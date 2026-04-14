import {
  ensureLocalVideoForJob,
  getVideoJob,
  listVideoJobs,
  patchVideoJob,
  type VideoJobRecord,
} from "./video-job-store";
import { triggerShotLipSync } from "./lip-sync-trigger";
import { listTaskClipShots } from "./task-clip-store";
import { getVideoTask, patchVideoTask } from "./video-task-store";
import { getVideoTaskStatusIndex } from "./video-task-schema";
import { refreshProviderVideoJob } from "./video-provider";
import { getProviderRuntime } from "./video-provider-config";

const activePollers = new Map<string, NodeJS.Timeout>();

function stopPolling(jobId: string) {
  const timer = activePollers.get(jobId);

  if (timer) {
    clearInterval(timer);
    activePollers.delete(jobId);
  }
}

export async function refreshLiveJob(jobId: string) {
  const job = getVideoJob(jobId);
  if (!job || job.mode !== "live") {
    return null;
  }

  const refreshed = await refreshProviderVideoJob(job);
  let patchedJob = patchVideoJob(jobId, refreshed);

  if (patchedJob?.status === "COMPLETED") {
    // 将 remoteVideoUrl 下载到本地，供合成和预览使用
    try {
      patchedJob = (await ensureLocalVideoForJob(jobId)) ?? patchedJob;
    } catch {
      /* 下载失败不阻断流程，合成时会重试远程 URL */
    }

    if (patchedJob?.sourceTaskId) {
      const task = getVideoTask(patchedJob.sourceTaskId);
      if (task && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("CLIPS_READY")) {
        patchVideoTask(patchedJob.sourceTaskId, {
          status: "CLIPS_READY",
        });
      }

      const isClipJob = patchedJob.generationSettings?.sourceImageUrl && patchedJob.strategy.style !== "Kling lip-sync 口型同步";
      if (isClipJob) {
        const clipRecord = listTaskClipShots(patchedJob.sourceTaskId).find((r) => r.videoJobId === patchedJob!.jobId);
        if (clipRecord && !clipRecord.lipSyncJobId) {
          try {
            await triggerShotLipSync(patchedJob.sourceTaskId, clipRecord.shotIndex);
          } catch {
            /* 口型任务提交失败时保留无声片段，用户可重新生成该镜重试 */
          }
        }
      }
    }
  }

  if (refreshed.status === "COMPLETED" || refreshed.status === "FAILED") {
    stopPolling(jobId);
  }

  return patchedJob;
}

export function scheduleVideoJobPolling(jobId: string) {
  if (activePollers.has(jobId)) {
    return;
  }

  const currentJob = getVideoJob(jobId);
  const providerRuntime = getProviderRuntime(currentJob?.provider ?? undefined);
  const { backgroundPollIntervalSeconds, backgroundMaxPollAttempts } = providerRuntime;
  let attempts = 0;

  const timer = setInterval(async () => {
    attempts += 1;

    const currentJob = getVideoJob(jobId);
    if (!currentJob || currentJob.mode !== "live") {
      stopPolling(jobId);
      return;
    }

    if (currentJob.status === "COMPLETED" || currentJob.status === "FAILED") {
      stopPolling(jobId);
      return;
    }

    try {
      await refreshLiveJob(jobId);
    } catch {
      if (attempts >= backgroundMaxPollAttempts) {
        stopPolling(jobId);
      }
      return;
    }

    const nextJob = getVideoJob(jobId);
    if (!nextJob || nextJob.status === "COMPLETED" || nextJob.status === "FAILED") {
      stopPolling(jobId);
      return;
    }

    if (attempts >= backgroundMaxPollAttempts) {
      stopPolling(jobId);
    }
  }, backgroundPollIntervalSeconds * 1000);

  activePollers.set(jobId, timer);
}

export function ensurePendingVideoJobPolling() {
  for (const job of listVideoJobs()) {
    if (job.mode !== "live") {
      continue;
    }

    if (job.status === "QUEUED" || job.status === "IN_PROGRESS") {
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
    deletedAt: null,
  } satisfies VideoJobRecord;
}
