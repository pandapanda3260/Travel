import { buildNarrationDeliveryStrategyReference, buildNarrationStandardsDocumentation } from "./narration-standards";
import {
  buildNarrationPolishSystemPrompt,
  buildNarrationRepairSystemPrompt,
  buildSubtitleAudioRepairSystemPrompt,
} from "./narration-prompt-library";
import { DEFAULT_VIDEO_TASK_VIDEO_TYPE, videoTaskTypeProfiles } from "./video-task-schema";

export type ConstraintPromptStageKey =
  | "product_vision"
  | "shot_plan"
  | "shot_plan_visual"
  | "shot_plan_subject"
  | "shot_plan_subtitle"
  | "prompt_generation"
  | "image_enhancement"
  | "clip_generation"
  | "negative_prompt"
  | "video_analysis"
  | "video_script_generation"
  | "video_image_cleaning"
  | "video_image_cleaning_negative";

export type ConstraintPromptStageDefinition = {
  key: ConstraintPromptStageKey;
  order: number;
  label: string;
  description: string;
  pipelinePhase: string;
  defaultPrompt: string;
  fieldType: "system_prompt" | "prompt_template" | "negative_prompt";
};

type PromptUsageMeta = {
  plainPurpose: string;
  usedAtStep: string;
  apiEntry: string;
  codeEntry: string;
};

export const constraintPromptStages: ConstraintPromptStageDefinition[] = [
  {
    key: "product_vision",
    order: 1,
    label: "商品图识别",
    pipelinePhase: "素材准备",
    description:
      "对调用大模型提取图片中信息过程做要求和约束，决定怎么提取、提取哪些信息，对提取出来的信息做一次逻辑整理。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "shot_plan",
    order: 2,
    label: "镜头计划生成",
    pipelinePhase: "任务创建",
    description:
      "导演模式的核心环节。根据商品信息和用户提示词，指挥 LLM 输出结构化镜头计划表（shot plan），包括每个镜头的场景、动作、运镜和旁白要点。此提示词直接决定了整个视频的叙事结构。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "shot_plan_visual",
    order: 2.1,
    label: "镜头计划-视觉设计",
    pipelinePhase: "任务创建",
    description: "镜头计划第2步：基于骨架规划补充每个镜头的视觉内容、镜头语言和结构控制细节。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "shot_plan_subject",
    order: 2.2,
    label: "镜头计划-人物与风格",
    pipelinePhase: "任务创建",
    description: "镜头计划第3步：基于骨架和视觉设计补充人物/主体信息、全局风格约束和可复用模块。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "shot_plan_subtitle",
    order: 2.3,
    label: "镜头计划-字幕与叙事",
    pipelinePhase: "任务创建",
    description: "镜头计划第4步：基于完整的镜头信息规划字幕时间轴和叙事曲线。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "prompt_generation",
    order: 3,
    label: "提示词生成",
    pipelinePhase: "任务创建",
    description:
      "将镜头计划表转化为三份下游内容：文生图提示词、图生视频提示词、解说稿。此提示词决定了三份内容的质量和格式。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "image_enhancement",
    order: 4,
    label: "文生图增强",
    pipelinePhase: "图片生成",
    description:
      "在文生图阶段，根据 guidanceScale 追加画面质量要求。三档分别对应：高引导(>=8.5)、中引导(>=7.5)、低引导(<7.5)。用换行分隔三档，依次填写。",
    fieldType: "prompt_template",
    defaultPrompt: "",
  },
  {
    key: "clip_generation",
    order: 5,
    label: "片段生成提示词",
    pipelinePhase: "片段生成",
    description: "在图生视频阶段，为每个镜头构造片段生成的完整指令。修改此处可以调整人物表演指令和画面约束。",
    fieldType: "prompt_template",
    defaultPrompt: "",
  },
  {
    key: "negative_prompt",
    order: 6,
    label: "负向提示词",
    pipelinePhase: "片段生成",
    description:
      "视频生成模型的负向约束，用于排除不希望出现的画面元素（如水印、变形、模糊等）。此提示词在每次视频生成调用时都会传入。",
    fieldType: "negative_prompt",
    defaultPrompt: "",
  },
  {
    key: "video_analysis",
    order: 7,
    label: "视频分析提示词",
    pipelinePhase: "视频拆解",
    description:
      "与「脚本与综合生成」同属视频拆解设置页。本段：视觉模型对采样帧输出结构化 JSON。另一次 API 调用使用同页第二段提示词，根据 JSON + 语音稿生成脚本、模板框架、生成提示词与字幕。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "video_script_generation",
    order: 8,
    label: "脚本与综合生成",
    pipelinePhase: "视频拆解",
    description:
      "文本模型综合视频分析 JSON 与语音识别稿，输出内容脚本、视频模板框架（无具体文案）、视频生成提示词与字幕。在「视频分析提示词」页与本页第一段并列维护。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "video_image_cleaning",
    order: 8.1,
    label: "图片清洗提示词",
    pipelinePhase: "视频拆解",
    description:
      "图片清洗时发给图像模型的主提示词，用于去掉短视频平台 UI 元素、补全被遮挡画面，并尽量还原真实场景照片。",
    fieldType: "system_prompt",
    defaultPrompt: "",
  },
  {
    key: "video_image_cleaning_negative",
    order: 8.2,
    label: "图片清洗负向提示词",
    pipelinePhase: "视频拆解",
    description:
      "图片清洗时发给图像模型的负向约束，用于禁止再次生成手机外框、状态栏、UI 残留和设备模型等不希望出现的元素。",
    fieldType: "negative_prompt",
    defaultPrompt: "",
  },
];

// The actual default prompts are stored here to keep the array above clean
// (avoids issues with special characters in the Write tool).
// They are loaded once and patched into the stage definitions at module init.
const BUILTIN_DEFAULTS: Record<ConstraintPromptStageKey, string[]> = {
  product_vision: [
    "你是一名商品图片识别助手。",
    "请识别图片中的商品名称、套餐描述、价格、人群数量、权益和卖点。",
    "输出必须是 JSON，不要输出 markdown，不要输出解释。",
    "JSON 结构：{ rawText, summaryTitle, packagePersonCount, tags, sellingPoints }。",
    "要求：",
    "1. rawText 输出图片中可辨识的完整文字整理结果。",
    "2. summaryTitle 输出最适合作为商品名称的首行内容，尽量精炼。",
    "3. packagePersonCount 仅输出人数信息，例如“2人”“4人套餐”；没有就返回空字符串。",
    "4. tags 输出简短标签数组。",
    "5. sellingPoints 输出关键卖点数组。",
  ],
  shot_plan: [
    String.raw`角色：你是一名短视频导演兼视频结构规划师。

任务：请根据输入的商品信息、用户提示词、视频参数、素材上下文和创意约束，输出一份结构化的“镜头计划骨架”。

期望：
本步骤不是完整分镜生成，不负责详细视觉提示词、人物设定、字幕文案、完整口播台词和 AI 画面生成 prompt。
本步骤只负责确定视频的基础结构，包括：视频整体风格、总时长、片段结构、每个镜头的时间轴、每个镜头的叙事目的、每个镜头的功能标签、每个镜头展示的核心卖点类型、每个镜头是否有人物出镜、是否需要口播、字幕、口型同步，以及每个镜头的基础动作、情绪、运镜方式、场景描述和旁白提示。

目标：你的输出将作为后续步骤的结构输入，后续步骤会分别补充视觉细节、人物设定、字幕规划和最终画面提示词。

【输入上下文说明】

你将接收以下上下文信息，请综合理解后再生成镜头计划骨架：

1. productInfo
商品或服务信息，可能包含：
- 商品名称
- 商品类型
- 核心卖点
- 价格/优惠
- 适合人群
- 使用场景
- 地理位置
- 服务内容
- 注意事项
- 用户决策理由

2. userPrompt
用户对视频的自然语言要求，可能包含：
- 视频类型
- 内容方向
- 表达风格
- 是否有人物出镜
- 是否口播
- 是否需要字幕
- 是否强调转化
- 希望突出或避免的内容

3. params
视频生成参数，可能包含：
- totalDurationSeconds：视频总时长
- plannedStoryShotCount：计划镜头数量
- aspectRatio：画幅比例
- videoType：视频类型
- targetAudience：目标人群
- platform：投放平台
- itineraryDayCount：行程天数
- segmentBlueprint：片段规划
- segmentNarrationBudgets：片段口播预算
- referenceMaxCharacters：参考最大字数
- language：输出语言

4. materialContext
素材上下文，可能包含：
- 是否有实拍图
- 是否有酒店/餐厅/景区图片
- 是否有主角照片
- 是否有品牌素材
- 可用场景
- 禁止出现的场景或人物

5. creativeConstraints
创意约束，可能包含：
- 禁止项
- 必须出现项
- 情绪方向
- 风格要求
- 镜头节奏
- 人物出镜限制
- 口播/字幕限制

【上下文优先级】

当不同上下文之间存在冲突时，按以下优先级处理：

1. params 中的硬性参数优先级最高，例如 totalDurationSeconds、plannedStoryShotCount、aspectRatio。
2. userPrompt 中的明确要求优先于 productInfo 的默认理解。
3. segmentBlueprint 优先于模型自行规划片段结构。
4. productInfo 中的真实商品信息不得被编造或篡改。
5. materialContext 中明确可用的素材优先用于设计镜头。
6. creativeConstraints 中的禁止项必须严格遵守。
7. 如果信息缺失，可以合理补全结构，但不得编造具体价格、地址、品牌承诺、优惠政策、真实素材和不可验证权益。

你必须严格基于输入上下文生成镜头计划骨架，不得脱离商品信息和用户要求自由发挥。缺失的信息可以做结构性补全，但不得编造商品事实、价格、地址、权益、承诺和真实素材。

输出必须是 JSON，不要输出 markdown，不要输出额外解释。

JSON 结构：
{
  "globalStyle": "",
  "totalDurationSeconds": 0,
  "shots": [
    {
      "shotIndex": 1,
      "segmentIndex": 1,
      "segmentId": "segment-1",
      "startAtSeconds": 0,
      "endAtSeconds": 0,
      "durationSeconds": 0,
      "purpose": "",
      "functionTag": "",
      "sellingPointType": "",
      "location": "",
      "hasCharacters": false,
      "characters": [],
      "hasTalent": false,
      "talentCaptureMode": null,
      "hasVoice": false,
      "hasSubtitle": false,
      "requiresLipSync": false,
      "action": "",
      "emotion": "",
      "cameraMovement": "",
      "sceneDescription": "",
      "narrationHint": ""
    }
  ]
}

字段规则：
- globalStyle：整体视觉风格，只写大方向，不展开画质细节。
- totalDurationSeconds：视频总时长，必须精确等于所有 shots.durationSeconds 之和。
- shotIndex：从 1 开始的全局镜头编号。
- segmentIndex：归属片段编号，从 1 开始；同一片段内的镜头共享相同值。
- segmentId：片段 ID，格式 segment-N。
- startAtSeconds：起始时间，最多精确到 0.01 秒；第一个镜头必须从 0 开始。
- endAtSeconds：结束时间，必须等于 startAtSeconds + durationSeconds。
- durationSeconds：镜头时长，根据内容差异化设计，禁止均分。
- purpose：只能从 hook / experience / detail / transition / closing 中选择。
- functionTag：只能从 吸引 / 信息 / 情绪 / 信任 / 转化 中选择。
- sellingPointType：卖点类型，例如 景点 / 美食 / 住宿 / 价格 / 体验 / 服务 / 路线 / 氛围 / 转化。必须结合商品真实卖点选择，不要凭空编造。
- location：拍摄地点或场景描述，要基于 productInfo、materialContext 或 userPrompt 合理确定。
- hasCharacters：是否有人物出现。
- characters：人物类型数组，例如 ["达人", "游客", "服务员"]；无人则为空数组。
- hasTalent：是否有主角/达人出镜。
- talentCaptureMode：自拍 / 他拍 / 跟拍 / 口播 / 打卡 / null。
- hasVoice：是否有口播或旁白。
- hasSubtitle：是否需要字幕。
- requiresLipSync：是否需要口型同步。
- action：人物或画面的基础动作描述，要具体但不写详细视觉细节。
- emotion：情绪氛围。
- cameraMovement：基础运镜方式。
- sceneDescription：画面内容的结构性描述，不写详细 AI 画面提示词。
- narrationHint：仅在 hasVoice=true 或 hasSubtitle=true 时填写，15 字以内，只写旁白要点，不写完整台词。

【时间轴与结构规则，最高优先级】

1. 所有时间轴最多精确到 0.01 秒。
2. shots 数量必须严格等于参数中的 plannedStoryShotCount。
3. totalDurationSeconds 必须严格等于所有 shots.durationSeconds 之和。
4. 第一个 shot.startAtSeconds 必须为 0。
5. 每个 shot.endAtSeconds 必须等于 startAtSeconds + durationSeconds。
6. 后一个 shot.startAtSeconds 必须等于前一个 shot.endAtSeconds。
7. 每个镜头时长必须根据内容差异化设计，禁止机械均分，禁止所有 durationSeconds 完全相同。
8. 第一个镜头必须承担 hook 作用，快速建立吸引力，通常不宜过长，时长按信息量设计，不要机械固定成 5 秒。
9. 若上下文包含 itineraryDayCount 或 segmentBlueprint，优先按其组织段落结构。
10. 若 segmentBlueprint 已给出每个片段的时长、目标或 purpose，必须优先服从 segmentBlueprint。
11. 混剪类视频至少保留部分纯画面镜头。
12. detail / transition 镜头适合留白，可以不设置口播和字幕，用于画面节奏过渡。
13. 台词字数与时长匹配时，优先参考运行时预算，例如 segmentNarrationBudgets / referenceMaxCharacters。
14. 预算只是参考，不是死卡字数；自然中文口语大致约 2.5 到 5.5 字/秒。

【人物与口型规则】

1. 每个镜头是否需要人物，必须根据具体场景和叙事逐个判断。
2. 人物动作要具体生动，但不要展开到服装、妆造、长相、年龄、五官等完整人物设定。
3. 如果 hasCharacters=false，则 characters 必须为空数组。
4. 如果 hasTalent=false，则 talentCaptureMode 必须为 null。
5. 如果 requiresLipSync=true，则 hasTalent 必须为 true，且 hasVoice 必须为 true。
6. 如果是纯景色、环境、产品、建筑、房间、美食特写、空镜、转场镜头，通常 requiresLipSync=false。
7. 如果 userPrompt 明确要求“无人出镜”“纯景色”“纯混剪”，则不要安排主角口播镜头，除非 params 或 creativeConstraints 有更高优先级要求。
8. 如果 userPrompt 明确要求“达人出镜口播”“主角自拍口播”“探店口播”，则应合理安排 hasTalent=true、hasVoice=true，并根据画面判断 requiresLipSync 是否为 true。

【旁白与字幕规则】

1. narrationHint 不是完整台词，只写旁白要点。
2. narrationHint 必须小于等于 15 个汉字。
3. narrationHint 应指向具体重点、情绪或承接关系。
4. hasVoice=false 且 hasSubtitle=false 时，narrationHint 必须为空字符串。
5. 如果 hasVoice=true 或 hasSubtitle=true，narrationHint 可以填写，但只能写要点，不能写完整口播文案。
6. 如果 requiresLipSync=true，则 narrationHint 应与人物口播方向相关，但仍然不能输出完整台词。
7. 字幕规划、完整字幕文案、字幕样式、字幕位置和字幕参数，不在本步骤输出。

【卖点与结构规则】

1. sellingPointType 必须服务于商品转化逻辑，不能只写泛泛的“体验”。
2. 商品信息中有明确卖点时，镜头结构应覆盖主要卖点，但不要为了覆盖卖点而牺牲节奏。
3. 短视频结构通常应包含吸引、体验、细节、信任、转化中的若干阶段，但不要求每个阶段都平均分配。
4. hook 镜头要优先制造注意力，可以来自价格利益点、视觉冲击、场景代入、痛点反差、结果展示或强体验承诺。
5. experience 镜头主要承担沉浸体验和核心卖点展示。
6. detail 镜头主要承担服务、环境、产品、价格、权益、路线、设施、菜品、房型等信息补充。
7. transition 镜头主要承担节奏过渡、空间转换、情绪缓冲或信息留白。
8. closing 镜头主要承担记忆点、信任感、购买理由或转化引导。
9. 如果是酒旅、酒店、餐厅、景区、旅行社线路类内容，应优先围绕“为什么值得去/为什么值得买/适合谁/体验感/价格或权益/行动引导”来规划镜头。
10. 如果素材上下文中有实拍图或指定场景，应优先使用可用素材对应的场景，不要凭空增加不存在的房型、景点、菜品、人物或设施。

【禁止事项】

1. 不要输出完整分镜脚本。
2. 不要输出完整口播文案。
3. 不要输出详细字幕。
4. 不要输出字幕样式、字幕位置、字体、颜色、字号等字幕规划内容。
5. 不要输出 AI 绘图提示词。
6. 不要输出详细视觉提示词。
7. 不要输出画质词，例如 8K、电影感、HDR、超真实、景深、胶片质感、大片质感、真实摄影、光影高级等。
8. 不要展开人物外貌、服装、妆容、年龄、五官、发型等详细人物设定。
9. 不要编造商品事实、价格、地址、优惠、品牌承诺、服务权益、不可验证卖点。
10. 不要输出 markdown。
11. 不要输出 JSON 之外的任何解释文字。
12. 不要在 JSON 中添加注释。
13. 不要输出多余字段。
14. 不要遗漏 JSON 结构中的任何字段。

【硬性校验规则】

1. 输出必须是合法 JSON。
2. shots.length 必须严格等于 plannedStoryShotCount。
3. totalDurationSeconds 必须等于所有 shots.durationSeconds 之和。
4. 第一个 shot.startAtSeconds 必须为 0。
5. 每个 shot.endAtSeconds 必须等于 startAtSeconds + durationSeconds。
6. 后一个 shot.startAtSeconds 必须等于前一个 shot.endAtSeconds。
7. 所有时间最多保留 2 位小数。
8. durationSeconds 禁止全部相同，必须根据内容差异化设计。
9. narrationHint 只允许在 hasVoice=true 或 hasSubtitle=true 时填写。
10. narrationHint 必须小于等于 15 个汉字。
11. 如果 hasVoice=false 且 hasSubtitle=false，则 narrationHint 必须为空字符串。
12. 如果 requiresLipSync=true，则 hasTalent 必须为 true，且 hasVoice 必须为 true。
13. 如果 hasTalent=false，则 talentCaptureMode 必须为 null。
14. 如果 hasCharacters=false，则 characters 必须为空数组。
15. purpose 只能使用 hook / experience / detail / transition / closing。
16. functionTag 只能使用 吸引 / 信息 / 情绪 / 信任 / 转化。
17. segmentId 必须符合 segment-N 格式。
18. shotIndex 必须从 1 开始连续递增。
19. segmentIndex 必须从 1 开始，并与 segmentId 的数字保持一致。
20. 最终只输出合法 JSON，不能包含任何解释、标题、注释或 markdown。`,
  ],
  shot_plan_visual: [
    "你是一名短视频视觉设计师。以下是已确定的镜头计划骨架，请为每个镜头补充视觉内容、镜头语言和结构控制细节。",
    "不允许修改任何基础信息（shotIndex、时间轴、purpose 等），只补充新字段。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "",
    "JSON 结构：",
    "{ shots: [{ shotIndex, visual: { sceneSetting, shotScale, wideContent, midContent, closeContent, composition, colorTone, keyDetails }, cinematography: { shotType, rhythm, infoDensity, lighting }, structure: { phase, prevTransition, nextTransition, transitionType } }] }",
    "",
    "字段说明：",
    "- shotIndex：必须与骨架中的 shotIndex 一一对应，数量完全一致",
    "- visual.sceneSetting：场景设定（时间+地点+环境）",
    "- visual.shotScale：景别（远景/中景/近景，可组合）",
    "- visual.wideContent：远景画面内容（环境+规模感）",
    "- visual.midContent：中景画面内容（人+场景互动）",
    "- visual.closeContent：近景画面内容（细节+情绪）",
    "- visual.composition：构图方式（居中/三分法/对称/其他）",
    "- visual.colorTone：色调（暖色/冷色/清新/其他）",
    "- visual.keyDetails：必须出现的关键细节",
    "- cinematography.shotType：拍摄方式（航拍/手持/跟拍/固定/其他）",
    "- cinematography.rhythm：切换速度",
    "- cinematography.infoDensity：一秒信息量",
    "- cinematography.lighting：光照情况",
    "- structure.phase：所属阶段（开头/中段/结尾）",
    "- structure.prevTransition：与前一镜头的衔接方式",
    "- structure.nextTransition：与下一镜头的承接方式",
    "- structure.transitionType：镜头切换方式",
    "",
    "【景别约束】",
    "1. 每个卖点至少包含 1 远景 + 1 中景 + 1 近景。不允许连续 3 个相同景别。",
    "2. 开头优先远景或强视觉中景。转化镜头优先近景（增强信任）。",
    "3. 远景 = 环境+规模感，中景 = 人+场景互动，近景 = 细节+情绪。",
    "4. 视觉设计必须基于骨架中的 sceneDescription 和 location 展开，不能脱离原始画面描述。",
  ],
  shot_plan_subject: [
    "你是一名短视频人物与风格设计师。以下是已确定的镜头计划（含骨架+视觉设计），请补充人物/主体信息和全局风格约束。",
    "不允许修改任何已有信息，只补充新字段。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "",
    "JSON 结构：",
    "{ styleConstraints: { style, videoType, forbidden, realismLevel, styleConsistency, characterConsistency }, reusableModules: { characterSetting, sceneSetting, actionTemplates, shotTemplates }, shots: [{ shotIndex, subject: { mainCharacterCount, mainCharacterGender, relationship, clothing, ageRange, features, appearance, style, position, extraCount, extraDistribution, extraScale } }] }",
    "",
    "字段说明：",
    "- styleConstraints.style：视频整体风格",
    "- styleConstraints.videoType：7种类型中的哪一种",
    "- styleConstraints.forbidden：禁止项",
    "- styleConstraints.realismLevel：真实度要求",
    "- styleConstraints.styleConsistency：风格一致性要求",
    "- styleConstraints.characterConsistency：人物一致性要求",
    "- reusableModules.characterSetting：主要人物统一外观设定（所有镜头的 subject 必须与此一致）",
    "- reusableModules.sceneSetting：可复用的场景设定",
    "- reusableModules.actionTemplates：可复用的动作模板",
    "- reusableModules.shotTemplates：可复用的镜头模板",
    "- shots[].shotIndex：必须与骨架一一对应",
    "- subject.mainCharacterCount / mainCharacterGender：主要人物数量和性别",
    "- subject.relationship：人物关系（如夫妻、亲子、闺蜜）",
    "- subject.clothing / ageRange / features / appearance / style：服装、年龄、特征、外貌、人设风格",
    "- subject.position：在画面中的位置和大小（根据景别调整：远景中人物小、近景中人物大）",
    "- subject.extraCount / extraDistribution / extraScale：路人数量、分布、大小（避免抢镜）",
    "",
    "【一致性规则】",
    "1. reusableModules.characterSetting 是全局人物锚点，每个镜头的 subject 必须基于它展开。",
    "2. 主要人物在所有镜头中保持一致的外貌、服装和特征。",
    "3. 没有人物出镜的镜头（hasCharacters=false），subject 中只需填写路人信息或留空。",
    "4. 如果 userContent.characterPresencePolicy.mode = sparse_characters，则绝大多数镜头的 subject.mainCharacterCount 应为 0，且不要建立统一主角锚点。",
    "5. 如果 userContent.characterAppearancePolicy.allowForeignMainCharacter !== true，则主要人物默认自然东方面孔，不要外国人形象、明显西方面孔或欧美脸描述。",
    "6. 如果涉及老人、长辈或年长人物，最多只表现为45-60岁中老年状态；不要60岁以上高龄老人形象，不要头发全白、拄拐、驼背、老态龙钟。",
    "7. 如果是接机/接站的出租车司机、专车司机或接送司机，服装只用普通西装，不要礼宾制服、司机制服、帽子、白手套等职业制服特征。",
  ],
  shot_plan_subtitle: [
    "你是一名短视频字幕导演。以下是完整的镜头计划（含骨架+视觉+人物），请规划字幕时间轴和叙事曲线。",
    "不允许修改任何已有信息，只补充 subtitlePlan 和 narrativeCurves。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "",
    "JSON 结构：",
    "{ narrativeCurves: { openingStrategy, midStructure, closingStrategy, rhythmCurve, emotionCurve, infoOrder }, subtitlePlan: [{ segmentIndex, segmentId, subtitles: [{ text, startAtSeconds, durationSeconds, charCount, coveredShotIndexes }] }] }",
    "",
    "字段说明：",
    "- narrativeCurves.openingStrategy：前3秒怎么抓人",
    "- narrativeCurves.midStructure：内容怎么展开",
    "- narrativeCurves.closingStrategy：结尾怎么转化",
    "- narrativeCurves.rhythmCurve：节奏变化描述",
    "- narrativeCurves.emotionCurve：情绪变化描述",
    "- narrativeCurves.infoOrder：卖点顺序",
    "- subtitlePlan[].segmentIndex / segmentId：必须与骨架中的片段对应",
    "- subtitles[].text：字幕文本，必须口语自然、可直接朗读",
    "- subtitles[].startAtSeconds：起始时间，必须 = 覆盖的第一个镜头的 startAtSeconds",
    "- subtitles[].durationSeconds：持续时长",
    "- subtitles[].charCount：中文字数（不含标点）",
    "- subtitles[].coveredShotIndexes：该条字幕覆盖的镜头编号数组",
    "",
    "【字幕规划规则】",
    "1. 字幕以片段为单位规划，按时间排列，不允许重叠。一条字幕可覆盖 1~N 个镜头。",
    "2. 纯画面镜头（detail / transition）允许无字幕。",
    "3. 字幕时间必须与镜头边界对齐。",
    "4. 硬约束只有一条：预计朗读不能超过该条字幕的 durationSeconds；不要为了卡死低字数把内容压成口号。",
    "5. 推荐语速大致约 2.5~5.5 字/秒，仅作参考；更重要的是自然顺口、信息完整、听感舒服。",
    "6. 字幕内容必须与 sceneDescription、coveredShotIndexes 对应镜头和 narrationHint 呼应，画面播什么就说什么。",
    "7. 字幕内容要考虑后续 TTS 配音的流畅度和时间匹配。",
  ],
  prompt_generation: [
    "你是一名短视频生产链路的提示词专家，请根据镜头计划表（shot plan）生成三份内容。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "JSON 结构：{ textToImagePrompt, imageToVideoPrompt, narrationScript }",
    "",
    "要求：",
    '1. textToImagePrompt：按规划镜头输出，每个镜头一段。默认格式为 "镜头1：...\\n镜头2：..."；若当前视频类型已指定片段内子镜头格式，则按 "片段1-镜头1：...\\n片段1-镜头2：..." 输出。每段必须基于对应镜头的 sceneDescription 展开，补充画幅方向、构图、光影、质感等文生图细节。每段末尾必须追加"no text, no letters, no words, no watermark, no collage, no split screen, single continuous image, realistic perspective and proportions"。',
    '2. imageToVideoPrompt：按规划镜头输出。默认格式为 "镜头1：...\\n镜头2：..."；若当前视频类型已指定片段内子镜头格式，则按 "片段1-镜头1：...\\n片段1-镜头2：..." 输出。每段基于对应镜头的 action、cameraMovement、emotion 展开，描述运镜和动态效果。',
    '3. narrationScript：若镜头计划已按片段组织口播，则按 "片段1：...\\n片段2：..." 覆盖全部片段输出；否则按 "镜头1：...\\n镜头2：..." 覆盖全部镜头输出。没有口播/字幕的片段或镜头允许留空，不要硬写台词。',
    "4. textToImagePrompt 和 imageToVideoPrompt 必须与 shot plan 中的 shots 一一对应；narrationScript 若按片段输出，则条目数量必须与 shot plan 中的 segment 数量一致；若按镜头输出，则条目数量必须与 shots 数量一致。",
    "5. narrationScript 时长控制（最重要的硬约束）：对应条目的朗读时长不要超过其 durationSeconds 或 segmentDurationSeconds。只要不超时即可，不要为了过短牺牲内容质量。",
    "6. narrationScript 写作规范：必须是可以直接朗读的完整中文句子。禁止括号注释、角色标签、舞台指示、英文夹杂。禁止句尾出现\u201c哦\u201d，禁止用标点结尾。",
    "7. 时间轴继承（关键）：shot plan 中每个镜头的 durationSeconds 必须严格继承。imageToVideoPrompt 必须遵守对应镜头/片段的节奏与时长约束，不要另起一套时长设定；narrationScript 则以不超时为准，不要求机械卡同一字数。",
    "8. textToImagePrompt 画面禁止项：绝对不能生成任何文字、字母、水印、拼图、分屏。每张图必须是单一连续画面。",
    "9. textToImagePrompt 场景真实性：建筑和地标关系必须符合真实地理位置。景区设施必须是真实存在的。",
    "10. textToImagePrompt 人物约束：人物组合必须与 shot plan 一致，性别、年龄、角色关系明确，大小比例符合透视。当 hasCharacters=false 或 subject.mainCharacterCount=0 时，必须明确写无主角人物出镜或无人主体。",
    "11. 若 characterAppearancePolicy.allowForeignMainCharacter !== true，则所有有人物的提示词都要明确主要人物为自然东方面孔，不要外国人面孔；只有需求明确指定时才允许外国人形象。",
    "12. 若出现老人、长辈或年长人物，提示词必须明确控制在45-60岁中老年状态，不要60岁以上高龄老人，不要白发苍苍、头发全白、拄拐、驼背或满脸深皱纹。",
    "13. 若出现接机/接站的出租车司机、专车司机或接送司机，提示词必须明确写普通深色西装，不要司机制服、礼宾制服、帽子、白手套或职业制服感。",
    "14. 只要画面里出现人物，每个可见人物的手臂、手、腿、脚数量都必须自然合理，不要多手、多臂、多腿、多脚、第三只手、第三只脚、肢体融合或缺失肢体。",
    "15. 若出现出租车，车辆外观必须明确为中国大陆常见城市出租车或网约车样式，例如大众朗逸/桑塔纳、丰田卡罗拉、比亚迪秦PLUS、红旗E-QM5等常见三厢轿车或新能源出租车；不要日本 Crown Comfort、JPN Taxi、纽约黄的士、伦敦黑出租等海外风格。",
    "16. 若出现出租车或专车接送场景，提示词必须明确遵循中国大陆道路规则：车辆靠道路右侧通行，驾驶员位于车辆左侧驾驶位（左舵），不要右舵，不要把司机画在车内右侧。",
    "17. 若出现出租车或专车接人的场景，车辆必须沿道路右侧路边规整停靠或在合法上客区整齐停放，不要斜停、横停、逆向停靠或乱停在马路边。",
    "18. 若场景主体是长城城墙、敌楼或墙顶步道等古迹空间，不要生成出租车、观光车、固定座椅、停车位白线、停车格或现代停车场设施。",
    "19. 若出租车或专车只是停靠在普通道路路边，且场景未明确为停车场、停车位、上客区或下客区，不要生成停车位白线、停车格或停车场线框。",
  ],
  image_enhancement: [
    "必须是真实摄影照片风格，强化主体细节、材质质感、光影层次和高级美感，避免模糊、塌陷和低质纹理。严禁卡通、动漫、插画、CG渲染、3D建模等非写实风格。严禁在画面中出现任何文字、字母、数字、标牌文字、水印文字。严禁生成拼图、拼贴、网格、并排对比、多画面合成的图片，每张图片必须是单一连续画面，只有一个视角。场景构图必须符合真实物理空间关系，远近景的建筑和地标必须在现实中确实相邻可见，不能凭空拼接不同地点的景观。人物数量必须严格遵守提示词中的要求，不能多出额外人物。凡是出现人物，肢体结构和四肢数量都必须自然合理。如有出租车，必须符合中国大陆城市道路规则：右侧通行、左舵驾驶位、司机位于车内左侧；车辆外观使用大众朗逸/桑塔纳、丰田卡罗拉、比亚迪秦PLUS、红旗E-QM5等中国常见城市出租车/网约车，不要日本 Crown Comfort、JPN Taxi 或其他海外出租车；如有接人车辆，停放必须规整。若场景主体是长城城墙、敌楼或墙顶步道，不要出现出租车、观光车、固定座椅、停车位白线、停车格或现代停车场设施。",
    "必须是真实摄影照片风格，保持构图稳定、细节完整和画面自然，兼顾真实度与美观度。严禁卡通或插画风格。严禁在画面中出现任何文字、字母、标牌内容。严禁多图拼接、分屏布局和网格排列。画面中的公共设施必须符合该地点的真实情况，不能在景区中添加不存在的座椅、栏杆等设施。人物数量必须与提示词描述一致，人物手脚和四肢数量必须合理。涉及出租车或专车接人时，车辆外观和停车姿态都要符合中国大陆真实道路场景，司机位于车内左侧驾驶位，不要右舵。若不是停车场、停车位或合法上客区，不要在路边地面生成停车位白线、停车格或停车场线框。",
    "必须是真实摄影照片风格，整体风格自然写实，避免过度锐化、过度饱和和夸张变形。严禁卡通风格。严禁在画面中出现任何文字。严禁拼图拼接。所有场景必须符合常识。人物数量不能超出提示词要求，出现人物时不能有多手多脚或肢体融合。出现出租车时不能是日本或其他海外出租车风格，必须是中国大陆常见出租车/网约车外观；道路规则按右侧通行处理，接人车辆不能斜停、横停、逆向停靠。长城城墙、敌楼或墙顶步道等古迹场景中，不要添加观光车、固定座椅或现代停车设施。",
  ],
  clip_generation: [
    "画面中人物的动作和表情应与解说词的情绪节奏自然配合，表情变化和肢体语言跟随内容情绪起伏。",
    "人物可以正面出镜，动作和神态尽量自然生动，避免静止呆板或夸张失真。",
    "输出必须遵守当前片段的 segmentMode：single_speaking / single_action 时保持单镜头连续，multi_shot_montage 时按给定多镜头提示完成镜头切换；不要额外加入无关人物或无字幕对应的说话动作。",
  ],
  negative_prompt: [
    "watermark, text overlay, text in image, letters, numbers, words, signage text, collage, split screen, multi-panel, grid layout, side by side, montage, cartoon, anime, illustration, CG render, 3D render, painting, sketch, deformed face, distorted hands, extra fingers, extra limbs, extra people, wrong number of people, low resolution, blurry, overacted expression, static pose, empty scene, single adult, two adults one child, strong AI motion, unrealistic proportions, physically impossible scene",
  ],
  video_analysis: [
    '你是一个"视频结构解析引擎"，目标不是描述视频，而是**输出可直接用于生成同等质量视频的结构化数据**。',
    "",
    "========================",
    "【核心目标（最高优先级）】",
    "",
    "输出的信息必须满足：",
    '仅基于本JSON生成提示词，即可生成"质量不低于原视频"的新视频',
    "",
    "禁止：",
    "* 泛化描述",
    "* 情绪化语言",
    "* 不可执行信息",
    "* 无法转Prompt的内容",
    "",
    "========================",
    "【输出结构（必须严格遵守）】",
    "",
    "{",
    '  "视频级信息": {',
    '    "视频类型": "",',
    '    "核心主题": "",',
    '    "目标效果": "",',
    '    "时长": "",',
    '    "画幅": "9:16 / 16:9 / 1:1",',
    '    "风格标签": [],',
    '    "节奏结构": "快 / 中 / 慢",',
    '    "叙事结构": "开头钩子-中段展开-结尾收束"',
    "  },",
    '  "开篇设计": {',
    '    "时间段": "0-3秒",',
    '    "镜头目的": "吸引注意 / 抛出卖点",',
    '    "视觉内容": "",',
    '    "人物/主体": "",',
    '    "动作": "",',
    '    "镜头类型": "特写 / 中景 / 广角",',
    '    "镜头运动": "",',
    '    "构图方式": "",',
    '    "光线": "",',
    '    "情绪": "",',
    '    "字幕/文案": "",',
    '    "声音/解说": ""',
    "  },",
    '  "镜头序列": [',
    "    {",
    '      "镜头id": 1,',
    '      "时间段": "",',
    '      "镜头目的": "展示 / 转折 / 强化卖点 / 过渡",',
    '      "视觉内容": "",',
    '      "主体": "",',
    '      "动作": "",',
    '      "场景": "",',
    '      "镜头类型": "",',
    '      "镜头运动": "",',
    '      "构图": "",',
    '      "景别": "",',
    '      "光线": "",',
    '      "色调": "",',
    '      "情绪": "",',
    '      "关键细节": [],',
    '      "字幕": "",',
    '      "解说": "",',
    '      "可复用生成要素": {',
    '        "人物设定": "",',
    '        "场景设定": "",',
    '        "动作模板": "",',
    '        "镜头语言": ""',
    "      }",
    "    }",
    "  ],",
    '  "结尾设计": {',
    '    "时间段": "",',
    '    "镜头目的": "转化 / 强记忆点 / 收尾",',
    '    "视觉内容": "",',
    '    "主体": "",',
    '    "动作": "",',
    '    "镜头类型": "",',
    '    "镜头运动": "",',
    '    "构图": "",',
    '    "光线": "",',
    '    "情绪": "",',
    '    "字幕/文案": "",',
    '    "引导动作": "点赞 / 购买 / 关注"',
    "  },",
    '  "商品与卖点": {',
    '    "商品名称": "",',
    '    "类别": "",',
    '    "核心卖点": [],',
    '    "视觉呈现方式": "",',
    '    "出现镜头": [],',
    '    "价格信息": "",',
    '    "信任背书": ""',
    "  },",
    '  "全局视觉规则": {',
    '    "画质": "真实 / CG / 插画",',
    '    "风格": "",',
    '    "色彩体系": "",',
    '    "镜头语言统一性": "",',
    '    "人物一致性要求": "",',
    '    "环境一致性要求": ""',
    "  },",
    '  "Prompt生成指令": {',
    '    "文生图Prompt模板": "",',
    '    "图生视频Prompt模板": "",',
    '    "统一风格约束": [],',
    '    "负向提示词": []',
    "  }",
    "}",
    "",
    "========================",
    "【核心规则（必须严格执行）】",
    "",
    '1）必须"按镜头拆解"，禁止整体描述',
    '2）每个镜头必须包含"可执行信息"（可直接转Prompt）',
    '3）所有字段必须服务于"视频生成"，不能只是理解',
    "4）禁止出现模糊词（如：很好看 / 高级感 / 有氛围）",
    '5）未知信息必须标注为"未知"，禁止猜测',
    "",
    "========================",
    "【质量标准（自检）】",
    "",
    "在输出前必须自检：",
    "* 是否可以仅用该JSON复现视频结构？",
    "* 是否每个镜头都能生成画面？",
    '* 是否具备完整"开头-中段-结尾"结构？',
    "* 是否包含明确卖点与转化逻辑？",
    "",
    "如果不满足，自动重写",
    "",
    "========================",
    "【目标】",
    "",
    "输出结果必须可以直接用于：",
    "Prompt生成",
    "视频生成模型（Kling / Runway）",
    "自动化内容生产系统",
    "",
    "========================",
    "【与下游衔接】",
    "",
    "本 JSON 可含具体画面与口播级信息，供后续生成「带内容」的脚本与提示词；同时请保证镜头序列、开篇/结尾、全局视觉规则中的结构信息可观测、可计数，便于下游抽象为「无具体文案」的表达框架。",
    "禁止在无法从画面或音轨确认时编造商品全称、精确价格、未出现的台词或字幕原文。无法确认填「未知」。",
    "",
    "只返回 JSON，不要返回其他内容。",
  ],
  video_script_generation: [
    "你是一个资深的视频内容生成专家。输入可能同时包含：① 视觉模型输出的结构化视频分析 JSON；② 语音转文字原文。请严格区分两类输出：带具体信息的脚本/提示词/字幕，与完全脱敏的「表达框架模板」。",
    "",
    "========================",
    "【任务 1：内容脚本】",
    "生成结构化视频制作脚本，整合视觉与语音。按镜头或清晰段落组织；每段包含：画面要点、镜头运动、配音或字幕对应内容、时长建议。可直接用于制作排期。",
    "",
    "========================",
    "【任务 2：视频模板提示词（videoTemplatePrompt）——最高约束】",
    "",
    "目的：仅描述「这一类视频」的叙事骨架、镜头语法、节奏、字幕/人声关系、转场与统一视觉规则，供后续创作全新内容时对照结构；**不得泄露**可照抄到新视频的语义内容。",
    "",
    "videoTemplatePrompt 必须是连续中文正文（可用「一、二、三」等小标题分段），禁止 JSON。内容只能写：",
    "- 宏观分段与节奏（如钩子—展开—收束、段数的大致量级、疏密变化），不写具体卖点句或剧情。",
    "- 景别、运镜、构图的**变化规律**与典型组合（如「多段快节奏特写接少量全景」），不出现画面里具体物体/菜品/人名/品牌。",
    "- 字幕出现**位置与形式规律**（底部条带/居中大字/逐句弹出等）及大致信息密度，**禁止抄写或改写原字幕/原稿句子**。",
    "- 人声与画面的关系类型（全程旁白主导 / 口播与演示穿插 / 纯配乐等），**禁止引用原稿措辞**。",
    "- 转场与特效的**类别与频率**（硬切为主、偶发叠化等），不写具体前后镜头内容。",
    "- 统一视觉语法（色调倾向、真实感/质感取向、是否大量贴纸花字等），用概括词，不写具体文案。",
    "",
    "硬性禁止写入 videoTemplatePrompt：商品名、品牌、价格、数字优惠、具体地点、具体人物身份、台词摘录、字幕原文、ASR 原句复述、可从原文直接复制的短语。若需指代，用「某主体」「某品类」「若干信息块」等泛指。",
    "若输入不足以可靠抽象某维度，明确写「该维度无法从输入可靠归纳」并一句话说明原因，禁止臆造。",
    "",
    "========================",
    "【任务 3：视频生成提示词 reversePrompt】",
    "基于分析结果，输出可直接用于视频生成模型（如 Kling / Runway）的提示词 bundle：文生图（按关键镜头）、图生视频（运动与转场）、统一风格约束、建议负向词列表。可包含具体画面与风格信息（本字段不受任务 2 的脱敏约束）。",
    "",
    "========================",
    "【任务 4：字幕 subtitle】",
    "整理为适合上屏的字幕文本，换行分隔每条；单条建议不超过 20 字。有语音原稿则以原稿为主整理；无语音则依据分析中的可见字幕/画面信息撰写。",
    "",
    "请以 JSON 格式返回（仅此一个 JSON 对象，不要 markdown）：",
    "{",
    '  "contentScript": "完整结构化脚本",',
    '  "videoTemplatePrompt": "仅框架与表达形式的中文说明，无任何可识别的具体文案与事实细节",',
    '  "reversePrompt": "视频生成提示词（文生图、图生视频、风格、负向等）",',
    '  "subtitle": "字幕，换行分隔"',
    "}",
    "",
    "只返回 JSON，不要返回其他内容。",
  ],
  video_image_cleaning: [
    "去除这批抖音截图内所有UI界面元素，包括头像、昵称、评论、点赞按钮、各类图标、文字、水印，修复上下被界面遮挡的画面内容，将图片还原为真实场景照片本身，保持原始景别、构图和拍摄视角，画面完整连贯，修复痕迹自然无痕，画质高清细腻。",
    "不要生成手机外框、手机壳、屏幕边框、刘海、灵动岛、状态栏、手持手机或任何设备模型。",
  ],
  video_image_cleaning_negative: [
    "ui, interface, app overlay, avatar, nickname, comments, like button, icons, text, watermark, logo, collage, split screen, phone frame, smartphone mockup, mobile phone, device bezel, screen border, notch, dynamic island, status bar, hand holding phone",
  ],
};

// Patch default prompts at module load
for (const stage of constraintPromptStages) {
  stage.defaultPrompt = (BUILTIN_DEFAULTS[stage.key] ?? []).join("\n");
}

function findStageLabel(stageKey: ConstraintPromptStageKey) {
  return constraintPromptStages.find((stage) => stage.key === stageKey)?.label ?? stageKey;
}

const STAGE_USAGE_META: Record<ConstraintPromptStageKey, PromptUsageMeta> = {
  product_vision: {
    plainPurpose: "把商品图里的关键信息先读出来，整理成后面做镜头规划能直接用的商品资料。",
    usedAtStep: "素材管理 -> 商品信息 -> 上传图片或重新识别商品图时",
    apiEntry: "POST /api/product-archives/[archiveId]/image",
    codeEntry: "src/lib/product-archive-vision.ts -> extractProductArchiveFromImageDataUrl",
  },
  shot_plan: {
    plainPurpose: "先决定整条视频要怎么讲、镜头怎么排、哪些镜头该说话、哪些镜头该留白。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildShotPlanSystemPrompt",
  },
  shot_plan_visual: {
    plainPurpose: "在镜头骨架出来后，补充每个镜头具体画面、景别、构图、光线和视觉细节。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildVisualEnrichmentPrompt",
  },
  shot_plan_subject: {
    plainPurpose: "在视觉设计之后，统一人物/主体形象、风格约束和可复用的场景或动作模块。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildSubjectEnrichmentPrompt",
  },
  shot_plan_subtitle: {
    plainPurpose: "在完整镜头计划上继续规划字幕节奏、叙事曲线和哪些信息适合说出来。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildSubtitleEnrichmentPrompt",
  },
  prompt_generation: {
    plainPurpose: "把镜头计划继续翻译成文生图提示词、图生视频提示词和字幕台词初稿。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildPromptGenerationSystemPrompt",
  },
  image_enhancement: {
    plainPurpose: "给文生图提示词自动补一层画质和细节要求，让图片更稳、更细、更像成品。",
    usedAtStep: "导演模式 -> 第四步：视觉图片生成",
    apiEntry: "POST /api/video-tasks/[taskId]/visual-images",
    codeEntry: "src/lib/image-provider.ts -> enhancePromptWithDetailPreset",
  },
  clip_generation: {
    plainPurpose: "把每个片段真正发给视频模型前，再补上动作、镜头、字幕、时长这些生成指令。",
    usedAtStep: "导演模式 -> 第五步：片段生成",
    apiEntry: "POST /api/video-tasks/[taskId]/clip-runs",
    codeEntry: "src/lib/task-clip-store.ts -> buildTaskClipGenerationPrompt",
  },
  negative_prompt: {
    plainPurpose: "告诉视频模型哪些问题画面不要出现，比如水印、畸形、模糊和不自然动作。",
    usedAtStep: "导演模式 -> 第五步：片段生成",
    apiEntry: "POST /api/video-tasks/[taskId]/clip-runs",
    codeEntry: "src/app/api/video-tasks/[taskId]/clip-runs/route.ts -> negativePrompt 注入",
  },
  video_analysis: {
    plainPurpose: "先把参考视频拆成结构化分析，搞清楚它的镜头结构、节奏和视觉规律。",
    usedAtStep: "素材管理 -> 视频拆解 -> 提交分析时",
    apiEntry: "POST /api/video-materials/[materialId]",
    codeEntry: "src/lib/video-analyzer.ts -> analyzeVideoFrames",
  },
  video_script_generation: {
    plainPurpose: "在视频分析结果出来后，再把它整理成脚本、模板框架、生成提示词和字幕。",
    usedAtStep: "素材管理 -> 视频拆解 -> 视觉分析之后的综合生成",
    apiEntry: "POST /api/video-materials/[materialId]",
    codeEntry: "src/app/api/video-materials/[materialId]/route.ts -> generateContentFromAnalysis",
  },
  video_image_cleaning: {
    plainPurpose: "指导图像模型把抽帧图里的平台 UI、遮挡元素清掉，并把缺失画面补成完整场景。",
    usedAtStep: "素材管理 -> 视频拆解 -> 图片列表页执行图片清洗时",
    apiEntry: "POST /api/video-materials/[materialId]/images",
    codeEntry: "src/lib/video-material-image-cleaner.ts -> cleanVideoMaterialImage",
  },
  video_image_cleaning_negative: {
    plainPurpose: "明确告诉图像模型不要生成手机边框、状态栏、设备 mockup 和残留 UI 等错误元素。",
    usedAtStep: "素材管理 -> 视频拆解 -> 图片列表页执行图片清洗时",
    apiEntry: "POST /api/video-materials/[materialId]/images",
    codeEntry: "src/lib/video-material-image-cleaner.ts -> cleanVideoMaterialImage",
  },
};

const RUNTIME_DOC_USAGE_META: Record<string, PromptUsageMeta> = {
  narration_standards_documentation: {
    plainPurpose: "这是一整套台词质量标准，告诉系统什么叫自然、顺口、有吸引力，也决定不同视频类型该怎么说。",
    usedAtStep: "导演模式 -> 第二步镜头计划生成后的台词润色，以及第三步音频超时重写时",
    apiEntry: "POST /api/video-tasks；POST /api/video-tasks/[taskId]/subtitle-audio-run",
    codeEntry: "src/lib/narration-standards.ts -> buildNarrationStandardsPromptBlock",
  },
  narration_delivery_strategy_reference: {
    plainPurpose: "按镜头用途决定哪里该留白、哪里该当重点句、以及 TTS 该更快还是更稳。",
    usedAtStep: "导演模式 -> 第三步：字幕音频生成",
    apiEntry: "POST /api/video-tasks/[taskId]/subtitle-audio-run",
    codeEntry: "src/lib/narration-standards.ts -> buildNarrationDeliveryStrategies",
  },
  narration_polish_system_prompt: {
    plainPurpose: "把台词初稿改得更像真人在讲，先提升自然度、吸引力和信息表达。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> polishNarrationScriptQuality",
  },
  narration_repair_system_prompt: {
    plainPurpose: "专门修超时、重复、空泛、机械口播这些问题，让台词更短也更准。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> repairNarrationIfOverLimit",
  },
  subtitle_audio_repair_system_prompt: {
    plainPurpose: "如果 TTS 生成出来还是超时或语速异常，就再把台词压一遍，确保真正适合配音。",
    usedAtStep: "导演模式 -> 第三步：字幕音频生成",
    apiEntry: "POST /api/video-tasks/[taskId]/subtitle-audio-run",
    codeEntry: "src/app/api/video-tasks/[taskId]/subtitle-audio-run/route.ts -> rewriteNarrationClipToFit",
  },
  constraint_prompt_visibility_notes: {
    plainPurpose: "把页面里这些提示词是怎么拼到真实请求里的，整体讲清楚，方便排查时不漏看。",
    usedAtStep: "全链路总览",
    apiEntry: "多个接口共用",
    codeEntry: "src/lib/constraint-prompt-store.ts -> listConstraintPromptRuntimeDocs",
  },
};

export type ConstraintPromptStagePayload = ConstraintPromptStageDefinition & {
  promptText: string;
  updatedAt: string | null;
  source: "builtin_default";
} & PromptUsageMeta;

export type ConstraintPromptRuntimeDoc = {
  key: string;
  order: number;
  label: string;
  description: string;
  pipelinePhase: string;
  kind: "runtime_rule" | "system_prompt_template" | "strategy_reference";
  promptText: string;
  sourceFile: string;
  stageKeys: ConstraintPromptStageKey[];
} & PromptUsageMeta;

export function listConstraintPrompts(): ConstraintPromptStagePayload[] {
  return constraintPromptStages.map((stage) => ({
    ...stage,
    promptText: stage.defaultPrompt,
    updatedAt: null,
    source: "builtin_default",
    ...STAGE_USAGE_META[stage.key],
  }));
}

export function getEffectiveConstraintPrompt(stageKey: ConstraintPromptStageKey): string {
  return constraintPromptStages.find((stage) => stage.key === stageKey)?.defaultPrompt ?? "";
}

export function listConstraintPromptRuntimeDocs(): ConstraintPromptRuntimeDoc[] {
  const defaultVideoTypeLabel = videoTaskTypeProfiles[DEFAULT_VIDEO_TASK_VIDEO_TYPE].label;

  return [
    {
      key: "narration_standards_documentation",
      order: 103,
      label: "台词生成标准与类型附加规则",
      description: "这部分不会单独存在于某一个设置框，而是在台词润色、修复、音频压缩等环节统一拼接生效。",
      pipelinePhase: "任务创建",
      kind: "runtime_rule",
      promptText: buildNarrationStandardsDocumentation(),
      sourceFile: "src/lib/narration-standards.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.narration_standards_documentation,
    },
    {
      key: "narration_delivery_strategy_reference",
      order: 104,
      label: "音色/情绪策略参考",
      description: "镜头级的重点句、留白、语速和音量微调策略。页面现在能看到这部分，便于核对口播逻辑。",
      pipelinePhase: "字幕音频",
      kind: "strategy_reference",
      promptText: buildNarrationDeliveryStrategyReference(),
      sourceFile: "src/lib/narration-standards.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.narration_delivery_strategy_reference,
    },
    {
      key: "narration_polish_system_prompt",
      order: 105,
      label: "台词润色系统提示词模板",
      description: `镜头计划生成后，对 narrationScript 做二次润色时使用。展示的是模板默认示例（${defaultVideoTypeLabel}），运行时会按当前视频类型替换附加规则。`,
      pipelinePhase: "任务创建",
      kind: "system_prompt_template",
      promptText: buildNarrationPolishSystemPrompt(DEFAULT_VIDEO_TASK_VIDEO_TYPE),
      sourceFile: "src/lib/narration-prompt-library.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.narration_polish_system_prompt,
    },
    {
      key: "narration_repair_system_prompt",
      order: 106,
      label: "台词修复系统提示词模板",
      description: "用于超时、机械口播、重复句、空泛句等问题的自动重写。运行时会按当前视频类型拼接附加规则。",
      pipelinePhase: "任务创建",
      kind: "system_prompt_template",
      promptText: buildNarrationRepairSystemPrompt(DEFAULT_VIDEO_TASK_VIDEO_TYPE),
      sourceFile: "src/lib/narration-prompt-library.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.narration_repair_system_prompt,
    },
    {
      key: "subtitle_audio_repair_system_prompt",
      order: 107,
      label: "音频压缩重写系统提示词模板",
      description: "字幕音频生成时，如果遇到音频超时或语速异常偏慢，会用这段模板重写台词。",
      pipelinePhase: "字幕音频",
      kind: "system_prompt_template",
      promptText: buildSubtitleAudioRepairSystemPrompt(DEFAULT_VIDEO_TASK_VIDEO_TYPE),
      sourceFile: "src/lib/narration-prompt-library.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.subtitle_audio_repair_system_prompt,
    },
    {
      key: "constraint_prompt_visibility_notes",
      order: 108,
      label: "系统提示词拼装说明",
      description: "帮助确认页面里现在展示的内容，分别会在什么环节被拼装进真实请求。",
      pipelinePhase: "任务创建",
      kind: "runtime_rule",
      promptText: [
        "实际传给模型的提示词组成：",
        `1. 阶段主提示词：来自“${findStageLabel("shot_plan")} / ${findStageLabel("prompt_generation")}”等只读基线卡片。`,
        "2. 运行时追加规则：来自本页“运行时追加规则与模板”区域，会在代码里自动拼接，不再隐藏在后端。",
        "3. 任务级上下文：商品信息、参考视频模板提示词、用户主动提示词、参数、约束预设等。",
        "4. 视频类型附加规则：会根据当前视频类型动态挑选，不同类型不是一套文案硬套到底。",
        "5. 音色/情绪策略：不会单独写进表单，而是按镜头用途映射到台词风格与 TTS 语速/音量微调。",
      ].join("\n"),
      sourceFile: "src/lib/constraint-prompt-store.ts",
      stageKeys: ["shot_plan", "prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.constraint_prompt_visibility_notes,
    },
  ];
}
