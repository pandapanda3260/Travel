export const videoGenerationStepKeys = {
  clipGeneration: "clip_generation",
  composition: "composition",
} as const;

export type VideoGenerationStepKey = (typeof videoGenerationStepKeys)[keyof typeof videoGenerationStepKeys];
export type VideoGenerationWorkflowStatus = "pending" | "running" | "success" | "failed";
export type VideoGenerationStepStatus = "pending" | "running" | "success" | "failed";

export type VideoGenerationStepRecord = {
  stepKey: VideoGenerationStepKey;
  label: string;
  status: VideoGenerationStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  errorMessage: string | null;
};

export type VideoGenerationWorkflowRecord = {
  workflowId: string;
  taskId: string;
  ownerUserId: string | null;
  requestId: string;
  status: VideoGenerationWorkflowStatus;
  currentStepKey: VideoGenerationStepKey | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  requestSnapshot: Record<string, unknown> | null;
  steps: Record<VideoGenerationStepKey, VideoGenerationStepRecord>;
};

export function isVideoGenerationWorkflowRunning(
  workflow: Pick<VideoGenerationWorkflowRecord, "status"> | null | undefined,
) {
  return workflow?.status === "pending" || workflow?.status === "running";
}
