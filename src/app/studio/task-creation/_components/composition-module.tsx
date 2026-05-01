"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";

import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
  getDirectorPrimaryStepButtonLabel,
} from "../../../../lib/director-step-actions";
import { type SubtitleConfig } from "../../../../lib/subtitle-style-config";
import type { TaskClipSourceShot } from "../../../../lib/task-clip-store";
import { isTaskStageProgressRunning, type TaskStageProgressSnapshot } from "../../../../lib/task-stage-progress";
import type { VideoTaskRecord } from "../../../../lib/video-task-schema";
import { useVideoTimecode } from "../../../_components/use-video-timecode";

import { parseApiResponse } from "./api-response";
import { type TaskStepActionState } from "./task-ui";
import { useStreamProgress } from "./use-stream-progress";
import { CompositionSettingsPanel } from "./composition-settings-panel";

type CompositionTransition = "cut" | "fade";

type CompositionMaterial = {
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  shotTitle: string;
  segmentMode?: string;
  requiresLipSync?: boolean;
  videoPrompt: string;
  subtitleText: string;
  narrationText: string;
  durationSeconds: number;
  visualImageSessionId: string | null;
  visualImageUrl: string | null;
  wordTimeline: Array<{
    word: string;
    startTime: number;
    endTime: number;
  }>;
  clipRecord: {
    videoJobId: string;
    generatedAt: string;
    thumbnailUrl: string | null;
  } | null;
  job: {
    jobId: string;
    status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    submittedAt: string;
    updatedAt: string;
    videoUrl: string | null;
    modelId: string | null;
    generationSettings: {
      durationSeconds: number;
      aspectRatio: "16:9" | "9:16" | "1:1";
      shotType: string;
      generateAudio: boolean;
      negativePrompt: string;
      mode: "std" | "pro";
      cfgScale: number;
      cameraControl: string;
      watermark: boolean;
    } | null;
  } | null;
  thumbnailUrl: string | null;
  sourceShots: TaskClipSourceShot[];
};

type CompositionRecord = {
  compositionId: string;
  title: string;
  status: "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
  outputVideoUrl: string | null;
  backgroundMusicUrl: string | null;
  backgroundMusicVolume: number;
  transitionMode: CompositionTransition;
  transitionDurationSeconds: number;
  audioMode: string;
  subtitleSrtUrl: string | null;
  subtitleConfig: SubtitleConfig;
  createdAt: string;
  updatedAt: string;
  segments: Array<{
    sourceJobId: string;
    order: number;
    transition: CompositionTransition;
    note?: string;
    durationSeconds?: number | null;
  }>;
};

type CompositionModuleResponse = {
  task?: VideoTaskRecord;
  clipShots?: CompositionMaterial[];
  narrationResult?: {
    clips: Array<unknown>;
    updatedAt?: string;
    subtitleSrtUrl?: string | null;
  } | null;
  latestComposition?: CompositionRecord | null;
  latestPlayableComposition?: CompositionRecord | null;
  statusSummary?: {
    clipCount: number;
    completedClipCount: number;
    subtitleReady: boolean;
    narrationReady: boolean;
    subtitleSourceLabel?: string;
    narrationSourceLabel?: string;
    latestResultAt: string;
  };
  runtime?: {
    serviceLabel: string;
    available: boolean;
    statusLabel: string;
  };
  result?: CompositionRecord | null;
  error?: string;
};

type TimelineSegmentSummary = {
  segmentId: string;
  shotIndex: number;
  shotTitle: string;
  durationSeconds: number;
};

function toCssAspectRatio(aspectRatio: "16:9" | "9:16" | "1:1" | null | undefined) {
  switch (aspectRatio) {
    case "16:9":
      return "16 / 9";
    case "1:1":
      return "1 / 1";
    case "9:16":
    default:
      return "9 / 16";
  }
}

function resolveSceneTypeLabel(sceneType: TaskClipSourceShot["sceneType"]) {
  switch (sceneType) {
    case "exterior":
      return "酒店外观";
    case "lobby":
      return "大堂";
    case "room":
      return "客房";
    case "bathroom":
      return "卫浴";
    case "dining":
      return "餐厅";
    case "food":
      return "早餐/菜品";
    case "facility":
      return "配套设施";
    case "neighborhood":
      return "周边";
    case "service_detail":
      return "服务细节";
    case "atmosphere":
      return "氛围镜头";
    case "other":
      return "其他";
    default:
      return "未分类";
  }
}

function resolveGenerationModeLabel(
  mode: TaskClipSourceShot["generationMode"],
  assetSourceType?: TaskClipSourceShot["assetSourceType"],
) {
  if (assetSourceType === "video_material") {
    return "实拍视频直出";
  }
  switch (mode) {
    case "photo_direct_i2v":
      return "实拍图直驱";
    case "photo_enhanced_i2v":
      return "实拍图增强后驱动";
    case "ai_generated_broll":
      return "AI 补镜头";
    default:
      return "待定";
  }
}

function formatSourceSummary(sourceShots: TaskClipSourceShot[]) {
  if (!sourceShots.length) {
    return "暂无镜头来源记录";
  }

  return sourceShots
    .map((shot) => {
      const subject =
        shot.assetSubjectSummary?.trim() || shot.contentDescription?.trim() || resolveSceneTypeLabel(shot.sceneType);
      return `镜头 ${shot.shotIndex} · ${resolveGenerationModeLabel(shot.generationMode, shot.assetSourceType)} · ${subject}`;
    })
    .join(" ｜ ");
}

function buildShotPlanHref(taskId: string, shotIndex: number) {
  return `/studio/task-creation/${encodeURIComponent(taskId)}/shot-plan?shot=${encodeURIComponent(String(shotIndex))}#shot-${encodeURIComponent(String(shotIndex))}`;
}

export function CompositionModule({
  task,
  persistedStageProgress,
  onTaskUpdate,
  onPrimaryActionChange,
  includeBackgroundMusic,
  backgroundMusicUrl,
  backgroundMusicVolume,
  subtitleConfig,
  upstreamBlockedReason = null,
  showSettings = false,
}: {
  task: VideoTaskRecord | null;
  persistedStageProgress?: TaskStageProgressSnapshot | null;
  onTaskUpdate: (task: VideoTaskRecord) => void;
  onPrimaryActionChange?: ((config: TaskStepActionState | null) => void) | undefined;
  includeBackgroundMusic: boolean;
  backgroundMusicUrl: string;
  backgroundMusicVolume: number;
  subtitleConfig: SubtitleConfig;
  upstreamBlockedReason?: string | null;
  showSettings?: boolean;
}) {
  const taskId = task?.taskId ?? null;
  const [materials, setMaterials] = useState<CompositionMaterial[]>([]);
  const [latestComposition, setLatestComposition] = useState<CompositionRecord | null>(null);
  const [latestPlayableComposition, setLatestPlayableComposition] = useState<CompositionRecord | null>(null);
  const [statusSummary, setStatusSummary] = useState<CompositionModuleResponse["statusSummary"] | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceReviewExpanded, setSourceReviewExpanded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compositionStreamProgress = useStreamProgress();
  const compositionProgressMessage = compositionStreamProgress.progress.message;
  const compositionProgressPercent = compositionStreamProgress.progress.percent;
  const readCompositionStream = compositionStreamProgress.readStream;
  const resetCompositionStream = compositionStreamProgress.reset;

  const completedSegments = useMemo((): TimelineSegmentSummary[] => {
    return materials
      .filter((item) => item.job?.status === "COMPLETED")
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .map((item) => ({
        segmentId: item.segmentId,
        shotIndex: item.shotIndex,
        shotTitle: item.shotTitle,
        durationSeconds: item.durationSeconds,
      }));
  }, [materials]);
  const compositionPreviewAspectRatio = task?.parameters.video.aspectRatio ?? "9:16";
  const previewComposition =
    (latestComposition?.outputVideoUrl ? latestComposition : null) ?? latestPlayableComposition ?? latestComposition;
  const previewTimecode = useVideoTimecode(previewComposition?.outputVideoUrl ?? null);

  const loadCompositionData = useCallback(
    async (silently = false) => {
      if (!taskId) {
        return;
      }

      if (!silently) {
        setLoadingStatus("loading");
      }
      setError(null);

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(`/api/video-tasks/${taskId}/composition-runs`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await parseApiResponse<CompositionModuleResponse>(response);
        if (!response.ok) {
          throw new Error(data.error ?? "视频合成数据加载失败");
        }

        if (data.task) {
          onTaskUpdate(data.task);
        }
        setMaterials(data.clipShots ?? []);
        setLatestComposition(data.latestComposition ?? data.result ?? null);
        setLatestPlayableComposition(data.latestPlayableComposition ?? data.result ?? data.latestComposition ?? null);
        setStatusSummary(data.statusSummary ?? null);
        setLoadingStatus("success");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setLoadingStatus("error");
        setError(
          loadError instanceof Error && loadError.message === "Failed to fetch"
            ? "视频合成接口当前不可达，请稍后重试；如果你刚修改过代码，通常是开发服务正在重编译。"
            : loadError instanceof Error
              ? loadError.message
              : "视频合成数据加载失败",
        );
      }
    },
    [onTaskUpdate, taskId],
  );

  useEffect(() => {
    if (!taskId) {
      setMaterials([]);
      setLatestComposition(null);
      setLatestPlayableComposition(null);
      setLoadingStatus("idle");
      return;
    }

    void loadCompositionData();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadCompositionData, taskId]);

  const persistedRunning = isTaskStageProgressRunning(persistedStageProgress);
  const compositionStageRunning = submitting || persistedRunning || latestComposition?.status === "PROCESSING";
  const isInitialCompositionLoading = Boolean(
    taskId &&
      (loadingStatus === "idle" || loadingStatus === "loading") &&
      !latestComposition &&
      !latestPlayableComposition &&
      materials.length === 0,
  );
  const basePrimaryActionLabel = getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.composeStoryVideo, {
    running: compositionStageRunning,
    rerun: Boolean(latestComposition),
  });
  const primaryActionLabel =
    isInitialCompositionLoading
      ? "合成结果加载中..."
      : submitting && compositionProgressMessage
      ? compositionProgressMessage
      : persistedRunning && persistedStageProgress?.message
        ? persistedStageProgress.message
        : basePrimaryActionLabel;
  const primaryProgressPercent = submitting
    ? compositionProgressPercent
    : persistedRunning
      ? (persistedStageProgress?.percent ?? 0)
      : 0;
  const completedClipCount = statusSummary?.completedClipCount ?? completedSegments.length;
  const compositionBlockedReason =
    upstreamBlockedReason?.trim() ||
    (isInitialCompositionLoading || loadingStatus === "loading"
      ? "合成素材加载中，请稍后再试。"
      : completedClipCount <= 0
        ? "请先完成视频片段生成后，再进行视频合成。"
        : null);

  const submitComposition = useCallback(async () => {
    if (!taskId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const data = await readCompositionStream<CompositionModuleResponse>(
        `/api/video-tasks/${taskId}/composition-runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: directorSecondaryStepActionKeys.autoComposeStoryVideo,
            includeBackgroundMusic,
            backgroundMusicUrl,
            backgroundMusicVolume,
            subtitleConfig,
          }),
        },
      );

      if (data.error) {
        throw new Error(data.error);
      }

      setMaterials(data.clipShots ?? []);
      setLatestComposition(data.result ?? data.latestComposition ?? null);
      setLatestPlayableComposition(data.latestPlayableComposition ?? data.result ?? data.latestComposition ?? null);
      setStatusSummary(data.statusSummary ?? null);

      if (data.task) {
        onTaskUpdate(data.task);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message === "Failed to fetch"
          ? "视频合成请求未送达，请确认开发服务可用后重试。"
          : submitError instanceof Error
            ? submitError.message
            : "视频合成失败",
      );
    } finally {
      setSubmitting(false);
      resetCompositionStream();
    }
  }, [
    backgroundMusicUrl,
    backgroundMusicVolume,
    includeBackgroundMusic,
    onTaskUpdate,
    readCompositionStream,
    resetCompositionStream,
    subtitleConfig,
    taskId,
  ]);

  const handlePrimaryAction = useCallback(() => {
    void submitComposition();
  }, [submitComposition]);

  useEffect(() => {
    if (!taskId || submitting || !compositionStageRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadCompositionData(true);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [compositionStageRunning, loadCompositionData, submitting, taskId]);

  function handlePlayPreview() {
    if (!previewVideoRef.current || !previewComposition?.outputVideoUrl) {
      return;
    }

    previewVideoRef.current.currentTime = 0;
    void previewVideoRef.current.play();
  }

  useEffect(() => {
    setIsPlaying(false);
  }, [previewComposition?.outputVideoUrl]);

  useEffect(() => {
    if (!onPrimaryActionChange) {
      return;
    }

    if (!taskId) {
      onPrimaryActionChange(null);
      return;
    }

    onPrimaryActionChange({
      label: primaryActionLabel,
      isRunning: compositionStageRunning || isInitialCompositionLoading,
      busyDisplay: isInitialCompositionLoading ? "status" : "progress",
      progressPercent: primaryProgressPercent,
      canRun: !compositionBlockedReason,
      blockedReason: compositionBlockedReason,
      onAction: handlePrimaryAction,
    });
  }, [
    loadingStatus,
    handlePrimaryAction,
    onPrimaryActionChange,
    primaryProgressPercent,
    primaryActionLabel,
    completedSegments.length,
    statusSummary?.completedClipCount,
    compositionStageRunning,
    compositionBlockedReason,
    isInitialCompositionLoading,
    taskId,
  ]);

  useEffect(() => {
    if (!onPrimaryActionChange) {
      return;
    }

    return () => {
      onPrimaryActionChange(null);
    };
  }, [onPrimaryActionChange]);

  if (!task) {
    return <div className="task-module-empty">完成片段生成后，这里会进行视频合成、字幕对齐与背景音乐编排。</div>;
  }

  if (isInitialCompositionLoading) {
    return <div className="task-module-empty">合成结果加载中…</div>;
  }

  return (
    <div className="task-composition-module">
      {error ? <div className="error-box">{error}</div> : null}

      {showSettings ? (
        <CompositionSettingsPanel
          includeBackgroundMusic={includeBackgroundMusic}
          backgroundMusicUrl={backgroundMusicUrl}
          backgroundMusicVolume={backgroundMusicVolume}
          subtitleConfig={subtitleConfig}
          subtitleAspectRatio={compositionPreviewAspectRatio}
          onIncludeBackgroundMusicChange={() => undefined}
          onBackgroundMusicUrlChange={() => undefined}
          onBackgroundMusicVolumeChange={() => undefined}
          onSubtitleConfigChange={() => undefined}
        />
      ) : null}

      <section className="task-clip-detail-card">
        <div className="task-clip-detail-head">
          <strong>拼接结果</strong>
        </div>
        <div className="task-clip-detail-layout">
          <div className="task-clip-preview-panel">
            <div
              className="task-clip-preview-stage"
              style={{ aspectRatio: toCssAspectRatio(compositionPreviewAspectRatio) }}
            >
              {previewComposition?.outputVideoUrl ? (
                <>
                  <video
                    ref={previewVideoRef}
                    className="task-clip-preview-video"
                    src={previewComposition.outputVideoUrl}
                    preload="metadata"
                    playsInline
                    controls={isPlaying}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    {...previewTimecode.videoTimecodeProps}
                  />
                  <div className="video-timecode-badge">{previewTimecode.timecodeLabel}</div>
                  {!isPlaying ? (
                    <button className="task-clip-preview-play" type="button" onClick={handlePlayPreview}>
                      <Play size={22} strokeWidth={2.5} />
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="task-clip-preview-empty">视频预览</div>
              )}
            </div>
          </div>

          <div className="task-clip-detail-meta">
            <div className="task-clip-detail-title-row">
              <strong>{task.title}</strong>
              <span
                className={`task-clip-status-chip ${latestComposition?.status === "COMPLETED" ? "success" : latestComposition?.status === "FAILED" ? "danger" : ""}`}
              >
                {latestComposition?.status === "COMPLETED"
                  ? "已完成"
                  : latestComposition?.status === "FAILED"
                    ? "失败"
                    : "待生成"}
              </span>
            </div>
            <div className="task-clip-params">
              <span>{`画面比例 ${task.parameters.video.aspectRatio}`}</span>
              <span>{`片段数量 ${completedSegments.length}`}</span>
              <span>{`输出画质 ${task.parameters.video.mode}`}</span>
              <span>{`转场方式 硬转（按脚本顺序自动排列）`}</span>
              <span>{`字幕 ${latestComposition?.subtitleConfig?.enabled === false ? "已关闭" : latestComposition?.subtitleSrtUrl ? "已合成" : "未合成"}`}</span>
            </div>
            <div className="task-clip-params">
              <span>{`合成音频 ${statusSummary?.narrationSourceLabel ?? (statusSummary?.narrationReady ? "片段原音已就绪" : "按片段原音优先")}`}</span>
              <span>{`背景音乐 ${includeBackgroundMusic && backgroundMusicUrl ? "已加入" : "未加入"}`}</span>
              <span>{`音频模式 多轨混音`}</span>
              <span>{`弱化淡出 已启用`}</span>
            </div>
            <div className="task-clip-params">
              <span>{`生成时间 ${new Date(latestComposition?.updatedAt ?? previewComposition?.updatedAt ?? task.updatedAt).toLocaleString("zh-CN")}`}</span>
              <span>{`调用模型 视频生成 + ffmpeg`}</span>
              <span>{`最终视频名称 ${task.title}`}</span>
            </div>
            <div className="task-clip-detail-actions">
              <button
                className="btn-pill task-clip-action-button"
                type="button"
                disabled={!previewComposition?.outputVideoUrl}
                onClick={handlePlayPreview}
              >
                播放视频
              </button>
              <a
                className={`btn-pill task-clip-action-button ${previewComposition?.outputVideoUrl ? "" : "is-disabled"}`}
                href={previewComposition?.outputVideoUrl ?? undefined}
                download={task.title}
                onClick={(event) => {
                  if (!previewComposition?.outputVideoUrl) {
                    event.preventDefault();
                  }
                }}
              >
                下载视频
              </a>
              <button
                className="btn-pill task-clip-action-button"
                type="button"
                disabled={Boolean(compositionBlockedReason) || compositionStageRunning}
                title={compositionBlockedReason ?? undefined}
                onClick={handlePrimaryAction}
              >
                {primaryActionLabel}
              </button>
            </div>
            <div className="task-clip-detail-copy">
              <div className="task-clip-copy-head">
                <p>成片镜头来源回看</p>
                <button
                  className="btn-secondary small task-clip-copy-toggle"
                  type="button"
                  aria-expanded={sourceReviewExpanded}
                  onClick={() => setSourceReviewExpanded((current) => !current)}
                >
                  {sourceReviewExpanded ? "收起" : "展开"}
                </button>
              </div>
              <div className={`task-clip-copy-body ${sourceReviewExpanded ? "is-expanded" : "is-collapsed"}`}>
                <div className="task-clip-copy-body-inner">
                  {materials
                    .slice()
                    .sort((left, right) => left.segmentIndex - right.segmentIndex)
                    .map((item) => (
                      <div key={item.segmentId} className="task-clip-source-item">
                        <p>{`片段 ${item.segmentIndex}：${formatSourceSummary(item.sourceShots)}`}</p>
                        <div className="task-clip-source-links">
                          {item.sourceShots.map((sourceShot) => {
                            const previewImageUrl =
                              sourceShot.selectedVisualImageUrl ?? sourceShot.referenceImageUrl ?? null;
                            return (
                              <span key={sourceShot.shotId} className="task-clip-source-link-group">
                                <Link
                                  className="task-clip-source-link"
                                  href={buildShotPlanHref(task.taskId, sourceShot.shotIndex)}
                                >
                                  {`镜头 ${sourceShot.shotIndex}`}
                                </Link>
                                {previewImageUrl ? (
                                  <a
                                    className="task-clip-source-link"
                                    href={previewImageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    参考图
                                  </a>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
