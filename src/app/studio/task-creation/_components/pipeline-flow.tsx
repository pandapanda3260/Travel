"use client";

import { countSubtitlePlanTextEntries } from "../../../../lib/subtitle-plan-source";
import {
  getVideoTaskTypeProfile,
  usesCapturedMaterialFirstWorkflow,
  type VideoTaskRecord,
  type VideoTaskStatus,
} from "../../../../lib/video-task-schema";

type PipelineStage = {
  key: PipelineStageKey;
  label: string;
  completedStatus: VideoTaskStatus;
  statusLabel: "idle" | "active" | "completed" | "error";
};

export type PipelineStageKey = "draft" | "subtitle_audio" | "images" | "clips" | "composition";

export type PipelineStageRuntime = {
  percent?: number | null;
  isRunning?: boolean;
  message?: string;
  hasError?: boolean;
};

export type PipelineMetricTone = "neutral" | "success" | "danger" | "progress";

export type PipelineMetricItem = {
  label: string;
  value: string;
  tone?: PipelineMetricTone;
};

export type VisualPipelineSummary = {
  totalCount: number;
  candidateReadyCount: number;
  finalSelectedCount: number;
};

export type ClipPipelineSummary = {
  totalCount: number;
  referenceBoundCount: number;
  silentClipCount: number;
  availableClipCount: number;
  failedClipCount: number;
};

const pipelineStages: Omit<PipelineStage, "statusLabel">[] = [
  {
    key: "draft",
    label: "镜头计划",
    completedStatus: "CREATED",
  },
  {
    key: "subtitle_audio",
    label: "字幕音频",
    completedStatus: "SUBTITLE_AUDIO_READY",
  },
  {
    key: "images",
    label: "参考图",
    completedStatus: "IMAGES_READY",
  },
  {
    key: "clips",
    label: "视频片段",
    completedStatus: "CLIPS_READY",
  },
  {
    key: "composition",
    label: "成片合成",
    completedStatus: "COMPOSITION_READY",
  },
];

const statusOrder: VideoTaskStatus[] = [
  "CREATED",
  "SUBTITLE_AUDIO_READY",
  "IMAGES_READY",
  "CLIPS_READY",
  "COMPOSITION_READY",
];

function getStatusIndex(status: VideoTaskStatus) {
  return statusOrder.indexOf(status);
}

function clampPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function getPipelineStageWeight(stageKey: PipelineStageKey, task: VideoTaskRecord) {
  const storyShotCount = Math.max(
    1,
    task.directorPlan?.storyShots.length ??
      task.shotPlan?.shots.length ??
      task.parameters.video.storyShotCount ??
      task.parameters.video.segmentCount,
  );
  const renderSegmentCount = Math.max(
    1,
    task.directorPlan?.renderSegments.length ?? task.parameters.video.segmentCount,
  );
  const audioCueCount =
    countSubtitlePlanTextEntries(task.directorPlan?.subtitlePlan) ||
    task.directorPlan?.renderSegments.filter((segment) => segment.hasVoice || segment.hasSubtitle).length ||
    0;
  const lipSyncSegmentCount =
    task.directorPlan?.renderSegments.filter((segment) =>
      task.directorPlan?.storyShots.some((shot) => shot.segmentId === segment.segmentId && shot.requiresLipSync),
    ).length ?? 0;
  const totalDurationSeconds = Math.max(
    1,
    task.directorPlan?.storyShots.reduce((sum, shot) => sum + Math.max(0, shot.durationSeconds || 0), 0) ??
      task.shotPlan?.totalDurationSeconds ??
      task.parameters.video.segmentCount * task.parameters.video.durationSeconds,
  );
  const videoTypeProfile = getVideoTaskTypeProfile(task.parameters.video.videoType);

  switch (stageKey) {
    case "draft":
      return 20_000 + storyShotCount * 550 + audioCueCount * 260;
    case "subtitle_audio":
      return videoTypeProfile.hasVoice || videoTypeProfile.hasSubtitle
        ? 3_000 + Math.max(1, audioCueCount) * 3_400
        : 1_200;
    case "images":
      return 2_000 + storyShotCount * 5_800;
    case "clips":
      return 5_000 + renderSegmentCount * 40_000 + lipSyncSegmentCount * 16_000;
    case "composition":
      return 4_000 + renderSegmentCount * 4_200 + totalDurationSeconds * 260;
    default:
      return 10_000;
  }
}

function resolveStagePercent(
  stage: (typeof pipelineStages)[number],
  task: VideoTaskRecord,
  runtime: Partial<Record<PipelineStageKey, PipelineStageRuntime>> | undefined,
) {
  const currentIndex = getStatusIndex(task.status);
  const stageIndex = getStatusIndex(stage.completedStatus);

  if (currentIndex >= stageIndex) {
    return 100;
  }

  return clampPercent(runtime?.[stage.key]?.percent);
}

function resolveStageStatus(
  stage: (typeof pipelineStages)[number],
  task: VideoTaskRecord,
  runtime: Partial<Record<PipelineStageKey, PipelineStageRuntime>> | undefined,
): PipelineStage["statusLabel"] {
  const currentIndex = getStatusIndex(task.status);
  const stageIndex = getStatusIndex(stage.completedStatus);
  const currentRuntime = runtime?.[stage.key];

  if (currentRuntime?.hasError) {
    return "error";
  }

  if (currentIndex >= stageIndex) return "completed";
  if (currentRuntime?.isRunning || clampPercent(currentRuntime?.percent) > 0) return "active";

  const previousStageIndex = stageIndex - 1;
  if (previousStageIndex >= 0 && currentIndex >= previousStageIndex) return "active";

  return "idle";
}

function getStageMetaText(stage: PipelineStage & { percent: number }) {
  if (stage.statusLabel === "completed") {
    return "已完成";
  }

  if (stage.statusLabel === "error") {
    return "异常";
  }

  if (stage.statusLabel === "active") {
    return stage.percent > 0 ? `${stage.percent}%` : "进行中";
  }

  return "待开始";
}

function getConnectorStatus(stage: PipelineStage["statusLabel"]) {
  if (stage === "completed") {
    return "completed";
  }

  if (stage === "active") {
    return "active";
  }

  if (stage === "error") {
    return "error";
  }

  return "idle";
}

export function PipelineFlow({
  task,
  stageRuntime,
  metrics = [],
}: {
  task: VideoTaskRecord | null;
  stageRuntime?: Partial<Record<PipelineStageKey, PipelineStageRuntime>>;
  metrics?: PipelineMetricItem[];
}) {
  if (!task) {
    return null;
  }

  const capturedMaterialFirst = usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType);
  const stages = pipelineStages.map((stage) => ({
    ...stage,
    label: capturedMaterialFirst && stage.key === "images" ? "素材镜头" : stage.label,
    statusLabel: resolveStageStatus(stage, task, stageRuntime),
    percent: resolveStagePercent(stage, task, stageRuntime),
    weight: getPipelineStageWeight(stage.key, task),
    message: stageRuntime?.[stage.key]?.message?.trim() || "",
  }));
  const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0);
  const totalPercent = clampPercent(
    totalWeight > 0 ? stages.reduce((sum, stage) => sum + stage.weight * stage.percent, 0) / totalWeight : 0,
  );
  const summaryTitle = `整体进度 · ${totalPercent}%`;

  return (
    <div className="pipeline-flow-container">
      <div className="pipeline-flow-header">
        <div className="pipeline-flow-title-group">
          <span className="pipeline-flow-title">生产流水线</span>
        </div>
        <div className="pipeline-flow-summary" aria-label={summaryTitle}>
          <span className="pipeline-flow-summary-title">{summaryTitle}</span>
        </div>
      </div>

      <div className="pipeline-flow-track">
        {stages.map((stage, index) => (
          <div key={stage.key} className="pipeline-flow-stage-wrapper">
            <div className={`pipeline-flow-stage pipeline-flow-stage--${stage.statusLabel}`}>
              <div className="pipeline-flow-stage-indicator">
                <div className="pipeline-flow-stage-dot">
                  {stage.statusLabel === "completed" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : stage.statusLabel === "active" ? (
                    <div className="pipeline-flow-stage-pulse" />
                  ) : (
                    <span className="pipeline-flow-stage-number">{index + 1}</span>
                  )}
                </div>
                {index < stages.length - 1 ? (
                  <div
                    className={`pipeline-flow-connector pipeline-flow-connector--${getConnectorStatus(stage.statusLabel)}`}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <div className="pipeline-flow-stage-content">
                <span className="pipeline-flow-stage-label">{stage.label}</span>
                <span className="pipeline-flow-stage-meta">{getStageMetaText(stage)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {metrics.length ? (
        <div className="pipeline-flow-metrics">
          {metrics.map((item) => (
            <div key={item.label} className={`pipeline-flow-metric pipeline-flow-metric--${item.tone ?? "neutral"}`}>
              <span className="pipeline-flow-metric-label">{item.label}</span>
              <strong className="pipeline-flow-metric-value">{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
