import {
  ensureLocalVideoForJob,
  getVideoJob,
  listVideoJobs,
  patchVideoJob,
  type VideoJobRecord,
} from "./video-job-store";
import { withAdminProviderCallTracking, writeAdminTaskStageRun } from "./admin-data-flow-tracking";
import { upsertMaterialLibraryItemBySource } from "./material-library-store";
import { triggerShotLipSync } from "./lip-sync-trigger";
import { resolveTaskClipCompletionState } from "./task-clip-completion";
import { getTaskClipNarrationResult, listTaskClipShots, parseTaskClipShots } from "./task-clip-store";
import { getVideoTask, patchVideoTask } from "./video-task-store";
import { getVideoTaskStatusIndex } from "./video-task-schema";
import { refreshProviderVideoJob } from "./video-provider";
import { getProviderRuntime } from "./video-provider-config";
import { confirmCommercialUsageCharge, releaseCommercialUsageCharge } from "./commercial-billing-gateway";

const activePollers = new Map<string, NodeJS.Timeout>();
const activeRefreshes = new Map<string, Promise<VideoJobRecord | null>>();

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "状态刷新失败");
}

function confirmCommercialChargeForCompletedJob(job: VideoJobRecord) {
  if (!job.commercialChargeFreezeId || job.commercialChargeStatus !== "frozen") {
    return job;
  }

  try {
    const confirmed = confirmCommercialUsageCharge({
      freezeId: job.commercialChargeFreezeId,
      idempotencyKey: `commercial:video:confirm:${job.jobId}`,
      provider: job.provider,
      modelId: job.modelId,
    });

    return (
      patchVideoJob(job.jobId, {
        commercialChargeStatus: "confirmed",
        logs: [...job.logs, `商业积分扣费已确认：${confirmed.transaction.changeCredits} 积分`],
      }) ?? job
    );
  } catch (error) {
    return (
      patchVideoJob(job.jobId, {
        logs: [...job.logs, `商业积分扣费确认失败：${toErrorMessage(error)}`],
      }) ?? job
    );
  }
}

function releaseCommercialChargeForFailedJob(job: VideoJobRecord) {
  if (!job.commercialChargeFreezeId || job.commercialChargeStatus !== "frozen") {
    return job;
  }

  try {
    releaseCommercialUsageCharge({
      freezeId: job.commercialChargeFreezeId,
      reason: "video_generation_failed",
    });

    return (
      patchVideoJob(job.jobId, {
        commercialChargeStatus: "released",
        logs: [...job.logs, "视频生成失败，商业积分冻结已释放"],
      }) ?? job
    );
  } catch (error) {
    return (
      patchVideoJob(job.jobId, {
        logs: [...job.logs, `商业积分冻结释放失败：${toErrorMessage(error)}`],
      }) ?? job
    );
  }
}

function stopPolling(jobId: string) {
  const timer = activePollers.get(jobId);

  if (timer) {
    clearInterval(timer);
    activePollers.delete(jobId);
  }
}

function markPollingTimedOut(jobId: string, attempts: number, maxAttempts: number) {
  const currentJob = getVideoJob(jobId);
  if (!currentJob || currentJob.status === "COMPLETED" || currentJob.status === "FAILED") {
    return currentJob;
  }

  const message = `视频生成后台轮询超时：已尝试 ${attempts}/${maxAttempts} 次，请重新生成该片段`;
  const failedJob = patchVideoJob(jobId, {
    status: "FAILED",
    error: message,
    logs: [...currentJob.logs, message],
  });
  return failedJob ? releaseCommercialChargeForFailedJob(failedJob) : failedJob;
}

async function refreshLiveJobOnce(jobId: string) {
  const job = getVideoJob(jobId);
  if (!job || job.mode !== "live") {
    return null;
  }

  const providerRuntime = getProviderRuntime(job.provider ?? undefined);
  let refreshed: Awaited<ReturnType<typeof refreshProviderVideoJob>>;
  try {
    refreshed = await withAdminProviderCallTracking(
      {
        enabled: providerRuntime.liveEnabled,
        serviceName: "video.refresh",
        provider: providerRuntime.providerLabel,
        modelId: job.modelId,
        objectType: "video_job",
        objectId: job.jobId,
      },
      () => refreshProviderVideoJob(job),
    );
  } catch (error) {
    const latestJob = getVideoJob(jobId) ?? job;
    patchVideoJob(jobId, {
      logs: [...latestJob.logs, `状态刷新失败：${toErrorMessage(error)}`],
    });
    throw error;
  }
  let patchedJob = patchVideoJob(jobId, refreshed);

  if (patchedJob?.status === "COMPLETED") {
    // 将 remoteVideoUrl 下载到本地，供合成和预览使用
    try {
      patchedJob = (await ensureLocalVideoForJob(jobId)) ?? patchedJob;
    } catch {
      /* 下载失败不阻断流程，合成时会重试远程 URL */
    }

    patchedJob = confirmCommercialChargeForCompletedJob(patchedJob);

    if (patchedJob?.sourceTaskId) {
      const completedSourceTaskId = patchedJob.sourceTaskId;
      if (patchedJob.videoUrl || patchedJob.remoteVideoUrl) {
        upsertMaterialLibraryItemBySource({
          type: "video",
          source: "video-generation-job",
          title: patchedJob.taskName || `任务片段 ${patchedJob.jobId}`,
          previewUrl: patchedJob.videoUrl ?? patchedJob.remoteVideoUrl ?? "",
          assetUrl: patchedJob.videoUrl ?? patchedJob.remoteVideoUrl ?? "",
          prompt: patchedJob.optimizedPrompt || patchedJob.originalPrompt,
          tags: [patchedJob.provider ?? "video", patchedJob.modelId ?? "unknown-model"].filter(Boolean),
          width: null,
          height: null,
          durationSeconds: patchedJob.resolvedDurationSeconds ?? patchedJob.generationSettings?.durationSeconds ?? null,
          aspectRatio: patchedJob.generationSettings?.aspectRatio ?? null,
          sourceSessionId: patchedJob.jobId,
        });
      }

      const task = getVideoTask(completedSourceTaskId);
      const clipCompletionState = task
        ? resolveTaskClipCompletionState({
            shotDefinitions: parseTaskClipShots(task, getTaskClipNarrationResult(task.taskId, task)),
            clipRecords: listTaskClipShots(task.taskId),
            jobs: listVideoJobs(),
          })
        : null;
      if (
        task &&
        clipCompletionState?.allCompleted &&
        getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("CLIPS_READY")
      ) {
        patchVideoTask(completedSourceTaskId, {
          status: "CLIPS_READY",
        });
      }

      const isLipSyncStyle = patchedJob.strategy.style === "Kling lip-sync 口型同步";
      const isClipJob = patchedJob.generationSettings?.sourceImageUrl && !isLipSyncStyle;
      const clipRecord = listTaskClipShots(completedSourceTaskId).find((r) => r.videoJobId === patchedJob!.jobId);

      if (clipRecord) {
        writeAdminTaskStageRun({
          runId: `clip:${completedSourceTaskId}:${clipRecord.shotIndex}:${clipRecord.generatedAt ?? job.submittedAt}`,
          taskId: completedSourceTaskId,
          stageKey: "clip_generation",
          status: "COMPLETED",
          provider: patchedJob.provider ?? providerRuntime.providerLabel,
          modelId: patchedJob.modelId,
          startedAt: clipRecord.generatedAt ?? job.submittedAt,
          finishedAt: patchedJob.updatedAt,
        });
      }

      if (isLipSyncStyle) {
        const lipSyncRecord = listTaskClipShots(completedSourceTaskId).find(
          (item) => item.lipSyncJobId === patchedJob!.jobId,
        );
        if (lipSyncRecord) {
          writeAdminTaskStageRun({
            runId: patchedJob.jobId,
            taskId: completedSourceTaskId,
            stageKey: "lip_sync",
            status: "COMPLETED",
            provider: patchedJob.provider ?? providerRuntime.providerLabel,
            modelId: patchedJob.modelId,
            startedAt: lipSyncRecord.updatedAt ?? job.submittedAt,
            finishedAt: patchedJob.updatedAt,
          });
        }
      }

      if (isClipJob) {
        if (clipRecord && !clipRecord.lipSyncJobId) {
          try {
            await triggerShotLipSync(completedSourceTaskId, clipRecord.shotIndex);
          } catch {
            /* 口型任务提交失败时保留无声片段，用户可重新生成该镜重试 */
          }
        }
      }
    }
  }

  if (patchedJob?.status === "FAILED" && patchedJob.sourceTaskId) {
    const failedSourceTaskId = patchedJob.sourceTaskId;
    const failedJob = releaseCommercialChargeForFailedJob(patchedJob);
    patchedJob = failedJob;
    const clipRecord = listTaskClipShots(failedSourceTaskId).find((item) => item.videoJobId === failedJob.jobId);
    if (clipRecord) {
      writeAdminTaskStageRun({
        runId: `clip:${failedSourceTaskId}:${clipRecord.shotIndex}:${clipRecord.generatedAt ?? job.submittedAt}`,
        taskId: failedSourceTaskId,
        stageKey: "clip_generation",
        status: "FAILED",
        provider: failedJob.provider ?? providerRuntime.providerLabel,
        modelId: failedJob.modelId,
        startedAt: clipRecord.generatedAt ?? job.submittedAt,
        finishedAt: failedJob.updatedAt,
        errorMessage: failedJob.error ?? "视频片段生成失败",
      });
    }

    const lipSyncRecord = listTaskClipShots(failedSourceTaskId).find(
      (item) => item.lipSyncJobId === failedJob.jobId,
    );
    if (lipSyncRecord) {
      writeAdminTaskStageRun({
        runId: failedJob.jobId,
        taskId: failedSourceTaskId,
        stageKey: "lip_sync",
        status: "FAILED",
        provider: failedJob.provider ?? providerRuntime.providerLabel,
        modelId: failedJob.modelId,
        startedAt: lipSyncRecord.updatedAt ?? job.submittedAt,
        finishedAt: failedJob.updatedAt,
        errorMessage: failedJob.error ?? "口型同步失败",
      });
    }
  }

  if (refreshed.status === "COMPLETED" || refreshed.status === "FAILED") {
    stopPolling(jobId);
  }

  return patchedJob;
}

export async function refreshLiveJob(jobId: string) {
  const activeRefresh = activeRefreshes.get(jobId);
  if (activeRefresh) {
    return activeRefresh;
  }

  const refresh = refreshLiveJobOnce(jobId).finally(() => {
    activeRefreshes.delete(jobId);
  });
  activeRefreshes.set(jobId, refresh);
  return refresh;
}

export function scheduleVideoJobPolling(jobId: string) {
  if (activePollers.has(jobId)) {
    return;
  }

  const currentJob = getVideoJob(jobId);
  const providerRuntime = getProviderRuntime(currentJob?.provider ?? undefined);
  const { backgroundPollIntervalSeconds } = providerRuntime;
  const backgroundMaxPollAttempts = Math.max(1, providerRuntime.backgroundMaxPollAttempts);
  let attempts = 0;
  let isRefreshing = false;

  const timer = setInterval(async () => {
    if (isRefreshing) {
      return;
    }
    attempts += 1;
    isRefreshing = true;

    const currentJob = getVideoJob(jobId);
    if (!currentJob || currentJob.mode !== "live") {
      isRefreshing = false;
      stopPolling(jobId);
      return;
    }

    if (currentJob.status === "COMPLETED" || currentJob.status === "FAILED") {
      isRefreshing = false;
      stopPolling(jobId);
      return;
    }

    try {
      await refreshLiveJob(jobId);
    } catch {
      if (attempts >= backgroundMaxPollAttempts) {
        markPollingTimedOut(jobId, attempts, backgroundMaxPollAttempts);
        stopPolling(jobId);
      }
      isRefreshing = false;
      return;
    }

    const nextJob = getVideoJob(jobId);
    if (!nextJob || nextJob.status === "COMPLETED" || nextJob.status === "FAILED") {
      isRefreshing = false;
      stopPolling(jobId);
      return;
    }

    if (attempts >= backgroundMaxPollAttempts) {
      markPollingTimedOut(jobId, attempts, backgroundMaxPollAttempts);
      stopPolling(jobId);
    }
    isRefreshing = false;
  }, backgroundPollIntervalSeconds * 1000);

  activePollers.set(jobId, timer);
}

export function ensurePendingVideoJobPolling(sourceTaskId?: string | null) {
  for (const job of listVideoJobs()) {
    if (job.mode !== "live") {
      continue;
    }

    if (sourceTaskId && job.sourceTaskId !== sourceTaskId) {
      continue;
    }

    if (job.status === "QUEUED" || job.status === "IN_PROGRESS") {
      void refreshLiveJob(job.jobId).catch(() => null);
      scheduleVideoJobPolling(job.jobId);
    }
  }
}

export function createVideoJobRecord(input: {
  jobId: string;
  sourceTaskId?: string | null;
  taskName: string;
  originalPrompt: string;
  optimizedPrompt: string;
  strategy: VideoJobRecord["strategy"];
  submittedAt: string;
  status: VideoJobRecord["status"];
  mode: VideoJobRecord["mode"];
  logs: string[];
  videoUrl?: string | null;
  remoteVideoUrl?: string | null;
  error?: string | null;
  provider?: VideoJobRecord["provider"];
  modelId?: string | null;
  generationSettings?: VideoJobRecord["generationSettings"];
  commercialChargeFreezeId?: string | null;
  commercialChargeStatus?: VideoJobRecord["commercialChargeStatus"];
}) {
  return {
    jobId: input.jobId,
    sourceTaskId: input.sourceTaskId ?? null,
    taskName: input.taskName,
    originalPrompt: input.originalPrompt,
    optimizedPrompt: input.optimizedPrompt,
    strategy: input.strategy,
    submittedAt: input.submittedAt,
    updatedAt: input.submittedAt,
    status: input.status,
    mode: input.mode,
    logs: input.logs,
    videoUrl: input.videoUrl ?? null,
    remoteVideoUrl: input.remoteVideoUrl ?? null,
    error: input.error ?? null,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    generationSettings: input.generationSettings ?? null,
    resolvedDurationSeconds: null,
    commercialChargeFreezeId: input.commercialChargeFreezeId ?? null,
    commercialChargeStatus: input.commercialChargeStatus ?? null,
    deletedAt: null,
  } satisfies VideoJobRecord;
}
