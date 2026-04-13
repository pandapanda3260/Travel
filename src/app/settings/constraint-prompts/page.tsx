"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  items: Array<{ label?: string; body: string }>;
};

type SystemRulesTabPayload = {
  id: string;
  title: string;
  hint?: string;
  sections: SystemRulesSection[];
};

type ConstraintPromptsPayload = {
  generatedAt: string;
  stages: StageData[];
  runtimeDocs: RuntimeDoc[];
  systemRulesTabs: SystemRulesTabPayload[];
};

type RuleSectionWithSource = SystemRulesSection & {
  sourceTabId: string;
  sourceTabTitle: string;
};

type StepGroupDefinition = {
  id: string;
  title: string;
  stepLabel: string;
  description: string;
  stageKeys?: string[];
  runtimeDocKeys?: string[];
  runtimeDocPhases?: string[];
  ruleTabIds?: string[];
  ruleSectionTitles?: string[];
};

type ApplicationTabDefinition = {
  id: string;
  title: string;
  shortDesc: string;
  eyebrow: string;
  description: string;
  stepGroups: StepGroupDefinition[];
};

const phaseAccent: Record<string, string> = {
  素材准备: "#6e8efb",
  任务创建: "#8b5cf6",
  字幕音频: "#3b82f6",
  图片生成: "#10b981",
  片段生成: "#f59e0b",
  视频拆解: "#e11d48",
  全链路总览: "#0f766e",
};

const kindLabelMap: Record<RuntimeDoc["kind"], string> = {
  runtime_rule: "运行时规则",
  system_prompt_template: "系统提示词模板",
  strategy_reference: "策略参考",
};

const applicationTabs: ApplicationTabDefinition[] = [
  {
    id: "overview",
    title: "全链路总览",
    shortDesc: "页面说明与状态流",
    eyebrow: "统一入口",
    description: "把原先分散在“系统提示词”和“系统规则”两页的内容合并到这里，先看全链路说明，再按具体环节进入。",
    stepGroups: [
      {
        id: "overview_status",
        title: "全链路状态与阅读方式",
        stepLabel: "所有环节",
        description: "先看这部分，可以快速理解为什么系统提示词页现在会同时展示主提示词、运行时模板和程序规则。",
        runtimeDocKeys: ["constraint_prompt_visibility_notes"],
        ruleTabIds: ["downstream"],
        ruleSectionTitles: ["任务状态流（videoTaskStatusFlow）"],
      },
    ],
  },
  {
    id: "material_prep",
    title: "素材准备",
    shortDesc: "商品信息识别",
    eyebrow: "素材管理",
    description: "这部分在商品图识别时生效，决定从商品图片里提取哪些关键信息，并如何整理成后续镜头规划可用的输入。",
    stepGroups: [
      {
        id: "product_vision",
        title: "商品图识别提示词",
        stepLabel: "素材管理 · 商品信息识别时",
        description: "这里的提示词会先把图片信息识别成结构化商品信息，再进入任务创建链路。",
        stageKeys: ["product_vision"],
      },
    ],
  },
  {
    id: "task_creation",
    title: "任务创建",
    shortDesc: "输入信息与镜头规划",
    eyebrow: "导演模式",
    description: "这部分影响从用户输入到镜头计划、台词、提示词初稿生成的整个核心链路，是目前最关键的工作区。",
    stepGroups: [
      {
        id: "task_input_constraints",
        title: "输入信息提交后的约束注入",
        stepLabel: "第一步：输入信息",
        description: "用户填写商品信息、提示词、参考模板和参数后，系统会先合并预设与任务专属约束，再进入镜头计划生成。",
        ruleTabIds: ["task_constraints"],
      },
      {
        id: "task_planning_generation",
        title: "镜头计划与台词初稿生成",
        stepLabel: "第二步：镜头计划生成",
        description: "这一层包含阶段主提示词，以及运行时追加的硬规则、台词标准和润色/修复模板。",
        stageKeys: ["shot_plan", "prompt_generation"],
        runtimeDocPhases: ["任务创建"],
        ruleTabIds: ["shot_plan"],
      },
    ],
  },
  {
    id: "subtitle_audio",
    title: "字幕音频",
    shortDesc: "音色策略与校验",
    eyebrow: "导演模式",
    description: "这部分在“第三步：音频字幕生成”时起作用，负责台词压缩重写、音色/情绪策略和字幕音频校验。",
    stepGroups: [
      {
        id: "subtitle_audio_generation",
        title: "音频字幕生成规则",
        stepLabel: "第三步：音频字幕生成",
        description: "这里重点展示 TTS 前的文案重写模板、镜头级音色/情绪策略，以及字幕音频阶段的程序校验标准。",
        runtimeDocPhases: ["字幕音频"],
        ruleTabIds: ["downstream"],
        ruleSectionTitles: ["字幕音频（validateNarrationResult）"],
      },
    ],
  },
  {
    id: "image_generation",
    title: "图片生成",
    shortDesc: "视觉图片生成",
    eyebrow: "导演模式",
    description: "这部分在“第四步：视觉图片生成”时起作用，决定文生图增强规则和图片阶段的校验方式。",
    stepGroups: [
      {
        id: "visual_images",
        title: "视觉图片生成规则",
        stepLabel: "第四步：视觉图片生成",
        description: "文生图增强提示词和选图校验都放在这一类里看，方便对照生图效果和程序约束。",
        stageKeys: ["image_enhancement"],
        ruleTabIds: ["downstream"],
        ruleSectionTitles: ["文生图选图（validateVisualImages）"],
      },
    ],
  },
  {
    id: "clip_generation",
    title: "片段生成",
    shortDesc: "视频片段与负向约束",
    eyebrow: "导演模式",
    description: "这部分在“第五步：片段生成”时起作用，负责图生视频指令、负向约束和片段阶段的完整性校验。",
    stepGroups: [
      {
        id: "clip_generation_rules",
        title: "片段生成规则",
        stepLabel: "第五步：片段生成",
        description: "主模板和负向提示词共同决定每个片段如何生成，程序校验则负责检查片段数量、完成状态和时长偏差。",
        stageKeys: ["clip_generation", "negative_prompt"],
        ruleTabIds: ["downstream"],
        ruleSectionTitles: ["片段生成（validateClipShots）"],
      },
    ],
  },
  {
    id: "video_analysis",
    title: "视频拆解",
    shortDesc: "分析与脚本抽象",
    eyebrow: "素材管理",
    description: "这部分在“视频拆解”模块起作用，负责把参考视频分析成结构化 JSON、脚本、模板框架和生成提示词。",
    stepGroups: [
      {
        id: "video_analysis_rules",
        title: "视频拆解规则",
        stepLabel: "素材管理 · 视频拆解时",
        description: "视觉分析提示词、脚本综合生成提示词，以及分析 JSON 的完整性校验都集中在这里。",
        stageKeys: ["video_analysis", "video_script_generation"],
        ruleTabIds: ["downstream"],
        ruleSectionTitles: ["视频拆解 · 分析 JSON（validateAnalysisCompleteness）"],
      },
    ],
  },
];

function formatGeneratedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function PromptCard(input: {
  accent: string;
  badgeText: string;
  eyebrow: string;
  title: string;
  meta: string;
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
  description: string;
  promptText: string;
  footerLeft: string;
  footerRight: string;
}) {
  const lineCount = input.promptText ? input.promptText.split("\n").length : 0;

  return (
    <article className="panel sr-panel sr-prompt-card">
      <header className="sr-prompt-card-head">
        <span className="sr-prompt-order" style={{ borderColor: input.accent, color: input.accent }}>
          {input.badgeText}
        </span>
        <div className="sr-prompt-titles">
          <p className="eyebrow" style={{ color: input.accent }}>
            {input.eyebrow}
          </p>
          <h4>{input.title}</h4>
        </div>
        <span className="sr-prompt-meta">{input.meta}</span>
      </header>
      <p className="sr-prompt-purpose">{input.plainPurpose}</p>
      <div className="sr-meta-list">
        <p className="sr-meta-item">
          <strong>在哪一步生效：</strong>
          <span>{input.usedAtStep}</span>
        </p>
        <p className="sr-meta-item">
          <strong>调用接口：</strong>
          <span>{input.apiEntry}</span>
        </p>
        <p className="sr-meta-item">
          <strong>代码入口：</strong>
          <span>{input.codeEntry}</span>
        </p>
      </div>
      <p className="sr-prompt-desc">{input.description}</p>
      <textarea
        className="sr-prompt-textarea"
        readOnly
        value={input.promptText || "（空）"}
        rows={Math.min(26, Math.max(6, lineCount + 1))}
        spellCheck={false}
      />
      <footer className="sr-prompt-foot">
        <span>{input.footerLeft}</span>
        <span>{input.footerRight}</span>
      </footer>
    </article>
  );
}

function collectRuleSections(
  systemRulesTabs: SystemRulesTabPayload[],
  definition: StepGroupDefinition,
): RuleSectionWithSource[] {
  const allowedTabIds = definition.ruleTabIds ? new Set(definition.ruleTabIds) : null;
  const allowedSectionTitles = definition.ruleSectionTitles ? new Set(definition.ruleSectionTitles) : null;

  return systemRulesTabs.flatMap((tab) => {
    if (allowedTabIds && !allowedTabIds.has(tab.id)) {
      return [];
    }

    return tab.sections
      .filter((section) => (allowedSectionTitles ? allowedSectionTitles.has(section.title) : true))
      .map((section) => ({
        ...section,
        sourceTabId: tab.id,
        sourceTabTitle: tab.title,
      }));
  });
}

export default function ConstraintPromptsPage() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<ConstraintPromptsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/constraint-prompts")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
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
    load();
  }, [load]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab && applicationTabs.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  const stages = useMemo(() => [...(payload?.stages ?? [])].sort((left, right) => left.order - right.order), [payload]);
  const runtimeDocs = useMemo(
    () => [...(payload?.runtimeDocs ?? [])].sort((left, right) => left.order - right.order),
    [payload],
  );
  const systemRulesTabs = useMemo(() => payload?.systemRulesTabs ?? [], [payload]);

  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.key, stage])), [stages]);
  const runtimeDocMap = useMemo(() => new Map(runtimeDocs.map((doc) => [doc.key, doc])), [runtimeDocs]);

  const activeTabDefinition =
    applicationTabs.find((tab) => tab.id === activeTab) ?? applicationTabs.find((tab) => tab.id === "overview")!;

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <div className="topbar-title brand-inline">
                <div className="brand-mark">AI</div>
                <div className="brand-name-row">
                  <h2>Hospitality AI Studio</h2>
                </div>
              </div>
              <div className="topbar-actions compact">
                <button className="toolbar-button" type="button" onClick={load} disabled={loading}>
                  {loading ? "刷新中…" : "刷新"}
                </button>
              </div>
            </div>
          </header>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>系统提示词与系统规则已合并</strong>
              <span>
                我检查后确认两页重复量较高，尤其“生效提示词”部分几乎重复，所以现在统一合并到这一个页面里；旧的“系统规则”入口会直接跳转到这里。
                {payload?.generatedAt ? <> 最近加载：{formatGeneratedAt(payload.generatedAt)}</> : null}
              </span>
            </div>
          </section>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>当前展示逻辑</strong>
              <span>
                每个 tab
                都按“应用环节”和“在哪一步起作用”组织，并同时展示三层信息：阶段主提示词、运行时追加模板、程序规则与校验说明。
              </span>
            </div>
          </section>
        </section>

        {error ? (
          <section className="panel sr-panel" style={{ padding: "28px", textAlign: "center", color: "#dc2626" }}>
            {error}
          </section>
        ) : loading && !payload ? (
          <section className="panel sr-panel" style={{ padding: "40px", textAlign: "center", color: "#7d89b0" }}>
            正在加载系统提示词…
          </section>
        ) : (
          <div className="cp-settings-stack">
            <div className="cp-tab-bar sr-tab-bar">
              {applicationTabs.map((tab, index) => {
                const isActive = activeTabDefinition.id === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`cp-step-card ${isActive ? "cp-step-active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className={`cp-step-dot ${isActive ? "active" : "default"}`}>
                      {index === 0 ? "Σ" : index}
                    </span>
                    <span className="cp-step-text">
                      <span className="cp-step-title">{tab.title}</span>
                      <span className="cp-step-desc">{tab.shortDesc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <section className="panel sr-panel sr-tab-hero">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow" style={{ color: phaseAccent[activeTabDefinition.title] ?? "#64748b" }}>
                    {activeTabDefinition.eyebrow}
                  </p>
                  <h3>{activeTabDefinition.title}</h3>
                </div>
                <span className="table-meta">{activeTabDefinition.stepGroups.length} 个作用区块</span>
              </div>
              <p className="sr-tab-hint">{activeTabDefinition.description}</p>
            </section>

            <div className="sr-phase-stack">
              {activeTabDefinition.stepGroups.map((group) => {
                const stageItems =
                  group.stageKeys
                    ?.map((stageKey) => stageMap.get(stageKey))
                    .filter((stage): stage is StageData => Boolean(stage)) ?? [];
                const runtimeItems =
                  group.runtimeDocKeys
                    ?.map((docKey) => runtimeDocMap.get(docKey))
                    .filter((doc): doc is RuntimeDoc => Boolean(doc)) ??
                  runtimeDocs.filter((doc) => group.runtimeDocPhases?.includes(doc.pipelinePhase) ?? false);
                const ruleSections = collectRuleSections(systemRulesTabs, group);
                const accent =
                  phaseAccent[
                    stageItems[0]?.pipelinePhase ??
                      runtimeItems[0]?.pipelinePhase ??
                      activeTabDefinition.title ??
                      "全链路总览"
                  ] ?? "#64748b";
                const totalCount = stageItems.length + runtimeItems.length + ruleSections.length;

                return (
                  <section key={group.id} className="panel sr-panel sr-step-panel">
                    <div className="panel-header compact">
                      <div>
                        <p className="eyebrow" style={{ color: accent }}>
                          {group.stepLabel}
                        </p>
                        <h3>{group.title}</h3>
                      </div>
                      <span className="table-meta">{totalCount} 项内容</span>
                    </div>
                    <p className="sr-intro-copy">{group.description}</p>

                    {stageItems.length > 0 ? (
                      <div className="sr-step-section">
                        <div className="sr-step-section-head">
                          <strong>阶段主提示词</strong>
                          <span>{stageItems.length} 项</span>
                        </div>
                        <div className="sr-prompt-grid">
                          {stageItems.map((stage) => (
                            <PromptCard
                              key={stage.key}
                              accent={phaseAccent[stage.pipelinePhase] ?? accent}
                              badgeText={String(stage.order)}
                              eyebrow={`${stage.pipelinePhase} · 主提示词`}
                              title={stage.label}
                              meta={stage.fieldType}
                              plainPurpose={stage.plainPurpose}
                              usedAtStep={stage.usedAtStep}
                              apiEntry={stage.apiEntry}
                              codeEntry={stage.codeEntry}
                              description={stage.description}
                              promptText={stage.promptText}
                              footerLeft="来源：后端内置默认"
                              footerRight={`${stage.promptText.split("\n").length} 行`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {runtimeItems.length > 0 ? (
                      <div className="sr-step-section">
                        <div className="sr-step-section-head">
                          <strong>运行时追加模板</strong>
                          <span>{runtimeItems.length} 项</span>
                        </div>
                        <div className="sr-prompt-grid">
                          {runtimeItems.map((doc) => (
                            <PromptCard
                              key={doc.key}
                              accent={phaseAccent[doc.pipelinePhase] ?? accent}
                              badgeText="R"
                              eyebrow={`${doc.pipelinePhase} · ${kindLabelMap[doc.kind]}`}
                              title={doc.label}
                              meta={kindLabelMap[doc.kind]}
                              plainPurpose={doc.plainPurpose}
                              usedAtStep={doc.usedAtStep}
                              apiEntry={doc.apiEntry}
                              codeEntry={doc.codeEntry}
                              description={doc.description}
                              promptText={doc.promptText}
                              footerLeft={`来源：${doc.sourceFile}`}
                              footerRight={`${doc.promptText.split("\n").length} 行`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {ruleSections.length > 0 ? (
                      <div className="sr-step-section">
                        <div className="sr-step-section-head">
                          <strong>程序规则与校验</strong>
                          <span>{ruleSections.length} 组</span>
                        </div>
                        <div className="sr-rule-stack">
                          {ruleSections.map((section) => (
                            <section
                              key={`${section.sourceTabId}:${section.title}`}
                              className="panel sr-panel sr-section-panel"
                            >
                              <div className="sr-section-heading-row">
                                <div className="sr-section-heading-copy">
                                  <h4 className="sr-section-title">{section.title}</h4>
                                  <p className="sr-section-purpose">{section.plainPurpose}</p>
                                </div>
                                <span className="sr-section-source">{section.sourceTabTitle}</span>
                              </div>
                              <div className="sr-meta-list">
                                <p className="sr-meta-item">
                                  <strong>在哪一步生效：</strong>
                                  <span>{section.usedAtStep}</span>
                                </p>
                                <p className="sr-meta-item">
                                  <strong>调用接口：</strong>
                                  <span>{section.apiEntry}</span>
                                </p>
                                <p className="sr-meta-item">
                                  <strong>代码入口：</strong>
                                  <span>{section.codeEntry}</span>
                                </p>
                              </div>
                              <ul className="sr-rule-list">
                                {section.items.map((item, idx) => (
                                  <li key={idx} className="sr-rule-item">
                                    {item.label ? <span className="sr-rule-label">{item.label}</span> : null}
                                    <p className="sr-rule-body">{item.body}</p>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {totalCount === 0 ? (
                      <section className="panel sr-panel sr-empty-panel">
                        <p className="sr-empty-copy">这一环节当前没有额外内容。</p>
                      </section>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
