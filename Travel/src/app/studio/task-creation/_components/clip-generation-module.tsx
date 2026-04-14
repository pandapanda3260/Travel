"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getVideoTaskStatusIndex, type VideoTaskRecord } from "../../../../lib/video-task-schema";

import { TaskStatusHintPanel, type TaskStatusHintItem } from "./task-ui";

type ClipJob = {
  jobId: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  submittedAt: string;
  updatedAt: string;
  videoUrl: string | null;
  remoteVideoUrl?: string | null;
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
};

type ClipModuleResponse = {
  task?: VideoTaskRecord;
  shots?: ClipShot[];
  runtime?: {
    providerLabel: string;
    modelId: string;
    liveEnabled: boolean;
  };
  error?: string;
};

function shouldAllowPromptExpand(prompt: string) {
  return prompt.replace(/\s+/g, "").length > 72;
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

/** 成片预览：口型完成后优先使用口型视频；底层无声片段仍保留在 job 上。 */
function getEffectiveClipPreview(shot: ClipShot): { videoUrl: string | null; variant: "lip_sync" | "silent_clip" | "none" } {
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

export function ClipGenerationModule({
  task,
  onTaskUpdate,
  onPrimaryActionChange,
  onLipSyncStatusChange,
}: {
  task: VideoTaskRecord | null;
  onTaskUpdate: (task: VideoTaskRecord) => void;
  onPrimaryActionChange?: ((config: { label: string; disabled: boolean; onAction: () => void } | null) => void) | undefined;
  onLipSyncStatusChange?: ((ready: boolean) => void) | undefined;
}) {
  const taskId = task?.taskId ?? null;
  const [shots, setShots] = useState<ClipShot[]>([]);
  const [selectedShotIndex, setSelectedShotIndex] = useState(1);
  const [expandedPromptKeys, setExpandedPromptKeys] = useState<string[]>([]);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState("Kling V3");
  const [runtimeModelId, setRuntimeModelId] = useState("");
  const [runtimeLiveEnabled, setRuntimeLiveEnabled] = useState(true);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingShotIndex, setGeneratingShotIndex] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const isLoadInFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadShots = useCallback(async (silently = false) => {
    if (!taskId || isLoadInFlightRef.current) {
      return;
    }

    isLoadInFlightRef.current = true;
    if (!silently) {
      setLoadingStatus("loading");
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/video-tasks/${taskId}/clip-runs`, { cache: "no-store", signal: controller.signal });
      const data = (await response.json()) as ClipModuleResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "片段结果加载失败");
      }

      const nextShots = data.shots ?? [];
      setShots(nextShots);
      setRuntimeLabel(data.runtime?.providerLabel ?? "Kling V3");
      setRuntimeModelId(data.runtime?.modelId ?? "");
      setRuntimeLiveEnabled(data.runtime?.liveEnabled ?? true);
      if (data.task) {
        onTaskUpdate(data.task);
      }
      const hasLipSyncRequirement = nextShots.some((s) => s.requiresLipSync);
      const lipSyncTargets = nextShots.filter((s) => s.requiresLipSync && s.job?.status === "COMPLETED");
      const lipSyncedTargets = lipSyncTargets.filter((s) => s.lipSyncJob?.status === "COMPLETED");
      onLipSyncStatusChange?.(!hasLipSyncRequirement || (lipSyncTargets.length > 0 && lipSyncedTargets.length === lipSyncTargets.length));
      setLoadingStatus("success");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setLoadingStatus("error");
      setError(loadError instanceof Error ? loadError.message : "片段结果加载失败");
    } finally {
      isLoadInFlightRef.current = false;
    }
  }, [onLipSyncStatusChange, onTaskUpdate, taskId]);

  useEffect(() => {
    if (!taskId) {
      setShots([]);
      setLoadingStatus("idle");
      return;
    }

    setError(null);
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
  const imagesReadyIndex = getVideoTaskStatusIndex("IMAGES_READY");
  const clipsReadyIndex = getVideoTaskStatusIndex("CLIPS_READY");
  const currentStatusIndex = task ? getVideoTaskStatusIndex(task.status) : -1;
  const prevStepSucceeded = currentStatusIndex >= imagesReadyIndex;
  const clipsStageComplete = currentStatusIndex >= clipsReadyIndex;

  const primaryActionLabel = useMemo(() => {
    if (generatingAll) {
      return "生成中...";
    }
    if (clipsStageComplete) {
      return "重新生成片段视频";
    }
    return "点击进行下一步";
  }, [clipsStageComplete, generatingAll]);

  const clipHintItems = useMemo((): TaskStatusHintItem[] => {
    const total = shots.length;
    const completed = shots.filter((s) => s.job?.status === "COMPLETED").length;
    const failed = shots.filter((s) => s.job?.status === "FAILED").length;
    const pending = shots.filter((s) => s.job?.status === "QUEUED" || s.job?.status === "IN_PROGRESS").length;
    const lipTargets = shots.filter((s) => s.requiresLipSync && s.job?.status === "COMPLETED");
    const lipDone = lipTargets.filter((s) => s.lipSyncJob?.status === "COMPLETED").length;
    const withVisual = shots.filter((s) => s.visualImageUrl || s.visualImageSessionId).length;

    const loadTone: TaskStatusHintItem["tone"] =
      loadingStatus === "error" ? "danger" : loadingStatus === "success" ? "success" : loadingStatus === "loading" ? "progress" : "neutral";
    const loadValue =
      loadingStatus === "loading" ? "加载中" : loadingStatus === "success" ? "已同步" : loadingStatus === "error" ? "失败（可看顶部报错）" : "待加载";

    const silentValue = !total
      ? "暂无镜头数据"
      : `${completed}/${total} 完成` +
        (failed ? ` · ${failed} 失败` : "") +
        (pending ? ` · ${pending} 进行中` : "");

    const silentTone: TaskStatusHintItem["tone"] = !total ? "neutral" : failed ? "danger" : completed === total ? "success" : pending ? "progress" : "neutral";

    const lipValue = lipTargets.length === 0 ? "当前类型无需口型同步" : `${lipDone}/${lipTargets.length} 段已口型对齐`;
    const lipTone: TaskStatusHintItem["tone"] = lipTargets.length === 0 ? "neutral" : lipDone === lipTargets.length ? "success" : "progress";

    return [
      {
        label: "上游视觉定稿",
        value: prevStepSucceeded ? "图片阶段已达标" : "未完成（主按钮禁用）",
        tone: prevStepSucceeded ? "success" : "danger",
      },
      {
        label: "参考图绑定",
        value: total ? `${withVisual}/${total} 镜已绑参考图` : "—",
        tone: !total ? "neutral" : withVisual === total ? "success" : "danger",
      },
      {
        label: "片段任务接口",
        value: loadValue,
        tone: loadTone,
      },
      {
        label: "视频模型线路",
        value: `${runtimeLabel}${runtimeModelId ? ` · ${runtimeModelId}` : ""} · ${runtimeLiveEnabled ? "可用" : "异常/离线"}`,
        tone: runtimeLiveEnabled ? "success" : "danger",
      },
      {
        label: "无声片段",
        value: silentValue,
        tone: silentTone,
      },
      {
        label: "口型对齐",
        value: lipValue,
        tone: lipTone,
      },
    ];
  }, [loadingStatus, prevStepSucceeded, runtimeLabel, runtimeLiveEnabled, runtimeModelId, shots]);

  useEffect(() => {
    if (!taskId || !hasPendingShots) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadShots(true);
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingShots, loadShots, taskId]);

  useEffect(() => {
    if (!shots.length) {
      setSelectedShotIndex(1);
      return;
    }

    setSelectedShotIndex((current) => (shots.some((shot) => shot.shotIndex === current) ? current : shots[0].shotIndex));
  }, [shots]);

  const selectedShot = shots.find((shot) => shot.shotIndex === selectedShotIndex) ?? shots[0] ?? null;

  const submitAction = useCallback(async (body: Record<string, unknown>) => {
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
    const data = (await response.json()) as ClipModuleResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "片段生成失败");
    }

    setShots(data.shots ?? []);
    if (data.task) {
      onTaskUpdate(data.task);
    }
  }, [onTaskUpdate, taskId]);

  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setError(null);
    try {
      await submitAction({ action: "generate_all" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "片段生成失败");
    } finally {
      setGeneratingAll(false);
    }
  }, [submitAction]);

  async function handleGenerateShot(shotIndex: number) {
    setGeneratingShotIndex(shotIndex);
    setError(null);
    try {
      await submitAction({ action: "generate_shot", shotIndex });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "片段重新生成失败");
    } finally {
      setGeneratingShotIndex(null);
    }
  }

  async function handlePlaySelectedShot() {
    const url = selectedShot ? getEffectiveClipPreview(selectedShot).videoUrl : null;
    if (!previewVideoRef.current || !url) {
      return;
    }

    previewVideoRef.current.currentTime = 0;
    await previewVideoRef.current.play();
  }

  function togglePromptExpand(key: string) {
    setExpandedPromptKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
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
      disabled: generatingAll || loadingStatus === "loading" || !prevStepSucceeded,
      onAction: () => {
        void handleGenerateAll();
      },
    });

    return () => {
      onPrimaryActionChange(null);
    };
  }, [generatingAll, handleGenerateAll, loadingStatus, onPrimaryActionChange, prevStepSucceeded, primaryActionLabel, taskId]);

  if (!task) {
    return <div className="task-module-empty">完成视觉图片生成后，这里会按镜头生成视频片段并展示详情。</div>;
  }

  return (
    <div className="task-clip-module">
      {error ? <div className="error-box">{error}</div> : null}
      <TaskStatusHintPanel
        description="片段（I2V）提交后由后台自动排队口型同步；预览优先展示口型成片。失败镜头可单镜重生，重新生成会清理旧口型任务并再次自动对齐。"
        items={clipHintItems}
      />
      <div className="task-clip-toolbar">
        <span>
          {hasPendingShots
            ? "片段或口型同步进行中，页面会定时刷新；口型在对应无声片段完成后由后台自动提交，无需再手动点同步。"
            : "点击「下一步」批量生成缺失镜头后，每一镜无声视频就绪时会自动排队口型同步；合成阶段会优先使用口型成片。"}
        </span>
      </div>

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
              <span className="task-clip-strip-badge">{`镜头 ${shot.shotIndex}`}</span>
              <div className="task-clip-strip-media">
                {shot.thumbnailUrl ? (
                  <Image src={shot.thumbnailUrl} alt={`${shot.shotTitle} 首帧`} width={720} height={720} unoptimized />
                ) : stripPreview.videoUrl ? (
                  <video src={stripPreview.videoUrl} preload="metadata" muted playsInline />
                ) : (
                  <div className="task-clip-strip-empty">待生成</div>
                )}
              </div>
              <p>{shot.subtitleText || shot.narrationText || "生成完成后，这里会展示当前镜头的台词。"} </p>
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
              <div className="task-clip-preview-stage">
                {(() => {
                  const { videoUrl, variant } = getEffectiveClipPreview(selectedShot);
                  const previewKey = `${variant}-${selectedShot.lipSyncJob?.jobId ?? ""}-${selectedShot.job?.jobId ?? ""}`;
                  return videoUrl ? (
                  <>
                    <video
                      key={previewKey}
                      ref={previewVideoRef}
                      className="task-clip-preview-video"
                      src={videoUrl}
                      poster={selectedShot.thumbnailUrl ?? undefined}
                      preload="metadata"
                      playsInline
                      controls={isPreviewPlaying}
                      onPlay={() => setIsPreviewPlaying(true)}
                      onPause={() => setIsPreviewPlaying(false)}
                      onEnded={() => setIsPreviewPlaying(false)}
                    />
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
                  <Image src={selectedShot.thumbnailUrl} alt={`${selectedShot.shotTitle} 首帧`} width={900} height={1600} unoptimized />
                ) : (
                  <div className="task-clip-preview-empty">当前镜头片段尚未生成</div>
                );
                })()}
              </div>
            </div>

            <div className="task-clip-detail-meta">
              <div className="task-clip-detail-title-row">
                <strong>{selectedShot.shotTitle}</strong>
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
                <p className={`task-visual-shot-prompt ${expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "expanded" : ""}`}>
                  {selectedShot.videoPrompt}
                </p>
                {shouldAllowPromptExpand(selectedShot.videoPrompt) ? (
                  <button className="task-visual-shot-expand" type="button" onClick={() => togglePromptExpand(`clip-${selectedShot.shotIndex}`)}>
                    <span>{expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "收起" : "展开"}</span>
                    <span className={`task-visual-shot-expand-icon ${expandedPromptKeys.includes(`clip-${selectedShot.shotIndex}`) ? "expanded" : ""}`}>⌄</span>
                  </button>
                ) : null}
              </div>
              <div className="task-clip-params">
                <span>{`画面比例 ${selectedShot.job?.generationSettings?.aspectRatio ?? task.parameters.video.aspectRatio}`}</span>
                <span>{`片段时长 ${selectedShot.durationSeconds} 秒`}</span>
                <span>{`输出画质 ${selectedShot.job?.generationSettings?.mode ?? task.parameters.video.mode}`}</span>
                <span>{`提示词相关性 ${selectedShot.job?.generationSettings?.cfgScale ?? task.parameters.video.cfgScale}`}</span>
              </div>
              <div className="task-clip-params">
                <span>{`生成时间 ${new Date(selectedShot.clipRecord?.generatedAt ?? selectedShot.job?.submittedAt ?? task.updatedAt).toLocaleString("zh-CN")}`}</span>
                <span>{`调用模型 ${(selectedShot.job?.modelId ?? runtimeModelId) || runtimeLabel}`}</span>
              </div>
              <div className="task-clip-detail-copy">
                <p>{`台词：${selectedShot.narrationText || "暂无"}`}</p>
                <p>{`字幕：${selectedShot.subtitleText || "暂无"}`}</p>
              </div>
              <div className="task-clip-detail-actions">
                <button
                  className="btn-pill task-clip-action-button"
                  type="button"
                  disabled={!getEffectiveClipPreview(selectedShot).videoUrl}
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
                  {generatingShotIndex === selectedShot.shotIndex ? "生成中..." : "重新生成该镜片段"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="task-module-empty">当前任务还没有镜头数据。</div>
        )}
      </section>
    </div>
  );
}
