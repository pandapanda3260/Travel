"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import type { VideoTaskDraftBundle, VideoTaskRecord } from "../../../../lib/video-task-schema";
import { getVideoTaskStatusMeta } from "../../../../lib/video-task-schema";

export function ClientDate({
  dateString,
  fallback = "-",
}: {
  dateString: string | number | undefined;
  fallback?: string;
}) {
  if (!dateString) return <>{fallback}</>;
  return <time suppressHydrationWarning>{new Date(dateString).toLocaleString("zh-CN")}</time>;
}

export function TaskStatusChip({ status }: { status: VideoTaskRecord["status"] }) {
  const currentStep = getVideoTaskStatusMeta(status);

  return <span className="modal-chip status-chip primary task-status-chip">{currentStep.label}</span>;
}

export function ModuleStatusBadge({ label, tone }: { label: string; tone: "idle" | "editing" | "created" }) {
  return <span className={`table-status task-module-status ${tone}`}>{label}</span>;
}

export function ModuleTitle({
  title,
  eyebrow,
  action,
  inner = false,
  level = "primary",
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  inner?: boolean;
  level?: "primary" | "secondary";
}) {
  return (
    <div className={`panel-header compact${inner ? " inner" : ""}`}>
      <div className={`task-module-title ${level}`}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
      </div>
      {action ?? null}
    </div>
  );
}

export function TaskDraftEditors({
  draftBundle,
  onSave,
  savingKey,
  variant = "list",
}: {
  draftBundle: VideoTaskDraftBundle;
  onSave: (key: keyof VideoTaskDraftBundle, value: string) => Promise<void>;
  savingKey: keyof VideoTaskDraftBundle | null;
  variant?: "list" | "tabs";
}) {
  const fields: Array<{ key: keyof VideoTaskDraftBundle; label: string; placeholder: string }> = [
    {
      key: "textToImagePrompt",
      label: "片段视觉提示词（兼容导出）",
      placeholder: "请输入片段级视觉提示词，可使用“片段1：...”或“镜头1：...”格式。",
    },
    {
      key: "imageToVideoPrompt",
      label: "片段生成提示词（兼容导出）",
      placeholder: "请输入片段级视频提示词，可使用“片段1：...”或“镜头1：...”格式。",
    },
    {
      key: "narrationScript",
      label: "口播/字幕草稿（兼容导出）",
      placeholder:
        "支持“片段N：...”或“镜头N：...”格式，例如：\n片段1：先用 4 秒左右读稿把观众带入目的地。\n片段2：接着切入景观和玩法亮点。\n片段3：最后收束卖点与记忆点。",
    },
  ];

  const [activeKey, setActiveKey] = useState<keyof VideoTaskDraftBundle>("textToImagePrompt");
  const [localDraftBundle, setLocalDraftBundle] = useState(draftBundle);
  const saveTimersRef = useRef<Partial<Record<keyof VideoTaskDraftBundle, number>>>({});

  useEffect(() => {
    const activeTimers = saveTimersRef.current;
    return () => {
      Object.values(activeTimers).forEach((timer) => {
        if (timer) {
          window.clearTimeout(timer);
        }
      });
    };
  }, []);

  function handleFieldChange(key: keyof VideoTaskDraftBundle, nextValue: string) {
    setLocalDraftBundle((current) => ({
      ...current,
      [key]: nextValue,
    }));

    const previousTimer = saveTimersRef.current[key];
    if (previousTimer) {
      window.clearTimeout(previousTimer);
    }

    saveTimersRef.current[key] = window.setTimeout(() => {
      void onSave(key, nextValue);
    }, 600);
  }

  if (variant === "tabs") {
    const activeField = fields.find((field) => field.key === activeKey) ?? fields[0];

    return (
      <div className="task-editor-tabs-layout">
        <div className="task-editor-tabs">
          {fields.map((field) => (
            <button
              key={field.key}
              className={`task-editor-tab${field.key === activeField.key ? " active" : ""}`}
              type="button"
              onClick={() => setActiveKey(field.key)}
            >
              {field.label}
            </button>
          ))}
        </div>
        <TaskDraftPromptPanel
          label={activeField.label}
          value={localDraftBundle[activeField.key]}
          placeholder={activeField.placeholder}
          saving={savingKey === activeField.key}
          onChange={(value) => handleFieldChange(activeField.key, value)}
        />
      </div>
    );
  }

  return (
    <div className="task-editor-list">
      {fields.map((field) => (
        <TaskDraftEditorCard
          key={field.key}
          fieldKey={field.key}
          label={field.label}
          value={localDraftBundle[field.key]}
          placeholder={field.placeholder}
          saving={savingKey === field.key}
          onSave={(value) => onSave(field.key, value)}
          onChange={(value) => handleFieldChange(field.key, value)}
        />
      ))}
    </div>
  );
}

function TaskDraftEditorCard({
  fieldKey,
  label,
  value,
  placeholder,
  saving,
  showHeader = true,
  autoSave = false,
  onSave,
  onChange,
}: {
  fieldKey: keyof VideoTaskDraftBundle;
  label: string;
  value: string;
  placeholder: string;
  saving: boolean;
  showHeader?: boolean;
  autoSave?: boolean;
  onSave: (value: string) => Promise<void>;
  onChange: (value: string) => void;
}) {
  return (
    <TaskDraftEditorInner
      key={fieldKey}
      label={label}
      value={value}
      placeholder={placeholder}
      saving={saving}
      showHeader={showHeader}
      autoSave={autoSave}
      onSave={onSave}
      onChange={onChange}
    />
  );
}

type PromptDisplayBlock = {
  id: string;
  title: string;
  content: string;
};

function TaskDraftPromptPanel({
  label,
  value,
  placeholder,
  saving,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  saving: boolean;
  onChange: (value: string) => void;
}) {
  const blocks = parsePromptDisplayBlocks(value);
  const displayLabel = label.replace("（兼容导出）", "");
  const textLength = value.trim().length;

  return (
    <section className="composer-card task-editor-card plain task-prompt-panel-card">
      <details className="task-shot-plan-panel task-prompt-display-panel">
        <summary className="task-shot-plan-panel-summary">
          <div className="task-shot-plan-panel-title">
            <strong>{displayLabel}</strong>
            <span>按片段/镜头拆成卡片展示，展开后更方便快速检查内容。</span>
          </div>
          <div className="task-shot-plan-panel-metrics">
            <span>{blocks.length ? `${blocks.length} 条内容` : "暂无内容"}</span>
            <span>{textLength ? `${textLength} 字` : "0 字"}</span>
            <span>{saving ? "保存中..." : "自动保存"}</span>
          </div>
        </summary>
        <div className="task-shot-plan-panel-body">
          {blocks.length ? (
            <div className="task-prompt-block-list">
              {blocks.map((block) => (
                <article key={block.id} className="task-prompt-block-card">
                  <div className="task-shot-plan-shot-head">
                    <strong>{block.title}</strong>
                  </div>
                  <p>{block.content}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="task-prompt-empty">暂无内容，展开“编辑原文”后可以手动补充。</div>
          )}
        </div>
      </details>

      <details className="task-prompt-edit-panel">
        <summary>
          <strong>编辑原文</strong>
          <span>{saving ? "保存中..." : `${displayLabel} · 兼容导出格式`}</span>
        </summary>
        <div className="task-prompt-edit-body">
          <textarea
            className="prompt-box compact task-editor-textarea"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </details>
    </section>
  );
}

function parsePromptDisplayBlocks(value: string): PromptDisplayBlock[] {
  const text = value.trim();

  if (!text) {
    return [];
  }

  const markerPattern = /(^|\n)\s*(片段|镜头)\s*([0-9０-９]+)\s*[：:]\s*/g;
  const matches = Array.from(text.matchAll(markerPattern));

  if (!matches.length) {
    return [
      {
        id: "raw",
        title: "原文",
        content: text,
      },
    ];
  }

  return matches.map((match, index) => {
    const markerStart = match.index ?? 0;
    const contentStart = markerStart + match[0].length;
    const nextMarkerStart = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    const label = match[2] ?? "片段";
    const number = normalizePromptIndex(match[3] ?? `${index + 1}`) || index + 1;
    const content = text.slice(contentStart, nextMarkerStart).trim();

    return {
      id: `${label}-${number}-${index}`,
      title: `${label} ${number}`,
      content: content || "（空内容）",
    };
  });
}

function normalizePromptIndex(value: string): number {
  const normalized = value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function TaskDraftEditorInner({
  label,
  value,
  placeholder,
  saving,
  showHeader,
  autoSave,
  onSave,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  saving: boolean;
  showHeader: boolean;
  autoSave: boolean;
  onSave: (value: string) => Promise<void>;
  onChange: (value: string) => void;
}) {
  return (
    <section className={`composer-card task-editor-card${showHeader ? "" : " plain"}`}>
      {showHeader ? (
        <div className="panel-header compact inner">
          <div>
            <h3>{label}</h3>
          </div>
          {!autoSave ? (
            <button
              className="btn-secondary small"
              type="button"
              disabled={saving}
              onClick={() => {
                void onSave(value);
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          ) : null}
        </div>
      ) : null}
      <textarea
        className="prompt-box compact task-editor-textarea"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}

export type TaskStepActionState = {
  label: string;
  onAction: () => void;
  isRunning?: boolean;
  busyDisplay?: "progress" | "status";
  progressPercent?: number | null;
  canRun?: boolean;
  blockedReason?: string | null;
};

export function formatRuntimeDisplay(input: {
  providerLabel: string;
  modelId?: string | null;
  liveEnabled: boolean;
  offlineLabel?: string;
}) {
  const segments = [input.providerLabel];
  if (input.modelId && !input.providerLabel.includes(input.modelId)) {
    segments.push(input.modelId);
  }
  segments.push(input.liveEnabled ? "在线" : (input.offlineLabel ?? "本地兜底"));
  return segments.join(" · ");
}

export function formatLocalServiceDisplay(input: {
  serviceLabel: string;
  available: boolean;
  unavailableLabel?: string;
}) {
  return `${input.serviceLabel} · ${input.available ? "可用" : (input.unavailableLabel ?? "缺失/异常")}`;
}

export function TaskNextStepButton({
  state,
  onBlocked,
  className = "",
}: {
  state: TaskStepActionState;
  onBlocked?: (reason: string) => void;
  className?: string;
}) {
  const running = Boolean(state.isRunning);
  const canRun = typeof state.canRun === "boolean" ? state.canRun : !state.blockedReason;
  const blockedReason = state.blockedReason?.trim() || "请先完善当前步骤后再继续。";
  const blocked = !running && !canRun;
  const busyDisplay = running ? (state.busyDisplay ?? "progress") : "status";
  const progressPercent =
    typeof state.progressPercent === "number" && Number.isFinite(state.progressPercent)
      ? Math.max(0, Math.min(100, Math.round(state.progressPercent)))
      : null;
  const displayProgressPercent =
    running && busyDisplay === "progress" ? (progressPercent === null ? 1 : progressPercent) : null;
  const buttonLabel =
    running && displayProgressPercent !== null ? `${state.label} ${displayProgressPercent}%` : state.label;

  return (
    <button
      className={`btn-primary task-next-step-button${blocked ? " is-blocked" : ""}${running ? " is-running" : ""}${className ? ` ${className}` : ""}`}
      type="button"
      disabled={running || blocked}
      aria-disabled={running || blocked}
      title={blocked ? blockedReason : undefined}
      onClick={() => {
        if (running) {
          return;
        }
        if (blocked) {
          onBlocked?.(blockedReason);
          return;
        }
        state.onAction();
      }}
    >
      <span className="task-next-step-button-text" aria-live={running ? "polite" : undefined}>
        {buttonLabel}
      </span>
    </button>
  );
}
