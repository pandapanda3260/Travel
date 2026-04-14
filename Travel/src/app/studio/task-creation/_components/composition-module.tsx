"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { splitTextIntoPhrases } from "../../../../lib/subtitle-text-utils";
import type { VideoTaskRecord } from "../../../../lib/video-task-schema";

import { formatLocalServiceDisplay, TaskStatusHintPanel, type TaskStatusHintItem } from "./task-ui";

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
};

type CompositionRecord = {
  compositionId: string;
  title: string;
  status: "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
  outputVideoUrl: string | null;
  backgroundMusicUrl: string | null;
  transitionMode: CompositionTransition;
  transitionDurationSeconds: number;
  audioMode: string;
  subtitleSrtUrl: string | null;
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
  latestComposition?: CompositionRecord | null;
  statusSummary?: {
    clipCount: number;
    completedClipCount: number;
    subtitleReady: boolean;
    narrationReady: boolean;
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

type TimelineItem = {
  segmentId: string;
  shotIndex: number;
  transition: CompositionTransition;
};

async function parseApiResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  if (!rawText) {
    throw new Error(`接口返回为空，状态码 ${response.status}`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    const normalizedText = rawText.trim().slice(0, 180);
    throw new Error(
      response.ok
        ? `接口返回了非 JSON 内容：${normalizedText}`
        : `接口请求失败，状态码 ${response.status}：${normalizedText}`,
    );
  }
}

function buildTimelineKey(timeline: TimelineItem[]) {
  return timeline.map((item) => `${item.segmentId}:${item.transition}`).join("|");
}

export function CompositionModule({
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
  const [materials, setMaterials] = useState<CompositionMaterial[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [includeBackgroundMusic, setIncludeBackgroundMusic] = useState(false);
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState("");
  const [subtitleStyle, setSubtitleStyle] = useState<"clean" | "bold" | "outline" | "shadow">("clean");
  const [subtitleMaxChars, setSubtitleMaxChars] = useState(8);
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "center" | "top">("bottom");
  const [subtitleSizeRatio, setSubtitleSizeRatio] = useState(0.022);
  const [subtitleDisplay, setSubtitleDisplay] = useState<"word_by_word" | "full_sentence">("full_sentence");
  const [previewSubtitleIndex, setPreviewSubtitleIndex] = useState(0);
  const [latestComposition, setLatestComposition] = useState<CompositionRecord | null>(null);
  const [statusSummary, setStatusSummary] = useState<CompositionModuleResponse["statusSummary"] | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runtime, setRuntime] = useState<CompositionModuleResponse["runtime"] | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastHydratedTimelineKeyRef = useRef("");
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadCompositionData = useCallback(async () => {
    if (!taskId) {
      return;
    }

    setLoadingStatus("loading");
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

      setMaterials(data.clipShots ?? []);
      setLatestComposition(data.latestComposition ?? data.result ?? null);
      setStatusSummary(data.statusSummary ?? null);
      setRuntime(data.runtime ?? null);

      const compositionSegments = data.latestComposition?.segments ?? [];
      const hasExistingComposition = compositionSegments.length > 0;

      let nextTimeline: TimelineItem[];
      if (hasExistingComposition) {
        nextTimeline = compositionSegments
          .sort((left, right) => left.order - right.order)
          .map((segment) => {
            const matchedMaterial = (data.clipShots ?? []).find((item) => item.job?.jobId === segment.sourceJobId);
            return matchedMaterial
              ? {
                  segmentId: matchedMaterial.segmentId,
                  shotIndex: matchedMaterial.shotIndex,
                  transition: segment.transition ?? "cut",
                }
              : null;
          })
          .filter((item): item is TimelineItem => Boolean(item));
      } else {
        nextTimeline = (data.clipShots ?? [])
          .filter((item) => item.job?.status === "COMPLETED")
          .sort((left, right) => left.segmentIndex - right.segmentIndex)
          .map((item) => ({ segmentId: item.segmentId, shotIndex: item.shotIndex, transition: "cut" as const }));
      }
      const nextTimelineKey = buildTimelineKey(nextTimeline);

      if (nextTimelineKey && lastHydratedTimelineKeyRef.current !== nextTimelineKey) {
        setTimeline(nextTimeline);
        lastHydratedTimelineKeyRef.current = nextTimelineKey;
      }

      const nextBackgroundMusicUrl = data.latestComposition?.backgroundMusicUrl ?? "";
      setIncludeBackgroundMusic(Boolean(nextBackgroundMusicUrl));
      setBackgroundMusicUrl(nextBackgroundMusicUrl);
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
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setMaterials([]);
      setTimeline([]);
      setLatestComposition(null);
      setRuntime(null);
      setLoadingStatus("idle");
      return;
    }

    setTimeline([]);
    setIncludeBackgroundMusic(false);
    setBackgroundMusicUrl("");
    lastHydratedTimelineKeyRef.current = "";
    void loadCompositionData();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadCompositionData, taskId]);

  const materialMap = useMemo(() => new Map(materials.map((item) => [item.segmentId, item])), [materials]);
  const timelineMaterials = useMemo(() => {
    const seen = new Set<string>();
    return timeline
      .filter((item) => {
        if (seen.has(item.segmentId)) return false;
        seen.add(item.segmentId);
        return true;
      })
      .map((item) => ({ timelineItem: item, material: materialMap.get(item.segmentId) ?? null }))
      .filter((item): item is { timelineItem: TimelineItem; material: CompositionMaterial } => item.material !== null);
  }, [timeline, materialMap]);

  const compositionHintItems = useMemo((): TaskStatusHintItem[] => {
    const clipCount = statusSummary?.clipCount ?? materials.length;
    const completedClips =
      statusSummary?.completedClipCount ?? materials.filter((m) => m.job?.status === "COMPLETED").length;

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

    const clipTone: TaskStatusHintItem["tone"] = !clipCount
      ? "neutral"
      : completedClips === clipCount
        ? "success"
        : completedClips > 0
          ? "progress"
          : "danger";
    const clipValue = clipCount ? `${completedClips}/${clipCount} 片段可用` : "暂无素材";

    const compStatus = latestComposition?.status;
    const compTone: TaskStatusHintItem["tone"] =
      compStatus === "COMPLETED"
        ? "success"
        : compStatus === "FAILED"
          ? "danger"
          : compStatus === "PROCESSING"
            ? "progress"
            : "neutral";
    const compValue = !latestComposition
      ? "尚无成片记录"
      : compStatus === "COMPLETED"
        ? "输出可预览"
        : compStatus === "FAILED"
          ? "上次失败"
          : compStatus === "PROCESSING"
            ? "处理中"
            : "草稿/待合成";

    return [
      { label: "合成数据接口", value: loadValue, tone: loadTone },
      {
        label: "本地合成服务",
        value: runtime
          ? formatLocalServiceDisplay({
              serviceLabel: runtime.serviceLabel,
              available: runtime.available,
              unavailableLabel: runtime.statusLabel,
            })
          : "待加载",
        tone: runtime?.available ? "success" : runtime ? "danger" : "neutral",
      },
      { label: "可用视频片段", value: clipValue, tone: clipTone },
      {
        label: "字幕轨素材",
        value: statusSummary?.subtitleReady ? "已取到" : "缺失（易致字幕异常）",
        tone: statusSummary?.subtitleReady ? "success" : "danger",
      },
      {
        label: "配音轨素材",
        value: statusSummary?.narrationReady ? "已取到" : "缺失（易致无声）",
        tone: statusSummary?.narrationReady ? "success" : "danger",
      },
      {
        label: "Timeline 入轨",
        value: timeline.length ? `${timeline.length} 段已排程` : "未加入任何片段（主按钮禁用）",
        tone: timeline.length > 0 ? "success" : "danger",
      },
      { label: "成片任务", value: compValue, tone: compTone },
    ];
  }, [latestComposition, loadingStatus, materials, runtime, statusSummary, timeline.length]);

  const primaryActionLabel = submitting ? "合成中..." : latestComposition ? "重新合成视频" : "点击进行第六步 合成视频";

  const submitAutoCompose = useCallback(async () => {
    if (!taskId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/video-tasks/${taskId}/composition-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto_compose",
          includeBackgroundMusic,
          backgroundMusicUrl,
        }),
      });
      const data = await parseApiResponse<CompositionModuleResponse>(response);
      if (!response.ok) {
        throw new Error(data.error ?? "自动合成失败");
      }

      setMaterials(data.clipShots ?? []);
      setLatestComposition(data.result ?? data.latestComposition ?? null);
      setStatusSummary(data.statusSummary ?? null);
      setRuntime(data.runtime ?? null);

      if (data.result?.segments?.length) {
        const autoTimeline = data.result.segments
          .sort((left, right) => left.order - right.order)
          .map((segment) => {
            const matchedMaterial = (data.clipShots ?? []).find((item) => item.job?.jobId === segment.sourceJobId);
            return matchedMaterial
              ? {
                  segmentId: matchedMaterial.segmentId,
                  shotIndex: matchedMaterial.shotIndex,
                  transition: segment.transition ?? ("cut" as const),
                }
              : null;
          })
          .filter((item): item is TimelineItem => Boolean(item));
        if (autoTimeline.length) {
          setTimeline(autoTimeline);
          lastHydratedTimelineKeyRef.current = buildTimelineKey(autoTimeline);
        }
      }

      if (data.task) {
        onTaskUpdate(data.task);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "自动合成失败");
    } finally {
      setSubmitting(false);
    }
  }, [backgroundMusicUrl, includeBackgroundMusic, onTaskUpdate, taskId]);

  const submitComposition = useCallback(
    async (action: "compose" | "regenerate") => {
      if (!taskId) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch(`/api/video-tasks/${taskId}/composition-runs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            timeline,
            includeBackgroundMusic,
            backgroundMusicUrl,
          }),
        });
        const data = await parseApiResponse<CompositionModuleResponse>(response);
        if (!response.ok) {
          throw new Error(data.error ?? "视频合成失败");
        }

        setMaterials(data.clipShots ?? []);
        setLatestComposition(data.result ?? data.latestComposition ?? null);
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
      }
    },
    [backgroundMusicUrl, includeBackgroundMusic, onTaskUpdate, taskId, timeline],
  );

  function addToTimeline(segmentId: string, shotIndex: number) {
    setTimeline((current) => {
      if (current.some((item) => item.segmentId === segmentId)) {
        return current;
      }
      const next = [...current, { segmentId, shotIndex, transition: "cut" as const }];
      lastHydratedTimelineKeyRef.current = buildTimelineKey(next);
      return next;
    });
  }

  function removeFromTimeline(segmentId: string) {
    setTimeline((current) => {
      const next = current.filter((item) => item.segmentId !== segmentId);
      if (next.length === current.length) return current;
      lastHydratedTimelineKeyRef.current = buildTimelineKey(next);
      return next;
    });
  }

  function updateTimelineTransition(segmentId: string, transition: CompositionTransition) {
    setTimeline((current) => {
      const index = current.findIndex((item) => item.segmentId === segmentId);
      if (index < 0) return current;
      const next = [...current];
      next[index] = { ...next[index], transition };
      lastHydratedTimelineKeyRef.current = buildTimelineKey(next);
      return next;
    });
  }

  function autoArrangeTimeline() {
    const completedMaterials = materials
      .filter((item) => item.job?.status === "COMPLETED")
      .sort((left, right) => left.segmentIndex - right.segmentIndex);
    const next: TimelineItem[] = completedMaterials.map((item) => ({
      segmentId: item.segmentId,
      shotIndex: item.shotIndex,
      transition: "cut" as const,
    }));
    lastHydratedTimelineKeyRef.current = buildTimelineKey(next);
    setTimeline(next);
  }

  function moveTimelineItem(segmentId: string, direction: "up" | "down") {
    setTimeline((current) => {
      const index = current.findIndex((item) => item.segmentId === segmentId);
      if (index < 0) return current;
      if (direction === "up" && index === 0) return current;
      if (direction === "down" && index === current.length - 1) return current;
      const next = [...current];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [next[targetIndex], next[index]] = [next[index], next[targetIndex]];
      lastHydratedTimelineKeyRef.current = buildTimelineKey(next);
      return next;
    });
  }

  function handlePlayPreview() {
    if (!previewVideoRef.current || !latestComposition?.outputVideoUrl) {
      return;
    }

    previewVideoRef.current.currentTime = 0;
    void previewVideoRef.current.play();
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
      disabled: submitting || !timelineMaterials.length,
      onAction: () => {
        void submitComposition(latestComposition ? "regenerate" : "compose");
      },
    });

    return () => {
      onPrimaryActionChange(null);
    };
  }, [
    latestComposition,
    onPrimaryActionChange,
    primaryActionLabel,
    submitComposition,
    submitting,
    taskId,
    timelineMaterials.length,
  ]);

  if (!task) {
    return <div className="task-module-empty">完成片段生成后，这里会进行视频合成、字幕对齐与背景音乐编排。</div>;
  }

  return (
    <div className="task-composition-module">
      {error ? <div className="error-box">{error}</div> : null}

      <TaskStatusHintPanel
        description="关注片段与字幕/配音素材是否齐全、Timeline 是否已入轨，以及合成接口与成片任务状态；缺轨或素材缺失是最常见的合成失败原因。"
        items={compositionHintItems}
      />

      <section className="task-composition-av-settings">
        <div className="task-composition-av-controls">
          <div className="task-composition-av-group">
            <strong>背景音乐</strong>
            <div className="task-composition-bgm-row">
              <label>是否加入</label>
              <div className="task-composition-bgm-toggle" role="group" aria-label="是否加入背景音乐">
                <button
                  className={`task-composition-bgm-toggle-button ${!includeBackgroundMusic ? "active" : ""}`}
                  type="button"
                  onClick={() => setIncludeBackgroundMusic(false)}
                >
                  不加入
                </button>
                <button
                  className={`task-composition-bgm-toggle-button ${includeBackgroundMusic ? "active" : ""}`}
                  type="button"
                  onClick={() => setIncludeBackgroundMusic(true)}
                >
                  加入
                </button>
              </div>
              {includeBackgroundMusic ? (
                <input
                  value={backgroundMusicUrl}
                  onChange={(event) => setBackgroundMusicUrl(event.target.value)}
                  placeholder="本地路径或在线 mp3 地址"
                />
              ) : null}
            </div>
          </div>
          <div className="task-composition-av-group">
            <strong>字幕设置</strong>
            <div className="task-subtitle-settings-grid">
              <label className="task-subtitle-setting-field">
                <span>样式</span>
                <select
                  value={subtitleStyle}
                  onChange={(e) => setSubtitleStyle(e.target.value as typeof subtitleStyle)}
                >
                  <option value="clean">简洁白字</option>
                  <option value="bold">加粗描边</option>
                  <option value="outline">霓虹描边</option>
                  <option value="shadow">底部阴影条</option>
                </select>
              </label>
              <label className="task-subtitle-setting-field">
                <span>出现方式</span>
                <select
                  value={subtitleDisplay}
                  onChange={(e) => setSubtitleDisplay(e.target.value as typeof subtitleDisplay)}
                >
                  <option value="word_by_word">逐字显示</option>
                  <option value="full_sentence">整句显示</option>
                </select>
              </label>
              <label className="task-subtitle-setting-field">
                <span>位置</span>
                <select
                  value={subtitlePosition}
                  onChange={(e) => setSubtitlePosition(e.target.value as typeof subtitlePosition)}
                >
                  <option value="bottom">底部</option>
                  <option value="center">居中</option>
                  <option value="top">顶部</option>
                </select>
              </label>
              <label className="task-subtitle-setting-field">
                <span>每行字数</span>
                <select value={subtitleMaxChars} onChange={(e) => setSubtitleMaxChars(Number(e.target.value))}>
                  <option value={8}>8 字</option>
                  <option value={10}>10 字</option>
                  <option value={12}>12 字</option>
                  <option value={14}>14 字</option>
                  <option value={16}>16 字</option>
                </select>
              </label>
              <label className="task-subtitle-setting-field">
                <span>字号</span>
                <select value={subtitleSizeRatio} onChange={(e) => setSubtitleSizeRatio(Number(e.target.value))}>
                  <option value={0.022}>小</option>
                  <option value={0.028}>中</option>
                  <option value={0.035}>大</option>
                  <option value={0.042}>特大</option>
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="task-subtitle-preview-col">
          <div className="task-subtitle-preview-screen" data-position={subtitlePosition}>
            {materials[previewSubtitleIndex]?.thumbnailUrl ? (
              <Image
                className="task-subtitle-preview-poster"
                src={materials[previewSubtitleIndex].thumbnailUrl!}
                alt=""
                fill
                unoptimized
              />
            ) : (
              <div className="task-subtitle-preview-bg" />
            )}
            <button
              className="task-subtitle-nav-btn task-subtitle-nav-prev"
              type="button"
              disabled={previewSubtitleIndex <= 0}
              onClick={() => setPreviewSubtitleIndex((i) => Math.max(0, i - 1))}
            >
              ‹
            </button>
            <button
              className="task-subtitle-nav-btn task-subtitle-nav-next"
              type="button"
              disabled={previewSubtitleIndex >= materials.length - 1}
              onClick={() => setPreviewSubtitleIndex((i) => Math.min(materials.length - 1, i + 1))}
            >
              ›
            </button>
            <div
              className={`task-subtitle-preview-text task-subtitle-preview-text--${subtitleStyle}`}
              style={{ fontSize: `${Math.round(subtitleSizeRatio * 460)}px` }}
            >
              {(() => {
                const raw = materials[previewSubtitleIndex]?.subtitleText;
                if (!raw) return "字幕预览";
                const phrases = splitTextIntoPhrases(raw, subtitleMaxChars);
                return phrases[0] ?? raw;
              })()}
            </div>
          </div>
          <span className="task-subtitle-preview-hint">
            仅查看字幕显示效果{materials.length > 0 ? `（${previewSubtitleIndex + 1}/${materials.length}）` : ""}
          </span>
        </div>
      </section>

      <section className="task-composition-auto-bar">
        <button
          className="btn-pill task-composition-auto-compose-button"
          type="button"
          disabled={submitting || !materials.some((item) => item.job?.status === "COMPLETED")}
          onClick={() => void submitAutoCompose()}
        >
          {submitting ? "自动合成中..." : "一键自动合成（按脚本顺序）"}
        </button>
        <span className="task-composition-auto-hint">
          自动将所有已完成片段按脚本镜头顺序排列并直接合成，无需手动编排。
        </span>
      </section>

      <section className="task-composition-workbench">
        <div className="task-composition-panel">
          <div className="task-composition-panel-head">
            <strong>素材池</strong>
            <button
              className="btn-pill small"
              type="button"
              disabled={!materials.some((item) => item.job?.status === "COMPLETED")}
              onClick={autoArrangeTimeline}
            >
              一键按脚本排列
            </button>
          </div>
          <div className="task-composition-card-list">
            {materials.map((material) => {
              const alreadyAdded = timeline.some((item) => item.segmentId === material.segmentId);
              return (
                <article key={material.segmentId} className="task-composition-material-card">
                  <div className="task-composition-material-copy">
                    <p className="task-composition-shot-title">{`片段 ${material.shotIndex}`}</p>
                    <p>{`视频：${material.shotTitle} · ${material.durationSeconds} 秒`}</p>
                    <p>{`音频：${material.narrationText || "暂无"} · ${material.durationSeconds} 秒`}</p>
                    <p>{`字幕：${material.subtitleText || "暂无"} · ${material.subtitleText.length} 字`}</p>
                  </div>
                  <button
                    className="btn-pill task-composition-join-button"
                    type="button"
                    disabled={alreadyAdded || material.job?.status !== "COMPLETED"}
                    onClick={() => addToTimeline(material.segmentId, material.shotIndex)}
                  >
                    {alreadyAdded ? "已加入" : "加入 Timeline"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="task-composition-panel">
          <div className="task-composition-panel-head">
            <strong>编辑区</strong>
          </div>
          <div className="task-composition-card-list">
            {timelineMaterials.length ? (
              timelineMaterials.map(({ timelineItem, material }, index) => (
                <article key={timelineItem.segmentId} className="task-composition-timeline-card">
                  <div className="task-composition-order-badge">{index + 1}</div>
                  <div className="task-composition-material-copy">
                    <p className="task-composition-shot-title">{`片段 ${material!.shotIndex}`}</p>
                    <p>{`视频标题：${material!.shotTitle}`}</p>
                    <p>{`视频时长：${material!.durationSeconds} 秒`}</p>
                  </div>
                  <select
                    className="task-composition-transition-select"
                    value={timelineItem.transition}
                    onChange={(event) =>
                      updateTimelineTransition(timelineItem.segmentId, event.target.value as CompositionTransition)
                    }
                  >
                    <option value="cut">衔接方式：硬转</option>
                    <option value="fade">衔接方式：淡入淡出</option>
                  </select>
                  <div className="task-composition-timeline-actions">
                    <button
                      className="btn-secondary small"
                      type="button"
                      onClick={() => moveTimelineItem(timelineItem.segmentId, "up")}
                    >
                      上移
                    </button>
                    <button
                      className="btn-secondary small"
                      type="button"
                      onClick={() => moveTimelineItem(timelineItem.segmentId, "down")}
                    >
                      下移
                    </button>
                    <button
                      className="btn-secondary small"
                      type="button"
                      onClick={() => removeFromTimeline(timelineItem.segmentId)}
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="task-module-empty">已完成的片段会按脚本顺序自动排入；也可从左侧素材池手动加入。</div>
            )}
          </div>
        </div>
      </section>

      <section className="task-clip-detail-card">
        <div className="task-clip-detail-head">
          <strong>拼接结果</strong>
        </div>
        <div className="task-clip-detail-layout">
          <div className="task-clip-preview-panel">
            <div className="task-clip-preview-stage">
              {latestComposition?.outputVideoUrl ? (
                <>
                  <video
                    ref={previewVideoRef}
                    className="task-clip-preview-video"
                    src={latestComposition.outputVideoUrl}
                    preload="metadata"
                    playsInline
                    controls={isPlaying}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                  />
                  {!isPlaying ? (
                    <button className="task-clip-preview-play" type="button" onClick={handlePlayPreview}>
                      ▶
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
              <span>{`片段数量 ${timelineMaterials.length}`}</span>
              <span>{`输出画质 ${task.parameters.video.mode}`}</span>
              <span>{`转场方式 ${timeline.some((item) => item.transition === "fade") ? "含淡入淡出" : "硬转"}`}</span>
              <span>{`字幕 ${latestComposition?.subtitleSrtUrl ? "已合成" : "未合成"}`}</span>
            </div>
            <div className="task-clip-params">
              <span>{`分镜头音频 ${statusSummary?.narrationReady ? "已接入" : "未接入"}`}</span>
              <span>{`背景音乐 ${includeBackgroundMusic && backgroundMusicUrl ? "已加入" : "未加入"}`}</span>
              <span>{`音频模式 多轨混音`}</span>
              <span>{`弱化淡出 已启用`}</span>
            </div>
            <div className="task-clip-params">
              <span>{`生成时间 ${new Date(latestComposition?.updatedAt ?? task.updatedAt).toLocaleString("zh-CN")}`}</span>
              <span>{`调用模型 ${task.parameters.video.mode === "pro" ? "kling-v3 + ffmpeg" : "kling-v3 + ffmpeg"}`}</span>
              <span>{`最终视频名称 ${task.title}`}</span>
            </div>
            <div className="task-clip-detail-actions">
              <button
                className="btn-pill task-clip-action-button"
                type="button"
                disabled={!latestComposition?.outputVideoUrl}
                onClick={handlePlayPreview}
              >
                播放视频
              </button>
              <a
                className={`btn-pill task-clip-action-button ${latestComposition?.outputVideoUrl ? "" : "is-disabled"}`}
                href={latestComposition?.outputVideoUrl ?? undefined}
                download={task.title}
                onClick={(event) => {
                  if (!latestComposition?.outputVideoUrl) {
                    event.preventDefault();
                  }
                }}
              >
                下载视频
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
