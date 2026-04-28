import { videoTaskTypeProfiles, type VideoTaskVideoType } from "./video-task-schema";

export type VideoTypePromptStage =
	| "shot_plan"
	| "shot_plan_visual"
	| "shot_plan_subject"
	| "shot_plan_subtitle"
	| "prompt_generation"
	| "clip_generation"
	| "narration";

export const VIDEO_TYPE_PROMPT_STAGE_ORDER: VideoTypePromptStage[] = [
	"shot_plan",
	"shot_plan_visual",
	"shot_plan_subject",
	"shot_plan_subtitle",
	"prompt_generation",
	"clip_generation",
	"narration",
];

export type VideoTypePromptConfig = {
	key: VideoTaskVideoType;
	label: string;
	categoryPrompts: Partial<Record<VideoTypePromptStage, string>>;
	addonPrompts: Partial<Record<VideoTypePromptStage, string>>;
};

// ---------------------------------------------------------------------------
// 分类提示词：每个视频类型在各 pipeline stage 的专属规则
// ---------------------------------------------------------------------------

const AGENCY_GUIDE_VOICEOVER_CATEGORY: Partial<Record<VideoTypePromptStage, string>> = {
	shot_plan: [
		"",
		"【旅行社-攻略-空镜旁白 分类规则】",
		"本类型视频结构为：开篇片段 → 按天/主题的行程片段 → 收尾片段。",
		"每个「片段」对应一次视频生成调用（Seedance 2.0），片段时长限制 4~7 秒。",
		"一个片段内包含 1~3 个镜头（景点），多个镜头共享一段连贯的旁白。",
		"",
		"旅行社-攻略类片段归属与时长规则：",
		"1. 旅行社-攻略-空镜旁白 的每个镜头都必须通过 segmentIndex/segmentId 归属到开篇片段、行程片段或收尾片段；同一片段内镜头按 shotIndex 递增排列、时间连续且不重叠。",
		"2. 旅行社-攻略-空镜旁白 的片段时长 = 该片段所含镜头 durationSeconds 之和，限制 4~7 秒；totalDurationSeconds = 全部镜头 durationSeconds 之和。",
		"3. 旅行社-攻略-空镜旁白 的单个镜头时长按信息量弹性设计：开场/钩子镜头通常 2.5~5.5 秒，行程主体镜头通常 3~6 秒，细节/转场通常 1~2.5 秒，收尾镜头按总结或行动引导的信息量设计为 2.5~5.5 秒；不要把整条攻略视频机械写成同一时长。",
		"",
		"片段功能建议：",
		"- 开篇片段优先做成短促利落的钩子段，通常 4~6 秒，信息极少时可略短，但整段仍需服从 4~7 秒片段总规则。",
		"- 行程片段通常对应一天行程或一个主题（如美食、景点、酒店），每段 4~7 秒，包含 1~3 个镜头。",
		"- 收尾片段优先做成简洁收束段，通常 4~6 秒，可按总结或行动引导的信息量上下浮动，但整段仍需服从 4~7 秒片段总规则。",
		"- 时长要随内容节奏变化：景点全景通常 3~6 秒、细节特写通常 1.5~4 秒、美食或体验镜头通常 2.5~5.5 秒。",
		"",
		"镜头计划 JSON 中的每个 shot 必须带有 segmentId（如 segment-1）和 segmentIndex（从 1 开始），",
		"同一个 segmentId 下的 shots 将在生成阶段被合并为一个片段。",
		"开篇 segmentIndex=1，行程片段 segmentIndex=2,3,...，收尾 segmentIndex=最后一个。",
		"",
		"旁白分配：",
		"- 每个片段写一段完整的旁白（不是每个镜头单独写）。",
		"- narrationHint 仍然按镜头填写，但同一片段内的 hints 应该能自然串成一段流畅的旁白。",
		"- 开篇和收尾片段的旁白要分别有钩子感和收束感。",
		"- 行程片段的旁白像真人边看边讲，自然过渡，不机械播报「第几天去哪」。",
		"- 人物出镜策略：本类型默认无主角。大多数镜头应为纯景色/景点/环境展示，只有和真实体验强相关的镜头才允许人物短暂点缀出镜。",
		"- 全片“有人物主体”的镜头数量不得超过总镜头数的 20%。普通地标、建筑、环境、设施、美食、夜景镜头默认不要主角人物。",
		"- 不要为整条视频建立统一主角锚点；如果确实有少量人物镜头，也只是体验参照，不是连续出镜的主角。",
		"- 允许人物的典型场景只限：入住办理、服务互动、亲子体验、项目体验、交通乘坐、用餐品尝、真实打卡互动。",
		"- 普通景点全景、建筑外观、夜景、环境空镜、菜品特写、设施展示镜头，一律优先纯景色表达。",
		"",
		"字幕规划（subtitlePlan）专属规则：",
		"- 本类型的字幕以片段为单位，每个片段只输出 1 条字幕，不要拆成多条。",
		"- 开篇片段：1 条字幕覆盖整个片段，字幕要有钩子感。",
		"- 行程片段：即使包含 2~3 个镜头，也必须用 1 条字幕覆盖该片段内所有镜头。",
		"- 收尾片段：1 条字幕覆盖整个片段，要有收束感或行动引导。",
		"- 纯景色过渡镜头（detail / transition）可以不配字幕，让画面自己说话。",
		"- 字幕内容必须口语自然、可直接朗读，同时要考虑后续 TTS 配音的流畅度和时间匹配。",
		"- 字幕要跟画面一一对应：当前片段展示哪个景点/玩法，就说哪个景点/玩法，不能跨镜头乱讲。",
	].join("\n"),

	shot_plan_visual: [
		"",
		"【旅行社-攻略-空镜旁白 视觉设计规则】",
		"本步骤只补 visual / cinematography / structure 字段，不要重复改写片段时长、旁白分配或 subtitlePlan。",
		"大多数镜头的第一主体必须是景点、建筑、环境、设施或菜品本身，普通景色镜头不要设计成人像写真构图。",
		"同一片段内的 1~3 个镜头要形成自然推进：优先从环境建立到玩法/细节，或从大场景推进到关键体验点。",
		"若某镜允许人物点缀出镜，人物也应只占小比例，不居中长期停留，不压过景点主体。",
	].join("\n"),

	shot_plan_subject: [
		"",
		"【旅行社-攻略-空镜旁白 人物与主体规则】",
		"本类型默认无主角，大多数镜头的 subject.mainCharacterCount 应为 0。",
		"不要为了统一人物一致性而强行给整条视频建立一个连续出镜的旅行者主角；如果人物镜头极少，reusableModules.characterSetting 可以为空。",
		"允许人物的镜头仅限真实体验强相关场景，人物只作体验参照，不抢景点主体。",
		"若出现人物，位置和尺度应服务景点展示：远景人物更小，中景点缀互动，避免大头近景和写真感占满画面。",
	].join("\n"),

	shot_plan_subtitle: [
		"",
		"【旅行社-攻略-空镜旁白 字幕规划规则】",
		"本类型的 subtitlePlan 以片段为单位组织；每个片段只输出 1 条字幕，覆盖该片段完整时长，不要拆成多条。",
		"开篇片段通常 1 条字幕覆盖全段，要有钩子感；收尾片段通常 1 条字幕覆盖全段，要有收束感或行动引导。",
		"2~3 个镜头的行程片段，也必须保持一段连贯口播；字幕文本按 coveredShotIndexes 的画面顺序自然串联。",
		"纯景色过渡镜头可以不配字幕；字幕内容必须顺着 coveredShotIndexes 对应画面自然推进，不能提前剧透后一个镜头。",
	].join("\n"),

	prompt_generation: [
		"",
		"【旅行社-攻略-空镜旁白 分类规则】",
		'narrationScript 必须按片段输出，格式为 "片段1：...\n片段2：..."。',
		"每个片段的旁白是完整的一段话，覆盖该片段内所有镜头，不要按镜头拆开。",
		"旁白将通过 TTS 单独生成配音，再在合成阶段与视频合并，因此：",
		"1. 旁白文本必须是可以直接朗读的自然口语。",
		"2. 片段内的旁白应该配合镜头切换节奏，前半段描述前面的景点，后半段过渡到后面的景点。",
			"3. 每段旁白只要保证朗读不超出片段时长即可；优先参考上下文里的 segmentNarrationBudgets / referenceMaxCharacters，但预算只是参考，不要为了卡字数牺牲信息质量。没有预算信息时，按当前片段的真实时长做宽松估算，更重要的是自然完整、信息贴画面。",
		"4. 同一片段内如果前后镜头内容不同，旁白也要顺着画面推进，先讲前半段在播什么，再自然过渡到后半段。",
		"",
		"textToImagePrompt 和 imageToVideoPrompt 仍按镜头输出，但编号改为片段内的子镜头：",
		'如 "片段1-镜头1：...\n片段1-镜头2：...\n片段2-镜头1：..."',
		"其中 textToImagePrompt 必须有明确的人物稀疏策略：全片带可识别主体人物的镜头总数不得超过 20%，其余镜头要明确写无人主体、景点/环境是主角。",
	].join("\n"),

	clip_generation: [
		"",
		"【片段生成规则】",
		"本片段使用 Seedance 2.0 通过参考图片生成纯画面视频（不含音频）。",
		"提示词中使用 @image1 引用参考图片。",
		"音频（旁白/配音）由后续 TTS 环节单独生成，再在合成阶段与视频合并。",
		"提示词应描述：镜头之间的过渡方式、整体节奏感、画面氛围。",
	].join("\n"),

	narration: [
		"",
		"【旁白/配音要求】",
		"旁白将通过 TTS 单独生成配音，再在合成阶段与视频合并。",
		"因此旁白必须满足以下格式：",
		"1. 语句必须口语自然，适合朗读。",
		"2. 不要使用括号、注释、标题格式。",
		"3. 每个片段只有一段旁白，不要按镜头拆分。",
		"4. 优先说用户真正关心的决策信息和体验亮点，不要写成机械行程播报。",
	].join("\n"),
};

// ---------------------------------------------------------------------------
// 追加提示词：每个视频类型的运行时硬规则、质量底线
// ---------------------------------------------------------------------------

const AGENCY_GUIDE_VOICEOVER_ADDON: Partial<Record<VideoTypePromptStage, string>> = {
	shot_plan: [
		"",
		"【旅行社-攻略-空镜旁白 追加规则】",
		'1. narrationHint 必须给出具体表达方向，优先写用户收益、服务闭环、玩法差异或决策理由，不能只写"太值了/直接冲/更省力"这种空泛口号。',
		"2. 旅行攻略类镜头的 narrationHint 要像真人会说的话题点，而不是景点名简单罗列。",
		'3. narrationHint 要说明"这句该抓什么重点、用什么情绪去讲、是否需要承接上一镜头"，而不是只丢一个形容词。',
		"4. detail / transition 这类强画面镜头允许留白；不要默认每个镜头都塞 narrationHint。",
		"5. 开场 narrationHint 要有钩子感，收尾 narrationHint 要有收束感或行动感，中段 narrationHint 要把体验亮点或价值点讲具体。",
		"6. 画面人物控制：只有入住、服务互动、亲子体验、用餐、交通、项目体验等强相关场景才允许人物点缀出镜，其余镜头优先纯景色/景点。",
	].join("\n"),

	prompt_generation: [
		"",
		"【旅行社-攻略-空镜旁白 追加规则】",
		"1. narrationScript 是最终配音/字幕成稿，不是口号集，也不是机械行程单。",
		'2. 除开场外，不要连续用"第一天/第二天/Day1/Day2"开头，攻略类视频应像真人带看，而不是播报行程。',
		"3. textToImagePrompt 对无人物镜头必须明确写出：无主角人物出镜、仅景色景点展示、若有路人也只作远景点缀。",
		"4. 即使是允许人物的镜头，人物也只能作为体验点缀，不要抢景点主体，不要让人像写真感压过攻略信息。",
		"5. 不要把旅行攻略类默认写成“有一位旅行者全程带看”。如果不是强相关体验场景，直接按纯景点/纯环境图去写。",
		"6. 对允许人物的镜头，也要写清楚人物只占小比例、不居中、不做大特写；景点或环境仍然是第一主体。",
	].join("\n"),

	narration: [
		"",
		"【旅行社-攻略-空镜旁白 旁白追加规则】",
		"1. narrationScript 是最终配音/字幕成稿，不是口号集，也不是机械行程单。",
		'2. 除开场外，不要连续用"第一天/第二天/Day1/Day2"开头，攻略类视频应像真人带看，而不是播报行程。',
		"3. 同一片段跨多个景点或玩法时，要按画面推进顺序自然衔接，不要前后跳讲。",
	].join("\n"),
};

function buildScenicVoiceoverPromptCategory(input: {
	title: string;
	domainLabel: string;
	spaceExamples: string;
	characterRule: string;
	narrationRule: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 分类规则】`,
			`本类型视频结构以 ${input.domainLabel} 为主，通常组织为：开篇钩子 → 核心空间/主题片段 → 收尾片段。`,
			"每个「片段」对应一次视频生成调用（Seedance 2.0），片段时长限制 4~7 秒。",
			"一个片段内包含 1~3 个镜头，多个镜头共享一段连贯旁白。",
			"",
			"片段设计要求：",
			`1. 中段片段优先围绕 ${input.spaceExamples} 等主题组织，不要把不相关空间硬塞进同一段。`,
			"2. 每个镜头都必须通过 segmentIndex/segmentId 归属片段；同一片段内镜头按 shotIndex 递增、时间连续且不重叠。",
			"3. 片段时长 = 所含镜头 durationSeconds 之和，限制 4~7 秒；totalDurationSeconds = 全部镜头 durationSeconds 之和。",
			"4. 单个镜头时长按信息量弹性设计：建立空间通常 3~6 秒，细节特写通常 1.5~4 秒，体验/服务镜头通常 2.5~5.5 秒。",
			"",
			"旁白与人物策略：",
			"- narrationHint 仍按镜头填写，但同片段 hints 应能自然串成一段完整旁白。",
			`- ${input.characterRule}`,
			`- ${input.narrationRule}`,
			"",
			"字幕规划：",
			"- subtitlePlan 以片段为单位组织，每个片段只输出 1 条字幕，覆盖该片段完整时长。",
			"- 强画面细节镜头允许不配字幕，让空间质感自己说话。",
		].join("\n"),
		shot_plan_visual: [
			"",
			`【${input.title} 视觉设计规则】`,
			"本步骤只补 visual / cinematography / structure 字段，不要重复改写片段时长、旁白分配或 subtitlePlan。",
			`镜头主体优先是 ${input.spaceExamples} 对应的空间、设施、物件或氛围本身，不要随意拍成人像写真。`,
			"同一片段内优先从环境建立推进到重点细节，再落到体验或服务亮点。",
		].join("\n"),
		shot_plan_subject: [
			"",
			`【${input.title} 人物与主体规则】`,
			input.characterRule,
			"若出现人物，位置和尺度必须服务空间展示，不要让人物长期占满画面中央。",
		].join("\n"),
		shot_plan_subtitle: [
			"",
			`【${input.title} 字幕规划规则】`,
			"subtitlePlan 以片段为单位组织；每个片段只输出 1 条字幕，覆盖该片段完整时长，不要拆成多条。",
			"字幕必须顺着 coveredShotIndexes 对应的空间或体验自然推进，不能跨镜头乱讲。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 分类规则】`,
			'narrationScript 必须按片段输出，格式为 "片段1：...\n片段2：..."。',
			"每个片段的旁白是完整的一段话，覆盖该片段内所有镜头，不要按镜头拆开。",
			`textToImagePrompt 和 imageToVideoPrompt 仍按镜头输出；旁白则要围绕 ${input.spaceExamples} 的画面顺序自然展开。`,
			"textToImagePrompt 需要强调空间、材质、光线、景别和动线；imageToVideoPrompt 需要强调推进、转场和氛围变化。",
		].join("\n"),
		clip_generation: [
			"",
			"【片段生成规则】",
			"本片段使用 Seedance 2.0 通过参考图片生成纯画面视频（不含音频）。",
			"提示词中使用 @image1 引用参考图片，重点描述空间推进、细节切换和氛围节奏。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 旁白要求】`,
			"旁白将通过 TTS 单独生成配音，再在合成阶段与视频合并。",
			"旁白必须口语自然、适合朗读，不要写成样板广告词或机械介绍词。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildScenicVoiceoverPromptAddon(input: {
	title: string;
	narrationFocus: string;
	textToImageRule: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationHint 必须具体说明该镜头该说什么、强调什么，不要只写空泛情绪词。",
			`2. ${input.narrationFocus}`,
			"3. detail / transition 这类强画面镜头允许留白，不要默认每个镜头都塞 narrationHint。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationScript 是最终配音/字幕成稿，不是口号集。",
			`2. ${input.textToImageRule}`,
			"3. 如果镜头允许人物点缀出镜，也要明确人物只占小比例、不要居中大特写。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 旁白追加规则】`,
			`1. ${input.narrationFocus}`,
			"2. 旁白要和画面推进顺序一致，不要前后跳讲。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildRoamingVoiceoverPromptCategory(input: {
	title: string;
	domainLabel: string;
	sceneExamples: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 分类规则】`,
			`本类型视频结构以 ${input.domainLabel} 为主，通常组织为：开篇钩子 → 漫游体验片段 → 收尾片段。`,
			"每个片段对应一次视频生成调用（Seedance 2.0），片段时长限制 4~7 秒。",
			"一个片段内通常包含 1~3 个镜头，镜头之间围绕同一段漫游体验推进。",
			"",
			"漫游片段要求：",
			`1. 中段片段优先围绕 ${input.sceneExamples} 等连续体验组织，不要突然切成无关空间。`,
			"2. 每个镜头必须通过 segmentIndex/segmentId 归属片段；同一片段内镜头按 shotIndex 递增、时间连续不重叠。",
			"3. 片段时长 = 所含镜头 durationSeconds 之和，限制 4~7 秒；旁白按片段写一整段，不按镜头拆开。",
			"4. 主角或体验者可以在多个片段中连续出现，但不能变成怼脸说话口型镜头，本类型不做 lip sync。",
		].join("\n"),
		shot_plan_visual: [
			"",
			`【${input.title} 视觉设计规则】`,
			"本步骤只补 visual / cinematography / structure 字段。",
			"优先设计人物带着观众往前走、转身看、进入空间、触摸设施、停留体验等漫游式动作。",
			"环境仍是第一主体，人物负责带路，不要拍成口播站桩镜头。",
		].join("\n"),
		shot_plan_subject: [
			"",
			`【${input.title} 人物与主体规则】`,
			"允许有一个持续出现的主角/体验者，用来承接漫游体验；subject.mainCharacterCount 通常为 1。",
			"人物外观要稳定，但不要把镜头都拍成大头近景；人物更多作为带看者和尺度参照。",
		].join("\n"),
		shot_plan_subtitle: [
			"",
			`【${input.title} 字幕规划规则】`,
			"subtitlePlan 以片段为单位组织；每个片段只输出 1 条字幕，覆盖该片段完整时长，不要拆成多条。",
			"字幕必须贴着人物漫游路径和画面推进顺序，不要出现口播站桩式句法。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 分类规则】`,
			'narrationScript 必须按片段输出，格式为 "片段1：...\n片段2：..."。',
			"textToImagePrompt 和 imageToVideoPrompt 仍按镜头输出；提示词要明确主角在空间里漫游、观察、体验，而不是对镜讲话。",
			"旁白要像主角在边逛边带看，信息顺着画面推进，自然过渡。",
		].join("\n"),
		clip_generation: [
			"",
			"【片段生成规则】",
			"本片段使用 Seedance 2.0 通过参考图片生成纯画面视频（不含音频）。",
			"重点描述人物漫游、停留、转身、观察、与空间互动的动态过程，不要生成明显对口型说话动作。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 旁白要求】`,
			"旁白按片段生成，语气像真人边走边讲，有带看感，但不要像播报提词器。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildRoamingVoiceoverPromptAddon(input: { title: string; narrationFocus: string }) {
	return {
		shot_plan: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationHint 要说明当前漫游镜头该抓的体验重点，而不是只写“氛围感”“很好逛”。",
			`2. ${input.narrationFocus}`,
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationScript 不要写成主播口播词，要像人物边走边看时自然冒出来的话。",
			"2. textToImagePrompt 要明确人物是漫游式带看，不是站在原地正对镜头讲话。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 旁白追加规则】`,
			`1. ${input.narrationFocus}`,
			"2. 旁白要先给感知和判断，再补一句理由，不要机械顺序播报。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildLipSyncNarrationPromptCategory(input: {
	title: string;
	domainLabel: string;
	captureLabel: string;
	focusExamples: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 分类规则】`,
			`本类型是 ${input.captureLabel} 口播视频，核心是人物出镜讲解 ${input.domainLabel}。`,
			"每个输出片段通常对应 1 个说话镜头，优先保持单镜头连续表达；requiresLipSync=true。",
			`镜头重点优先围绕 ${input.focusExamples} 组织，不要为了凑结构硬拆成多镜头旁白。`,
			"人物口播句子要和画面表达一致，允许配合少量动作、转身、手势或环境引导，但主体始终是正在讲话的人物。",
		].join("\n"),
		shot_plan_visual: [
			"",
			`【${input.title} 视觉设计规则】`,
			input.captureLabel.includes("自拍")
				? "优先手机自拍或近距自拍视角，构图自然，保留手持临场感，但避免夸张广角变形。"
				: "优先稳定的他拍中景或半身景，保留人与空间的关系，避免拍成纯景空镜。",
			"人物必须清楚可见、口型区域无遮挡，同时让背景环境能支持当前讲解内容。",
		].join("\n"),
		shot_plan_subject: [
			"",
			`【${input.title} 人物与主体规则】`,
			"subject.mainCharacterCount 通常为 1，人物外观、年龄、服装和身份要稳定一致。",
			"本类型允许人物成为第一主体，但不要频繁变人，不要突然消失成纯空镜。",
		].join("\n"),
		shot_plan_subtitle: [
			"",
			`【${input.title} 字幕规划规则】`,
			"subtitlePlan 优先按镜头组织，一镜一条字幕；字幕就是人物真正会说出来的话。",
			"字幕内容必须适合口播和口型同步，不要写括号注释、停顿标记或分镜说明。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 分类规则】`,
			'narrationScript 优先按镜头输出，格式为 "镜头1：...\n镜头2：..."。',
			"旁白文本就是人物实际说出口的台词，必须和镜头时长匹配，并适合后续 lip sync。",
			"textToImagePrompt 和 imageToVideoPrompt 也按镜头输出，重点保证人物口型区域、面部朝向、手势和环境关系稳定可控。",
		].join("\n"),
		clip_generation: [
			"",
			"【片段生成规则】",
			"本类型要为后续口型同步服务，视频提示词应保持人物正面或半侧面可见、嘴部清晰、动作自然，不要做过激镜头切换。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 台词要求】`,
			"台词必须口语自然、适合人物直接说出来；优先短句，不要书面腔，不要机械套话。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildLipSyncNarrationPromptAddon(input: {
	title: string;
	dialogueFocus: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationHint 要写清楚人物这句口播的重点、情绪和手势/视线配合方式，不要只给空泛口号。",
			`2. ${input.dialogueFocus}`,
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationScript 不要写成长句堆砌，要便于人物一口气自然说完。",
			"2. 口播台词要像真人说话，不要口号腔、海报文案腔或机械播报腔。",
		].join("\n"),
		narration: [
			"",
			`【${input.title} 台词追加规则】`,
			`1. ${input.dialogueFocus}`,
			"2. 台词要有交流感和对象感，像真的在带人看和解释。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildSilentRoamingPromptCategory(input: {
	title: string;
	domainLabel: string;
	sceneExamples: string;
}) {
	return {
		shot_plan: [
			"",
			`【${input.title} 分类规则】`,
			`本类型以 ${input.domainLabel} 的人物漫游/动作混剪为主，无口播、无字幕，仅由画面节奏和 BGM 推进。`,
			"每个片段通常对应 1 个动作镜头，优先保持 single_action 表达，不要为它规划 narrationHint 或字幕承载。",
			`镜头内容优先围绕 ${input.sceneExamples} 等动作或空间切换，不要拍成站桩口播。`,
		].join("\n"),
		shot_plan_visual: [
			"",
			`【${input.title} 视觉设计规则】`,
			"重点设计走、看、停、转身、互动、进入空间、触摸物件等动作节奏，避免静止站立。",
		].join("\n"),
		shot_plan_subject: [
			"",
			`【${input.title} 人物与主体规则】`,
			"允许一个持续出现的主角/体验者，人物外观要稳定，但镜头重点是动作和漫游节奏，不是说话表演。",
		].join("\n"),
		shot_plan_subtitle: [
			"",
			`【${input.title} 字幕规划规则】`,
			"本类型默认不需要字幕；subtitlePlan 应为空，除非上游明确额外要求。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 分类规则】`,
			"textToImagePrompt 和 imageToVideoPrompt 仍按镜头输出。",
			"narrationScript 保持为空字符串或仅空行，不要硬写台词，不要补口播。",
		].join("\n"),
		clip_generation: [
			"",
			"【片段生成规则】",
			"重点描述动作节奏、镜头切换和氛围推进，不要生成明显对口型讲话动作。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

function buildSilentRoamingPromptAddon(input: { title: string }) {
	return {
		shot_plan: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationHint 和字幕不是本类型重点；优先把信息放到动作、构图和节奏设计里。",
			"2. 不要把无声漫游类型规划成带旁白的攻略或带台词的口播。",
		].join("\n"),
		prompt_generation: [
			"",
			`【${input.title} 追加规则】`,
			"1. narrationScript 为空是正常结果，不要为了凑字段强行写字。",
			"2. imageToVideoPrompt 要更具体地写动作、镜头变化和 BGM 节奏感。",
		].join("\n"),
	} satisfies Partial<Record<VideoTypePromptStage, string>>;
}

const HOTEL_EXPLORE_VOICEOVER_CATEGORY = buildScenicVoiceoverPromptCategory({
	title: "酒店-探店-空镜旁白",
	domainLabel: "酒店探店空间带看",
	spaceExamples: "大堂、客房、早餐、泳池、公区、设施、服务细节",
	characterRule:
		"本类型默认空镜旁白，大多数镜头的主体应是酒店空间、设施、菜品或服务细节本身；人物只在办理入住、服务互动、用餐体验等强相关场景里短暂点缀。",
	narrationRule:
		"旁白要像真实探店带看，优先讲清房型亮点、设施体验、服务细节和住起来的感受，不要写成空泛酒店广告词。",
});

const HOTEL_EXPLORE_VOICEOVER_ADDON = buildScenicVoiceoverPromptAddon({
	title: "酒店-探店-空镜旁白",
	narrationFocus: "酒店探店类 narrationHint 要优先突出房型、设施、服务、餐饮、位置或度假感受等可感知价值。",
	textToImageRule:
		"textToImagePrompt 对无人物镜头必须明确写空间本身是主角，重点呈现大堂、客房、窗景、早餐、泳池、服务细节等酒店卖点。",
});

const HOTEL_MONTAGE_VOICEOVER_CATEGORY = buildScenicVoiceoverPromptCategory({
	title: "酒店-混剪-空镜旁白",
	domainLabel: "酒店氛围混剪带看",
	spaceExamples: "外观、大堂、客房、夜景、公区、设施、餐饮、度假氛围",
	characterRule:
		"本类型以空镜和空间氛围为主，人物只作偶发点缀，不要成为连续出镜主角。",
	narrationRule:
		"旁白可以更氛围化，但仍要说具体卖点和住感，不要只堆砌高级感、治愈感之类空词。",
});

const HOTEL_MONTAGE_VOICEOVER_ADDON = buildScenicVoiceoverPromptAddon({
	title: "酒店-混剪-空镜旁白",
	narrationFocus: "酒店混剪类 narrationHint 既要有氛围，也要点出空间质感、住感和记忆点。",
	textToImageRule:
		"textToImagePrompt 要优先呈现空间质感、光影和度假氛围，不要默认生成可识别主角人物。",
});

const HOTEL_EXPLORE_ROAMING_VOICEOVER_CATEGORY = buildRoamingVoiceoverPromptCategory({
	title: "酒店-探店-漫游旁白",
	domainLabel: "酒店探店漫游带看",
	sceneExamples: "进入大堂、推门看房、经过走廊、体验早餐、查看设施、感受服务",
});

const HOTEL_EXPLORE_ROAMING_VOICEOVER_ADDON = buildRoamingVoiceoverPromptAddon({
	title: "酒店-探店-漫游旁白",
	narrationFocus: "酒店漫游类旁白要顺着人物进入空间、观察细节和真实体验的顺序推进，像带着观众一起逛。",
});

const HOTEL_EXPLORE_SELFIE_NARRATION_CATEGORY = buildLipSyncNarrationPromptCategory({
	title: "酒店-探店-自拍口播",
	domainLabel: "酒店探店",
	captureLabel: "自拍",
	focusExamples: "房型亮点、设施体验、服务细节、早餐、位置和入住感受",
});

const HOTEL_EXPLORE_SELFIE_NARRATION_ADDON = buildLipSyncNarrationPromptAddon({
	title: "酒店-探店-自拍口播",
	dialogueFocus: "台词要像住客边拍边说，优先讲真实感受、值不值得住、最推荐哪个点。",
});

const HOTEL_EXPLORE_PRESENTER_NARRATION_CATEGORY = buildLipSyncNarrationPromptCategory({
	title: "酒店-探店-他拍口播",
	domainLabel: "酒店探店",
	captureLabel: "他拍",
	focusExamples: "房型、设施、服务、餐饮、位置和入住体验",
});

const HOTEL_EXPLORE_PRESENTER_NARRATION_ADDON = buildLipSyncNarrationPromptAddon({
	title: "酒店-探店-他拍口播",
	dialogueFocus: "台词要像真人在带看酒店，不要背稿感太重，优先先给判断再补理由。",
});

const HOTEL_EXPLORE_ROAMING_SILENT_CATEGORY = buildSilentRoamingPromptCategory({
	title: "酒店-探店-漫游无声",
	domainLabel: "酒店探店",
	sceneExamples: "进入大堂、推门看房、经过公区、体验设施、取餐或漫游空间",
});

const HOTEL_EXPLORE_ROAMING_SILENT_ADDON = buildSilentRoamingPromptAddon({
	title: "酒店-探店-漫游无声",
});

const AGENCY_GUIDE_ROAMING_VOICEOVER_CATEGORY = buildRoamingVoiceoverPromptCategory({
	title: "旅行社-攻略-漫游旁白",
	domainLabel: "旅行攻略漫游带看",
	sceneExamples: "进入景点、边走边看、停留体验、换场转移、观察细节",
});

const AGENCY_GUIDE_ROAMING_VOICEOVER_ADDON = buildRoamingVoiceoverPromptAddon({
	title: "旅行社-攻略-漫游旁白",
	narrationFocus: "旅行攻略漫游类旁白要把路线、体验和判断自然串起来，不要写成站桩播报。",
});

const AGENCY_MONTAGE_ROAMING_VOICEOVER_CATEGORY = buildRoamingVoiceoverPromptCategory({
	title: "旅行社-混剪-漫游旁白",
	domainLabel: "旅行漫游混剪带看",
	sceneExamples: "边走边看、随拍打卡、经过街区、停留体验、切换不同景点",
});

const AGENCY_MONTAGE_ROAMING_VOICEOVER_ADDON = buildRoamingVoiceoverPromptAddon({
	title: "旅行社-混剪-漫游旁白",
	narrationFocus: "混剪漫游类旁白可以更轻快，但仍要顺着画面带出体验感和记忆点。",
});

const AGENCY_GUIDE_SELFIE_NARRATION_CATEGORY = buildLipSyncNarrationPromptCategory({
	title: "旅行社-攻略-自拍口播",
	domainLabel: "旅行攻略",
	captureLabel: "自拍",
	focusExamples: "路线建议、玩法亮点、值不值得、为什么这样安排",
});

const AGENCY_GUIDE_SELFIE_NARRATION_ADDON = buildLipSyncNarrationPromptAddon({
	title: "旅行社-攻略-自拍口播",
	dialogueFocus: "台词要像人在现场边拍边讲，先说结论，再补一句为什么值得。",
});

const AGENCY_GUIDE_PRESENTER_NARRATION_CATEGORY = buildLipSyncNarrationPromptCategory({
	title: "旅行社-攻略-他拍口播",
	domainLabel: "旅行攻略",
	captureLabel: "他拍",
	focusExamples: "路线建议、玩法亮点、值不值得、怎么安排更省心",
});

const AGENCY_GUIDE_PRESENTER_NARRATION_ADDON = buildLipSyncNarrationPromptAddon({
	title: "旅行社-攻略-他拍口播",
	dialogueFocus: "台词要像真人在带路讲解，不要写成提词器式攻略播报。",
});

const RETAIL_EXPLORE_PRESENTER_NARRATION_CATEGORY = buildLipSyncNarrationPromptCategory({
	title: "超市卖场-探店-他拍口播",
	domainLabel: "超市卖场探店",
	captureLabel: "他拍",
	focusExamples: "动线、货盘、陈列、试吃、优惠、选购理由和逛店体验",
});

const RETAIL_EXPLORE_PRESENTER_NARRATION_ADDON = buildLipSyncNarrationPromptAddon({
	title: "超市卖场-探店-他拍口播",
	dialogueFocus: "台词要像真人边逛边讲，优先说有什么、怎么买、为什么值得逛，不要空喊便宜划算。",
});

// ---------------------------------------------------------------------------
// 所有视频类型的配置注册表
// ---------------------------------------------------------------------------

const VIDEO_TYPE_PROMPT_CONFIGS: Partial<Record<VideoTaskVideoType, {
	categoryPrompts: Partial<Record<VideoTypePromptStage, string>>;
	addonPrompts: Partial<Record<VideoTypePromptStage, string>>;
}>> = {
	agency_guide_voiceover: {
		categoryPrompts: AGENCY_GUIDE_VOICEOVER_CATEGORY,
		addonPrompts: AGENCY_GUIDE_VOICEOVER_ADDON,
	},
	agency_guide_selfie_narration: {
		categoryPrompts: AGENCY_GUIDE_SELFIE_NARRATION_CATEGORY,
		addonPrompts: AGENCY_GUIDE_SELFIE_NARRATION_ADDON,
	},
	agency_guide_presenter_narration: {
		categoryPrompts: AGENCY_GUIDE_PRESENTER_NARRATION_CATEGORY,
		addonPrompts: AGENCY_GUIDE_PRESENTER_NARRATION_ADDON,
	},
	agency_guide_roaming_voiceover: {
		categoryPrompts: AGENCY_GUIDE_ROAMING_VOICEOVER_CATEGORY,
		addonPrompts: AGENCY_GUIDE_ROAMING_VOICEOVER_ADDON,
	},
	agency_montage_roaming_voiceover: {
		categoryPrompts: AGENCY_MONTAGE_ROAMING_VOICEOVER_CATEGORY,
		addonPrompts: AGENCY_MONTAGE_ROAMING_VOICEOVER_ADDON,
	},
	hotel_explore_voiceover: {
		categoryPrompts: HOTEL_EXPLORE_VOICEOVER_CATEGORY,
		addonPrompts: HOTEL_EXPLORE_VOICEOVER_ADDON,
	},
	hotel_explore_selfie_narration: {
		categoryPrompts: HOTEL_EXPLORE_SELFIE_NARRATION_CATEGORY,
		addonPrompts: HOTEL_EXPLORE_SELFIE_NARRATION_ADDON,
	},
	hotel_explore_presenter_narration: {
		categoryPrompts: HOTEL_EXPLORE_PRESENTER_NARRATION_CATEGORY,
		addonPrompts: HOTEL_EXPLORE_PRESENTER_NARRATION_ADDON,
	},
	hotel_explore_roaming_voiceover: {
		categoryPrompts: HOTEL_EXPLORE_ROAMING_VOICEOVER_CATEGORY,
		addonPrompts: HOTEL_EXPLORE_ROAMING_VOICEOVER_ADDON,
	},
	hotel_explore_roaming_silent: {
		categoryPrompts: HOTEL_EXPLORE_ROAMING_SILENT_CATEGORY,
		addonPrompts: HOTEL_EXPLORE_ROAMING_SILENT_ADDON,
	},
	hotel_montage_voiceover: {
		categoryPrompts: HOTEL_MONTAGE_VOICEOVER_CATEGORY,
		addonPrompts: HOTEL_MONTAGE_VOICEOVER_ADDON,
	},
	retail_explore_presenter_narration: {
		categoryPrompts: RETAIL_EXPLORE_PRESENTER_NARRATION_CATEGORY,
		addonPrompts: RETAIL_EXPLORE_PRESENTER_NARRATION_ADDON,
	},
};

// ---------------------------------------------------------------------------
// 导出函数
// ---------------------------------------------------------------------------

/** 获取指定视频类型在指定 stage 的分类提示词 */
export function getVideoTypeCategoryPrompt(videoType: VideoTaskVideoType, stage: VideoTypePromptStage): string {
	return VIDEO_TYPE_PROMPT_CONFIGS[videoType]?.categoryPrompts[stage] ?? "";
}

/** 获取指定视频类型在指定 stage 的追加提示词 */
export function getVideoTypeAddonPrompt(videoType: VideoTaskVideoType, stage: VideoTypePromptStage): string {
	return VIDEO_TYPE_PROMPT_CONFIGS[videoType]?.addonPrompts[stage] ?? "";
}

export function buildVideoTypePromptBlock(videoType: VideoTaskVideoType, stage: VideoTypePromptStage): string {
	return [getVideoTypeCategoryPrompt(videoType, stage), getVideoTypeAddonPrompt(videoType, stage)]
		.filter(Boolean)
		.join("\n");
}

/** 兼容旧接口：返回分类提示词（等同于 getVideoTypeCategoryPrompt） */
export function getVideoTypePromptOverlay(videoType: VideoTaskVideoType, stage: VideoTypePromptStage): string {
	return getVideoTypeCategoryPrompt(videoType, stage);
}

/** 列出所有视频类型的提示词配置（供页面展示用） */
export function listAllVideoTypePromptConfigs(): VideoTypePromptConfig[] {
	return (Object.keys(videoTaskTypeProfiles) as VideoTaskVideoType[]).map((key) => ({
		key,
		label: videoTaskTypeProfiles[key].label,
		categoryPrompts: VIDEO_TYPE_PROMPT_CONFIGS[key]?.categoryPrompts ?? {},
		addonPrompts: VIDEO_TYPE_PROMPT_CONFIGS[key]?.addonPrompts ?? {},
	}));
}
