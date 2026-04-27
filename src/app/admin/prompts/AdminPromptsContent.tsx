"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { VIDEO_TYPE_PROMPT_STAGE_ORDER } from "../../../lib/video-type-prompts";

type StageData = {
  key: string;
  order: number;
  label: string;
  description: string;
  pipelinePhase: string;
  defaultPrompt: string;
  fieldType: string;
  promptText: string;
  updatedAt: string | null;
  source: "builtin_default";
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
};

type RuntimeDoc = {
  key: string;
  order: number;
  label: string;
  description: string;
  pipelinePhase: string;
  kind: "runtime_rule" | "system_prompt_template" | "strategy_reference";
  promptText: string;
  sourceFile: string;
  stageKeys: string[];
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
};

type SystemRulesSection = {
  title: string;
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
  items: Array<{ category: string; label: string; body: string }>;
};

type SystemRulesTabPayload = {
  id: string;
  title: string;
  hint?: string;
  sections: SystemRulesSection[];
};

type VideoTypePromptConfig = {
  key: string;
  label: string;
  categoryPrompts: Record<string, string>;
  addonPrompts: Record<string, string>;
};

type ConstraintPromptsPayload = {
  generatedAt: string;
  stages: StageData[];
  runtimeDocs: RuntimeDoc[];
  systemRulesTabs: SystemRulesTabPayload[];
  videoTypeConfigs?: VideoTypePromptConfig[];
};

const kindLabel: Record<RuntimeDoc["kind"], string> = {
  runtime_rule: "运行时规则",
  system_prompt_template: "提示词模板",
  strategy_reference: "策略参考",
};

type PhaseTab = { id: string; title: string; phases: string[] };

const stageLabel: Record<string, string> = {
  shot_plan: "镜头计划",
  shot_plan_visual: "镜头计划-视觉设计",
  shot_plan_subject: "镜头计划-人物与风格",
  shot_plan_subtitle: "镜头计划-字幕与叙事",
  prompt_generation: "提示词生成",
  clip_generation: "片段生成",
  narration: "旁白/台词",
};

const phaseTabs: PhaseTab[] = [
  { id: "material_prep", title: "素材准备", phases: ["素材准备"] },
  { id: "task_creation", title: "任务创建", phases: ["任务创建"] },
  { id: "video_types", title: "分视频类型提示词", phases: [] },
  { id: "subtitle_audio", title: "字幕音频", phases: ["字幕音频"] },
  { id: "image_generation", title: "图片生成", phases: ["图片生成"] },
  { id: "clip_generation", title: "片段生成", phases: ["片段生成"] },
  { id: "video_analysis", title: "视频拆解", phases: ["视频拆解"] },
];

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function AdminPromptsContent() {
  const [payload, setPayload] = useState<ConstraintPromptsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string>("video_types");
  const [collapsedPrompts, setCollapsedPrompts] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/constraint-prompts", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ConstraintPromptsPayload) => {
        setPayload(data);
        setLoading(false);
      })
      .catch(() => {
        setError("加载失败，请稍后重试");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const stages = useMemo(() => [...(payload?.stages ?? [])].sort((a, b) => a.order - b.order), [payload]);
  const runtimeDocs = useMemo(() => [...(payload?.runtimeDocs ?? [])].sort((a, b) => a.order - b.order), [payload]);
  const systemRulesTabs = useMemo(() => payload?.systemRulesTabs ?? [], [payload]);
  const videoTypeConfigs = useMemo(() => payload?.videoTypeConfigs ?? [], [payload]);

  const matchPhase = useCallback(
    (phase: string) => {
      const tab = phaseTabs.find((t) => t.id === activePhase);
      return tab ? tab.phases.includes(phase) : false;
    },
    [activePhase],
  );

  const filteredStages = useMemo(() => stages.filter((s) => matchPhase(s.pipelinePhase)), [stages, matchPhase]);
  const filteredRuntimeDocs = useMemo(
    () => runtimeDocs.filter((d) => matchPhase(d.pipelinePhase)),
    [runtimeDocs, matchPhase],
  );

  const toggle = useCallback((key: string) => {
    setCollapsedPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedPrompts(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsedPrompts(new Set([...stages.map((s) => s.key), ...runtimeDocs.map((d) => d.key)]));
  }, [stages, runtimeDocs]);

  return (
    <div className="ap">
      {/* Page header */}
      <div className="ap-header">
        <div className="ap-header-top">
          <div>
            <h1 className="ap-title">系统提示词</h1>
            <p className="ap-desc">
              查看系统中所有提示词和程序规则，内容从后端代码与运行时生成函数实时读取。
              {payload?.generatedAt && <span className="ap-time">更新于 {formatTime(payload.generatedAt)}</span>}
            </p>
          </div>
          <div className="ap-actions">
            <button className="ap-btn" type="button" onClick={expandAll}>
              全部展开
            </button>
            <button className="ap-btn" type="button" onClick={collapseAll}>
              全部折叠
            </button>
            <button className="ap-btn ap-btn-fill" type="button" onClick={load} disabled={loading}>
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="ap-error">{error}</div>
      ) : loading && !payload ? (
        <div className="ap-loading">正在加载…</div>
      ) : (
        <>
          {/* Phase tabs */}
          <div className="ap-tabs">
            {phaseTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`ap-tab ${activePhase === t.id ? "active" : ""}`}
                onClick={() => setActivePhase(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>

          {/* ── Video Type Prompts ── */}
          {activePhase === "video_types" && (
            <section className="ap-section">
              <div className="ap-section-bar">
                <h2 className="ap-section-title">分视频类型提示词</h2>
                <span className="ap-section-stat">{videoTypeConfigs.length} 个类型</span>
              </div>
              <p className="ap-desc" style={{ margin: "0 0 16px" }}>
                每个视频类型有独立的「分类提示词」和「追加提示词」。调用大模型时只会在对应 stage
                拼接当前类型的提示词，不会混入其他类型内容。
              </p>
              {videoTypeConfigs.map((config) => {
                const hasCat = Object.values(config.categoryPrompts).some(Boolean);
                const hasAddon = Object.values(config.addonPrompts).some(Boolean);
                const configured = hasCat || hasAddon;
                const isOpen = !collapsedPrompts.has(`vt-${config.key}`);
                return (
                  <div key={config.key} className={`ap-card ${isOpen ? "open" : ""}`} style={{ marginBottom: 12 }}>
                    <div className="ap-card-head">
                      <span className={`ap-card-num ${configured ? "" : "rt"}`}>{configured ? "V" : "-"}</span>
                      <div className="ap-card-info">
                        <span className="ap-card-name">{config.label}</span>
                        <span className="ap-card-phase">{configured ? "已配置" : "暂未配置"}</span>
                      </div>
                      <button
                        type="button"
                        className="ap-card-toggle"
                        onClick={() => toggle(`vt-${config.key}`)}
                        aria-expanded={isOpen}
                      >
                        <span className={`ap-chevron ${isOpen ? "open" : ""}`} aria-hidden />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="ap-card-body">
                        {!configured && (
                          <p className="ap-empty">该类型暂未配置分类提示词和追加提示词，后续可逐步填充。</p>
                        )}
                        {hasCat && (
                          <div style={{ marginBottom: 16 }}>
                            <p className="ap-group-label">分类提示词</p>
                            {VIDEO_TYPE_PROMPT_STAGE_ORDER.map((stage) => {
                              const text = config.categoryPrompts[stage];
                              if (!text) return null;
                              return (
                                <div key={stage} style={{ marginBottom: 12 }}>
                                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                                    {stageLabel[stage] ?? stage}
                                  </p>
                                  <textarea
                                    className="ap-textarea"
                                    readOnly
                                    value={text}
                                    rows={Math.min(16, Math.max(3, text.split("\n").length + 1))}
                                    spellCheck={false}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {hasAddon && (
                          <div>
                            <p className="ap-group-label">追加提示词</p>
                            {VIDEO_TYPE_PROMPT_STAGE_ORDER.map((stage) => {
                              const text = config.addonPrompts[stage];
                              if (!text) return null;
                              return (
                                <div key={stage} style={{ marginBottom: 12 }}>
                                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                                    {stageLabel[stage] ?? stage}
                                  </p>
                                  <textarea
                                    className="ap-textarea"
                                    readOnly
                                    value={text}
                                    rows={Math.min(16, Math.max(3, text.split("\n").length + 1))}
                                    spellCheck={false}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* ── System Prompts ── */}
          {activePhase !== "video_types" && (
            <section className="ap-section">
              <div className="ap-section-bar">
                <h2 className="ap-section-title">系统提示词</h2>
                <span className="ap-section-stat">{filteredStages.length + filteredRuntimeDocs.length} 项</span>
              </div>

              {filteredStages.length > 0 && (
                <div className="ap-group">
                  <p className="ap-group-label">阶段主提示词</p>
                  <div className="ap-cards">
                    {filteredStages.map((s) => {
                      const open = !collapsedPrompts.has(s.key);
                      const lines = s.promptText ? s.promptText.split("\n").length : 0;
                      return (
                        <div key={s.key} className={`ap-card ${open ? "open" : ""}`}>
                          <div className="ap-card-head">
                            <span className="ap-card-num">{s.order}</span>
                            <div className="ap-card-info">
                              <span className="ap-card-name">{s.label}</span>
                              <span className="ap-card-phase">{s.pipelinePhase}</span>
                            </div>
                            <button
                              type="button"
                              className="ap-card-toggle"
                              onClick={() => toggle(s.key)}
                              aria-expanded={open}
                              aria-label={open ? "折叠本条" : "展开本条"}
                            >
                              <span className="ap-card-lines">{lines} 行</span>
                              <span className={`ap-chevron ${open ? "open" : ""}`} aria-hidden />
                            </button>
                          </div>
                          {open && (
                            <div className="ap-card-body">
                              <p className="ap-card-purpose">{s.plainPurpose}</p>
                              <div className="ap-meta">
                                <dl>
                                  <dt>生效步骤</dt>
                                  <dd>{s.usedAtStep}</dd>
                                  <dt>调用接口</dt>
                                  <dd>{s.apiEntry}</dd>
                                  <dt>代码入口</dt>
                                  <dd>{s.codeEntry}</dd>
                                </dl>
                              </div>
                              <p className="ap-card-desc">{s.description}</p>
                              <textarea
                                className="ap-textarea"
                                readOnly
                                value={s.promptText || "（空）"}
                                rows={Math.min(28, Math.max(4, lines + 1))}
                                spellCheck={false}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {filteredRuntimeDocs.length > 0 && (
                <div className="ap-group">
                  <p className="ap-group-label">运行时追加模板</p>
                  <div className="ap-cards">
                    {filteredRuntimeDocs.map((d) => {
                      const open = !collapsedPrompts.has(d.key);
                      const lines = d.promptText ? d.promptText.split("\n").length : 0;
                      return (
                        <div key={d.key} className={`ap-card ${open ? "open" : ""}`}>
                          <div className="ap-card-head">
                            <span className="ap-card-num rt">R</span>
                            <div className="ap-card-info">
                              <span className="ap-card-name">{d.label}</span>
                              <span className="ap-card-phase">{kindLabel[d.kind]}</span>
                            </div>
                            <button
                              type="button"
                              className="ap-card-toggle"
                              onClick={() => toggle(d.key)}
                              aria-expanded={open}
                              aria-label={open ? "折叠本条" : "展开本条"}
                            >
                              <span className="ap-card-lines">{lines} 行</span>
                              <span className={`ap-chevron ${open ? "open" : ""}`} aria-hidden />
                            </button>
                          </div>
                          {open && (
                            <div className="ap-card-body">
                              <p className="ap-card-purpose">{d.plainPurpose}</p>
                              <div className="ap-meta">
                                <dl>
                                  <dt>生效步骤</dt>
                                  <dd>{d.usedAtStep}</dd>
                                  <dt>调用接口</dt>
                                  <dd>{d.apiEntry}</dd>
                                  <dt>代码入口</dt>
                                  <dd>{d.codeEntry}</dd>
                                  <dt>来源文件</dt>
                                  <dd>{d.sourceFile}</dd>
                                </dl>
                              </div>
                              <p className="ap-card-desc">{d.description}</p>
                              <textarea
                                className="ap-textarea"
                                readOnly
                                value={d.promptText || "（空）"}
                                rows={Math.min(28, Math.max(4, lines + 1))}
                                spellCheck={false}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {filteredStages.length === 0 && filteredRuntimeDocs.length === 0 && (
                <p className="ap-empty">当前阶段暂无提示词内容。</p>
              )}
            </section>
          )}

          {/* ── Program Rules ── */}
          <section className="ap-section">
            <div className="ap-section-bar">
              <h2 className="ap-section-title">程序规则与校验</h2>
              <span className="ap-section-stat">
                {systemRulesTabs.reduce((n, t) => n + t.sections.length, 0)} 个板块
              </span>
            </div>

            {systemRulesTabs.map((tab) => (
              <div key={tab.id} className="ap-rules-group">
                <div className="ap-rules-group-head">
                  <h3 className="ap-rules-group-title">{tab.title}</h3>
                  {tab.hint && <p className="ap-rules-group-hint">{tab.hint}</p>}
                </div>

                <div className="ap-rules-box">
                  {tab.sections.map((sec, si) => (
                    <div key={sec.title} className={`ap-rules-block ${si > 0 ? "bordered" : ""}`}>
                      <h4 className="ap-rules-block-title">{sec.title}</h4>
                      <p className="ap-rules-block-purpose">{sec.plainPurpose}</p>
                      <div className="ap-rules-block-meta">
                        <span>
                          <strong>生效步骤</strong>
                          {sec.usedAtStep}
                        </span>
                        <span>
                          <strong>接口</strong>
                          {sec.apiEntry}
                        </span>
                        <span>
                          <strong>代码</strong>
                          {sec.codeEntry}
                        </span>
                      </div>
                      <ul className="ap-rules-list">
                        {sec.items.map((item, idx) => (
                          <li key={idx}>
                            <strong>
                              【{item.category}】{item.label}：
                            </strong>
                            {item.body}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
