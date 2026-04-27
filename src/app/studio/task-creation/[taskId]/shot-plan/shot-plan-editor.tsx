"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatDurationSecondsLabel, formatTimelineSecondLabel } from "../../../../../lib/duration-format";
import type { ShotPlanEditorState } from "../../../../../lib/video-task-plan-edit";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

type ShotPlanEditorProps = {
  taskId: string;
  title: string;
  videoTypeLabel: string;
  updatedAt: string;
  returnHref: string;
  highlightedShotIndex: number | null;
  initialEditorState: ShotPlanEditorState;
};

type EditableTextAreaProps = {
  className?: string;
  label: string;
  minRows?: number;
  maxRows?: number;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

type EditorShot = ShotPlanEditorState["segments"][number]["shots"][number];
type LocalEditorShot = EditorShot & {
  shotPlanText?: string;
};
type LocalEditorSegment = Omit<ShotPlanEditorState["segments"][number], "shots"> & {
  shots: LocalEditorShot[];
};
type LocalEditorState = Omit<ShotPlanEditorState, "segments"> & {
  segments: LocalEditorSegment[];
};

const shotPlanFieldLabels = ["画面", "目的", "地点", "动作", "情绪", "运镜", "音频", "字幕", "对口型"] as const;

function formatTime(seconds: number) {
  return formatDurationSecondsLabel(seconds) ?? `${Number(seconds || 0).toFixed(1)} 秒`;
}

function formatBooleanField(value: boolean) {
  return value ? "是" : "否";
}

function formatShotPlanText(shot: EditorShot) {
  return [
    `画面：${shot.sceneDescription}`,
    `目的：${shot.purpose}`,
    `地点：${shot.location}`,
    `动作：${shot.action}`,
    `情绪：${shot.emotion}`,
    `运镜：${shot.cameraMovement}`,
    `音频：${formatBooleanField(shot.hasVoice)}`,
    `字幕：${formatBooleanField(shot.hasSubtitle)}`,
    `对口型：${formatBooleanField(shot.requiresLipSync)}`,
  ].join("\n");
}

function getShotPlanText(shot: LocalEditorShot) {
  return shot.shotPlanText ?? formatShotPlanText(shot);
}

function parseBooleanField(value: string | undefined, fallback: boolean) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (/^(是|有|开|开启|生成|true|1|yes|y)$/iu.test(normalized)) {
    return true;
  }
  if (/^(否|无|关|关闭|不|不生成|false|0|no|n)$/iu.test(normalized)) {
    return false;
  }
  return fallback;
}

function parseShotPlanText(text: string, fallback: EditorShot): EditorShot {
  const values = new Map<string, string>();
  let currentLabel: string | null = null;

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const matchedLabel = shotPlanFieldLabels.find(
      (label) => line.trimStart().startsWith(`${label}：`) || line.trimStart().startsWith(`${label}:`),
    );
    if (matchedLabel) {
      currentLabel = matchedLabel;
      values.set(matchedLabel, line.trimStart().replace(new RegExp(`^${matchedLabel}[：:]\\s*`, "u"), ""));
      continue;
    }

    if (currentLabel && line.trim()) {
      values.set(currentLabel, `${values.get(currentLabel) ?? ""}\n${line}`.trim());
    }
  }

  const freeText = text.trim();
  return {
    ...fallback,
    sceneDescription: (values.get("画面") ?? (!values.size ? freeText : fallback.sceneDescription)).trim(),
    purpose: (values.get("目的") ?? fallback.purpose).trim(),
    location: (values.get("地点") ?? fallback.location).trim(),
    action: (values.get("动作") ?? fallback.action).trim(),
    emotion: (values.get("情绪") ?? fallback.emotion).trim(),
    cameraMovement: (values.get("运镜") ?? fallback.cameraMovement).trim(),
    hasVoice: parseBooleanField(values.get("音频"), fallback.hasVoice),
    hasSubtitle: parseBooleanField(values.get("字幕"), fallback.hasSubtitle),
    requiresLipSync: parseBooleanField(values.get("对口型"), fallback.requiresLipSync),
  };
}

function normalizeEditorStateTimings(state: LocalEditorState): LocalEditorState {
  let cursor = 0;
  const segments = state.segments.map((segment) => {
    let segmentDuration = 0;
    const shots = segment.shots.map((shot) => {
      const durationSeconds = Number.isFinite(shot.durationSeconds)
        ? Math.max(0.8, Number(Number(shot.durationSeconds).toFixed(2)))
        : 0.8;
      const startAtSeconds = cursor;
      const endAtSeconds = Number((startAtSeconds + durationSeconds).toFixed(2));
      cursor = endAtSeconds;
      segmentDuration = Number((segmentDuration + durationSeconds).toFixed(2));
      return {
        ...shot,
        durationSeconds,
        startAtSeconds,
        endAtSeconds,
      };
    });
    return {
      ...segment,
      durationSeconds: segmentDuration,
      shots,
    };
  });

  return {
    totalDurationSeconds: Number(cursor.toFixed(2)),
    segments,
  };
}

function toLocalEditorState(state: ShotPlanEditorState): LocalEditorState {
  return normalizeEditorStateTimings({
    ...state,
    segments: state.segments.map((segment) => ({
      ...segment,
      shots: segment.shots.map((shot) => ({
        ...shot,
        shotPlanText: formatShotPlanText(shot),
      })),
    })),
  });
}

function getSaveStatusLabel(status: SaveStatus) {
  switch (status) {
    case "dirty":
      return "已修改，等待自动保存";
    case "saving":
      return "自动保存中...";
    case "saved":
      return "已保存";
    case "error":
      return "保存失败，将在下次修改后重试";
    case "conflict":
      return "页面数据已过期，请刷新";
    default:
      return "自动保存已开启";
  }
}

function AutoGrowTextarea({
  className,
  label,
  minRows = 1,
  maxRows = 20,
  placeholder,
  value,
  onChange,
}: EditableTextAreaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const hideEditFrameTimeoutRef = useRef<number | null>(null);
  const isFocusedRef = useRef(false);
  const [isEditingFrameVisible, setIsEditingFrameVisible] = useState(false);

  function clearHideEditFrameTimer() {
    if (hideEditFrameTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(hideEditFrameTimeoutRef.current);
    hideEditFrameTimeoutRef.current = null;
  }

  function showEditFrame(hideAfterMs?: number) {
    clearHideEditFrameTimer();
    setIsEditingFrameVisible(true);
    if (typeof hideAfterMs !== "number") {
      return;
    }
    hideEditFrameTimeoutRef.current = window.setTimeout(() => {
      if (isFocusedRef.current) {
        return;
      }
      setIsEditingFrameVisible(false);
      hideEditFrameTimeoutRef.current = null;
    }, hideAfterMs);
  }

  useEffect(() => {
    return () => clearHideEditFrameTimer();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const styles = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const borderY = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
    const minHeight = minRows * lineHeight + paddingY + borderY;
    const maxHeight = maxRows * lineHeight + paddingY + borderY;

    element.style.height = "auto";
    const nextHeight = Math.min(Math.max(element.scrollHeight + borderY, minHeight), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight + borderY > maxHeight ? "auto" : "hidden";
  }, [maxRows, minRows, value]);

  return (
    <label
      className={["shot-plan-editor-field", className, isEditingFrameVisible ? "is-editing" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{label}</span>
      <textarea
        ref={ref}
        rows={minRows}
        value={value}
        placeholder={placeholder}
        onBlur={() => {
          isFocusedRef.current = false;
          showEditFrame(900);
        }}
        onChange={(event) => {
          showEditFrame();
          onChange(event.target.value);
        }}
        onFocus={() => {
          isFocusedRef.current = true;
          showEditFrame();
        }}
      />
    </label>
  );
}

export function ShotPlanEditor({
  taskId,
  title,
  videoTypeLabel,
  updatedAt,
  returnHref,
  highlightedShotIndex,
  initialEditorState,
}: ShotPlanEditorProps) {
  const [editorState, setEditorState] = useState<LocalEditorState>(() => toLocalEditorState(initialEditorState));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(updatedAt);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const dirtyVersionRef = useRef(0);
  const latestEditorStateRef = useRef(editorState);
  const baseUpdatedAtRef = useRef(updatedAt);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);

  useEffect(() => {
    latestEditorStateRef.current = editorState;
  }, [editorState]);

  useEffect(() => {
    baseUpdatedAtRef.current = baseUpdatedAt;
  }, [baseUpdatedAt]);

  useEffect(() => {
    if (!highlightedShotIndex) {
      return;
    }
    const target = document.getElementById(`shot-edit-${highlightedShotIndex}`);
    target?.scrollIntoView({ block: "center" });
  }, [highlightedShotIndex]);

  const saveEditorState = useCallback(async function saveEditorState(state: LocalEditorState, version: number) {
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    queuedSaveRef.current = false;
    setSaveStatus("saving");
    setSaveMessage("");

    try {
      const response = await fetch(`/api/video-tasks/${encodeURIComponent(taskId)}/shot-plan`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUpdatedAt: baseUpdatedAtRef.current,
          segments: state.segments,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
        task?: { updatedAt?: string };
        editorState?: ShotPlanEditorState;
      } | null;

      if (!response.ok) {
        setSaveStatus(data?.code === "VIDEO_TASK_EDIT_CONFLICT" ? "conflict" : "error");
        setSaveMessage(data?.error ?? "保存镜头计划失败");
        return;
      }

      if (data?.task?.updatedAt) {
        baseUpdatedAtRef.current = data.task.updatedAt;
        setBaseUpdatedAt(data.task.updatedAt);
      }
      if (dirtyVersionRef.current === version && data?.editorState) {
        setEditorState(toLocalEditorState(data.editorState));
        setSaveStatus("saved");
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(error instanceof Error ? error.message : "保存镜头计划失败");
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current || dirtyVersionRef.current !== version) {
        queuedSaveRef.current = false;
        window.setTimeout(() => {
          void saveEditorState(latestEditorStateRef.current, dirtyVersionRef.current);
        }, 0);
      }
    }
  }, [taskId]);

  useEffect(() => {
    if (dirtyVersion === 0) {
      return;
    }
    setSaveStatus("dirty");
    const timeout = window.setTimeout(() => {
      void saveEditorState(latestEditorStateRef.current, dirtyVersion);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [dirtyVersion, saveEditorState]);

  function markDirty() {
    dirtyVersionRef.current += 1;
    setDirtyVersion(dirtyVersionRef.current);
  }

  function updateSegmentNarration(segmentIndex: number, narrationText: string) {
    setEditorState((current) =>
      normalizeEditorStateTimings({
        ...current,
        segments: current.segments.map((segment) =>
          segment.segmentIndex === segmentIndex
            ? {
                ...segment,
                narrationText,
              }
            : segment,
        ),
      }),
    );
    markDirty();
  }

  function updateShot<Field extends keyof LocalEditorShot>(
    segmentIndex: number,
    shotIndex: number,
    field: Field,
    value: LocalEditorShot[Field],
  ) {
    setEditorState((current) =>
      normalizeEditorStateTimings({
        ...current,
        segments: current.segments.map((segment) =>
          segment.segmentIndex === segmentIndex
            ? {
                ...segment,
                shots: segment.shots.map((shot) =>
                  shot.shotIndex === shotIndex
                    ? {
                        ...shot,
                        [field]: value,
                      }
                    : shot,
                ),
              }
            : segment,
        ),
      }),
    );
    markDirty();
  }

  function updateShotPlanText(segmentIndex: number, shotIndex: number, value: string) {
    setEditorState((current) =>
      normalizeEditorStateTimings({
        ...current,
        segments: current.segments.map((segment) =>
          segment.segmentIndex === segmentIndex
            ? {
                ...segment,
                shots: segment.shots.map((shot) =>
                  shot.shotIndex === shotIndex
                    ? {
                        ...parseShotPlanText(value, shot),
                        shotPlanText: value,
                      }
                    : shot,
                ),
              }
            : segment,
        ),
      }),
    );
    markDirty();
  }

  return (
    <main className="shot-plan-table-page shot-plan-editor-page">
      <header className="shot-plan-table-hero">
        <div className="shot-plan-table-topbar">
          <Link className="shot-plan-return-button" href={returnHref}>
            返回任务创建
          </Link>
          <div className={`shot-plan-editor-save-status ${saveStatus}`}>
            <span>{getSaveStatusLabel(saveStatus)}</span>
            {saveMessage ? <small>{saveMessage}</small> : null}
          </div>
        </div>
        <div className="shot-plan-table-title-row shot-plan-editor-title-row">
          <div className="shot-plan-table-title-stack">
            <div className="shot-plan-table-kicker">镜头计划及提示词编辑页</div>
            <h1>{videoTypeLabel || title}</h1>
            {highlightedShotIndex ? (
              <div className="shot-plan-table-meta-row">
                <span className="shot-plan-table-meta-chip subtle">{`当前定位：镜头 ${highlightedShotIndex}`}</span>
              </div>
            ) : null}
          </div>
          <div className="shot-plan-table-summary">
            <div className="shot-plan-table-summary-item">
              <small>片段</small>
              <strong>{editorState.segments.length}</strong>
            </div>
            <div className="shot-plan-table-summary-item">
              <small>镜头</small>
              <strong>{editorState.segments.reduce((sum, segment) => sum + segment.shots.length, 0)}</strong>
            </div>
            <div className="shot-plan-table-summary-item">
              <small>时长</small>
              <strong>{formatTime(editorState.totalDurationSeconds)}</strong>
            </div>
          </div>
        </div>
      </header>

      <section className="shot-plan-table-card" aria-label="镜头计划及提示词编辑表格">
        <div className="shot-plan-table-scroll">
          <table className="shot-plan-detail-table shot-plan-editor-table">
            <thead>
              <tr>
                <th>片段</th>
                <th>Shot Plan</th>
                <th>时间参数</th>
                <th>文生图提示词</th>
                <th>图生视频提示词</th>
                <th>解说词</th>
              </tr>
            </thead>
            <tbody>
              {editorState.segments.map((segment) => (
                <tr key={segment.segmentId}>
                  <th className="shot-plan-segment-cell" scope="row">
                    <div className="shot-plan-cell-block shot-plan-segment-block">
                      <strong>{`片段 ${segment.segmentIndex}`}</strong>
                      <p>{`（${segment.shots.length} 个镜头）`}</p>
                      <p>{formatTime(segment.durationSeconds)}</p>
                    </div>
                  </th>
                  <td>
                    <div className="shot-plan-cell-stack">
                      {segment.shots.map((shot) => (
                        <article
                          key={`plan-${shot.shotId}`}
                          id={`shot-edit-${shot.shotIndex}`}
                          className={`shot-plan-cell-block shot-plan-editor-table-shot ${
                            highlightedShotIndex === shot.shotIndex ? "is-targeted" : ""
                          }`}
                        >
                          <strong>{`镜头 ${shot.shotIndex}`}</strong>
                          <AutoGrowTextarea
                            className="shot-plan-editor-table-textarea shot-plan-editor-shot-plan-textarea"
                            label="Shot Plan"
                            value={getShotPlanText(shot)}
                            onChange={(value) => updateShotPlanText(segment.segmentIndex, shot.shotIndex, value)}
                          />
                        </article>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="shot-plan-cell-stack compact">
                      {segment.shots.map((shot) => (
                        <article key={`timing-${shot.shotId}`} className="shot-plan-cell-block">
                          <strong>{`镜头 ${shot.shotIndex}`}</strong>
                          <p>{`起始：${formatTimelineSecondLabel(shot.startAtSeconds) ?? "第 0.0 秒"}`}</p>
                          <p>{`结束：${formatTimelineSecondLabel(shot.endAtSeconds) ?? "第 0.0 秒"}`}</p>
                          <label className="shot-plan-editor-duration-field">
                            <span>时长</span>
                            <input
                              min={0.8}
                              max={60}
                              step={0.1}
                              type="number"
                              value={shot.durationSeconds}
                              onChange={(event) =>
                                updateShot(
                                  segment.segmentIndex,
                                  shot.shotIndex,
                                  "durationSeconds",
                                  Number(event.target.value),
                                )
                              }
                            />
                          </label>
                        </article>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="shot-plan-cell-stack">
                      {segment.shots.map((shot) => (
                        <article key={`image-${shot.shotId}`} className="shot-plan-cell-block">
                          <strong>{`镜头 ${shot.shotIndex}`}</strong>
                          <AutoGrowTextarea
                            className="shot-plan-editor-table-textarea"
                            label="文生图提示词"
                            value={shot.imagePrompt}
                            onChange={(value) => updateShot(segment.segmentIndex, shot.shotIndex, "imagePrompt", value)}
                          />
                        </article>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="shot-plan-cell-stack">
                      {segment.shots.map((shot) => (
                        <article key={`video-${shot.shotId}`} className="shot-plan-cell-block">
                          <strong>{`镜头 ${shot.shotIndex}`}</strong>
                          <AutoGrowTextarea
                            className="shot-plan-editor-table-textarea"
                            label="图生视频提示词"
                            value={shot.videoPrompt}
                            onChange={(value) => updateShot(segment.segmentIndex, shot.shotIndex, "videoPrompt", value)}
                          />
                        </article>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="shot-plan-segment-prompt">
                      <strong>{`片段 ${segment.segmentIndex}`}</strong>
                      <AutoGrowTextarea
                        className="shot-plan-editor-table-textarea shot-plan-editor-narration"
                        label="解说词"
                        placeholder="填写这一段最终要生成字幕和音频的解说词。"
                        value={segment.narrationText}
                        onChange={(value) => updateSegmentNarration(segment.segmentIndex, value)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
