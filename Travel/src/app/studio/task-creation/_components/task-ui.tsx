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
        "支持“片段N：...”或“镜头N：...”格式，例如：\n片段1：先用 3 秒读稿把观众带入目的地。\n片段2：接着切入景观和玩法亮点。\n片段3：最后收束卖点与记忆点。",
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
        <TaskDraftEditorCard
          fieldKey={activeField.key}
          label={activeField.label}
          value={localDraftBundle[activeField.key]}
          placeholder={activeField.placeholder}
          saving={savingKey === activeField.key}
          showHeader={false}
          autoSave
          onSave={(value) => onSave(activeField.key, value)}
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

export type TaskStatusHintTone = "neutral" | "success" | "danger" | "progress";

export type TaskStatusHintItem = {
  label: string;
  value: string;
  tone: TaskStatusHintTone;
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

export function TaskStatusHintPanel({ description, items }: { description: string; items: TaskStatusHintItem[] }) {
  return (
    <div className="task-status-hint-box">
      <div className="task-status-hint-head">
        <strong>状态提示</strong>
        <span>{description}</span>
      </div>
      <div className="task-status-hint-grid">
        {items.map((item) => (
          <div key={item.label} className={`task-status-hint-item ${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
