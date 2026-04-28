"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
  getDirectorPrimaryStepButtonLabel,
} from "../../../../lib/director-step-actions";
import { formatDurationSecondsLabel } from "../../../../lib/duration-format";
import type { TaskClipSourceShot } from "../../../../lib/task-clip-store";
import { getVideoTaskStatusIndex, type VideoTaskRecord } from "../../../../lib/video-task-schema";
import { useVideoTimecode } from "../../../_components/use-video-timecode";

import type { ClipPipelineSummary } from "./pipeline-flow";
import { parseApiResponse } from "./api-response";
import { type TaskStepActionState } from "./task-ui";

type ClipJob = {
  jobId: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  submittedAt: string;
  updatedAt: string;
  videoUrl: string | null;
  remoteVideoUrl?: string | null;
  resolvedDurationSeconds?: number | null;
  modelId: string | null;
  error: string | null;
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
};

type ClipShot = {
  segmentId?: string;
  segmentIndex?: number;
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
    lipSyncJobId: string | null;
    generatedAt: string;
    thumbnailUrl: string | null;
  } | null;
  job: ClipJob | null;
  lipSyncJob: ClipJob | null;
  thumbnailUrl: string | null;
  sourceShots: TaskClipSourceShot[];
};

type ClipModuleResponse = {
  task?: VideoTaskRecord;
  shots?: ClipShot[];
  runtime?: {
    generation?: {
      provider: "kling" | "seedance";
      providerLabel: string;
      modelId: string;
      liveEnabled: boolean;
    };
    lipSync?: {
      provider: "kling" | "seedance";
      providerLabel: string;
      modelId: string;
      liveEnabled: boolean;
    };
  };
  error?: string;
};

type RuntimeInfo = {
  provider: "kling" | "seedance";
  providerLabel: string;
  modelId: string;
  liveEnabled: boolean;
};

const defaultGenerationRuntime: RuntimeInfo = {
  provider: "seedance",
  providerLabel: "Seedance 2.0（火山方舟）",
  modelId: "",
  liveEnabled: false,
};

const defaultLipSyncRuntime: RuntimeInfo = {
  provider: "kling",
  providerLabel: "Kling 官方 API",
  modelId: "",
  liveEnabled: false,
};

function shouldAllowPromptExpand(prompt: string) {
  return prompt.replace(/\s+/g, "").length > 72;
}

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

function getClipSegmentLabel(shot: Pick<ClipShot, "segmentIndex" | "shotIndex">) {
  return `片段 ${shot.segmentIndex ?? shot.shotIndex}`;
}

function formatStatus(status: ClipJob["status"] | undefined) {
  switch (status) {
    case "QUEUED":
      return "排队中";
    case "IN_PROGRESS":
      return "生成中";
    case "COMPLETED":
      return "已完成";
    case "FAILED":
      return "失败";
    default:
      return "待生成";
  }
}

function pickPlayableVideoUrl(job: ClipJob | null | undefined): string | null {
  if (!job) {
    return null;
  }
  return job.videoUrl ?? job.remoteVideoUrl ?? null;
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

function summarizeSourceModes(sourceShots: TaskClipSourceShot[]) {
  const labels = [
    ...new Set(sourceShots.map((shot) => resolveGenerationModeLabel(shot.generationMode, shot.assetSourceType))),
  ];
  return labels.length ? labels.join(" / ") : "待定";
}

function summarizeSceneTypes(sourceShots: TaskClipSourceShot[]) {
  const labels = [...new Set(sourceShots.map((shot) => resolveSceneTypeLabel(shot.sceneType)))];
  return labels.length ? labels.join(" / ") : "未分类";
}

function summarizeSourceShotIndexes(sourceShots: TaskClipSourceShot[]) {
  const shotIndexes = [...new Set(sourceShots.map((shot) => shot.shotIndex).filter((index) => Number.isFinite(index)))]
    .sort((left, right) => left - right)
    .map((index) => String(index));

  if (!shotIndexes.length) {
    return "暂无";
  }

  return sourceShots.length > 1 ? `${shotIndexes.join("、")}（${sourceShots.length}个）` : shotIndexes[0]!;
}

function buildShotPlanHref(taskId: string, shotIndex: number) {
  return `/studio/task-creation/${encodeURIComponent(taskId)}/shot-plan?shot=${encodeURIComponent(String(shotIndex))}#shot-${encodeURIComponent(String(shotIndex))}`;
}

/** 成片预览：口型完成后优先使用口型视频；底层无声片段仍保留在 job 上。 */
function getEffectiveClipPreview(shot: ClipShot): {
  videoUrl: string | null;
  variant: "lip_sync" | "silent_clip" | "none";
} {
  if (shot.lipSyncJob?.status === "COMPLETED") {
    const url = pickPlayableVideoUrl(shot.lipSyncJob);
    if (url) {
      return { videoUrl: url, variant: "lip_sync" };
    }
  }
  if (shot.job?.videoUrl || shot.job?.remoteVideoUrl) {
    const url = pickPlayableVideoUrl(shot.job);
    if (url) {
      return { videoUrl: url, variant: "silent_clip" };
    }
  }
  return { videoUrl: null, variant: "none" };
}

function formatClipPipelineStatus(shot: ClipShot): string {
  const clipStatus = shot.job?.status;
  if (clipStatus === "QUEUED" || clipStatus === "IN_PROGRESS") {
    return `片段${formatStatus(clipStatus)}`;
  }
  if (clipStatus === "FAILED") {
    return "片段失败";
  }
  if (clipStatus !== "COMPLETED") {
    return "待生成片段";
  }
  if (!shot.requiresLipSync) {
    return "片段已完成";
  }
  if (!shot.lipSyncJob) {
    return "口型同步排队中";
  }
  const lip = shot.lipSyncJob.status;
  if (lip === "QUEUED" || lip === "IN_PROGRESS") {
    return `口型${formatStatus(lip)}`;
  }
  if (lip === "FAILED") {
    return "口型同步失败";
  }
  if (lip === "COMPLETED") {
    return "口型已完成";
  }
  return "口型待开始";
}

function getElapsedMs(timestamp: string | null | undefined, nowMs: number) {
  if (!timestamp) {
    return 0;
  }

  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.max(0, nowMs - value);
}

function getClipJobEstimateMs(shot: ClipShot) {
  const durationSeconds =
    shot.job?.generationSettings?.durationSeconds ?? shot.job?.resolvedDurationSeconds ?? shot.durationSeconds ?? 5;
  return 18_000 + Math.max(0, durationSeconds) * 3_600;
}

function getLipSyncEstimateMs(shot: ClipShot) {
  const durationSeconds =
    shot.lipSyncJob?.generationSettings?.durationSeconds ??
    shot.job?.resolvedDurationSeconds ??
    shot.durationSeconds ??
    5;
  return 9_000 + Math.max(0, durationSeconds) * 1_900;
}

function getTimedStageRatio(elapsedMs: number, estimateMs: number, cap = 0.96) {
  return Math.min(Math.max(0, elapsedMs) / Math.max(1_000, estimateMs), cap);
}

function getShotPipelineProgress(shot: ClipShot, nowMs: number) {
  const clipJob = shot.job;
  if (!clipJob) {
    return 0;
  }

  const clipElapsedMs = getElapsedMs(clipJob.status === "IN_PROGRESS" ? clipJob.updatedAt : clipJob.submittedAt, nowMs);
  if (clipJob.status === "QUEUED") {
    return 0.04 + 0.08 * getTimedStageRatio(clipElapsedMs, 8_000);
  }

  if (clipJob.status === "IN_PROGRESS") {
    return 0.14 + 0.58 * getTimedStageRatio(clipElapsedMs, getClipJobEstimateMs(shot));
  }

  if (clipJob.status === "FAILED") {
    return 0;
  }

  if (clipJob.status !== "COMPLETED") {
    return 0;
  }

  if (!shot.requiresLipSync) {
    return 1;
  }

  const lipSyncJob = shot.lipSyncJob;
  if (!lipSyncJob) {
    return 0.74;
  }

  const lipElapsedMs = getElapsedMs(
    lipSyncJob.status === "IN_PROGRESS" ? lipSyncJob.updatedAt : lipSyncJob.submittedAt,
    nowMs,
  );
  if (lipSyncJob.status === "QUEUED") {
    return 0.76 + 0.08 * getTimedStageRatio(lipElapsedMs, 6_000);
  }

  if (lipSyncJob.status === "IN_PROGRESS") {
    return 0.84 + 0.14 * getTimedStageRatio(lipElapsedMs, getLipSyncEstimateMs(shot));
  }

  if (lipSyncJob.status === "FAILED") {
    return 0.72;
  }

  return 1;
}

export function ClipGenerationModule({
  task,
  onTaskUpdate,
  onPrimaryActionChange,
  onLipSyncStatusChange,
  onSummaryChange,
  upstreamBlockedReason = null,
}: {
  task: VideoTaskRecord | null;
  onTaskUpdate: (task: VideoTaskRecord) => void;
  onPrimaryActionChange?: ((config: TaskStepActionState | null) => void) | undefined;
  onLipSyncStatusChange?: ((ready: boolean) => void) | undefined;
  onSummaryChange?: ((summary: ClipPipelineSummary | null) => void) | undefined;
  upstreamBlockedReason?: string | null;
}) {
  const taskId = task?.taskId ?? null;
  const [shots, setShots] = useState<ClipShot[]>([]);
  const [selectedShotIndex, setSelectedShotIndex] = useState(1);
  const [expandedPromptKeys, setExpandedPromptKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generationRuntime, setGenerationRuntime] = useState<RuntimeInfo>(defaultGenerationRuntime);
  const [lipSyncRuntime, setLipSyncRuntime] = useState<RuntimeInfo>(defaultLipSyncRuntime);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingShotIndex, setGeneratingShotIndex] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [sourceDetailExpanded, setSourceDetailExpanded] = useState(false);
  const [progressClockMs, setProgressClockMs] = useState(() => Date.now());
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onTaskUpdateRef = useRef(onTaskUpdate);
  onTaskUpdateRef.current = onTaskUpdate;
  const onLipSyncStatusChangeRef = useRef(onLipSyncStatusChange);
  onLipSyncStatusChangeRef.current = onLipSyncStatusChange;

  const loadShots = useCallback(async () => {
    if (!taskId) {
      return;
    }

    setLoadingStatus((current) => (current === "success" ? current : "loading"));

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/video-tasks/${taskId}/clip-runs`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await parseApiResponse<ClipModuleResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? "片段结果加载失败");
      }

      const nextShots = data.shots ?? [];
      setShots(nextShots);
      setGenerationRuntime(data.runtime?.generation ?? defaultGenerationRuntime);
      setLipSyncRuntime(data.runtime?.lipSync ?? defaultLipSyncRuntime);
      const hasLipSyncRequirement = nextShots.some((s) => s.requiresLipSync);
      const lipSyncTargets = nextShots.filter((s) => s.requiresLipSync && s.job?.status === "COMPLETED");
      const lipSyncedTargets = lipSyncTargets.filter((s) => s.lipSyncJob?.status === "COMPLETED");
      onLipSyncStatusChangeRef.current?.(
        !hasLipSyncRequirement || (lipSyncTargets.length > 0 && lipSyncedTargets.length === lipSyncTargets.length),
      );
      if (data.task) {
        onTaskUpdateRef.current(data.task);
      }
      setLoadingStatus("success");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }
      setLoadingStatus("error");
      setError(loadError instanceof Error ? loadError.message : "片段结果加载失败");
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setShots([]);
      setLoadingStatus("idle");
      return;
    }

    setError(null);
    setLoadingStatus("loading");
    void loadShots();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadShots, taskId]);

  const hasPendingShots = useMemo(
    () =>
      shots.some((shot) => {
        const clipBusy = shot.job?.status === "QUEUED" || shot.job?.status === "IN_PROGRESS";
        const lipBusy =
          shot.job?.status === "COMPLETED" &&
          shot.lipSyncJob &&
          (shot.lipSyncJob.status === "QUEUED" || shot.lipSyncJob.status === "IN_PROGRESS");
        return clipBusy || lipBusy;
      }),
    [shots],
  );
  const clipsReadyIndex = getVideoTaskStatusIndex("CLIPS_READY");
  const imagesReadyIndex = getVideoTaskStatusIndex("IMAGES_READY");
  const currentStatusIndex = task ? getVideoTaskStatusIndex(task.status) : -1;
  const clipsStageComplete = currentStatusIndex >= clipsReadyIndex;
  const visualReferenceCount = useMemo(
    () => shots.filter((shot) => shot.visualImageUrl || shot.visualImageSessionId).length,
    [shots],
  );
  const primaryRunning = generatingAll || hasPendingShots;
  const isInitialClipListLoading = Boolean(
    taskId && (loadingStatus === "idle" || loadingStatus === "loading") && !shots.length,
  );
  const primaryProgressPercent = useMemo(() => {
    if (!shots.length) {
      return 0;
    }

    const totalProgress = shots.reduce((sum, shot) => sum + getShotPipelineProgress(shot, progressClockMs), 0);
    return Math.max(0, Math.min(99, Math.round((totalProgress / shots.length) * 100)));
  }, [progressClockMs, shots]);

  const primaryActionLabel = useMemo(() => {
    if (isInitialClipListLoading) {
      return "片段结果加载中...";
    }

    const baseLabel = getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.buildVideoClips, {
      running: primaryRunning,
      rerun: clipsStageComplete,
    });
    if (!primaryRunning) {
      return baseLabel;
    }

    const clipInProgressCount = shots.filter((shot) => shot.job?.status === "IN_PROGRESS").length;
    if (clipInProgressCount > 0) {
      return `片段生成中（${clipInProgressCount}/${shots.length}）`;
    }

    const lipInProgressCount = shots.filter((shot) => shot.lipSyncJob?.status === "IN_PROGRESS").length;
    if (lipInProgressCount > 0) {
      return `口型同步中（${lipInProgressCount} 段）`;
    }

    const queuedCount = shots.filter(
      (shot) => shot.job?.status === "QUEUED" || shot.lipSyncJob?.status === "QUEUED",
    ).length;
    if (queuedCount > 0) {
      return `排队处理中（${queuedCount}/${shots.length}）`;
    }

    return baseLabel;
  }, [clipsStageComplete, isInitialClipListLoading, primaryRunning, shots]);

  const clipActionBlockedReason = useMemo((): string | null => {
    if (isInitialClipListLoading || loadingStatus === "loading") {
      return "片段结果加载中，请稍后再试。";
    }
    if (loadingStatus === "error") {
      return "片段结果加载失败，请刷新或稍后重试。";
    }
    return upstreamBlockedReason?.trim() || null;
  }, [isInitialClipListLoading, loadingStatus, upstreamBlockedReason]);

  useEffect(() => {
    if (!onSummaryChange) {
      return;
    }

    if (!task || loadingStatus !== "success") {
      onSummaryChange(null);
      return;
    }

    onSummaryChange({
      totalCount: shots.length,
      referenceBoundCount: visualReferenceCount,
      silentClipCount: shots.filter((shot) => shot.job?.status === "COMPLETED").length,
      availableClipCount: shots.filter((shot) => Boolean(getEffectiveClipPreview(shot).videoUrl)).length,
      failedClipCount: shots.filter((shot) => shot.job?.status === "FAILED").length,
    });
  }, [loadingStatus, onSummaryChange, shots, task, visualReferenceCount]);

  useEffect(() => {
    if (!onSummaryChange) {
      return;
    }

    return () => {
      onSummaryChange(null);
    };
  }, [onSummaryChange]);

  useEffect(() => {
    if (!taskId || !hasPendingShots) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadShots();
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingShots, loadShots, taskId]);

  useEffect(() => {
    if (!primaryRunning) {
      setProgressClockMs(Date.now());
      return;
    }

    setProgressClockMs(Date.now());
    const timer = window.setInterval(() => {
      setProgressClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [primaryRunning]);

  useEffect(() => {
    if (!shots.length) {
      setSelectedShotIndex(1);
      return;
    }

    setSelectedShotIndex((current) =>
      shots.some((shot) => shot.shotIndex === current) ? current : shots[0].shotIndex,
    );
  }, [shots]);

  const selectedShot = shots.find((shot) => shot.shotIndex === selectedShotIndex) ?? shots[0] ?? null;
  const selectedShotPreview = useMemo(
    () => (selectedShot ? getEffectiveClipPreview(selectedShot) : null),
    [selectedShot],
  );
  const selectedShotPreviewAspectRatio =
    selectedShot?.lipSyncJob?.generationSettings?.aspectRatio ??
    selectedShot?.job?.generationSettings?.aspectRatio ??
    task?.parameters.video.aspectRatio ??
    "9:16";
  const selectedShotTimecode = useVideoTimecode(
    selectedShotPreview ? `${selectedShotPreview.variant}:${selectedShotPreview.videoUrl ?? ""}` : null,
  );
  const lipSyncRuntimeText = useMemo(() => {
    const model = lipSyncRuntime.modelId ? ` · ${lipSyncRuntime.modelId}` : "";
    return lipSyncRuntime.liveEnabled
      ? `${lipSyncRuntime.providerLabel}${model} · audio2video`
      : `${lipSyncRuntime.providerLabel}${model} · 当前走本地 Mock 占位`;
  }, [lipSyncRuntime.liveEnabled, lipSyncRuntime.modelId, lipSyncRuntime.providerLabel]);
  const selectedShotLipSyncNote = useMemo(() => {
    if (!selectedShot) {
      return "";
    }
    if (!selectedShot.requiresLipSync) {
      return "当前片段不需要口型同步，生成完成后即可直接进入合成。";
    }
    if (selectedShot.lipSyncJob?.status === "COMPLETED") {
      return `当前预览已切换为对口型版本，来源于 ${lipSyncRuntimeText}。`;
    }
    if (selectedShot.lipSyncJob?.status === "FAILED") {
      return "当前片段的口型同步失败，基础片段仍会保留，可重新生成该片段重试。";
    }
    if (selectedShot.lipSyncJob?.status === "QUEUED" || selectedShot.lipSyncJob?.status === "IN_PROGRESS") {
      return `当前片段正在执行 ${lipSyncRuntimeText}，完成后会自动覆盖预览。`;
    }
    if (selectedShot.job?.status === "COMPLETED") {
      return `当前片段已完成，接下来会自动提交到 ${lipSyncRuntimeText}。`;
    }
    return "当前片段会在基础片段生成完成后自动进入口型同步。";
  }, [lipSyncRuntimeText, selectedShot]);

  const submitAction = useCallback(
    async (body: Record<string, unknown>) => {
      if (!taskId) {
        return;
      }

      const response = await fetch(`/api/video-tasks/${taskId}/clip-runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await parseApiResponse<ClipModuleResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? "片段生成失败");
      }

      setShots(data.shots ?? []);
      if (data.task) {
        onTaskUpdate(data.task);
      }
    },
    [onTaskUpdate, taskId],
  );

  const handleGenerateAll = useCallback(async () => {
    if (clipActionBlockedReason) {
      setError(clipActionBlockedReason);
      return;
    }

    setGeneratingAll(true);
    setError(null);
    try {
      await submitAction({ action: directorPrimaryStepActionKeys.buildVideoClips });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "片段生成失败");
    } finally {
      setGeneratingAll(false);
    }
  }, [clipActionBlockedReason, submitAction]);

  async function handleGenerateShot(shotIndex: number) {
    setGeneratingShotIndex(shotIndex);
    setError(null);
    try {
      await submitAction({ action: directorSecondaryStepActionKeys.regenerateClipShot, shotIndex });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "片段重新生成失败");
    } finally {
      setGeneratingShotIndex(null);
    }
  }

  async function handlePlaySelectedShot() {
    const url = selectedShotPreview?.videoUrl ?? null;
    if (!previewVideoRef.current || !url) {
      return;
    }

    previewVideoRef.current.currentTime = 0;
    await previewVideoRef.current.play();
  }

  function togglePromptExpand(key: string) {
    setExpandedPromptKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

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
      isRunning: primaryRunning || isInitialClipListLoading,
      progressPercent: primaryProgressPercent,
      canRun: !clipActionBlockedReason,
      blockedReason: clipActionBlockedReason,
      onAction: () => {
        void handleGenerateAll();
      },
    });
  }, [
    clipActionBlockedReason,
    handleGenerateAll,
    onPrimaryActionChange,
    primaryActionLabel,
    primaryProgressPercent,
    primaryRunning,
    isInitialClipListLoading,
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
    return <div className="task-module-empty">完成视觉图片生成后，这里会按片段生成视频片段并展示详情。</div>;
  }

  if (isInitialClipListLoading) {
    return <div className="task-module-empty">片段结果加载中…</div>;
  }

  return (
    <div className="task-clip-module">
      {error ? <div className="error-box">{error}</div> : null}
      <section className="task-clip-strip-card">
        <div className="task-clip-strip-head">
          <strong>视频片段展示</strong>
        </div>
        <div className="task-clip-strip-list">
          {shots.map((shot) => {
            const stripPreview = getEffectiveClipPreview(shot);
            return (
              <button
                key={shot.shotIndex}
                className={`task-clip-strip-item ${selectedShot?.shotIndex === shot.shotIndex ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedShotIndex(shot.shotIndex)}
              >
                <span className="task-clip-strip-badge">{getClipSegmentLabel(shot)}</span>
                <div className="task-clip-strip-media">
                  {shot.thumbnailUrl ? (
                    <Image
                      src={shot.thumbnailUrl}
                      alt={`${getClipSegmentLabel(shot)} 首帧`}
                      width={900}
                      height={1600}
                      unoptimized
                    />
                  ) : stripPreview.videoUrl ? (
                    <video src={stripPreview.videoUrl} preload="metadata" muted playsInline />
                  ) : (
                    <div className="task-clip-strip-empty">待生成</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="task-clip-detail-card">
        <div className="task-clip-detail-head">
          <strong>视频片段详情页</strong>
        </div>
        {selectedShot ? (
          <div className="task-clip-detail-layout">
            <div className="task-clip-preview-panel">
              <div
                className="task-clip-preview-stage"
                style={{ aspectRatio: toCssAspectRatio(selectedShotPreviewAspectRatio) }}
              >
                {selectedShotPreview?.videoUrl ? (
                  <>
                    <video
                      key={`${selectedShotPreview.variant}-${selectedShot.lipSyncJob?.jobId ?? ""}-${selectedShot.job?.jobId ?? ""}`}
                      ref={previewVideoRef}
                      className="task-clip-preview-video"
                      src={selectedShotPreview.videoUrl}
                      poster={selectedShot.thumbnailUrl ?? undefined}
                      preload="metadata"
                      playsInline
                      controls={isPreviewPlaying}
                      onPlay={() => setIsPreviewPlaying(true)}
                      onPause={() => setIsPreviewPlaying(false)}
                      {...selectedShotTimecode.videoTimecodeProps}
                    />
                    <div className="video-timecode-badge">{selectedShotTimecode.timecodeLabel}</div>
                    {!isPreviewPlaying ? (
                      <button
                        className="task-clip-preview-play"
                        type="button"
                        onClick={() => {
                          void previewVideoRef.current?.play();
                        }}
                      >
                        ▶
                      </button>
                    ) : null}
                  </>
                ) : selectedShot.thumbnailUrl ? (
                  <Image
                    src={selectedShot.thumbnailUrl}
                    alt={`${getClipSegmentLabel(selectedShot)} 首帧`}
                    width={900}
                    height={1600}
                    unoptimized
                  />
                ) : (
                  <div className="task-clip-preview-empty">当前片段尚未生成</div>
                )}
              </div>
            </div>

            <div className="task-clip-detail-meta">
              <div className="task-clip-detail-title-row">
                <strong>{getClipSegmentLabel(selectedShot)}</strong>
                <span
                  className={`task-clip-status-chip ${
                    selectedShot.lipSyncJob?.status === "COMPLETED"
                      ? "success"
                      : selectedShot.job?.status === "FAILED" || selectedShot.lipSyncJob?.status === "FAILED"
                        ? "danger"
                        : selectedShot.job?.status === "COMPLETED"
                          ? "progress"
                          : ""
                  }`}
                >
                  {formatClipPipelineStatus(selectedShot)}
                </span>
              </div>
              <div className="task-visual-shot-prompt-wrap">
                <p
                  className={`task-visual-shot-prompt ${expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "expanded" : ""}`}
                >
                  {selectedShot.videoPrompt}
                </p>
                {shouldAllowPromptExpand(selectedShot.videoPrompt) ? (
                  <button
                    className="task-visual-shot-expand"
                    type="button"
                    onClick={() => togglePromptExpand(`clip-${selectedShot.shotIndex}`)}
                  >
                    <span>{expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "收起" : "展开"}</span>
                    <span
                      className={`task-visual-shot-expand-icon ${expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "expanded" : ""}`}
                    >
                      ⌄
                    </span>
                  </button>
                ) : null}
              </div>
              <div className="task-clip-params">
                <span>{`画面比例 ${selectedShot.job?.generationSettings?.aspectRatio ?? task.parameters.video.aspectRatio}`}</span>
                <span>{`片段时长 ${formatDurationSecondsLabel(selectedShot.durationSeconds) ?? "0 秒"}`}</span>
                <span>{`原生音频 ${selectedShot.job?.generationSettings?.generateAudio ? "开启" : "关闭"}`}</span>
              </div>
              <div className="task-clip-params">
                <span>{`场景类型 ${summarizeSceneTypes(selectedShot.sourceShots)}`}</span>
                <span>{`生成方式 ${summarizeSourceModes(selectedShot.sourceShots)}`}</span>
                <span>{`来源镜头 ${summarizeSourceShotIndexes(selectedShot.sourceShots)}`}</span>
              </div>
              <div className="task-clip-params">
                <span>{`生成时间 ${new Date(selectedShot.clipRecord?.generatedAt ?? selectedShot.job?.submittedAt ?? task.updatedAt).toLocaleString("zh-CN")}`}</span>
                <span>{`片段模型 ${(selectedShot.job?.modelId ?? generationRuntime.modelId) || generationRuntime.providerLabel}`}</span>
                <span>
                  {selectedShot.requiresLipSync
                    ? `口型模型 ${(selectedShot.lipSyncJob?.modelId ?? lipSyncRuntime.modelId) || lipSyncRuntime.providerLabel}`
                    : "当前片段跳过口型同步"}
                </span>
              </div>
              <div className="task-clip-runtime-note">{selectedShotLipSyncNote}</div>
              <div className="task-clip-detail-copy">
                <div className="task-clip-copy-head">
                  <p>{`镜头来源：${selectedShot.sourceShots.length ? "已绑定" : "暂无绑定信息"}`}</p>
                  <button
                    className="btn-secondary small task-clip-copy-toggle"
                    type="button"
                    aria-expanded={sourceDetailExpanded}
                    onClick={() => setSourceDetailExpanded((current) => !current)}
                  >
                    {sourceDetailExpanded ? "收起" : "展开"}
                  </button>
                </div>
                <div className={`task-clip-copy-body ${sourceDetailExpanded ? "is-expanded" : "is-collapsed"}`}>
                  <div className="task-clip-copy-body-inner">
                    {selectedShot.sourceShots.map((sourceShot) => {
                      const previewImageUrl = sourceShot.selectedVisualImageUrl ?? sourceShot.referenceImageUrl ?? null;
                      return (
                        <div key={sourceShot.shotId} className="task-clip-source-item">
                          <p>
                            {`镜头 ${sourceShot.shotIndex} · ${resolveSceneTypeLabel(sourceShot.sceneType)} · ${resolveGenerationModeLabel(sourceShot.generationMode, sourceShot.assetSourceType)}${
                              sourceShot.assetSubjectSummary
                                ? ` · ${sourceShot.assetSubjectSummary}`
                                : sourceShot.contentDescription
                                  ? ` · ${sourceShot.contentDescription}`
                                  : ""
                            }${sourceShot.assetId ? ` · 素材 ${sourceShot.assetId}` : ""}`}
                          </p>
                          <div className="task-clip-source-links">
                            <Link
                              className="task-clip-source-link"
                              href={buildShotPlanHref(task.taskId, sourceShot.shotIndex)}
                            >
                              查看镜头计划
                            </Link>
                            {previewImageUrl ? (
                              <a
                                className="task-clip-source-link"
                                href={previewImageUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看参考图
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    <p>{`台词：${selectedShot.narrationText || "暂无"}`}</p>
                    <p>{`字幕：${selectedShot.subtitleText || "暂无"}`}</p>
                  </div>
                </div>
              </div>
              <div className="task-clip-detail-actions">
                <button
                  className="btn-pill task-clip-action-button"
                  type="button"
                  disabled={!selectedShotPreview?.videoUrl}
                  onClick={() => void handlePlaySelectedShot()}
                >
                  点击播放
                </button>
                <button
                  className="btn-pill task-clip-action-button task-clip-action-button-secondary"
                  type="button"
                  disabled={generatingShotIndex === selectedShot.shotIndex}
                  onClick={() => void handleGenerateShot(selectedShot.shotIndex)}
                >
                  {generatingShotIndex === selectedShot.shotIndex ? "生成中..." : "重新生成该片段"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="task-module-empty">当前任务还没有片段数据。</div>
        )}
      </section>
    </div>
  );
}
