import {
  constraintPromptStages,
  getEffectiveConstraintPrompt,
  type ConstraintPromptStageKey,
} from "./constraint-prompt-store";
import { getNarrationLengthGuidance } from "./narration";
import {
  getConstraintPresetDetectionDocs,
  taskConstraintPresets,
  videoTaskStatusFlow,
  type TaskConstraintPresetKey,
} from "./video-task-schema";
import { NARRATION_LENGTH_MAX_REPAIR_ROUNDS, SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS } from "./video-task-planner";

/**
 * 聚合「系统规则」页数据。请与以下实现保持语义一致：
 * - 镜头计划：`video-task-planner` 中 `validateShotPlan`、解说缩写逻辑
 * - 任务创建：`api/video-tasks` POST 对 constraints 的合并方式
 * - 生成校验：`generation-validator`、`video-analyzer` 的 `validateAnalysisCompleteness`
 * - 生效提示词：`getEffectiveConstraintPrompt`（与线上调用一致，当前为后端内置只读基线）
 */

export type SystemRulesSection = {
  title: string;
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
  items: Array<{ label?: string; body: string }>;
};

export type SystemRulesTabPayload = {
  id: string;
  title: string;
  hint?: string;
  sections: SystemRulesSection[];
};

export type EffectivePromptStagePayload = {
  key: ConstraintPromptStageKey;
  order: number;
  label: string;
  pipelinePhase: string;
  description: string;
  fieldType: string;
  effectivePrompt: string;
  lineCount: number;
};

export type SystemRulesPayload = {
  generatedAt: string;
  tabs: SystemRulesTabPayload[];
  effectivePrompts: EffectivePromptStagePayload[];
  meta: {
    shotPlanRepairRounds: number;
    narrationRepairRounds: number;
    narrationLengthExample: ReturnType<typeof getNarrationLengthGuidance>;
  };
};

function tabShotPlanAndNarration(): SystemRulesTabPayload {
  const example = getNarrationLengthGuidance(5);
  return {
    id: "shot_plan",
    title: "镜头计划与解说",
    hint: "导演模式创建任务时，LLM 产出镜头计划后的程序校验与后续文案处理。",
    sections: [
      {
        title: "镜头计划程序校验（validateShotPlan）",
        plainPurpose:
          "检查模型生成的镜头计划能不能继续往下走，先把镜头数不对、留白乱掉、人物约束不满足这些问题拦下来。",
        usedAtStep: "导演模式 -> 第二步：镜头计划生成后，进入提示词初稿生成前",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/lib/video-task-planner.ts -> validateShotPlan",
        items: [
          {
            body: "镜头条数必须等于任务参数中的「规划镜头数」（storyShotCount）；否则报错并触发修复流程。",
          },
          {
            body: "每个镜头的 durationSeconds 必须大于 0，并允许在总时长内做不完全平均分配；重点是结构自然而不是机械等长。",
          },
          {
            body: "每个镜头的 sceneDescription 不能为空（去空白后）；否则按镜头编号报错。",
          },
          {
            body: "凡标记为 hasVoice / hasSubtitle 的镜头，narrationHint 不能为空；否则按镜头编号报错。",
          },
          {
            label: "约束：每镜必须有人物",
            body: "当 requirePeopleInEveryShot 为 true 时，每个镜头的 hasCharacters 必须为 true；否则按镜头编号报错。",
          },
          {
            label: "约束：两成年人为一男一女",
            body: "当 adultGenderRule 为 one_male_one_female 时：若某镜有至少 2 个被识别为「成年人」的角色标识，则其中须同时包含男性侧（father / dad / 爸）与女性侧（mother / mom / 妈）关键词；成年人识别规则为角色名匹配 father|mother|dad|mom|爸|妈|大人|adult。",
          },
          {
            label: "约束：人物高一致性",
            body: "当 characterConsistency 为 high 时：若多个镜头均有人物，则任意镜头中出现的人物标识须出现在其他有人物的镜头中出现过的人物集合里；否则视为「未定义的新人物」并报错。",
          },
          {
            label: "混剪口播分布",
            body: "对于多镜头混剪类视频：程序会检查是否出现“每个镜头都要口播”的过密分布。开场和收尾通常需要口播，但中间应保留至少一部分留白镜头。",
          },
        ],
      },
      {
        title: "校验失败后的自动修复",
        plainPurpose: "如果镜头计划第一次没过，系统会带着错误清单再让模型修一轮，不会直接把坏结果往下传。",
        usedAtStep: "导演模式 -> 第二步：镜头计划生成后",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/lib/video-task-planner.ts -> generateVideoTaskDraftBundle",
        items: [
          {
            body: `若校验仍有问题，系统最多再请求 LLM ${SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS} 次，每次附上错误列表并要求在保持其余镜头不变的前提下输出完整 JSON。超过轮次后，剩余问题写入 shotPlan.validationErrors，任务仍会继续生成下游提示词。`,
          },
        ],
      },
      {
        title: "提示词生成后的解说词长度",
        plainPurpose: "在台词初稿出来后，系统会先看看有没有超时、机械播报、句尾问题，再决定要不要自动重写。",
        usedAtStep: "导演模式 -> 第二步：镜头计划生成后，准备进入第三步前",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/lib/video-task-planner.ts -> repairNarrationIfOverLimit",
        items: [
          {
            body: "生成三份草稿后，系统按「镜头N：」格式解析解说词，并对超时风险、机械化 Day 开头、句尾“哦”、句尾标点等问题尝试调用模型重写。",
          },
          {
            body: `缩写助手最多执行 ${NARRATION_LENGTH_MAX_REPAIR_ROUNDS} 轮；仅在文生配置 liveEnabled 时才会调用模型。`,
          },
          {
            label: "字数公式（与 getNarrationLengthGuidance 一致）",
            body: `设每段时长为 D 秒（至少按 1 秒计），则 minCharacters = max(6, floor(D×1.8))，suggestedCharacters = max(min+1, floor(D×2.4))，maxCharacters = max(suggested+2, floor(D×3.0))。示例 D=5 秒：min=${example.minCharacters}，max=${example.maxCharacters}，建议≈${example.suggestedCharacters}（不含标点与空格）。`,
          },
        ],
      },
    ],
  };
}

function tabTaskConstraints(): SystemRulesTabPayload {
  const presetRows = (Object.keys(taskConstraintPresets) as TaskConstraintPresetKey[]).map((key) => {
    const p = taskConstraintPresets[key];
    const c = p.constraints;
    const parts = [
      `peopleStructure=${JSON.stringify(c.peopleStructure)}`,
      `adultGenderRule=${JSON.stringify(c.adultGenderRule)}`,
      `characterConsistency=${c.characterConsistency}`,
      `sceneConsistency=${c.sceneConsistency}`,
      `forbidEmptyShots=${c.forbidEmptyShots}`,
      `requirePeopleInEveryShot=${c.requirePeopleInEveryShot}`,
    ];
    return { label: p.label, key, detail: parts.join("，") };
  });

  const detection = getConstraintPresetDetectionDocs();

  return {
    id: "task_constraints",
    title: "任务约束与预设",
    hint: "创建任务时如何合并预设、自定义行，以及注入镜头计划 LLM 的约束文案。",
    sections: [
      {
        title: "创建任务时的约束合并（POST /api/video-tasks）",
        plainPurpose: "把用户表单里选的预设和自定义约束合并起来，准备一起喂给镜头计划模型。",
        usedAtStep: "导演模式 -> 第一步：输入信息提交时",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/app/api/video-tasks/route.ts -> POST",
        items: [
          {
            body: "必须至少提供商品信息快照或用户提示词其一，否则拒绝创建。",
          },
          {
            body: "constraints = 所选预设的字段副本 + customRules：用户在表单「自定义约束」中按行填写的非空行会进入 customRules 数组。",
          },
        ],
      },
      {
        title: "预设库（taskConstraintPresets）",
        plainPurpose: "这里列的是系统内置的约束套餐，方便快速套用到不同类型的视频任务。",
        usedAtStep: "导演模式 -> 第一步：输入信息时",
        apiEntry: "前端表单 + POST /api/video-tasks",
        codeEntry: "src/lib/video-task-schema.ts -> taskConstraintPresets",
        items: presetRows.map((r) => ({
          label: r.label,
          body: `${r.key}：${r.detail}`,
        })),
      },
      {
        title: "未手动选预设时的自动识别（detectConstraintPreset）",
        plainPurpose: "如果你没手动选预设，系统会根据商品信息和提示词自动猜一个更合适的约束预设。",
        usedAtStep: "导演模式 -> 第一步：输入信息提交时",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/lib/video-task-schema.ts -> detectConstraintPreset",
        items: [
          {
            body: "将商品标题、快照、用户提示词拼接后，按下列顺序用正则匹配，命中则采用对应预设；均未命中则为「通用」。",
          },
          ...detection.map((d) => ({
            label: d.presetLabel,
            body: `正则源码：/${d.patternSource}/`,
          })),
        ],
      },
      {
        title: "注入镜头计划系统提示的约束段落（buildConstraintRules）",
        plainPurpose: "把人物结构、场景一致性、自定义要求这些约束，真正追加到镜头计划的系统提示词里。",
        usedAtStep: "导演模式 -> 第二步：镜头计划生成前",
        apiEntry: "POST /api/video-tasks",
        codeEntry: "src/lib/video-task-planner.ts -> buildConstraintRules",
        items: [
          {
            body: "在「系统提示词 → 镜头计划生成」生效文案之后，若有下列情况，会追加编号列表「本任务的专属约束（必须严格遵守）」。",
          },
          { body: "peopleStructure 非空：注入人物结构说明（值为原始字段，如 2_adults_2_children）。" },
          {
            body: "adultGenderRule === one_male_one_female：注入双成年人须为一男一女（father/mother），禁止同性双成年人。",
          },
          { body: "requirePeopleInEveryShot：注入每镜必须有人物、禁止纯空镜。" },
          { body: "forbidEmptyShots：注入禁止无视觉主体的空镜。" },
          { body: "characterConsistency 为 high / medium：注入对应等级的人物一致性说明。" },
          { body: "sceneConsistency 为 high：注入场景高一致性说明。" },
          { body: "customRules 每条非空行：以「自定义约束：」前缀逐条注入。" },
        ],
      },
    ],
  };
}

function tabDownstreamValidation(): SystemRulesTabPayload {
  return {
    id: "downstream",
    title: "生成链路校验",
    hint: "各阶段 API 中的程序校验逻辑摘要（与界面「校验提醒」同源）。",
    sections: [
      {
        title: "字幕音频（validateNarrationResult）",
        plainPurpose: "检查字幕音频阶段有没有音频缺失、超时、语速异常、字幕空掉这些问题。",
        usedAtStep: "导演模式 -> 第三步：音频字幕生成后",
        apiEntry: "POST /api/video-tasks/[taskId]/subtitle-audio-run",
        codeEntry: "src/lib/generation-validator.ts -> validateNarrationResult",
        items: [
          { body: "音频 cue 数量须等于 directorPlan 中需要口播/字幕的单元数量。" },
          { body: "每个片段须具备 audioUrl，否则为 error。" },
          {
            body: "单段解说时长若显著超过目标片段时长，会直接记 error；轻微超出则记 warning，优先要求在生成阶段压缩文本，而不是在合成阶段淡出截断。",
          },
          { body: "若检测到单位时间内文本量明显偏低，会判定语速异常偏慢并记 warning / error。" },
          { body: "解说词与字幕若均为空，记 warning。" },
        ],
      },
      {
        title: "文生图选图（validateVisualImages）",
        plainPurpose: "检查图片阶段是不是每个片段都拿到了合适的图，避免进入下一步时缺图。",
        usedAtStep: "导演模式 -> 第四步：视觉图片生成后",
        apiEntry: "POST /api/video-tasks/[taskId]/visual-images",
        codeEntry: "src/lib/generation-validator.ts -> validateVisualImages",
        items: [
          { body: "图片镜头数须等于 segmentCount。" },
          { body: "已确认张数少于 segmentCount 时记 warning；一张未确认为 error。" },
        ],
      },
      {
        title: "片段生成（validateClipShots）",
        plainPurpose: "检查每个视频片段有没有生成成功、数量对不对、时长偏差是不是太大。",
        usedAtStep: "导演模式 -> 第五步：片段生成后",
        apiEntry: "POST /api/video-tasks/[taskId]/clip-runs",
        codeEntry: "src/lib/generation-validator.ts -> validateClipShots",
        items: [
          { body: "片段条数须等于 segmentCount。" },
          { body: "存在 FAILED 任务为 error。" },
          { body: "COMPLETED 但无 videoUrl/remoteVideoUrl 为 error。" },
          { body: "resolvedDurationSeconds 与目标时长偏差超过 25% 为 warning。" },
          { body: "仍有未完成且未失败的片段为 warning。" },
        ],
      },
      {
        title: "视频拆解 · 分析 JSON（validateAnalysisCompleteness）",
        plainPurpose: "检查视频拆解出来的分析 JSON 结构是不是完整，避免下游脚本生成拿到残缺数据。",
        usedAtStep: "素材管理 -> 视频拆解 -> 视觉分析后",
        apiEntry: "POST /api/video-materials/[materialId]",
        codeEntry: "src/lib/video-analyzer.ts -> validateAnalysisCompleteness",
        items: [
          {
            body: "解析为 JSON 后须包含顶层字段：视频级信息、开篇设计、镜头序列、结尾设计、商品与卖点、全局视觉规则、Prompt生成指令；缺失则会重试分析（次数由调用方决定）。",
          },
          { body: "JSON 无法解析时视为缺少「合法 JSON」。" },
        ],
      },
      {
        title: "任务状态流（videoTaskStatusFlow）",
        plainPurpose: "把整条任务链路每一步的状态名字和含义统一列出来，方便看懂当前任务卡在哪一步。",
        usedAtStep: "全链路总览",
        apiEntry: "多个接口共用",
        codeEntry: "src/lib/video-task-schema.ts -> videoTaskStatusFlow",
        items: videoTaskStatusFlow.map((s) => ({
          label: s.label,
          body: s.description,
        })),
      },
    ],
  };
}

function buildEffectivePrompts(): EffectivePromptStagePayload[] {
  return constraintPromptStages.map((stage) => {
    const text = getEffectiveConstraintPrompt(stage.key);
    return {
      key: stage.key,
      order: stage.order,
      label: stage.label,
      pipelinePhase: stage.pipelinePhase,
      description: stage.description,
      fieldType: stage.fieldType,
      effectivePrompt: text,
      lineCount: text ? text.split("\n").length : 0,
    };
  });
}

export function buildSystemRulesPayload(): SystemRulesPayload {
  const exampleDuration = 5;
  return {
    generatedAt: new Date().toISOString(),
    tabs: [tabShotPlanAndNarration(), tabTaskConstraints(), tabDownstreamValidation()],
    effectivePrompts: buildEffectivePrompts(),
    meta: {
      shotPlanRepairRounds: SHOT_PLAN_VALIDATION_MAX_REPAIR_ROUNDS,
      narrationRepairRounds: NARRATION_LENGTH_MAX_REPAIR_ROUNDS,
      narrationLengthExample: getNarrationLengthGuidance(exampleDuration),
    },
  };
}
