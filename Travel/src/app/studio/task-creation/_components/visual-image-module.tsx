"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getVideoTaskStatusIndex, type VideoTaskRecord } from "../../../../lib/video-task-schema";

import { formatRuntimeDisplay, TaskStatusHintPanel, type TaskStatusHintItem } from "./task-ui";

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
};

type VisualImageShot = {
  shotIndex: number;
  shotTitle: string;
  prompt: string;
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

function formatWatermarkLabel(watermark: boolean) {
  return watermark ? "有水印" : "无水印";
}

function shouldAllowPromptExpand(prompt: string) {
  return prompt.replace(/\s+/g, "").length > 72;
}

export function VisualImageModule({
  task,
  onTaskUpdate,
  onPrimaryActionChange,
}: {
  task: VideoTaskRecord | null;
  onTaskUpdate: (task: VideoTaskRecord) => void;
  onPrimaryActionChange?:
    | ((config: { label: string; disabled: boolean; onAction: () => void } | null) => void)
    | undefined;
}) {
  const taskId = task?.taskId ?? null;
  const [shots, setShots] = useState<VisualImageShot[]>([]);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingShotIndex, setGeneratingShotIndex] = useState<number | null>(null);
  const [submittingShotIndex, setSubmittingShotIndex] = useState<number | null>(null);
  const [expandedPromptKeys, setExpandedPromptKeys] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<{ imageUrl: string; title: string } | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState("Doubao-Seedream-4.5");
  const [runtimeModelId, setRuntimeModelId] = useState("");
  const [runtimeLiveEnabled, setRuntimeLiveEnabled] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadShots = async () => {
      if (!taskId) {
        setShots([]);
        setLoadingStatus("idle");
        return;
      }

      setLoadingStatus("loading");
      setError(null);

      try {
        const response = await fetch(`/api/video-tasks/${taskId}/visual-images`, { cache: "no-store" });
        const data = (await response.json()) as VisualImageResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "视觉图片加载失败");
        }

        if (!isActive) {
          return;
        }

        setShots(data.shots ?? []);
        setRuntimeLabel(data.runtime?.providerLabel ?? "Doubao-Seedream-4.5");
        setRuntimeModelId(data.runtime?.modelId ?? "");
        setRuntimeLiveEnabled(data.runtime?.liveEnabled ?? true);
        setLoadingStatus("success");
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        setLoadingStatus("error");
        setError(loadError instanceof Error ? loadError.message : "视觉图片加载失败");
      }
    };

    void loadShots();

    return () => {
      isActive = false;
    };
  }, [taskId]);

  const hasGeneratedShots = useMemo(() => shots.some((shot) => shot.candidates.length > 0), [shots]);
  const subtitleAudioReadyIndex = getVideoTaskStatusIndex("SUBTITLE_AUDIO_READY");
  const imagesReadyIndex = getVideoTaskStatusIndex("IMAGES_READY");
  const currentStatusIndex = task ? getVideoTaskStatusIndex(task.status) : -1;
  const prevStepSucceeded = currentStatusIndex >= subtitleAudioReadyIndex;
  const visualStageComplete = currentStatusIndex >= imagesReadyIndex;

  const primaryActionLabel = useMemo(() => {
    if (generatingAll) {
      return "生成中...";
    }
    if (visualStageComplete) {
      return "重新生成图片";
    }
    return "点击进行下一步";
  }, [generatingAll, visualStageComplete]);

  const visualHintItems = useMemo((): TaskStatusHintItem[] => {
    const total = shots.length;
    const withCandidates = shots.filter((s) => s.candidates.length > 0).length;
    const withSelection = shots.filter((s) => s.selectedCandidate).length;
    const loadTone: TaskStatusHintItem["tone"] =
      loadingStatus === "error"
        ? "danger"
        : loadingStatus === "success"
          ? "success"
          : loadingStatus === "loading"
            ? "progress"
            : "neutral";
    const loadValue =
      loadingStatus === "loading"
        ? "加载中"
        : loadingStatus === "success"
          ? "已同步"
          : loadingStatus === "error"
            ? "失败（可看顶部报错）"
            : "待加载";

    return [
      {
        label: "上游字幕音频",
        value: prevStepSucceeded ? "已完成（可批量出图）" : "未完成（主按钮禁用）",
        tone: prevStepSucceeded ? "success" : "danger",
      },
      {
        label: "视觉列表接口",
        value: loadValue,
        tone: loadTone,
      },
      {
        label: "图片生成模型",
        value: formatRuntimeDisplay({
          providerLabel: runtimeLabel,
          modelId: runtimeModelId,
          liveEnabled: runtimeLiveEnabled,
          offlineLabel: "离线/不可用",
        }),
        tone: runtimeLiveEnabled ? "success" : "danger",
      },
      {
        label: "镜头数量",
        value: total ? `${total} 镜` : "暂无数据",
        tone: total ? "neutral" : "progress",
      },
      {
        label: "候选图覆盖",
        value: total ? `${withCandidates}/${total} 镜已出候选` : "—",
        tone: !total ? "neutral" : withCandidates === total ? "success" : withCandidates > 0 ? "progress" : "danger",
      },
      {
        label: "定稿选图",
        value: total ? `${withSelection}/${total} 镜已选定` : "—",
        tone: !total ? "neutral" : withSelection === total ? "success" : "danger",
      },
      {
        label: "任务状态位",
        value: task?.status ?? "—",
        tone: visualStageComplete ? "success" : "neutral",
      },
    ];
  }, [
    loadingStatus,
    prevStepSucceeded,
    runtimeLabel,
    runtimeLiveEnabled,
    runtimeModelId,
    shots,
    task?.status,
    visualStageComplete,
  ]);

  const submitAction = useCallback(
    async (body: Record<string, unknown>) => {
      if (!taskId) {
        return;
      }

      const response = await fetch(`/api/video-tasks/${taskId}/visual-images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as VisualImageResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "视觉图片操作失败");
      }

      setShots(data.shots ?? []);
      setRuntimeLabel(data.runtime?.providerLabel ?? runtimeLabel);
      setRuntimeModelId(data.runtime?.modelId ?? runtimeModelId);
      setRuntimeLiveEnabled(data.runtime?.liveEnabled ?? runtimeLiveEnabled);
      if (data.task) {
        onTaskUpdate(data.task);
      }
    },
    [onTaskUpdate, runtimeLabel, runtimeLiveEnabled, runtimeModelId, taskId],
  );

  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setError(null);

    try {
      await submitAction({ action: "generate_all" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "视觉图片生成失败");
    } finally {
      setGeneratingAll(false);
    }
  }, [submitAction]);

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
  }, [
    generatingAll,
    handleGenerateAll,
    loadingStatus,
    onPrimaryActionChange,
    prevStepSucceeded,
    primaryActionLabel,
    taskId,
  ]);

  async function handleGenerateShot(shotIndex: number) {
    setGeneratingShotIndex(shotIndex);
    setError(null);

    try {
      await submitAction({ action: "generate_shot", shotIndex });
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
      await submitAction({ action: "select_candidate", shotIndex, candidateId });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "选择图片失败");
    } finally {
      setSubmittingShotIndex(null);
    }
  }

  async function handleClearSelection(shotIndex: number) {
    setSubmittingShotIndex(shotIndex);
    setError(null);

    try {
      await submitAction({ action: "clear_selection", shotIndex });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "重新选择失败");
    } finally {
      setSubmittingShotIndex(null);
    }
  }

  function togglePromptExpand(key: string) {
    setExpandedPromptKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  if (!task) {
    return <div className="task-module-empty">完成字幕音频制作后，这里会按镜头生成视觉图片并供你逐张确认。</div>;
  }

  return (
    <div className="task-visual-image-module">
      {error ? <div className="error-box">{error}</div> : null}
      <TaskStatusHintPanel
        description="关注上游字幕是否完成、列表接口是否可用、候选图是否全覆盖，以及是否每镜选定参考图；未定稿会直接阻塞片段生成。"
        items={visualHintItems}
      />
      <div className="task-visual-image-toolbar">
        <span>
          {hasGeneratedShots
            ? "已为镜头生成候选视觉图，可继续选择或单镜头重生。"
            : "根据文生图提示词与当前图片参数，为每个镜头生成 6 张视觉候选图。"}
        </span>
      </div>

      <div className="task-visual-image-stack">
        {shots.map((shot) => {
          const isExpanded = expandedPromptKeys.includes(`shot-${shot.shotIndex}`);
          const hasSelection = Boolean(shot.selectedCandidate);
          const shouldShowExpand = shouldAllowPromptExpand(shot.prompt);

          return (
            <article key={shot.shotIndex} className="task-visual-shot-card">
              <div className="task-visual-shot-selected">
                <div className="task-visual-shot-selected-media">
                  {shot.selectedCandidate ? (
                    <button
                      className="task-visual-shot-selected-trigger image-preview-trigger"
                      type="button"
                      onClick={() =>
                        setPreviewImage({
                          imageUrl: shot.selectedCandidate!.imageUrl,
                          title: `${shot.shotTitle} 已选图片`,
                        })
                      }
                    >
                      <Image
                        src={shot.selectedCandidate.imageUrl}
                        alt={`${shot.shotTitle} 已选图片`}
                        width={900}
                        height={1350}
                        unoptimized
                      />
                    </button>
                  ) : (
                    <div className="task-visual-shot-empty">请在右方选择视觉图</div>
                  )}
                </div>
                <p className="task-visual-shot-selected-label">{`${shot.shotTitle}  已选图片`}</p>
              </div>

              <div className="task-visual-shot-meta">
                <div className="task-visual-shot-meta-head">
                  <strong>{shot.shotTitle}</strong>
                </div>
                <div className="task-visual-shot-prompt-wrap">
                  <p className={`task-visual-shot-prompt ${isExpanded ? "expanded" : ""}`}>{shot.prompt}</p>
                  {shouldShowExpand ? (
                    <button
                      className="task-visual-shot-expand"
                      type="button"
                      onClick={() => togglePromptExpand(`shot-${shot.shotIndex}`)}
                    >
                      <span>{isExpanded ? "收起" : "展开"}</span>
                      <span className={`task-visual-shot-expand-icon ${isExpanded ? "expanded" : ""}`}>⌄</span>
                    </button>
                  ) : null}
                </div>
                <div className="task-visual-shot-params">
                  <span>{shot.size}</span>
                  <span>{`细节档 ${shot.guidanceScale}`}</span>
                  <span>{formatWatermarkLabel(shot.watermark)}</span>
                  <span>{new Date(shot.generatedAt ?? shot.updatedAt ?? task.updatedAt).toLocaleString("zh-CN")}</span>
                </div>
                <div className="task-visual-shot-actions">
                  <button
                    className="btn-pill"
                    type="button"
                    disabled={!shot.selectedCandidate}
                    onClick={() =>
                      shot.selectedCandidate &&
                      setPreviewImage({ imageUrl: shot.selectedCandidate.imageUrl, title: `${shot.shotTitle} 原图` })
                    }
                  >
                    查看大图
                  </button>
                  <button
                    className="btn-pill"
                    type="button"
                    disabled={!hasSelection || submittingShotIndex === shot.shotIndex}
                    onClick={() => void handleClearSelection(shot.shotIndex)}
                  >
                    重新选择
                  </button>
                </div>
              </div>

              <div className="task-visual-shot-picker">
                <div className="task-visual-shot-picker-head">
                  <strong>图片选择区域</strong>
                  <button
                    className="btn-pill"
                    type="button"
                    disabled={generatingShotIndex === shot.shotIndex}
                    onClick={() => void handleGenerateShot(shot.shotIndex)}
                  >
                    {generatingShotIndex === shot.shotIndex ? "重新生成中..." : "重新生成一批"}
                  </button>
                </div>
                <div className="task-visual-shot-candidate-list">
                  {shot.candidates.length ? (
                    shot.candidates.map((candidate) => {
                      const isRecommended = candidate.candidateId === shot.recommendedCandidateId;
                      const isSelected = candidate.candidateId === shot.selectedCandidateId;
                      return (
                        <article
                          key={candidate.candidateId}
                          className={`task-visual-shot-candidate ${isSelected ? "selected" : ""}`}
                        >
                          <button
                            className="task-visual-shot-candidate-trigger image-preview-trigger"
                            type="button"
                            onClick={() =>
                              setPreviewImage({ imageUrl: candidate.imageUrl, title: `${shot.shotTitle} 候选图` })
                            }
                          >
                            <Image
                              src={candidate.imageUrl}
                              alt={`${shot.shotTitle} 候选图`}
                              width={1200}
                              height={900}
                              unoptimized
                            />
                          </button>
                          <div className="task-visual-shot-candidate-foot">
                            <div className="task-visual-shot-candidate-tags">
                              {isRecommended ? (
                                <span className="task-visual-shot-recommended">✓ 系统推荐</span>
                              ) : (
                                <span className="task-visual-shot-score">{candidate.scoreLabel}</span>
                              )}
                            </div>
                            <button
                              className="btn-pill"
                              type="button"
                              disabled={hasSelection || submittingShotIndex === shot.shotIndex}
                              onClick={() => void handleSelectCandidate(shot.shotIndex, candidate.candidateId)}
                            >
                              {isSelected ? "已选择" : "选择这一张"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="task-visual-shot-candidate-empty">
                      点击“重新生成一批”或上方批量按钮后，这里会展示该镜头的 6 张候选图。
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {previewImage ? (
        <div className="modal-overlay" role="presentation" onClick={() => setPreviewImage(null)}>
          <div
            className="modal-panel image-preview-panel"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3>{previewImage.title}</h3>
              </div>
              <button className="btn-secondary small" type="button" onClick={() => setPreviewImage(null)}>
                关闭
              </button>
            </div>
            <div className="modal-body image-preview-body">
              <div className="image-preview-stage">
                <Image src={previewImage.imageUrl} alt={previewImage.title} width={1600} height={1600} unoptimized />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
