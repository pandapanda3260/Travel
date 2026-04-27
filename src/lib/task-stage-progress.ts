import type { TaskWorkflowEventRecord } from "./task-workflow-event-store";

export const taskStageProgressKeys = {
  shotPlan: "shot_plan",
  subtitleAudio: "subtitle_audio",
  visualImages: "visual_images",
  clipGeneration: "clip_generation",
  composition: "composition",
} as const;

export type TaskStageProgressKey = (typeof taskStageProgressKeys)[keyof typeof taskStageProgressKeys];

export type TaskStageProgressStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type TaskStageProgressSnapshot = {
  taskId: string;
  stageKey: TaskStageProgressKey;
  runId: string;
  status: TaskStageProgressStatus;
  percent: number;
  message: string;
  provider: string | null;
  modelId: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type TaskStageProgressPayload = {
  taskId: string;
  stages: Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>;
  events?: TaskWorkflowEventRecord[];
};

export function filterTaskStageProgressByTaskId(
  stages: Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>,
  taskId: string | null | undefined,
) {
  if (!taskId) {
    return {} as Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>;
  }

  return Object.fromEntries(
    Object.entries(stages).filter(([, progress]) => progress?.taskId === taskId),
  ) as Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>;
}

export function normalizeTaskStageProgressPercent(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function isTaskStageProgressRunning(progress: TaskStageProgressSnapshot | null | undefined) {
  return progress?.status === "QUEUED" || progress?.status === "IN_PROGRESS";
}
