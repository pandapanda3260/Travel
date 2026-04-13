import { buildNarrationDeliveryStrategyReference, buildNarrationStandardsDocumentation } from "./narration-standards";
import {
  buildNarrationPolishSystemPrompt,
  buildNarrationRepairSystemPrompt,
  buildSubtitleAudioRepairSystemPrompt,
} from "./narration-prompt-library";
import { PROMPT_GENERATION_RUNTIME_HARD_RULES, SHOT_PLAN_RUNTIME_HARD_RULES } from "./prompt-runtime-library";
import { DEFAULT_VIDEO_TASK_VIDEO_TYPE, videoTaskTypeProfiles } from "./video-task-schema";

export type ConstraintPromptStageKey =
  | "product_vision"
  | "shot_plan"
  | "prompt_generation"
  | "image_enhancement"
  | "clip_generation"
  | "negative_prompt"
  | "video_analysis"
  | "video_script_generation";

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
    "你是一名短视频导演，请根据商品信息、用户提示词和参数，输出一份结构化的镜头计划表（shot plan）。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "JSON 结构：{ globalStyle, totalDurationSeconds, shots: [{ shotIndex, purpose, location, hasCharacters, characters, hasTalent, talentCaptureMode, hasVoice, hasSubtitle, requiresLipSync, action, emotion, cameraMovement, durationSeconds, sceneDescription, narrationHint }] }",
    "",
    "字段说明：",
    "- globalStyle：整体视觉风格，一句话概括",
    "- shots.shotIndex：从 1 开始的镜头编号",
    "- shots.purpose：镜头目的，如 hook / experience / detail / transition / climax / closing",
    "- shots.location：拍摄地点或场景描述",
    "- shots.hasCharacters：该镜头是否有人物出镜（布尔值）",
    '- shots.characters：出镜人物列表，如 ["father", "mother", "child_1"]，无人物时为空数组',
    "- shots.hasVoice：该镜头是否需要承担口播信息；混剪类视频不要默认每镜都为 true",
    "- shots.hasSubtitle：该镜头是否需要承载字幕；无台词留白镜头可与 hasVoice 一起为 false",
    "- shots.action：人物或画面的具体动作描述，要具体不要笼统",
    "- shots.emotion：该镜头的情绪氛围",
    "- shots.cameraMovement：运镜方式",
    "- shots.durationSeconds：该镜头时长（秒），必须为正整数",
    "- shots.sceneDescription：画面内容的完整描述，用于后续生成图片和视频提示词",
    "- shots.narrationHint：仅对 hasVoice/hasSubtitle=true 的镜头填写要点；无台词镜头留空",
    "",
    "通用规则：",
    "1. shots 数量必须严格等于参数中的 plannedStoryShotCount。",
    "2. 所有镜头的 durationSeconds 总和必须与参数 totalDurationSeconds 保持一致或近似一致，允许不同镜头时长不同。",
    "3. 每个镜头是否需要人物、出镜几个人，根据该镜头的具体场景和叙事需要逐个判断。",
    "4. 人物动作描述要具体生动，避免静态呆板。",
    "5. narrationHint 只写要点，不要写完整的解说词句子，字数控制在 15 字以内。",
    "6. 第一个镜头（hook）应该在 3 秒内建立吸引力。",
    "7. 若结构化上下文里带有 itineraryDayCount / segmentBlueprint，旅行攻略类视频要优先按“钩子—按天展开—收尾”来组织，不要机械平均分配段落。",
    "8. 混剪类视频必须先判断哪些镜头需要口播，哪些镜头应该留白；至少保留部分纯画面镜头，不要每个镜头都硬塞台词。",
    "9. 开场和收尾通常需要承担口播，detail / transition 镜头通常更适合留白或只服务画面节奏。",
    "10. narrationHint 要指向“该句该抓什么重点、用什么情绪讲、是否要承接上一镜头”，不能只写一个空泛形容词。",
    "11. 攻略类 narrationHint 优先写结论、理由、价值点；景色类优先写为什么美、为什么让人想停下来；人物口播类优先写交流感。",
  ],
  prompt_generation: [
    "你是一名短视频生产链路的提示词专家，请根据镜头计划表（shot plan）生成三份内容。",
    "输出必须是 JSON，不要输出 markdown，不要输出额外解释。",
    "JSON 结构：{ textToImagePrompt, imageToVideoPrompt, narrationScript }",
    "",
    "要求：",
    '1. textToImagePrompt：按规划镜头输出，每个镜头一段。格式为 "镜头1：...\\n镜头2：..."。每段必须基于对应镜头的 sceneDescription 展开，补充画幅方向、构图、光影、质感等文生图细节。',
    "2. imageToVideoPrompt：按规划镜头输出，格式同上。每段基于对应镜头的 action、cameraMovement、emotion 展开，描述运镜和动态效果。",
    '3. narrationScript：按规划镜头输出，格式严格为 "镜头1：...\\n镜头2：..."。若该镜头的 hasVoice=false 且 hasSubtitle=false，则仍保留 "镜头N：" 前缀，但冒号后留空，不要硬写台词。',
    "4. 三份内容的镜头数量必须和 shot plan 中的 shots 数量完全一致；系统会在后续把多个规划镜头组合为最终输出片段。",
    "5. narrationScript 字数控制（最重要的硬约束）：只有需要口播/字幕的镜头才写台词。每段中文字符数（不含标点和空格）必须不超过 narrationCharacterBudget.maxCharacters，建议靠近 narrationCharacterBudget.suggestedCharacters。宁可更凝练，也不要超字数。",
    "6. narrationScript 写作规范：每段解说词就是最终的配音文本和字幕文本，必须是可以直接朗读的完整中文句子。禁止出现括号注释、角色标签、舞台指示、英文夹杂。",
    "7. 文风必须口语自然、像真人在带用户看行程，优先写“感受、体验、决策理由”，不要机械地反复写“第一天、第二天、第三天……”。",
    "8. 禁止句尾出现“哦”；禁止用任何标点结尾；禁止为了凑字数重复同义词。",
    "9. 旅行攻略类视频要优先从“用户为什么想去、当天最值的一点、收尾怎么促成行动”去写，不要像播报行程单。",
    "10. 每句尽量只表达一个核心意思，优先让观众一遍听懂，不要一句塞太多信息。",
    "11. 先服务镜头，再追求文字好看；快镜头更短更利落，慢镜头更舒展，强画面镜头允许少说一点。",
    "12. 镜头之间要有承接意识，相邻句开头不要高度重复，避免机器拼接感。",
    "13. 少说“非常不错、氛围很好、值得体验、真的很好看”这类空泛套话，要把具体亮点说出来。",
    "14. 禁止广告腔、AI 总结腔、过度营销词和过度煽情表达。",
  ],
  image_enhancement: [
    "强化主体细节、材质质感、光影层次和高级美感，避免模糊、塌陷和低质纹理。",
    "保持构图稳定、细节完整和画面自然，兼顾真实度与美观度。",
    "整体风格自然写实，避免过度锐化、过度饱和和夸张变形。",
  ],
  clip_generation: [
    "画面中人物的动作和表情应与解说词的情绪节奏自然配合，表情变化和肢体语言跟随内容情绪起伏。",
    "人物可以正面出镜，动作和神态尽量自然生动，避免静止呆板或夸张失真。",
    "输出必须遵守当前片段的 segmentMode：single_speaking / single_action 时保持单镜头连续，multi_shot_montage 时按给定多镜头提示完成镜头切换；不要额外加入无关人物或无字幕对应的说话动作。",
  ],
  negative_prompt: [
    "watermark, text overlay, deformed face, distorted hands, extra fingers, low resolution, blurry, overacted expression, static pose, empty scene, single adult, two adults one child, strong AI motion",
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
};

// Patch default prompts at module load
for (const stage of constraintPromptStages) {
  stage.defaultPrompt = (BUILTIN_DEFAULTS[stage.key] ?? []).join("\n");
}

function findStageLabel(stageKey: ConstraintPromptStageKey) {
  return constraintPromptStages.find((stage) => stage.key === stageKey)?.label ?? stageKey;
}

function formatNumberedRules(rules: readonly string[]) {
  return rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
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
};

const RUNTIME_DOC_USAGE_META: Record<string, PromptUsageMeta> = {
  shot_plan_runtime_hard_rules: {
    plainPurpose: "给镜头计划再加一层兜底要求，避免模型把 narrationHint 写空、把口播塞太满，或者留白判断跑偏。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildShotPlanSystemPrompt",
  },
  prompt_generation_runtime_hard_rules: {
    plainPurpose: "给台词和提示词初稿再加一层兜底要求，拦住机械口播、空泛套话和重复句式。",
    usedAtStep: "导演模式 -> 第二步：镜头计划生成",
    apiEntry: "POST /api/video-tasks",
    codeEntry: "src/lib/video-task-planner.ts -> buildPromptGenerationSystemPrompt",
  },
  narration_standards_documentation: {
    plainPurpose: "这是一整套台词质量标准，告诉系统什么叫自然、顺口、有吸引力，也决定不同视频类型该怎么说。",
    usedAtStep: "导演模式 -> 第二步镜头计划生成后的台词润色，以及第三步音频超时重写时",
    apiEntry: "POST /api/video-tasks；POST /api/video-tasks/[taskId]/subtitle-audio-run",
    codeEntry: "src/lib/narration-standards.ts -> buildNarrationStandardsPromptBlock",
  },
  narration_delivery_strategy_reference: {
    plainPurpose: "按镜头用途决定哪里该留白、哪里该当重点句、以及 TTS 该更快还是更稳。",
    usedAtStep: "导演模式 -> 第三步：音频字幕生成",
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
    usedAtStep: "导演模式 -> 第三步：音频字幕生成",
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
      key: "shot_plan_runtime_hard_rules",
      order: 101,
      label: "镜头计划运行时硬规则",
      description: "在镜头计划主提示词之后，后端固定追加的硬规则，用来收紧 narrationHint、留白和口播分布。",
      pipelinePhase: "任务创建",
      kind: "runtime_rule",
      promptText: ["镜头计划运行时硬规则：", formatNumberedRules(SHOT_PLAN_RUNTIME_HARD_RULES)].join("\n"),
      sourceFile: "src/lib/prompt-runtime-library.ts",
      stageKeys: ["shot_plan"],
      ...RUNTIME_DOC_USAGE_META.shot_plan_runtime_hard_rules,
    },
    {
      key: "prompt_generation_runtime_hard_rules",
      order: 102,
      label: "提示词生成运行时硬规则",
      description: "在提示词生成主提示词之后，后端固定追加的硬规则，用来限制台词质量、留白和重复表达。",
      pipelinePhase: "任务创建",
      kind: "runtime_rule",
      promptText: ["提示词生成运行时硬规则：", formatNumberedRules(PROMPT_GENERATION_RUNTIME_HARD_RULES)].join("\n"),
      sourceFile: "src/lib/prompt-runtime-library.ts",
      stageKeys: ["prompt_generation"],
      ...RUNTIME_DOC_USAGE_META.prompt_generation_runtime_hard_rules,
    },
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
