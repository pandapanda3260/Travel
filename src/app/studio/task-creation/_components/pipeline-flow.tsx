"use client";

import type { VideoTaskRecord, VideoTaskStatus } from "../../../../lib/video-task-schema";

type PipelineStage = {
  key: string;
  label: string;
  description: string;
  completedStatus: VideoTaskStatus;
  statusLabel: "idle" | "active" | "completed" | "error";
};

const pipelineStages: Omit<PipelineStage, "statusLabel">[] = [
  {
    key: "draft",
    label: "镜头计划 & 提示词",
    description: "Shot Plan → 文生图/图生视频/解说词",
    completedStatus: "CREATED",
  },
  {
    key: "subtitle_audio",
    label: "字幕 & 音频",
    description: "解说词 → TTS → 音频 + 字幕",
    completedStatus: "SUBTITLE_AUDIO_READY",
  },
  {
    key: "images",
    label: "图片生成",
    description: "文生图提示词 → Seedream → 分镜图片",
    completedStatus: "IMAGES_READY",
  },
  {
    key: "clips",
    label: "视频片段",
    description: "图片 + 提示词 → Kling I2V → 无声视频",
    completedStatus: "CLIPS_READY",
  },
  {
    key: "lip_sync",
    label: "口型同步",
    description: "无声视频 + 音频 → Kling lip-sync",
    completedStatus: "CLIPS_READY",
  },
  {
    key: "composition",
    label: "合成成片",
    description: "口型同步视频 + 字幕 → FFmpeg → 最终视频",
    completedStatus: "COMPOSITION_READY",
  },
];

const statusOrder: VideoTaskStatus[] = [
  "CREATED",
  "SUBTITLE_AUDIO_READY",
  "IMAGES_READY",
  "CLIPS_READY",
  "COMPOSITION_READY",
  "VIDEO_BURN_READY",
];

function getStatusIndex(status: VideoTaskStatus) {
  return statusOrder.indexOf(status);
}

function resolveStageStatus(
  stage: (typeof pipelineStages)[number],
  task: VideoTaskRecord,
  lipSyncReady: boolean,
): PipelineStage["statusLabel"] {
  const currentIndex = getStatusIndex(task.status);
  const stageIndex = getStatusIndex(stage.completedStatus);

  if (stage.key === "lip_sync") {
    if (currentIndex < getStatusIndex("CLIPS_READY")) return "idle";
    if (lipSyncReady) return "completed";
    if (currentIndex >= getStatusIndex("CLIPS_READY")) return "active";
    return "idle";
  }

  if (currentIndex > stageIndex) return "completed";
  if (currentIndex === stageIndex) return "completed";

  const previousStageIndex = stageIndex - 1;
  if (previousStageIndex >= 0 && currentIndex >= previousStageIndex) return "active";

  return "idle";
}

export function PipelineFlow({
  task,
  lipSyncReady,
}: {
  task: VideoTaskRecord | null;
  lipSyncReady: boolean;
}) {
  if (!task) {
    return null;
  }

  const stages = pipelineStages.map((stage) => ({
    ...stage,
    statusLabel: resolveStageStatus(stage, task, lipSyncReady),
  }));

  return (
    <div className="pipeline-flow-container">
      <div className="pipeline-flow-header">
        <span className="pipeline-flow-title">生产流水线</span>
        <span className="pipeline-flow-task-id">{task.title}</span>
      </div>
      <div className="pipeline-flow-track">
        {stages.map((stage, index) => (
          <div key={stage.key} className="pipeline-flow-stage-wrapper">
            <div className={`pipeline-flow-stage pipeline-flow-stage--${stage.statusLabel}`}>
              <div className="pipeline-flow-stage-indicator">
                <div className="pipeline-flow-stage-dot">
                  {stage.statusLabel === "completed" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : stage.statusLabel === "active" ? (
                    <div className="pipeline-flow-stage-pulse" />
                  ) : (
                    <span className="pipeline-flow-stage-number">{index + 1}</span>
                  )}
                </div>
                {index < stages.length - 1 && (
                  <div className={`pipeline-flow-connector pipeline-flow-connector--${stage.statusLabel === "completed" ? "completed" : "idle"}`} />
                )}
              </div>
              <div className="pipeline-flow-stage-content">
                <span className="pipeline-flow-stage-label">{stage.label}</span>
                <span className="pipeline-flow-stage-desc">{stage.description}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
