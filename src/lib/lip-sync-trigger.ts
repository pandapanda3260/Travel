import { readFileSync } from "node:fs";

import { withAdminProviderCallTracking, writeAdminTaskStageRun } from "./admin-data-flow-tracking";
import { getTaskClipNarrationResult, getTaskClipShot, upsertTaskClipShot } from "./task-clip-store";
import { runWithModelUsageContext } from "./model-usage-context";
import { ensureLocalVideoForJob, getVideoJob, upsertVideoJob, deriveTaskName } from "./video-job-store";
import { createVideoJobRecord, scheduleVideoJobPolling } from "./video-job-runner";
import { createMockLipSyncVideo } from "./mock-aigc-assets";
import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { getLipSyncProviderRuntime } from "./video-provider-config";
import { submitLipSyncJob } from "./video-provider";
import { getVideoTask } from "./video-task-store";
import { getTaskDirectorPlan } from "./video-task-director";
import { getVideoTaskTypeProfile } from "./video-task-schema";

function audioFileToBase64(audioUrl: string): string {
  if (!audioUrl.startsWith("/")) {
    throw new Error("仅支持本地音频文件进行口型同步");
  }
  const absolutePath = resolveRuntimeAssetUrlToPath(audioUrl);
  return readFileSync(absolutePath).toString("base64");
}

async function resolveVideoRemoteUrl(jobId: string): Promise<string | null> {
  const ensured = await ensureLocalVideoForJob(jobId);
  const job = ensured ?? getVideoJob(jobId);
  return job?.remoteVideoUrl ?? (job?.videoUrl?.startsWith("http") ? job.videoUrl : null);
}

export async function triggerShotLipSync(taskId: string, shotIndex: number): Promise<string | null> {
  const task = getVideoTask(taskId);
  if (!task) return null;

  const typeProfile = getVideoTaskTypeProfile(task.parameters.video.videoType);
  if (!typeProfile.requiresLipSync) {
    return null;
  }

  const runTrigger = async () => {
    const directorPlan = getTaskDirectorPlan(task);
    const targetShot =
      directorPlan.storyShots.find((shot) => shot.shotIndex === shotIndex) ??
      directorPlan.renderSegments.find((segment) => segment.segmentIndex === shotIndex);

    if (targetShot && !targetShot.requiresLipSync) {
      return null;
    }

    const narrationResult = getTaskClipNarrationResult(taskId);
    if (!narrationResult) return null;

    const clipRecord = getTaskClipShot(taskId, shotIndex);
    if (!clipRecord?.videoJobId) return null;

    if (clipRecord.lipSyncJobId) {
      const existing = getVideoJob(clipRecord.lipSyncJobId);
      if (
        existing &&
        (existing.status === "QUEUED" || existing.status === "IN_PROGRESS" || existing.status === "COMPLETED")
      ) {
        return existing.jobId;
      }
    }

    const originalJob = getVideoJob(clipRecord.videoJobId);
    if (!originalJob || originalJob.status !== "COMPLETED") return null;

    const narrationClip = narrationResult.clips.find((clip) => clip.shotIndex === shotIndex);
    if (!narrationClip?.audioUrl) return null;

    const videoRemoteUrl = await resolveVideoRemoteUrl(originalJob.jobId);
    if (!videoRemoteUrl) return null;

    const submittedAt = new Date().toISOString();
    const runtime = getLipSyncProviderRuntime();
    let record;
    const failRunId = `lip_sync:${taskId}:${shotIndex}:${submittedAt}`;

    if (!runtime.liveEnabled) {
      const mockJobId = crypto.randomUUID();
      const mockVideo = await createMockLipSyncVideo({
        taskId,
        jobId: mockJobId,
        sourceVideoUrl: originalJob.videoUrl ?? videoRemoteUrl,
      });
      record = createVideoJobRecord({
        jobId: mockJobId,
        sourceTaskId: taskId,
        taskName: deriveTaskName(`${task.title} 镜头${shotIndex} 口型同步`),
        originalPrompt: `口型同步：镜头 ${shotIndex}`,
        optimizedPrompt: `口型同步：镜头 ${shotIndex}，原始视频 ${originalJob.jobId}`,
        strategy: {
          angle: `镜头 ${shotIndex}`,
          hook: narrationClip.subtitleText,
          style: "Kling lip-sync 口型同步",
        },
        submittedAt,
        status: "COMPLETED",
        mode: "mock",
        logs: [
          "视频 provider 未启用，已切换为 Mock 口型同步结果。",
          "当前结果复用了原始片段视频，仅用于保证链路闭环与合成可继续。",
        ],
        videoUrl: mockVideo.videoUrl,
        provider: null,
        modelId: "mock/local-lip-sync",
        generationSettings: originalJob.generationSettings,
      });
      record = upsertVideoJob(record);
      writeAdminTaskStageRun({
        runId: record.jobId,
        taskId,
        stageKey: "lip_sync",
        status: "COMPLETED",
        provider: "Mock 本地口型同步",
        modelId: "mock/local-lip-sync",
        startedAt: submittedAt,
        finishedAt: record.updatedAt,
      });
    } else {
      try {
        const audioBase64 = audioFileToBase64(narrationClip.audioUrl);
        const submission = await withAdminProviderCallTracking(
          {
            enabled: true,
            serviceName: "video.lip_sync_submit",
            provider: runtime.providerLabel,
            modelId: runtime.modelId,
            objectType: "video_task_lip_sync",
            objectId: `${taskId}:${shotIndex}`,
          },
          () => submitLipSyncJob({ videoUrl: videoRemoteUrl, audioBase64 }),
        );
        record = createVideoJobRecord({
          jobId: submission.jobId,
          sourceTaskId: taskId,
          taskName: deriveTaskName(`${task.title} 镜头${shotIndex} 口型同步`),
          originalPrompt: `口型同步：镜头 ${shotIndex}`,
          optimizedPrompt: `口型同步：镜头 ${shotIndex}，原始视频 ${originalJob.jobId}`,
          strategy: {
            angle: `镜头 ${shotIndex}`,
            hook: narrationClip.subtitleText,
            style: "Kling lip-sync 口型同步",
          },
          submittedAt,
          status: "QUEUED",
          mode: "live",
          logs: submission.logs,
          provider: submission.provider,
          modelId: submission.modelId,
          generationSettings: originalJob.generationSettings,
        });
        upsertVideoJob(record);
        writeAdminTaskStageRun({
          runId: record.jobId,
          taskId,
          stageKey: "lip_sync",
          status: "QUEUED",
          provider: submission.provider ?? runtime.providerLabel,
          modelId: submission.modelId,
          startedAt: submittedAt,
        });
        scheduleVideoJobPolling(record.jobId);
      } catch (error) {
        writeAdminTaskStageRun({
          runId: failRunId,
          taskId,
          stageKey: "lip_sync",
          status: "FAILED",
          provider: runtime.providerLabel,
          modelId: runtime.modelId,
          startedAt: submittedAt,
          finishedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : "口型同步提交失败",
        });
        throw error;
      }
    }

    upsertTaskClipShot({
      ...clipRecord,
      lipSyncJobId: record.jobId,
      updatedAt: submittedAt,
    });

    return record.jobId;
  };

  if (!task.ownerUserId) {
    return runTrigger();
  }

  return runWithModelUsageContext(
    {
      userId: task.ownerUserId,
      routePath: "/internal/video-tasks/lip-sync",
      objectType: "video_task",
      objectId: taskId,
    },
    runTrigger,
  );
}
