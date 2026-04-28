"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
  getDirectorPrimaryStepButtonLabel,
} from "../../../../lib/director-step-actions";
import { formatDurationSecondsLabel } from "../../../../lib/duration-format";
import { isTaskStageProgressRunning, type TaskStageProgressSnapshot } from "../../../../lib/task-stage-progress";
import {
  buildVisualImageCandidateRegenerationReasons,
  shouldShowVisualImageCandidateRegenerationReason,
} from "../../../../lib/task-visual-image-quality-copy";
import {
  getVideoTaskStatusIndex,
  type VideoTaskRecord,
  usesCapturedMaterialFirstWorkflow,
} from "../../../../lib/video-task-schema";

import type { VisualPipelineSummary } from "./pipeline-flow";
import { parseApiResponse } from "./api-response";
import { type TaskStepActionState } from "./task-ui";
import { useStreamProgress } from "./use-stream-progress";

type VisualImageCandidate = {
  candidateId: string;
  imageUrl: string;
  originalUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  bytesPerPixel: number | null;
  score: number;
  scoreLabel: string;
  scoreReasons: string[];
  source: "generated" | "uploaded";
  qualityStatus: "unchecked" | "passed" | "warning" | "failed";
  qualityIssues: string[];
  qualitySummary: string | null;
  qualityCheckedAt: string | null;
};

type VisualImageShot = {
  shotIndex: number;
  shotTitle: string;
  prompt: string;
  generationMode: string | null;
  referenceImageUrl: string | null;
  assetSubjectSummary: string | null;
  narrationText: string;
  subtitleText: string;
  durationSeconds: number | null;
  commercialPhase: string | null;
  commercialIntent: string | null;
  evidenceTarget: string | null;
  conversionRole: string | null;
  primaryAssetLabel: string | null;
  bindingReason: string | null;
  userIntentPreserved: string | null;
  narrationGoal: string | null;
  subtitleGoal: string | null;
  needsAiFallback: boolean;
  size: string;
  guidanceScale: number;
  watermark: boolean;
  generatedAt: string | null;
  updatedAt: string | null;
  recommendedCandidateId: string | null;
  selectedCandidateId: string | null;
  selectionMode: "manual" | null;
  selectedAt: string | null;
  selectedCandidate: VisualImageCandidate | null;
  candidates: VisualImageCandidate[];
};

type VisualImageResponse = {
  task?: VideoTaskRecord;
  shots?: VisualImageShot[];
  runtime?: {
    providerLabel: string;
    modelId: string;
    liveEnabled: boolean;
  };
  error?: string;
};

type PreviewImageState = {
  shotIndex: number;
  candidateId: string;
  mode: "strip" | "candidate";
};

type VisualWorkbenchNarrationClip = {
  shotIndex: number;
  narrationText: string;
  durationSeconds: number;
  audioUrl?: string | null;
};

const commercialPhaseDisplayLabels: Record<string, string> = {
  attention_hook: "停留钩子",
  identity_confirmation: "身份确认",
  opportunity_offer: "机会抛出",
  core_benefit: "核心利益",
  benefit_stack: "权益轰炸",
  evidence_proof: "素材证明",
  value_anchor: "价值锚定",
  risk_reversal: "风险解除",
  action_close: "行动收口",
  route_correction: "认知纠偏",
  itinerary_delivery: "路线交付",
  atmosphere_memory: "氛围记忆",
};

function getCommercialPhaseDisplayLabel(phase: string | null | undefined) {
  return phase ? (commercialPhaseDisplayLabels[phase] ?? phase) : "商业任务";
}

function isReferenceBackedMaterialShot(shot: VisualImageShot) {
  return Boolean(
    shot.referenceImageUrl &&
      (shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v"),
  );
}

export function VisualImageModule({
  task,
  persistedStageProgress,
  narrationClips = [],
  onTaskUpdate,
  onPrimaryActionChange,
  onSummaryChange,
  workflowLocked = false,
}: {
  task: VideoTaskRecord | null;
  persistedStageProgress?: TaskStageProgressSnapshot | null;
  narrationClips?: VisualWorkbenchNarrationClip[];
  onTaskUpdate: (task: VideoTaskRecord) => void;
  onPrimaryActionChange?: ((config: TaskStepActionState | null) => void) | undefined;
  onSummaryChange?: ((summary: VisualPipelineSummary | null) => void) | undefined;
  workflowLocked?: boolean;
}) {
  const taskId = task?.taskId ?? null;
  const [shots, setShots] = useState<VisualImageShot[]>([]);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingShotIndex, setGeneratingShotIndex] = useState<number | null>(null);
  const [submittingShotIndex, setSubmittingShotIndex] = useState<number | null>(null);
  const [activeShotIndex, setActiveShotIndex] = useState<number | null>(null);
  const [draggingShotIndex, setDraggingShotIndex] = useState<number | null>(null);
  const [sortingShotIndex, setSortingShotIndex] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const batchStreamProgress = useStreamProgress();
  const batchProgressMessage = batchStreamProgress.progress.message;
  const batchProgressValue = batchStreamProgress.progress.percent;
  const readBatchStream = batchStreamProgress.readStream;
  const resetBatchStream = batchStreamProgress.reset;

  const loadShots = useCallback(
    async (silently = false) => {
      if (!taskId) {
        setShots([]);
        setLoadingStatus("idle");
        return [] as VisualImageShot[];
      }

      if (!silently) {
        setLoadingStatus("loading");
      }
      setError(null);

      const response = await fetch(`/api/video-tasks/${taskId}/visual-images`, { cache: "no-store" });
      const data = await parseApiResponse<VisualImageResponse>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "视觉图片加载失败");
      }

      const nextShots = data.shots ?? [];
      setShots(nextShots);
      if (data.task) {
        onTaskUpdate(data.task);
      }
      setLoadingStatus("success");
      return nextShots;
    },
    [onTaskUpdate, taskId],
  );

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      try {
        await loadShots();
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        setLoadingStatus("error");
        setError(loadError instanceof Error ? loadError.message : "视觉图片加载失败");
      }
    };

    void run();

    return () => {
      isActive = false;
    };
  }, [loadShots]);

  const subtitleAudioReadyIndex = getVideoTaskStatusIndex("SUBTITLE_AUDIO_READY");
  const imagesReadyIndex = getVideoTaskStatusIndex("IMAGES_READY");
  const currentStatusIndex = task ? getVideoTaskStatusIndex(task.status) : -1;
  const capturedMaterialFirst = task ? usesCapturedMaterialFirstWorkflow(task.parameters.video.videoType) : false;
  const prevStepSucceeded = currentStatusIndex >= subtitleAudioReadyIndex;
  const visualStageComplete = currentStatusIndex >= imagesReadyIndex;
  const shotTotal = shots.length;
  const generatedShotCount = useMemo(() => shots.filter((shot) => shot.candidates.length > 0).length, [shots]);
  const materialBackedShotCount = useMemo(() => shots.filter(isReferenceBackedMaterialShot).length, [shots]);
  const pendingMaterialBackedCount = useMemo(
    () => shots.filter((shot) => isReferenceBackedMaterialShot(shot) && shot.candidates.length === 0).length,
    [shots],
  );
  const pendingAiFallbackCount = useMemo(
    () => shots.filter((shot) => !isReferenceBackedMaterialShot(shot) && shot.candidates.length === 0).length,
    [shots],
  );
  const hasPartialGeneratedShots = shotTotal > 0 && generatedShotCount > 0 && generatedShotCount < shotTotal;
  const allShotsGenerated = shotTotal > 0 && generatedShotCount === shotTotal;
  const shouldShowRerun = visualStageComplete || allShotsGenerated;
  const persistedRunning = isTaskStageProgressRunning(persistedStageProgress);
  const visualStageRunning = generatingAll || persistedRunning;
  const generationMutationLocked = workflowLocked || visualStageRunning;
  const shouldPollGeneratedShots = !generatingAll && (persistedRunning || workflowLocked);
  const isInitialVisualListLoading = Boolean(
    taskId && (loadingStatus === "idle" || loadingStatus === "loading") && !shots.length,
  );
  const batchProgressPercent = generatingAll
    ? batchProgressValue
    : persistedRunning
      ? (persistedStageProgress?.percent ?? 0)
      : 0;
  const activeShot = useMemo(
    () => shots.find((shot) => shot.shotIndex === activeShotIndex) ?? shots[0] ?? null,
    [activeShotIndex, shots],
  );
  const narrationClipByShotIndex = useMemo(
    () => new Map(narrationClips.map((clip) => [clip.shotIndex, clip])),
    [narrationClips],
  );
  const activeNarrationClip = activeShot ? (narrationClipByShotIndex.get(activeShot.shotIndex) ?? null) : null;
  const previewShot = useMemo(
    () => (previewImage ? (shots.find((shot) => shot.shotIndex === previewImage.shotIndex) ?? null) : null),
    [previewImage, shots],
  );
  const previewCandidateIndex = useMemo(() => {
    if (!previewImage || !previewShot) {
      return -1;
    }
    return previewShot.candidates.findIndex((candidate) => candidate.candidateId === previewImage.candidateId);
  }, [previewImage, previewShot]);
  const previewCandidate =
    previewShot && previewCandidateIndex >= 0 ? previewShot.candidates[previewCandidateIndex] : null;
  const previewMode = previewImage?.mode ?? "candidate";
  const previewHasPrevious = previewMode === "candidate" && previewCandidateIndex > 0;
  const previewHasNext =
    previewMode === "candidate" &&
    previewShot !== null &&
    previewCandidateIndex >= 0 &&
    previewCandidateIndex < previewShot.candidates.length - 1;
  const previewIsSelected = Boolean(
    previewShot && previewCandidate && previewShot.selectedCandidateId === previewCandidate.candidateId,
  );

  const primaryActionLabel = useMemo(() => {
    if (isInitialVisualListLoading) {
      return capturedMaterialFirst ? "素材镜头列表加载中..." : "参考图列表加载中...";
    }

    if (capturedMaterialFirst) {
      if (visualStageRunning) {
        return batchProgressMessage || persistedStageProgress?.message || "素材镜头处理中...";
      }
      if (shouldShowRerun && materialBackedShotCount > 0) {
        return "重新同步素材镜头";
      }
      if (pendingMaterialBackedCount > 0) {
        return `同步素材镜头（${materialBackedShotCount - pendingMaterialBackedCount}/${materialBackedShotCount}）`;
      }
      if (pendingAiFallbackCount > 0) {
        return `补齐 AI 镜头（${shotTotal - pendingAiFallbackCount}/${shotTotal}）`;
      }
      return "确认素材镜头";
    }

    const base = capturedMaterialFirst
      ? visualStageRunning
        ? "同步中..."
        : shouldShowRerun
          ? "重新同步素材镜头"
          : "同步素材镜头"
      : getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.buildVisualReferences, {
          running: visualStageRunning,
          rerun: shouldShowRerun,
        });
    if (!visualStageRunning && hasPartialGeneratedShots) {
      return `${capturedMaterialFirst ? "继续同步素材镜头" : "继续生成参考图"}（${generatedShotCount}/${shotTotal}）`;
    }
    if (generatingAll && batchProgressMessage) {
      return batchProgressMessage;
    }
    if (persistedRunning && persistedStageProgress?.message) {
      return persistedStageProgress.message;
    }
    return base;
  }, [
    batchProgressMessage,
    generatingAll,
    generatedShotCount,
    hasPartialGeneratedShots,
    persistedRunning,
    persistedStageProgress?.message,
    pendingAiFallbackCount,
    pendingMaterialBackedCount,
    materialBackedShotCount,
    shouldShowRerun,
    shotTotal,
    visualStageRunning,
    capturedMaterialFirst,
    isInitialVisualListLoading,
  ]);

  useEffect(() => {
    if (!onSummaryChange) {
      return;
    }

    if (!task || loadingStatus !== "success") {
      onSummaryChange(null);
      return;
    }

    onSummaryChange({
      totalCount: shotTotal,
      candidateReadyCount: shots.filter((shot) => shot.candidates.length > 0).length,
      finalSelectedCount: shots.filter((shot) => Boolean(shot.selectedCandidate)).length,
    });
  }, [loadingStatus, onSummaryChange, shotTotal, shots, task]);

  useEffect(() => {
    if (!onSummaryChange) {
      return;
    }

    return () => {
      onSummaryChange(null);
    };
  }, [onSummaryChange]);

  const submitAction = useCallback(
    async (body: Record<string, unknown>) => {
      if (!taskId) {
        return [] as VisualImageShot[];
      }

      const response = await fetch(`/api/video-tasks/${taskId}/visual-images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await parseApiResponse<VisualImageResponse>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "视觉图片操作失败");
      }

      const nextShots = data.shots ?? [];
      setShots(nextShots);
      if (data.task) {
        onTaskUpdate(data.task);
      }
      return nextShots;
    },
    [onTaskUpdate, taskId],
  );

  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setError(null);

    try {
      if (
        capturedMaterialFirst &&
        materialBackedShotCount > 0 &&
        pendingMaterialBackedCount > 0 &&
        !shouldShowRerun
      ) {
        await submitAction({
          action: "sync_captured_material_shots",
          force: shouldShowRerun,
        });
        return;
      }

      const data = await readBatchStream<VisualImageResponse>(`/api/video-tasks/${taskId}/visual-images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: directorPrimaryStepActionKeys.buildVisualReferences,
          regenerateAll: shouldShowRerun,
        }),
      });

      const nextShots = data.shots ?? [];
      setShots(nextShots);
      if (data.task) {
        onTaskUpdate(data.task);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : capturedMaterialFirst
            ? "素材镜头同步失败"
            : "视觉图片生成失败",
      );
    } finally {
      setGeneratingAll(false);
      resetBatchStream();
    }
  }, [
    capturedMaterialFirst,
    materialBackedShotCount,
    onTaskUpdate,
    pendingMaterialBackedCount,
    readBatchStream,
    resetBatchStream,
    shouldShowRerun,
    submitAction,
    taskId,
  ]);

  useEffect(() => {
    if (!onPrimaryActionChange) {
      return;
    }

    if (!taskId) {
      onPrimaryActionChange(null);
      return;
    }

    const blockedReason = !prevStepSucceeded
      ? capturedMaterialFirst
        ? "请先完成字幕配音，再同步素材镜头。"
        : "请先完成字幕配音，再生成参考图。"
      : isInitialVisualListLoading
        ? capturedMaterialFirst
          ? "素材镜头列表加载中，请稍后再试。"
          : "参考图列表加载中，请稍后再试。"
        : loadingStatus === "success" && shotTotal === 0
          ? capturedMaterialFirst
            ? "当前没有可同步的素材镜头，请先检查镜头规划。"
            : "当前没有可出图镜头，请先检查镜头规划。"
          : null;

    onPrimaryActionChange({
      label: primaryActionLabel,
      isRunning: visualStageRunning || isInitialVisualListLoading,
      progressPercent: batchProgressPercent,
      canRun: !blockedReason,
      blockedReason,
      onAction: () => {
        void handleGenerateAll();
      },
    });
  }, [
    visualStageRunning,
    handleGenerateAll,
    isInitialVisualListLoading,
    loadingStatus,
    onPrimaryActionChange,
    batchProgressPercent,
    prevStepSucceeded,
    primaryActionLabel,
    shotTotal,
    taskId,
    capturedMaterialFirst,
  ]);

  useEffect(() => {
    if (!taskId || !shouldPollGeneratedShots) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadShots(true);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadShots, shouldPollGeneratedShots, taskId]);

  useEffect(() => {
    if (!onPrimaryActionChange) {
      return;
    }

    return () => {
      onPrimaryActionChange(null);
    };
  }, [onPrimaryActionChange]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    if (!previewShot || !previewCandidate) {
      setPreviewImage(null);
    }
  }, [previewCandidate, previewImage, previewShot]);

  useEffect(() => {
    if (!shots.length) {
      setActiveShotIndex(null);
      return;
    }

    setActiveShotIndex((current) => (shots.some((shot) => shot.shotIndex === current) ? current : shots[0].shotIndex));
  }, [shots]);

  async function handleGenerateShot(shotIndex: number) {
    setGeneratingShotIndex(shotIndex);
    setError(null);

    try {
      await submitAction({ action: directorSecondaryStepActionKeys.regenerateShotImages, shotIndex });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "镜头图片生成失败");
    } finally {
      setGeneratingShotIndex(null);
    }
  }

  async function handleSelectCandidate(shotIndex: number, candidateId: string) {
    setSubmittingShotIndex(shotIndex);
    setError(null);

    try {
      await submitAction({ action: directorSecondaryStepActionKeys.selectVisualCandidate, shotIndex, candidateId });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "选择图片失败");
    } finally {
      setSubmittingShotIndex(null);
    }
  }

  const [uploadingShotIndex, setUploadingShotIndex] = useState<number | null>(null);

  async function handleUploadImage(shotIndex: number, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !taskId) return;

    setUploadingShotIndex(shotIndex);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("action", "upload_image");
      formData.append("shotIndex", String(shotIndex));
      formData.append("file", file);

      const response = await fetch(`/api/video-tasks/${taskId}/visual-images`, {
        method: "POST",
        body: formData,
      });
      const data = await parseApiResponse<{
        shots?: VisualImageShot[];
        task?: Record<string, unknown>;
        runtime?: { providerLabel?: string; modelId?: string; liveEnabled?: boolean };
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "上传图片失败");
      }

      if (data.shots) setShots(data.shots);
      if (data.task) onTaskUpdate(data.task as Parameters<typeof onTaskUpdate>[0]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "上传图片失败");
    } finally {
      setUploadingShotIndex(null);
      event.target.value = "";
    }
  }

  function openPreview(shotIndex: number, candidateId: string, mode: "strip" | "candidate" = "candidate") {
    setPreviewImage({ shotIndex, candidateId, mode });
  }

  function handleSelectShot(shot: VisualImageShot) {
    if (activeShot?.shotIndex === shot.shotIndex) {
      if (shot.selectedCandidate) {
        openPreview(shot.shotIndex, shot.selectedCandidate.candidateId, "strip");
      }
      return;
    }

    setActiveShotIndex(shot.shotIndex);
  }

  async function handleReorderShot(sourceShotIndex: number, targetShotIndex: number) {
    if (!taskId || !task?.directorPlan || sourceShotIndex === targetShotIndex) {
      return;
    }

    const orderedSegments = [...task.directorPlan.renderSegments].sort(
      (left, right) => left.segmentIndex - right.segmentIndex,
    );
    const storyShotByIndex = new Map(task.directorPlan.storyShots.map((shot) => [shot.shotIndex, shot]));
    const flatShots = orderedSegments.flatMap((segment) =>
      segment.shotIndexes.map((shotIndex) => storyShotByIndex.get(shotIndex)).filter(Boolean),
    ) as NonNullable<typeof task.directorPlan>["storyShots"];
    const sourceIndex = flatShots.findIndex((shot) => shot.shotIndex === sourceShotIndex);
    const targetIndex = flatShots.findIndex((shot) => shot.shotIndex === targetShotIndex);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const nextFlatShots = [...flatShots];
    const [movedShot] = nextFlatShots.splice(sourceIndex, 1);
    if (!movedShot) {
      return;
    }
    nextFlatShots.splice(targetIndex, 0, movedShot);

    let cursor = 0;
    let nextShotIndex = 1;
    let nextActiveShotIndex = targetShotIndex;
    const segments = orderedSegments.map((segment) => {
      const segmentShots = nextFlatShots.slice(cursor, cursor + segment.shotIndexes.length);
      cursor += segment.shotIndexes.length;
      return {
        segmentId: segment.segmentId,
        segmentIndex: segment.segmentIndex,
        narrationText: segment.narrationText || segment.subtitleText || "",
        shots: segmentShots.map((shot) => {
          const shotIndex = nextShotIndex;
          nextShotIndex += 1;
          if (shot.shotIndex === sourceShotIndex) {
            nextActiveShotIndex = shotIndex;
          }
          return {
            sourceShotIndex: shot.shotIndex,
            shotIndex,
            purpose: shot.purpose,
            location: shot.location,
            sceneDescription: shot.sceneDescription,
            action: shot.action,
            emotion: shot.emotion,
            cameraMovement: shot.cameraMovement,
            durationSeconds: shot.durationSeconds,
            hasVoice: shot.hasVoice,
            hasSubtitle: shot.hasSubtitle,
            requiresLipSync: shot.requiresLipSync,
            imagePrompt: shot.imagePrompt,
            videoPrompt: shot.videoPrompt,
            narrationHint: shot.narrationHint,
          };
        }),
      };
    });

    setSortingShotIndex(sourceShotIndex);
    setError(null);
    try {
      const response = await fetch(`/api/video-tasks/${encodeURIComponent(taskId)}/shot-plan`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUpdatedAt: task.updatedAt,
          segments,
        }),
      });
      const data = await parseApiResponse<{
        error?: string;
        task?: VideoTaskRecord | null;
      }>(response);
      if (!response.ok) {
        throw new Error(data?.error ?? "调整镜头顺序失败");
      }
      if (data?.task) {
        onTaskUpdate(data.task);
      }
      await loadShots(true);
      setActiveShotIndex(nextActiveShotIndex);
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "调整镜头顺序失败");
    } finally {
      setSortingShotIndex(null);
      setDraggingShotIndex(null);
    }
  }

  function handlePreviewNavigate(direction: "prev" | "next") {
    if (!previewShot || previewCandidateIndex < 0) {
      return;
    }

    const nextIndex = direction === "prev" ? previewCandidateIndex - 1 : previewCandidateIndex + 1;
    const nextCandidate = previewShot.candidates[nextIndex];
    if (!nextCandidate) {
      return;
    }

    setPreviewImage({ shotIndex: previewShot.shotIndex, candidateId: nextCandidate.candidateId, mode: "candidate" });
  }

  if (!task) {
    return <div className="task-module-empty">完成字幕音频制作后，这里会按镜头生成视觉图片并供你逐张确认。</div>;
  }

  if (isInitialVisualListLoading) {
    return <div className="task-module-empty">{capturedMaterialFirst ? "素材镜头列表加载中…" : "参考图列表加载中…"}</div>;
  }

  return (
    <div className="task-visual-image-module">
      {error ? <div className="error-box">{error}</div> : null}
      {workflowLocked ? (
        <div className="notice-bar compact inline">
          <strong>关键素材任务执行中</strong>
          <span>已生成的镜头图组可以先选择，生成和上传操作会在流程结束后开放。</span>
        </div>
      ) : null}
      <div className="task-visual-image-stack">
        {shots.length ? (
          <>
            <section className="task-visual-shot-strip-card">
              <div className="task-visual-shot-strip-head">
                <strong className="task-visual-section-title">镜头选择</strong>
              </div>
              <div className="task-visual-shot-strip-list">
                {shots.map((shot) => {
                  const isActive = activeShot?.shotIndex === shot.shotIndex;
                  const narrationClip = narrationClipByShotIndex.get(shot.shotIndex);
                  const isDragging = draggingShotIndex === shot.shotIndex;
                  const isSorting = sortingShotIndex === shot.shotIndex;
                  return (
                    <button
                      key={shot.shotIndex}
                      className={`task-visual-shot-strip-item ${isActive ? "active" : ""}${isDragging ? " dragging" : ""}${isSorting ? " sorting" : ""}`}
                      type="button"
                      draggable={!generationMutationLocked && !sortingShotIndex}
                      title="拖拽调整镜头顺序"
                      onDragEnd={() => setDraggingShotIndex(null)}
                      onDragOver={(event) => {
                        if (draggingShotIndex && draggingShotIndex !== shot.shotIndex) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDragStart={(event) => {
                        if (generationMutationLocked || sortingShotIndex) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(shot.shotIndex));
                        setDraggingShotIndex(shot.shotIndex);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const rawSourceShotIndex = event.dataTransfer.getData("text/plain");
                        const sourceShotIndex = Number(rawSourceShotIndex || draggingShotIndex);
                        if (Number.isFinite(sourceShotIndex)) {
                          void handleReorderShot(sourceShotIndex, shot.shotIndex);
                        }
                      }}
                      onClick={() => handleSelectShot(shot)}
                    >
                      <div className="task-visual-shot-strip-media">
                        {shot.selectedCandidate ? (
                          <Image
                            src={shot.selectedCandidate.imageUrl}
                            alt={`镜头${shot.shotIndex}已选图片`}
                            width={900}
                            height={1350}
                            loading={isActive ? "eager" : "lazy"}
                            unoptimized
                          />
                        ) : (
                          <div className="task-visual-shot-empty">{capturedMaterialFirst ? "待同步" : "待选图"}</div>
                        )}
                      </div>
                      <span className="task-visual-shot-strip-label">{`镜头${shot.shotIndex}`}</span>
                      {shot.commercialPhase ? (
                        <span className="task-visual-shot-strip-phase">
                          {getCommercialPhaseDisplayLabel(shot.commercialPhase)}
                        </span>
                      ) : null}
                      <span
                        className={`task-visual-shot-strip-asset${shot.needsAiFallback ? " needs-fallback" : ""}`}
                        title={shot.primaryAssetLabel ?? shot.assetSubjectSummary ?? undefined}
                      >
                        {shot.primaryAssetLabel ?? shot.assetSubjectSummary ?? (shot.needsAiFallback ? "AI 补镜头" : "素材待确认")}
                      </span>
                      <span
                        className={`task-visual-shot-strip-audio${narrationClip?.audioUrl ? " ready" : narrationClip ? " pending" : ""}`}
                      >
                        {narrationClip?.audioUrl ? "音频已就绪" : narrationClip ? "音频待生成" : "无音频"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {activeShot ? (
              <section className="task-visual-shot-picker-card">
                <div className="task-visual-shot-picker-head">
                  <strong className="task-visual-section-title">{`${
                    capturedMaterialFirst ? "素材确认" : "图片选择"
                  }（当前镜头${activeShot.shotIndex}）`}</strong>
                  <div className="task-visual-shot-picker-actions">
                    {taskId ? (
                      <a
                        className="btn-pill task-visual-shot-edit-link"
                        href={`/studio/task-creation/${taskId}/shot-plan?shot=${activeShot.shotIndex}`}
                      >
                        调整顺序与细节
                      </a>
                    ) : null}
                    <label className="btn-pill task-visual-upload-label">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => void handleUploadImage(activeShot.shotIndex, event)}
                        disabled={uploadingShotIndex === activeShot.shotIndex || generationMutationLocked}
                        hidden
                      />
                      {uploadingShotIndex === activeShot.shotIndex ? "上传中..." : "上传图片"}
                    </label>
                    <button
                      className="btn-pill"
                      type="button"
                      disabled={generatingShotIndex === activeShot.shotIndex || generationMutationLocked}
                      onClick={() => void handleGenerateShot(activeShot.shotIndex)}
                    >
                      {generatingShotIndex === activeShot.shotIndex ? "重新生成中..." : "重新生成一批"}
                    </button>
                  </div>
                </div>
                <div className="task-visual-shot-context-panel">
                  <div className="task-visual-shot-context-item">
                    <strong>成交任务</strong>
                    <span>{getCommercialPhaseDisplayLabel(activeShot.commercialPhase)}</span>
                  </div>
                  <div className="task-visual-shot-context-item">
                    <strong>素材</strong>
                    <span>
                      {activeShot.primaryAssetLabel ??
                        activeShot.assetSubjectSummary ??
                        (activeShot.needsAiFallback ? "AI 补镜头" : "素材待确认")}
                    </span>
                  </div>
                  <div className="task-visual-shot-context-item">
                    <strong>表达</strong>
                    <span>
                      {activeShot.commercialIntent ||
                        activeShot.narrationGoal ||
                        activeShot.subtitleGoal ||
                        activeShot.narrationText ||
                        "待确认"}
                    </span>
                  </div>
                  {activeShot.evidenceTarget ? (
                    <div className="task-visual-shot-context-item">
                      <strong>证明点</strong>
                      <span>{activeShot.evidenceTarget}</span>
                    </div>
                  ) : null}
                  <div className="task-visual-shot-context-item">
                    <strong>台词</strong>
                    <span>{activeShot.subtitleText || activeShot.narrationText || "无台词"}</span>
                  </div>
                  <div className="task-visual-shot-context-item">
                    <strong>音频</strong>
                    <span>
                      {activeNarrationClip?.audioUrl
                        ? "音频已生成"
                        : activeNarrationClip
                          ? "台词已生成，音频待生成"
                          : "暂无音频"}
                    </span>
                  </div>
                  <div className="task-visual-shot-context-item">
                    <strong>时长</strong>
                    <span>
                      {activeShot.durationSeconds
                        ? (formatDurationSecondsLabel(activeShot.durationSeconds) ?? `${activeShot.durationSeconds} 秒`)
                        : "待确认"}
                    </span>
                  </div>
                  {activeShot.bindingReason || activeShot.userIntentPreserved ? (
                    <div className="task-visual-shot-context-item wide">
                      <strong>确认重点</strong>
                      <span>{[activeShot.bindingReason, activeShot.userIntentPreserved].filter(Boolean).join("；")}</span>
                    </div>
                  ) : null}
                </div>
                <div className="task-visual-shot-candidate-list">
                  {activeShot.candidates.length ? (
                    activeShot.candidates.map((candidate) => {
                      const isRecommended = candidate.candidateId === activeShot.recommendedCandidateId;
                      const isSelected = candidate.candidateId === activeShot.selectedCandidateId;
                      const regenerationReasons = buildVisualImageCandidateRegenerationReasons(candidate);
                      const showRegenerationReason = shouldShowVisualImageCandidateRegenerationReason(candidate);
                      return (
                        <article
                          key={candidate.candidateId}
                          className={`task-visual-shot-candidate ${isSelected ? "selected" : ""} ${
                            showRegenerationReason ? "needs-regeneration" : ""
                          }`}
                        >
                          <button
                            className="task-visual-shot-candidate-trigger image-preview-trigger"
                            type="button"
                            onClick={() => openPreview(activeShot.shotIndex, candidate.candidateId, "candidate")}
                          >
                            <Image
                              src={candidate.imageUrl}
                              alt={`镜头 ${activeShot.shotIndex} 候选图`}
                              width={1200}
                              height={900}
                              loading={isSelected ? "eager" : "lazy"}
                              unoptimized
                            />
                          </button>
                          <div className="task-visual-shot-candidate-foot">
                            <button
                              className={`btn-pill task-visual-shot-select-button ${isSelected ? "is-selected" : ""}`}
                              type="button"
                              disabled={
                                isSelected ||
                                submittingShotIndex === activeShot.shotIndex ||
                                generatingShotIndex === activeShot.shotIndex
                              }
                              onClick={() => void handleSelectCandidate(activeShot.shotIndex, candidate.candidateId)}
                            >
                              {isSelected ? "✓ 已选择" : "选择这一张"}
                            </button>
                            <div className="task-visual-shot-candidate-tags">
                              {candidate.source === "uploaded" ? (
                                <span className="task-visual-shot-score">用户上传</span>
                              ) : isRecommended ? (
                                <span className="task-visual-shot-recommended">✓ 系统推荐</span>
                              ) : showRegenerationReason ? (
                                <span className="task-visual-shot-warning">建议重生</span>
                              ) : null}
                            </div>
                          </div>
                          {showRegenerationReason ? (
                            <div className="task-visual-shot-regeneration-reason">
                              <strong>为什么建议重生</strong>
                              <ul>
                                {(regenerationReasons.length
                                  ? regenerationReasons
                                  : ["视觉自检未通过，建议重新生成该候选图。"]
                                ).map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <div className="task-visual-shot-candidate-empty">
                      {workflowLocked || visualStageRunning
                        ? "当前镜头图组生成中。"
                        : "这里会展示所选镜头的 6 张候选图。"}
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="task-module-empty">当前任务还没有可选参考图。</div>
        )}
      </div>

      {previewImage && previewShot && previewCandidate ? (
        <div className="modal-overlay" role="presentation" onClick={() => setPreviewImage(null)}>
          <div
            className={`modal-panel image-preview-panel${previewMode === "strip" ? " image-preview-panel--single" : ""}`}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3>
                  {previewMode === "strip" ? `${previewShot.shotTitle}已选图片` : `${previewShot.shotTitle} 候选图`}
                </h3>
                {previewMode === "candidate" ? (
                  <p className="modal-head-subtitle">{`第 ${previewCandidateIndex + 1} / ${previewShot.candidates.length} 张`}</p>
                ) : null}
              </div>
              <button className="btn-secondary small" type="button" onClick={() => setPreviewImage(null)}>
                关闭
              </button>
            </div>
            <div className="modal-body image-preview-body">
              <div className="image-preview-stage">
                <div className="image-preview-canvas">
                  {previewMode === "candidate" ? (
                    <button
                      className="image-preview-nav image-preview-nav-prev"
                      type="button"
                      disabled={!previewHasPrevious}
                      aria-label="上一张图片"
                      onClick={() => handlePreviewNavigate("prev")}
                    >
                      {"<"}
                    </button>
                  ) : null}
                  <Image
                    src={previewCandidate.imageUrl}
                    alt={
                      previewMode === "strip" ? `${previewShot.shotTitle}已选图片` : `${previewShot.shotTitle} 候选图`
                    }
                    width={1600}
                    height={1600}
                    unoptimized
                  />
                  {previewMode === "candidate" ? (
                    <button
                      className="image-preview-nav image-preview-nav-next"
                      type="button"
                      disabled={!previewHasNext}
                      aria-label="下一张图片"
                      onClick={() => handlePreviewNavigate("next")}
                    >
                      {">"}
                    </button>
                  ) : null}
                </div>
              </div>
              {previewMode === "candidate" ? (
                <div className="image-preview-actions">
                  <button
                    className="btn-primary small image-preview-select-button"
                    type="button"
                    disabled={
                      previewIsSelected ||
                      submittingShotIndex === previewShot.shotIndex ||
                      generatingShotIndex === previewShot.shotIndex
                    }
                    onClick={() => void handleSelectCandidate(previewShot.shotIndex, previewCandidate.candidateId)}
                  >
                    {previewIsSelected
                      ? "已选择这一张"
                      : submittingShotIndex === previewShot.shotIndex
                        ? "选择中..."
                        : "选择这一张"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
