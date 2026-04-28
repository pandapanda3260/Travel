export type DirectorVideoGenerationProgressJob = {
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  submittedAt: string;
  updatedAt?: string | null;
};

function getElapsedMs(timestamp: string | null | undefined, nowMs: number) {
  if (!timestamp) {
    return 0;
  }
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value > 0 ? Math.max(0, nowMs - value) : 0;
}

function getTimedStageRatio(elapsedMs: number, estimateMs: number, cap = 0.96) {
  return Math.min(Math.max(0, elapsedMs) / Math.max(1_000, estimateMs), cap);
}

function getVideoJobEstimateMs(durationSeconds: number) {
  return 18_000 + Math.max(0, durationSeconds) * 3_600;
}

export function estimateDirectorVideoGenerationProgressPercent(
  job: DirectorVideoGenerationProgressJob | null,
  nowMs: number,
  durationSeconds: number,
) {
  if (!job) {
    return 0;
  }

  const submittedElapsedMs = getElapsedMs(job.submittedAt, nowMs);
  if (job.status === "QUEUED") {
    return Math.round((0.04 + 0.08 * getTimedStageRatio(submittedElapsedMs, 8_000)) * 100);
  }
  if (job.status === "IN_PROGRESS") {
    return Math.round((0.14 + 0.58 * getTimedStageRatio(submittedElapsedMs, getVideoJobEstimateMs(durationSeconds))) * 100);
  }
  return 0;
}
