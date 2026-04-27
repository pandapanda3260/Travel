import type { TaskClipShotRecord } from "./task-clip-store";
import type { VideoJobRecord } from "./video-job-store";

type ClipShotDefinition = {
  shotIndex: number;
};

type ClipCompletionJob = Pick<VideoJobRecord, "jobId" | "status" | "videoUrl" | "remoteVideoUrl">;

export type TaskClipCompletionState = {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  missingCount: number;
  allCompleted: boolean;
};

function isCompletedPlayableJob(job: ClipCompletionJob | null | undefined) {
  return job?.status === "COMPLETED" && Boolean(job.videoUrl || job.remoteVideoUrl);
}

export function resolveTaskClipCompletionState(input: {
  shotDefinitions: ClipShotDefinition[];
  clipRecords: Array<Pick<TaskClipShotRecord, "shotIndex" | "videoJobId">>;
  jobs: ClipCompletionJob[];
}): TaskClipCompletionState {
  const jobMap = new Map(input.jobs.map((job) => [job.jobId, job]));
  const recordMap = new Map(input.clipRecords.map((record) => [record.shotIndex, record]));

  let completedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let missingCount = 0;

  for (const shot of input.shotDefinitions) {
    const record = recordMap.get(shot.shotIndex);
    const job = record?.videoJobId ? jobMap.get(record.videoJobId) : null;

    if (!record || !job) {
      missingCount += 1;
      continue;
    }

    if (job.status === "FAILED") {
      failedCount += 1;
      continue;
    }

    if (isCompletedPlayableJob(job)) {
      completedCount += 1;
      continue;
    }

    pendingCount += 1;
  }

  const totalCount = input.shotDefinitions.length;
  return {
    totalCount,
    completedCount,
    pendingCount,
    failedCount,
    missingCount,
    allCompleted:
      totalCount > 0 && completedCount === totalCount && pendingCount === 0 && failedCount === 0 && missingCount === 0,
  };
}
