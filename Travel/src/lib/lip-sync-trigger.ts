import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getTaskClipNarrationResult,
  getTaskClipShot,
  upsertTaskClipShot,
} from "./task-clip-store";
import {
  ensureLocalVideoForJob,
  getVideoJob,
  upsertVideoJob,
  deriveTaskName,
} from "./video-job-store";
import { createVideoJobRecord, scheduleVideoJobPolling } from "./video-job-runner";
import { submitLipSyncJob } from "./video-provider";
import { getVideoTask } from "./video-task-store";

function audioFileToBase64(audioUrl: string): string {
  if (!audioUrl.startsWith("/")) {
    throw new Error("仅支持本地音频文件进行口型同步");
  }
  const absolutePath = join(process.cwd(), "public", audioUrl.replace(/^\//, ""));
  return readFileSync(absolutePath).toString("base64");
}

async function resolveVideoRemoteUrl(jobId: string): Promise<string | null> {
  const ensured = await ensureLocalVideoForJob(jobId);
  const job = ensured ?? getVideoJob(jobId);
  return job?.remoteVideoUrl
    ?? (job?.videoUrl?.startsWith("http") ? job.videoUrl : null);
}

export async function triggerShotLipSync(taskId: string, shotIndex: number): Promise<string | null> {
  const task = getVideoTask(taskId);
  if (!task) return null;

  const narrationResult = getTaskClipNarrationResult(taskId);
  if (!narrationResult) return null;

  const clipRecord = getTaskClipShot(taskId, shotIndex);
  if (!clipRecord?.videoJobId) return null;

  if (clipRecord.lipSyncJobId) {
    const existing = getVideoJob(clipRecord.lipSyncJobId);
    if (existing && (existing.status === "QUEUED" || existing.status === "IN_PROGRESS" || existing.status === "COMPLETED")) {
      return existing.jobId;
    }
  }

  const originalJob = getVideoJob(clipRecord.videoJobId);
  if (!originalJob || originalJob.status !== "COMPLETED") return null;

  const narrationClip = narrationResult.clips.find((clip) => clip.shotIndex === shotIndex);
  if (!narrationClip?.audioUrl) return null;

  const videoRemoteUrl = await resolveVideoRemoteUrl(originalJob.jobId);
  if (!videoRemoteUrl) return null;

  const audioBase64 = audioFileToBase64(narrationClip.audioUrl);

  const submission = await submitLipSyncJob({ videoUrl: videoRemoteUrl, audioBase64 });

  const submittedAt = new Date().toISOString();
  const record = createVideoJobRecord({
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
  scheduleVideoJobPolling(record.jobId);

  upsertTaskClipShot({
    ...clipRecord,
    lipSyncJobId: record.jobId,
    updatedAt: submittedAt,
  });

  return record.jobId;
}
