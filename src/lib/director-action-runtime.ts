import {
  isTaskStageProgressRunning,
  normalizeTaskStageProgressPercent,
  type TaskStageProgressSnapshot,
} from "./task-stage-progress";

type RuntimeWorkflowStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "partial_failed"
  | string
  | null
  | undefined;
type RuntimeStepStatus = "pending" | "running" | "success" | "failed" | string | null | undefined;

export type KeyMaterialActionRuntimeInput = {
  liveRunning?: boolean;
  liveMessage?: string | null;
  livePercent?: number | null;
  workflowStatus?: RuntimeWorkflowStatus;
  subtitleStepStatus?: RuntimeStepStatus;
  visualStepStatus?: RuntimeStepStatus;
  subtitleStageProgress?: TaskStageProgressSnapshot | null;
  visualStageProgress?: TaskStageProgressSnapshot | null;
  idleLabel: string;
  fallbackRunningLabel: string;
};

export type DirectorActionRuntime = {
  isRunning: boolean;
  label: string;
  progressPercent: number | null;
};

function isWorkflowStatusRunning(status: RuntimeWorkflowStatus) {
  return status === "pending" || status === "running";
}

function isStepStatusRunning(status: RuntimeStepStatus) {
  return status === "running";
}

function getLiveProgressPercent(value: number | null | undefined) {
  const percent = normalizeTaskStageProgressPercent(value ?? 0);
  return percent > 0 ? Math.max(1, percent) : 0;
}

export function resolveKeyMaterialActionRuntime(input: KeyMaterialActionRuntimeInput): DirectorActionRuntime {
  const subtitleStageRunning = isTaskStageProgressRunning(input.subtitleStageProgress);
  const visualStageRunning = isTaskStageProgressRunning(input.visualStageProgress);
  const subtitleStepRunning = isStepStatusRunning(input.subtitleStepStatus);
  const visualStepRunning = isStepStatusRunning(input.visualStepStatus);
  const isRunning = Boolean(
    input.liveRunning ||
    isWorkflowStatusRunning(input.workflowStatus) ||
    subtitleStageRunning ||
    visualStageRunning ||
    subtitleStepRunning ||
    visualStepRunning,
  );

  if (!isRunning) {
    return {
      isRunning: false,
      label: input.idleLabel,
      progressPercent: null,
    };
  }

  const liveProgress = getLiveProgressPercent(input.livePercent);
  if (liveProgress > 0) {
    return {
      isRunning: true,
      label: input.liveMessage?.trim() || input.fallbackRunningLabel,
      progressPercent: liveProgress,
    };
  }

  if (visualStageRunning || visualStepRunning) {
    const visualPercent = normalizeTaskStageProgressPercent(input.visualStageProgress?.percent ?? 0);
    return {
      isRunning: true,
      label: input.visualStageProgress?.message?.trim() || "视觉图片生成中...",
      progressPercent: Math.max(50, Math.min(99, 50 + Math.round(visualPercent / 2))),
    };
  }

  if (subtitleStageRunning || subtitleStepRunning) {
    const subtitlePercent = normalizeTaskStageProgressPercent(input.subtitleStageProgress?.percent ?? 0);
    return {
      isRunning: true,
      label: input.subtitleStageProgress?.message?.trim() || "字幕音频生成中...",
      progressPercent: Math.max(1, Math.min(49, Math.max(12, Math.round(subtitlePercent / 2)))),
    };
  }

  if (input.subtitleStepStatus === "success" && input.visualStepStatus === "pending") {
    return {
      isRunning: true,
      label: input.fallbackRunningLabel,
      progressPercent: 50,
    };
  }

  return {
    isRunning: true,
    label: input.fallbackRunningLabel,
    progressPercent: 1,
  };
}

export function resolveDirectorUpstreamBlockedReason(input: { planningRunning: boolean; keyMaterialRunning: boolean }) {
  if (input.planningRunning) {
    return "镜头规划处理中，请等待当前任务完成后再继续。";
  }

  if (input.keyMaterialRunning) {
    return "关键素材生成中，请等待当前任务完成后再继续。";
  }

  return null;
}
