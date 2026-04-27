import { listAccessibleProductArchives, listProductArchives } from "./product-archive-store";
import { getTaskGenerationRuntime } from "./task-generation-runtime";
import { listTaskCreationVoiceOptions } from "./task-creation-voice-options";
import { listTaskClipShots } from "./task-clip-store";
import { listVideoTaskReferenceMaterials } from "./video-material-store";
import { ensurePendingVideoJobPolling } from "./video-job-runner";
import { listVideoJobs, type VideoJobRecord } from "./video-job-store";
import { listAccessibleVideoTasks, listVideoTasks } from "./video-task-store";
import { reconcileVideoTaskRuntimeStatus } from "./video-task-runtime-status";
import {
  videoTaskStatusFlow,
  type VideoTaskGeneratedVideoRecord,
  type VideoTaskGeneratedVideoType,
  type VideoTaskRecord,
} from "./video-task-schema";

export type TaskCreationIndexPayload = {
  tasks: VideoTaskRecord[];
  generatedVideos?: VideoTaskGeneratedVideoRecord[];
  productOptions: Array<{
    id: string;
    title: string;
    snapshot: string;
  }>;
  referenceVideoMaterialOptions: Array<{
    materialId: string;
    name: string;
    videoTemplatePrompt: string;
  }>;
  runtime: {
    textProviderLabel: string;
    textLiveEnabled: boolean;
    textModelId: string;
    productInfoReady: boolean;
    voiceOptions?: Awaited<ReturnType<typeof listTaskCreationVoiceOptions>>;
  };
  statusFlow: typeof videoTaskStatusFlow;
};

async function buildGeneratedVideoRecords(tasks: VideoTaskRecord[]): Promise<VideoTaskGeneratedVideoRecord[]> {
  const internalShotJobIds = new Set(
    listTaskClipShots()
      .flatMap((record) => [record.videoJobId, record.lipSyncJobId])
      .filter((jobId): jobId is string => Boolean(jobId)),
  );
  const terminalJobs = listVideoJobs().filter(
    (job) =>
      (job.status === "COMPLETED" || job.status === "FAILED") &&
      !internalShotJobIds.has(job.jobId),
  );
  const assignments = new Map<string, VideoJobRecord>();

  for (const task of tasks) {
    const directorTaskRequiresComposition = Boolean(task.shotPlan || task.directorPlan);
    const taskJobs = terminalJobs
      .filter((job) => job.sourceTaskId === task.taskId)
      .filter((job) => !directorTaskRequiresComposition || job.mode === "composition")
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

    if (taskJobs[0]) {
      assignments.set(task.taskId, taskJobs[0]);
    }
  }

  const records: VideoTaskGeneratedVideoRecord[] = [];

  for (const task of tasks) {
    const job = assignments.get(task.taskId);
    if (!job) {
      continue;
    }

    const type: VideoTaskGeneratedVideoType = job.mode === "composition" ? "DIRECTOR" : "AUTO";

    records.push({
      taskId: task.taskId,
      taskTitle: task.title,
      videoJobId: job.jobId,
      type,
      status: job.status === "FAILED" ? "FAILED" : "COMPLETED",
      createdAt: task.createdAt,
      originalPrompt: job.originalPrompt,
      optimizedPrompt: job.optimizedPrompt,
      videoUrl: job.videoUrl,
      modelId: job.modelId,
      resolvedDurationSeconds: job.resolvedDurationSeconds,
      generationSettings: job.generationSettings
        ? {
            durationSeconds: job.generationSettings.durationSeconds,
            aspectRatio: job.generationSettings.aspectRatio,
            shotType: job.generationSettings.shotType,
            generateAudio: job.generationSettings.generateAudio,
            negativePrompt: job.generationSettings.negativePrompt,
          }
        : null,
      error: job.error,
    });
  }

  return records;
}

export async function getGeneratedVideoRecordForTask(task: VideoTaskRecord) {
  const records = await buildGeneratedVideoRecords([task]);
  return records[0] ?? null;
}

export async function getTaskCreationIndexPayload(options?: {
  includeVoiceOptions?: boolean;
  resumePendingVideoJobs?: boolean;
  userId?: string | null;
}): Promise<TaskCreationIndexPayload> {
  const includeVoiceOptions = options?.includeVoiceOptions ?? true;
  const resumePendingVideoJobs = options?.resumePendingVideoJobs ?? true;
  const userId = options?.userId ?? null;

  if (resumePendingVideoJobs) {
    ensurePendingVideoJobPolling();
  }

  const runtime = getTaskGenerationRuntime();
  const rawTasks = userId ? listAccessibleVideoTasks(userId) : listVideoTasks();
  const tasks = rawTasks
    .map((task) => reconcileVideoTaskRuntimeStatus(task.taskId) ?? task)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const productArchives = userId ? listAccessibleProductArchives(userId) : listProductArchives();
  const referenceVideoMaterialOptions = listVideoTaskReferenceMaterials(userId ?? undefined);
  const voiceOptionsPromise = includeVoiceOptions ? listTaskCreationVoiceOptions(userId ?? undefined) : Promise.resolve([]);
  const [generatedVideosResult, voiceOptionsResult] = await Promise.allSettled([
    buildGeneratedVideoRecords(tasks),
    voiceOptionsPromise,
  ]);

  return {
    tasks,
    generatedVideos: generatedVideosResult.status === "fulfilled" ? generatedVideosResult.value : [],
    statusFlow: videoTaskStatusFlow,
    runtime: {
      textProviderLabel: runtime.providerLabel,
      textLiveEnabled: runtime.liveEnabled,
      textModelId: runtime.modelId,
      productInfoReady: productArchives.length > 0,
      voiceOptions: voiceOptionsResult.status === "fulfilled" ? voiceOptionsResult.value : [],
    },
    productOptions: productArchives.map((item) => ({
      id: item.archiveId,
      title: item.title,
      snapshot: item.parsedText.trim() || item.parsedData.sellingPoints.join("，"),
    })),
    referenceVideoMaterialOptions,
  };
}
