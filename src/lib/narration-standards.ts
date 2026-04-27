import {
  countNarrationCharacters,
  getNarrationLengthGuidance,
  getNarrationRepairTriggerCharacters,
  isNarrationClearlyOverDuration,
  sanitizeNarrationText,
} from "./narration";
import { videoTaskTypeProfiles, type VideoTaskVideoType } from "./video-task-schema";

const SCENERY_DRIVEN_VOICE_TYPES = new Set<VideoTaskVideoType>([
  "agency_guide_scenery_voiceover",
  "agency_montage_scenery",
  "hotel_explore_voiceover",
  "hotel_montage_voiceover",
]);

const PRESENTER_NARRATION_TYPES = new Set<VideoTaskVideoType>([
  "agency_guide_selfie_narration",
  "agency_guide_presenter_narration",
  "hotel_explore_selfie_narration",
  "hotel_explore_presenter_narration",
  "retail_explore_presenter_narration",
]);

const GUIDE_STYLE_VOICEOVER_TYPES = new Set<VideoTaskVideoType>([
  "agency_guide_voiceover",
  "agency_guide_roaming_voiceover",
  "agency_montage_roaming_voiceover",
  "hotel_explore_roaming_voiceover",
]);

export type NarrationQualityIssue = {
  shotIndex: number;
  severity: "warning" | "error";
  code:
    | "over_limit"
    | "too_short"
    | "weak_opening"
    | "generic_phrase"
    | "ai_summary_tone"
    | "marketing_tone"
    | "weak_word_overuse"
    | "repeated_opening"
    | "day_prefix"
    | "terminal_oh"
    | "terminal_punctuation"
    | "detail_over_dense"
    | "hollow_recommendation_tone"
    | "missing_concrete_value";
  message: string;
};

export type NarrationQualityLineContext = {
  shotIndex: number;
  text: string;
  durationSeconds: number;
  purpose?: string | null;
};

export type NarrationDeliveryInput = {
  shotIndex: number;
  purpose: string;
  hasVoice?: boolean;
  hasSubtitle?: boolean;
  requiresLipSync?: boolean;
  hasTalent?: boolean;
  emotion?: string | null;
  durationSeconds: number;
};

export type NarrationDeliveryStrategy = {
  shotIndex: number;
  shouldLeaveBlank: boolean;
  isKeyLine: boolean;
  keyLineReason: string | null;
  voiceRole: "silent" | "hook" | "guide" | "highlight" | "transition" | "closing";
  deliveryTone: string;
  deliveryPace: "slow" | "balanced" | "fast";
  sentenceDensity: "light" | "standard" | "focus";
  speechRateDelta: number;
  loudnessDelta: number;
};

const weakWords = ["真的", "特别", "非常", "很", "有点"];

const genericPhrasePatterns: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /这里真的非常不错/u, message: "表达过于空泛，像套话" },
  { pattern: /值得大家来体验一下/u, message: "推荐理由过空，没有具体支撑点" },
  { pattern: /给人一种.+感觉/u, message: "句式偏虚，缺少可感知信息" },
  { pattern: /整体氛围特别好/u, message: "只在泛泛夸氛围，没有具体亮点" },
  { pattern: /非常有特色/u, message: "只说有特色，没有说明特色在哪" },
  { pattern: /真的很好看/u, message: "只说好看，没有解释为什么好看" },
  { pattern: /感觉很棒/u, message: "情绪词偏空，需要补足具体体验" },
  { pattern: /十分推荐/u, message: "推荐表达偏空泛，需要具体价值点" },
  { pattern: /不一样的感觉/u, message: "表达模糊，缺少具体感受描述" },
];

const aiSummaryTonePatterns: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /^(首先|其次|最后)/u, message: "开头像总结提纲，不像真人口播" },
  { pattern: /(整体来看|总的来说|总之)/u, message: "语气像书面总结，不够口语化" },
  { pattern: /给人一种/u, message: "有明显文案腔/总结腔" },
];

const marketingTonePatterns: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /赶紧冲/u, message: "营销感过强" },
  { pattern: /闭眼入/u, message: "营销感过强" },
  { pattern: /错过血亏/u, message: "营销感过强" },
  { pattern: /必买必来必打卡/u, message: "营销感过强" },
  { pattern: /全网最强/u, message: "表达过度夸张" },
  { pattern: /天花板/u, message: "表达过度夸张" },
  { pattern: /宇宙级/u, message: "表达失真，容易让用户反感" },
];

const hollowRecommendationPatterns: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /直接抄作业/u, message: "像攻略口号，没有真人推荐里的理由和对象感" },
  { pattern: /这趟.+就值了/u, message: "只下结论，没有说明为什么值" },
  { pattern: /这一段最舒服/u, message: "只说舒服，没有讲清具体体验" },
  { pattern: /照样轻松/u, message: "轻松感没有具体服务或动线支撑" },
  { pattern: /顺路看/u, message: "像行程压缩词，不像真人在解释安排原因" },
  { pattern: /接得稳/u, message: "服务表达过于生硬，需要具体成接送体验" },
  { pattern: /一落地就有人接/u, message: "像服务清单，需要讲成具体安心场景" },
  { pattern: /快速住进.+休息/u, message: "像服务说明，不像真人推荐表达" },
  { pattern: /看底蕴/u, message: "景点表达标签化，需要补出能被看到的具体内容" },
  { pattern: /刚到门口就有度假感/u, message: "像广告标签，需要补出门口看到什么或为什么有度假感" },
  { pattern: /干净利落这一路线/u, message: "表达抽象，需要讲成房间、动线或住感细节" },
  { pattern: /吃饭和遛娃都安排上了/u, message: "像权益清单，需要讲成具体家庭场景" },
  { pattern: /氛围也很放松/u, message: "氛围结论缺少可感知支撑" },
  { pattern: /整套体验都挺完整/u, message: "总结空泛，需要说明完整在哪些环节" },
  { pattern: /经典景点都逛到了/u, message: "像总结清单，不像真实推荐收束" },
  { pattern: /^想[^，。！？；]{0,12}(省心|轻松|舒服).{0,12}这条/u, message: "开场像模板广告语，缺少痛点或反差" },
];

const shallowValueClaimPattern = /(省心|轻松|舒服|值了|值得|划算|稳|顺路|方便|安心|高级|治愈|宝藏|好逛|好住|好玩)/u;
const concreteValueSupportPattern =
  /(因为|适合|不用|避免|省掉|带孩子|带娃|老人|亲子|家庭|情侣|朋友|预算|排队|交通|接送|专车|入住|房间|早餐|大堂|泳池|设施|服务|位置|动线|路线|历史|夜景|博物馆|藏品|建筑|湖|风|遗址|试吃|陈列|货架|价格|口感|材质|空间|窗景|步行|分钟|\d|[一二三四五六七八九十]天|先.+再|然后|走进|看看|感受|体验|俯瞰|打卡)/u;

const weakHookPatterns = [/^(这里|这一站|这个地方|这一幕|这一段)/u];
const repeatedOpeningStripPattern =
  /^(更妙的是|更重要的是|但真正让人惊喜的|但真正|看完这一段你就知道|别急|到了这里|再往后|接着看|接下来|然后|这里|这一站|这个地方|这一幕|这一段)/u;

export const NARRATION_STANDARD_COMMON_RULES = [
  "先理解镜头作用、画面重点、情绪和节奏，再下笔；禁止脱离画面空讲。",
  "台词是视频里的声音表达，不是散文、广告文案或朋友圈配文，必须优先保证听起来顺、读起来清楚。",
  "每句尽量只表达一个核心意思，优先说观众最在意的价值点、体验点或情绪点。",
  "快镜头更短更利落，慢镜头更舒展更有氛围；强画面镜头允许少说一点，不要把台词塞满。",
  "情绪要随画面变化，自然有起伏，但不能夸张喊口号、不能故作深沉、不能全程一个语气。",
  "可以把亮点形容得更出彩，但必须建立在画面和脚本信息上，不能硬编事实，不能夸张失真。",
  "少说空泛套话，多说能被画面验证的具体亮点、具体体验、具体感受。",
  "语言要口语化、自然、顺口，像真人在讲，不像说明书、论文、AI总结或硬广脚本。",
  "镜头之间要有承接意识，必要时用自然过渡，而不是每句都像孤岛。",
  "句长优先控制在 8-22 字；超过 28 字必须优先压缩；连续两句长句时，下一句必须更短。",
  "连续两句不得使用相同开头；相邻三句避免重复同类空泛形容词；少用“真的、特别、非常、很、有点”等弱信息词。",
  "每 3-5 句里，至少留 1 句有记忆点、能拉情绪、能提炼价值或能形成停留钩子。",
  "必须适合配音朗读和字幕展示，不要绕口，不要多重从句，不要信息过载。",
  "禁止广告腔、AI 总结腔、空泛夸赞、过度营销、过度煽情、长句堆叠、与画面脱节。",
  "所有带台词或字幕的视频，都要像真人在推荐一个具体选择：先有对象和判断，再给画面能证明的理由。",
  "不要只写“省心、轻松、舒服、值得、顺路、经典都逛到”这类结论词；出现结论词时，必须补出原因、场景或体验证据。",
  "每条脚本要有整片承接意识：开场建立问题或期待，中段给具体理由，收尾把价值说实，不要变成互不相关的短句合集。",
  "开场优先用真实判断、常见误区、适合人群或明确收益起势，不要用“想省心就看这条”这种模板句。",
  "中段要把服务项、景点、设施或商品权益讲成可想象的场景：谁在什么情况下会用到，看到什么，感受到什么。",
  "收尾不要只总结“都安排好了/体验完整/照着走”，要落到观众下一步能得到的具体好处。",
] as const;

export function buildHumanRecommendationScriptPromptBlock() {
  return [
    "真人推荐口播范式（所有有台词/字幕的视频都生效）：",
    "1. 台词不是景点名、空间名、商品名或服务项的罗列，而是一个真人在帮观众做选择。",
    "2. 优先写清：谁适合、解决什么问题、为什么这样安排/选择、画面里哪个细节能证明。",
    "3. 开场要有真实判断、痛点、反差或明确对象，不能只喊“想省心/想轻松就看这条”。",
    "4. 中段每句至少包含“具体对象、具体动作、具体体验、具体理由”中的两个，不要只给抽象结论。",
    "5. 收尾要把价值落到观众行动上，可以引导咨询/关注/进直播间，但要先完成可信推荐。",
    "6. 允许口语、有停顿、有轻微情绪，但不能油腻、喊麦、像广告提词器。",
    "7. 低质反例：想省心玩北京，这条五天四晚直接抄作业 / 刚到门口就有度假感，大堂也做得敞亮又舒服 / 经典景点都逛到了，想轻松玩北京可以按这条线路走。",
    "8. 改写方向：先点明人群或痛点，再给具体原因和画面证据；示例只学结构，不复制地点或事实。",
  ].join("\n");
}

function countWeakWordHits(text: string) {
  return weakWords.reduce((total, word) => total + (text.match(new RegExp(word, "gu"))?.length ?? 0), 0);
}

function extractOpeningSignature(text: string) {
  return sanitizeNarrationText(text, {
    stripLeadingDayPrefix: true,
    stripTerminalPunctuation: false,
    removeTerminalOh: false,
  })
    .replace(repeatedOpeningStripPattern, "")
    .slice(0, 4);
}

function getBaseDeliveryStrategy(
  shot: NarrationDeliveryInput,
  videoType: VideoTaskVideoType,
): Omit<NarrationDeliveryStrategy, "shotIndex" | "isKeyLine" | "keyLineReason" | "shouldLeaveBlank"> {
  if (!(shot.hasVoice || shot.hasSubtitle)) {
    return {
      voiceRole: "silent",
      deliveryTone: "留白给画面",
      deliveryPace: "balanced",
      sentenceDensity: "light",
      speechRateDelta: 0,
      loudnessDelta: 0,
    };
  }

  if (shot.requiresLipSync || PRESENTER_NARRATION_TYPES.has(videoType)) {
    return {
      voiceRole: shot.purpose === "closing" ? "closing" : shot.purpose === "hook" ? "hook" : "guide",
      deliveryTone: "真人交流感，自然可信",
      deliveryPace: "balanced",
      sentenceDensity: shot.purpose === "hook" ? "focus" : "standard",
      speechRateDelta: shot.purpose === "hook" ? 4 : 0,
      loudnessDelta: 2,
    };
  }

  switch (shot.purpose) {
    case "hook":
      return {
        voiceRole: "hook",
        deliveryTone: "利落好奇，快速建立兴趣",
        deliveryPace: "fast",
        sentenceDensity: "focus",
        speechRateDelta: 8,
        loudnessDelta: 4,
      };
    case "climax":
      return {
        voiceRole: "highlight",
        deliveryTone: "提气增强，把亮点抬起来",
        deliveryPace: "fast",
        sentenceDensity: "focus",
        speechRateDelta: 6,
        loudnessDelta: 5,
      };
    case "closing":
      return {
        voiceRole: "closing",
        deliveryTone: "收束真诚，留记忆点",
        deliveryPace: "balanced",
        sentenceDensity: "focus",
        speechRateDelta: -2,
        loudnessDelta: 2,
      };
    case "transition":
      return {
        voiceRole: "transition",
        deliveryTone: "轻推承接，让节奏自然往下走",
        deliveryPace: "slow",
        sentenceDensity: "light",
        speechRateDelta: -4,
        loudnessDelta: 0,
      };
    case "detail":
      return {
        voiceRole: "guide",
        deliveryTone: SCENERY_DRIVEN_VOICE_TYPES.has(videoType)
          ? "舒展沉浸，把细节感受说出来"
          : "具体说明，把关键细节讲清楚",
        deliveryPace: videoType === "agency_montage_scenery" ? "slow" : "balanced",
        sentenceDensity: "light",
        speechRateDelta: videoType === "agency_montage_scenery" ? -5 : -1,
        loudnessDelta: 0,
      };
    case "experience":
    default:
      return {
        voiceRole: "guide",
        deliveryTone:
          GUIDE_STYLE_VOICEOVER_TYPES.has(videoType) || videoType === "agency_guide_scenery_voiceover"
            ? "自然可信，像真人在带看攻略"
            : videoType === "agency_montage_scenery"
              ? "舒展自然，给画面留呼吸"
              : "自然生动，把体验感说具体",
        deliveryPace: videoType === "agency_montage_scenery" ? "slow" : "balanced",
        sentenceDensity: "standard",
        speechRateDelta: videoType === "agency_montage_scenery" ? -2 : 1,
        loudnessDelta: 1,
      };
  }
}

export function getNarrationContentTypeGuidance(videoType: VideoTaskVideoType): string[] {
  switch (videoType) {
    case "agency_montage_scenery":
    case "agency_guide_scenery_voiceover":
    case "hotel_explore_voiceover":
    case "hotel_montage_voiceover":
      return [
        "景色类台词：重点写为什么美、为什么让人想停下来，不要只重复“好看”“很美”。",
        "景色类台词：少塞硬信息，多给观众沉浸感和呼吸感。",
      ];
    case "agency_guide_selfie_narration":
    case "agency_guide_presenter_narration":
    case "hotel_explore_selfie_narration":
    case "hotel_explore_presenter_narration":
    case "retail_explore_presenter_narration":
      return [
        "人物口播类台词：要像真人边看边说，有交流感、代入感和轻微互动感。",
        "攻略类台词：优先先给结论，再补一句理由，不要绕弯子。",
      ];
    case "agency_guide_voiceover":
    case "agency_guide_roaming_voiceover":
    case "agency_montage_roaming_voiceover":
    case "hotel_explore_roaming_voiceover":
      return [
        "攻略类台词：优先说观众最在意的点，突出省心、省时、值不值得、为什么这么安排。",
        "攻略类台词：不要机械播报行程顺序，不要把“第几天去哪”当成主要内容。",
      ];
    case "agency_creative_beat_mix":
      return [
        "种草/混剪类台词：要有记忆点和推进感，但不要喊口号，不要硬卖。",
        "强画面镜头允许少说一点，让节奏和画面自己带情绪。",
      ];
    case "agency_montage_presenter_checkin":
      return [
        "人物体验类台词：突出真实体验和情绪变化，不要写成生硬介绍词。",
        "强画面镜头允许留白，不要句句都塞满信息。",
      ];
    default:
      return ["台词要围绕镜头说话，先说重点，再说感受或价值，不要空泛拔高。"];
  }
}

export function buildNarrationDeliveryStrategies(
  shots: NarrationDeliveryInput[],
  videoType: VideoTaskVideoType,
): NarrationDeliveryStrategy[] {
  const strategies = shots.map((shot) => {
    const base = getBaseDeliveryStrategy(shot, videoType);
    const shouldLeaveBlank = !(shot.hasVoice || shot.hasSubtitle);
    const isKeyLine = !shouldLeaveBlank && ["hook", "climax", "closing"].includes(shot.purpose);
    const keyLineReason = isKeyLine
      ? shot.purpose === "hook"
        ? "开场必须有钩子句"
        : shot.purpose === "closing"
          ? "收尾必须有记忆点和收束感"
          : "高能镜头需要重点句抬情绪"
      : null;

    return {
      shotIndex: shot.shotIndex,
      shouldLeaveBlank,
      isKeyLine,
      keyLineReason,
      ...base,
    } satisfies NarrationDeliveryStrategy;
  });

  const voicedIndexes = strategies
    .map((strategy, index) => ({ index, strategy }))
    .filter((item) => !item.strategy.shouldLeaveBlank);

  let voicedSinceLastKey = 0;
  for (const item of voicedIndexes) {
    if (item.strategy.isKeyLine) {
      voicedSinceLastKey = 0;
      continue;
    }

    voicedSinceLastKey += 1;
    if (voicedSinceLastKey >= 4) {
      item.strategy.isKeyLine = true;
      item.strategy.keyLineReason = "每 3-5 句至少保留 1 句重点句";
      item.strategy.voiceRole = item.strategy.voiceRole === "transition" ? "guide" : "highlight";
      item.strategy.deliveryTone = `${item.strategy.deliveryTone}，这一句要更有记忆点`;
      item.strategy.sentenceDensity = "focus";
      item.strategy.speechRateDelta += item.strategy.deliveryPace === "slow" ? 2 : 3;
      item.strategy.loudnessDelta += 2;
      voicedSinceLastKey = 0;
    }
  }

  return strategies;
}

export function buildNarrationDeliveryStrategyReference() {
  return [
    "音色/情绪策略（运行时规则）：",
    "1. hook：更利落、更有起势，语速略快、音量略提，但不能喊麦。",
    "2. climax / 高能句：更提气，把亮点抬起来，但仍保持真实可信。",
    "3. detail / transition：更轻、更短、更有留白，优先让画面自己说话。",
    "4. closing：更收束、更真诚，节奏回稳，留下记忆点或行动感。",
    "5. requiresLipSync / 人物口播：优先保持真人交流感，不做夸张情绪播法。",
    "6. 每 3-5 句至少保留 1 句重点句；若重点句不足，系统会在中段自动补一条更有记忆点的承载句。",
    "7. 混剪/攻略类禁止连续过多镜头都承担口播，否则会在镜头计划阶段被判定为过密。",
  ].join("\n");
}

export function buildNarrationStandardsDocumentation() {
  const typeGuidanceDocs = (
    Object.entries(videoTaskTypeProfiles) as Array<
      [VideoTaskVideoType, (typeof videoTaskTypeProfiles)[VideoTaskVideoType]]
    >
  )
    .map(([videoType, profile]) => {
      const guidance = getNarrationContentTypeGuidance(videoType);
      return [`${profile.label}：`, ...guidance.map((rule, index) => `${index + 1}. ${rule}`)].join("\n");
    })
    .join("\n\n");

  return [
    "台词生成统一标准：",
    ...NARRATION_STANDARD_COMMON_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    buildHumanRecommendationScriptPromptBlock(),
    "",
    "不同视频类型附加规则：",
    typeGuidanceDocs,
    "",
    buildNarrationDeliveryStrategyReference(),
  ].join("\n");
}

export function buildNarrationStandardsPromptBlock(videoType: VideoTaskVideoType) {
  const typeGuidance = getNarrationContentTypeGuidance(videoType);

  return [
    "台词生成标准（始终生效）：",
    ...NARRATION_STANDARD_COMMON_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    buildHumanRecommendationScriptPromptBlock(),
    "",
    ...typeGuidance.map((rule, index) => `${NARRATION_STANDARD_COMMON_RULES.length + index + 1}. ${rule}`),
  ].join("\n");
}

export function inspectNarrationQuality(lines: NarrationQualityLineContext[]): NarrationQualityIssue[] {
  const issues: NarrationQualityIssue[] = [];
  let previousOpeningSignature = "";

  for (const line of lines) {
    const rawText = String(line.text ?? "").trim();
    if (!rawText) {
      previousOpeningSignature = "";
      continue;
    }

    const guidance = getNarrationLengthGuidance(line.durationSeconds);
    const normalizedText = sanitizeNarrationText(rawText, {
      stripLeadingDayPrefix: false,
      stripTerminalPunctuation: false,
      removeTerminalOh: false,
    });
    const charCount = countNarrationCharacters(normalizedText);
    const purpose = line.purpose?.trim() ?? "";
    const openingSignature = extractOpeningSignature(rawText);
    const weakWordHits = countWeakWordHits(normalizedText);
    const repairTriggerCharacters = getNarrationRepairTriggerCharacters(line.durationSeconds);

    if (charCount > repairTriggerCharacters || isNarrationClearlyOverDuration(rawText, line.durationSeconds)) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "over_limit",
        message: `台词明显超出当前时长安全区（${charCount}/${repairTriggerCharacters}）`,
      });
    }

    if (charCount > 0 && charCount < Math.max(6, Math.floor(guidance.suggestedCharacters * 0.45))) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "too_short",
        message: "台词偏短，信息量不足，容易只剩情绪词或口号",
      });
    }

    if (/^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)/iu.test(rawText)) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "day_prefix",
        message: "台词开头仍像机械播报行程",
      });
    }

    if (/哦+[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]*$/u.test(rawText)) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "terminal_oh",
        message: "句尾带“哦”，听感会变油腻",
      });
    }

    if (/[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]$/u.test(rawText)) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "terminal_punctuation",
        message: "句尾仍带标点，不利于最终字幕与口播收尾",
      });
    }

    if (weakHookPatterns.some((pattern) => pattern.test(rawText)) && purpose === "hook") {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "weak_opening",
        message: "开场句开头偏弱，缺少钩子感",
      });
    }

    for (const rule of genericPhrasePatterns) {
      if (rule.pattern.test(rawText)) {
        issues.push({
          shotIndex: line.shotIndex,
          severity: "warning",
          code: "generic_phrase",
          message: rule.message,
        });
      }
    }

    for (const rule of aiSummaryTonePatterns) {
      if (rule.pattern.test(rawText)) {
        issues.push({
          shotIndex: line.shotIndex,
          severity: "warning",
          code: "ai_summary_tone",
          message: rule.message,
        });
      }
    }

    for (const rule of marketingTonePatterns) {
      if (rule.pattern.test(rawText)) {
        issues.push({
          shotIndex: line.shotIndex,
          severity: "warning",
          code: "marketing_tone",
          message: rule.message,
        });
      }
    }

    for (const rule of hollowRecommendationPatterns) {
      if (rule.pattern.test(rawText)) {
        issues.push({
          shotIndex: line.shotIndex,
          severity: "warning",
          code: "hollow_recommendation_tone",
          message: rule.message,
        });
      }
    }

    if (
      charCount <= Math.max(24, guidance.suggestedCharacters + 4) &&
      shallowValueClaimPattern.test(rawText) &&
      !concreteValueSupportPattern.test(rawText)
    ) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "missing_concrete_value",
        message: "有推荐结论但缺少具体理由或体验证据",
      });
    }

    if (weakWordHits >= 2) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "weak_word_overuse",
        message: "弱信息词偏多，容易显得空泛、发虚",
      });
    }

    if (
      (purpose === "detail" || purpose === "transition") &&
      charCount > Math.max(guidance.suggestedCharacters + 8, Math.floor(guidance.maxCharacters * 0.9))
    ) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "detail_over_dense",
        message: "强画面镜头台词偏满，留白感不足",
      });
    }

    if (openingSignature && previousOpeningSignature && openingSignature === previousOpeningSignature) {
      issues.push({
        shotIndex: line.shotIndex,
        severity: "warning",
        code: "repeated_opening",
        message: "与上一句开头过于相似，容易形成机器拼接感",
      });
    }

    previousOpeningSignature = openingSignature;
  }

  return issues;
}
