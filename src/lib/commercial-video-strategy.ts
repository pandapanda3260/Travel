import type {
  CommercialBeatPhase,
  CommercialBeatPlanItem,
  CommercialProgressScore,
  CommercialStrategyKind,
  ShotPlan,
  ShotPlanItem,
  TaskCommercialPlan,
  VideoTaskSource,
  VideoTaskVideoType,
} from "./video-task-schema";

type BuildCommercialStrategyPlanInput = {
  source: Pick<VideoTaskSource, "productInfoTitle" | "productInfoSnapshot" | "userPrompt" | "optimizedUserPrompt" | "videoTemplatePrompt">;
  videoType?: VideoTaskVideoType | string | null;
  shotPlan?: ShotPlan | null;
};

type StrategyMeta = {
  label: string;
  reason: string;
  targetAudience: string;
  coreHookFallback: string;
  decisionPath: string[];
};

const strategyMetaMap: Record<CommercialStrategyKind, StrategyMeta> = {
  transaction_seed: {
    label: "交易型种草",
    reason: "检测到价格、套餐、开业、促销、限时、可退等成交信息，适合利益前置和权益密集证明。",
    targetAudience: "正在比较价格、权益、适用时间和下单风险的人",
    coreHookFallback: "地域/人群 + 强利益 + 现在值得看",
    decisionPath: ["跟我有关吗", "有什么机会", "是谁在哪", "给我什么", "值不值", "有没有风险", "现在怎么做"],
  },
  guide_route: {
    label: "攻略路线型",
    reason: "检测到路线、避坑、建议、时间安排或攻略表达，适合先制造认知差，再按步骤交付。",
    targetAudience: "想少踩坑、把路线和体验安排明白的人",
    coreHookFallback: "常见错误/认知差 + 更优玩法",
    decisionPath: ["我是不是做错了", "正确玩法是什么", "每一步怎么走", "有什么注意点", "为什么值得收藏"],
  },
  brand_showcase: {
    label: "品牌展示型",
    reason: "未检测到强交易信息，素材更适合建立品牌、空间、氛围和品质感。",
    targetAudience: "正在比较空间品质、品牌调性和体验氛围的人",
    coreHookFallback: "品牌/空间第一印象 + 记忆点",
    decisionPath: ["这是什么", "看起来好不好", "空间有什么特色", "适合什么场景", "留下什么印象"],
  },
  experience_recommendation: {
    label: "体验推荐型",
    reason: "检测到探店、入住、亲子、推荐或真实体验表达，适合先代入人群，再用体验理由推进。",
    targetAudience: "需要真实体验理由和适合人群判断的人",
    coreHookFallback: "适合人群 + 真实体验判断",
    decisionPath: ["适合我吗", "体验感怎么样", "有哪些可感知理由", "谁最适合买", "下一步怎么做"],
  },
};

const transactionPattern =
  /(¥|￥|\d+\s*(?:元|块|多|起)|价格|套餐|房券|一价全包|三天两晚|两晚|大促|促销|优惠|开业|限时|库存|下架|涨价|有效期|周末|五一|可退|先囤|快去囤|刷到先囤)/u;
const guidePattern = /(攻略|路线|避坑|第[一二三四五六七八九十\d]+天|怎么玩|建议|时间表|入园|交通|收藏|第一次|没玩对|行程|专车送站)/u;
const experiencePattern = /(探店|入住|体验|亲子|遛娃|适合|推荐|真实|带孩子|家庭|情侣|差旅|周末)/u;
const identityPattern = /(Club\s*Med|酒店|度假村|民宿|景区|乐园|门店|品牌|杭州|北京|上海|广州|深圳|大连|哈尔滨|成都|重庆|三亚|西安|苏州|南京)/iu;
const opportunityPattern = /(开业|大促|促销|优惠|限时|下周|库存|下架|涨价|有效期|周末|五一|先囤|可退|只要|1000|299|一价全包)/u;
const benefitPattern =
  /(早餐|正餐|托管|儿童|乐园|俱乐部|门票|停车|海景|茶山|房型|大床|双床|餐厅|咖啡|设施|运动|娱乐|课程|权益|包含|送|免费|不限次)/u;
const riskReversalPattern = /(可退|随时退|不约|有效期|周末|五一|不用|先囤|不去也|保障)/u;
const actionPattern = /(先囤|快去囤|下单|预约|进直播间|关注|收藏|点赞|私信|抢|买)/u;

function normalizeText(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSourceText(input: BuildCommercialStrategyPlanInput) {
  return [
    input.source.productInfoTitle,
    input.source.productInfoSnapshot,
    input.source.userPrompt,
    input.source.optimizedUserPrompt,
    input.source.videoTemplatePrompt,
    ...(input.shotPlan?.shots ?? []).flatMap((shot) => [
      shot.purpose,
      shot.functionTag,
      shot.sellingPointType,
      shot.sceneDescription,
      shot.narrationHint,
      shot.commercialIntent,
      shot.evidenceTarget,
    ]),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

export function inferCommercialStrategyKind(input: BuildCommercialStrategyPlanInput): CommercialStrategyKind {
  const text = collectSourceText(input);
  if (transactionPattern.test(text)) {
    return "transaction_seed";
  }
  if (guidePattern.test(text) || String(input.videoType ?? "").startsWith("agency_guide")) {
    return "guide_route";
  }
  if (experiencePattern.test(text)) {
    return "experience_recommendation";
  }
  return "brand_showcase";
}

function getShotText(shot: ShotPlanItem | null | undefined) {
  if (!shot) {
    return "";
  }
  return [
    shot.purpose,
    shot.functionTag,
    shot.sellingPointType,
    shot.sceneType,
    shot.sceneDescription,
    shot.narrationHint,
    shot.commercialIntent,
    shot.evidenceTarget,
    shot.conversionRole,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function clampScore(value: number) {
  return Math.max(0, Math.min(20, Math.round(value)));
}

function scoreCommercialProgress(strategyKind: CommercialStrategyKind, text: string, shotPlan?: ShotPlan | null): CommercialProgressScore {
  const shots = [...(shotPlan?.shots ?? [])].sort((left, right) => left.shotIndex - right.shotIndex);
  const firstText = getShotText(shots[0]);
  const earlyText = shots.slice(0, Math.min(3, shots.length)).map(getShotText).join(" ");
  const lastText = shots.slice(-2).map(getShotText).join(" ");
  const materialBackedCount = shots.filter((shot) => shot.assetId || shot.referenceImageUrl || shot.sourceMaterialId).length;
  const totalShots = Math.max(1, shots.length);
  const benefitHitCount = (text.match(benefitPattern) ? 1 : 0) + shots.filter((shot) => benefitPattern.test(getShotText(shot))).length;
  const findings: string[] = [];

  const hookScore = clampScore(
    (/(hook|开场|钩子|吸引|全新|新开|大品牌|巨无霸|攻略|没玩对|只要|\d+\s*(?:元|多))/iu.test(firstText) ? 12 : 4) +
      (identityPattern.test(firstText) || opportunityPattern.test(firstText) ? 5 : 0) +
      (strategyKind === "transaction_seed" && opportunityPattern.test(firstText) ? 3 : 0),
  );

  const identityOpportunityScore = clampScore(
    (identityPattern.test(earlyText) ? 8 : 2) +
      (strategyKind === "transaction_seed" ? (opportunityPattern.test(earlyText) ? 10 : 1) : guidePattern.test(earlyText) ? 8 : 4) +
      (/(品牌|地点|在哪|项目|开业|大促|攻略|路线)/u.test(earlyText) ? 2 : 0),
  );

  const benefitDensityScore =
    strategyKind === "transaction_seed"
      ? clampScore(benefitHitCount >= 5 ? 20 : benefitHitCount >= 3 ? 15 : benefitHitCount >= 1 ? 9 : 2)
      : clampScore(benefitHitCount >= 3 ? 18 : benefitHitCount >= 1 ? 12 : 8);

  const evidenceScore = clampScore(
    (materialBackedCount / totalShots) * 14 +
      (shots.filter((shot) => normalizeText(shot.evidenceTarget).length > 0).length / totalShots) * 6,
  );

  const conversionScore = clampScore(
    (strategyKind === "transaction_seed" && riskReversalPattern.test(`${text} ${lastText}`) ? 8 : 0) +
      (actionPattern.test(`${text} ${lastText}`) ? 8 : 3) +
      (/(closing|收尾|转化|行动|建议)/iu.test(lastText) ? 4 : 0),
  );

  if (hookScore < 14) {
    findings.push("前 3 秒钩子偏弱，建议补足地域/人群/强利益中的至少两项。");
  }
  if (strategyKind === "transaction_seed" && identityOpportunityScore < 14) {
    findings.push("前 8 秒应更早讲清主体、开业/促销/价格机会。");
  }
  if (strategyKind === "transaction_seed" && benefitDensityScore < 14) {
    findings.push("中段权益密度不足，交易型种草需要连续给早餐、正餐、托管、设施、门票等可感知利益。");
  }
  if (evidenceScore < 12) {
    findings.push("素材证明偏弱，建议让每个核心卖点都有对应实拍镜头。");
  }
  if (conversionScore < 12) {
    findings.push("结尾转化不足，建议补充可退、有效期、涨价/库存或明确行动引导。");
  }

  return {
    hookScore,
    identityOpportunityScore,
    benefitDensityScore,
    evidenceScore,
    conversionScore,
    totalScore: hookScore + identityOpportunityScore + benefitDensityScore + evidenceScore + conversionScore,
    findings,
  };
}

function resolveCoreHook(sourceText: string, strategyKind: CommercialStrategyKind) {
  const lines = sourceText
    .split(/[。！？；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const strongLine = lines.find((line) =>
    strategyKind === "transaction_seed"
      ? opportunityPattern.test(line) || transactionPattern.test(line)
      : strategyKind === "guide_route"
        ? guidePattern.test(line)
        : identityPattern.test(line) || experiencePattern.test(line),
  );
  return strongLine?.slice(0, 48) || strategyMetaMap[strategyKind].coreHookFallback;
}

const transactionBeatTemplates: Array<Omit<CommercialBeatPlanItem, "targetShotIndexes">> = [
  {
    phase: "attention_hook",
    title: "停留钩子",
    goal: "3 秒内抛出地域/目标人群/强利益，让用户知道这条视频和自己有关。",
    targetWindow: "0-3 秒",
    userQuestion: "这跟我有关吗？",
    recommendedCopyMove: "城市或场景 + 人群 + 最大利益点，不铺垫。",
    strength: "must",
  },
  {
    phase: "identity_confirmation",
    title: "身份确认",
    goal: "快速讲清品牌、地点、项目，建立真实感和识别度。",
    targetWindow: "3-6 秒",
    userQuestion: "到底是哪？靠谱吗？",
    recommendedCopyMove: "品牌/项目名单独成句，画面优先门头、外观、标识。",
    strength: "strong",
  },
  {
    phase: "opportunity_offer",
    title: "机会抛出",
    goal: "把开业、大促、低价、限时、库存等机会前置。",
    targetWindow: "5-10 秒",
    userQuestion: "为什么现在要看？",
    recommendedCopyMove: "直接说开业大促、下周就没了、刷到先囤等机会句。",
    strength: "must",
  },
  {
    phase: "core_benefit",
    title: "核心利益",
    goal: "明确套餐/价格/适用时间，让用户知道能得到什么。",
    targetWindow: "8-16 秒",
    userQuestion: "我能得到什么？",
    recommendedCopyMove: "价格、晚数、一价全包、有效期用短句拆开。",
    strength: "must",
  },
  {
    phase: "benefit_stack",
    title: "权益轰炸",
    goal: "用短镜头连续堆权益，形成“东西很多、很值”的感受。",
    targetWindow: "14-28 秒",
    userQuestion: "这么多东西值吗？",
    recommendedCopyMove: "早餐、正餐、托管、乐园、课程、门票等连续上屏。",
    strength: "strong",
  },
  {
    phase: "value_anchor",
    title: "价值锚定",
    goal: "用原价、品牌、位置或平日价格解释为什么划算。",
    targetWindow: "28-35 秒",
    userQuestion: "和原价比真的划算吗？",
    recommendedCopyMove: "平日价/品牌背书/区位优势只保留最有说服力的一两个点。",
    strength: "strong",
  },
  {
    phase: "risk_reversal",
    title: "风险解除",
    goal: "解决买错、不去、时间不合适的犹豫。",
    targetWindow: "34-39 秒",
    userQuestion: "买了会不会亏？",
    recommendedCopyMove: "不约可退、有效期长、周末可用等信息放在行动前。",
    strength: "strong",
  },
  {
    phase: "action_close",
    title: "行动收口",
    goal: "给明确下一步，短促有力，不拖尾。",
    targetWindow: "最后 2-4 秒",
    userQuestion: "我现在要干嘛？",
    recommendedCopyMove: "刷到先囤、快去囤、进直播间等动作句。",
    strength: "must",
  },
];

const guideBeatTemplates: Array<Omit<CommercialBeatPlanItem, "targetShotIndexes">> = [
  {
    phase: "attention_hook",
    title: "攻略钩子",
    goal: "用误区、认知差或强视觉画面抓住注意力。",
    targetWindow: "0-3 秒",
    userQuestion: "我是不是也会踩坑？",
    recommendedCopyMove: "第一次来很多人没玩对 / 这条路线更省心。",
    strength: "must",
  },
  {
    phase: "route_correction",
    title: "认知纠偏",
    goal: "先指出常规玩法的问题，再给出更优方案承诺。",
    targetWindow: "3-10 秒",
    userQuestion: "为什么要听你的？",
    recommendedCopyMove: "贵、绕、没意思、排队久等痛点只挑最强一个。",
    strength: "strong",
  },
  {
    phase: "itinerary_delivery",
    title: "路线交付",
    goal: "按时间、地点或步骤交付可执行路线。",
    targetWindow: "中段",
    userQuestion: "具体怎么安排？",
    recommendedCopyMove: "一天/一站一个小结论，字幕必须沿用同一句完整口播。",
    strength: "must",
  },
  {
    phase: "value_anchor",
    title: "价值总结",
    goal: "总结这条路线为什么值得收藏或照着走。",
    targetWindow: "后段",
    userQuestion: "这样安排值不值？",
    recommendedCopyMove: "少踩坑、省时间、孩子有收获、体验完整。",
    strength: "strong",
  },
  {
    phase: "action_close",
    title: "互动收口",
    goal: "引导收藏、关注或进直播间咨询。",
    targetWindow: "最后 3 秒",
    userQuestion: "下一步怎么做？",
    recommendedCopyMove: "想要详细安排就收藏/关注/进直播间。",
    strength: "soft",
  },
];

const showcaseBeatTemplates: Array<Omit<CommercialBeatPlanItem, "targetShotIndexes">> = [
  {
    phase: "attention_hook",
    title: "第一印象",
    goal: "用最强空间或氛围镜头建立观看理由。",
    targetWindow: "0-3 秒",
    userQuestion: "这地方有什么特别？",
    recommendedCopyMove: "一句话点出空间记忆点或适合场景。",
    strength: "strong",
  },
  {
    phase: "identity_confirmation",
    title: "主体确认",
    goal: "交代品牌、地点、空间类型。",
    targetWindow: "3-8 秒",
    userQuestion: "这是哪里？",
    recommendedCopyMove: "品牌/地点/空间定位短句说明。",
    strength: "strong",
  },
  {
    phase: "evidence_proof",
    title: "空间证明",
    goal: "用实拍画面证明品质、动线、细节和氛围。",
    targetWindow: "中段",
    userQuestion: "画面能证明什么？",
    recommendedCopyMove: "每个镜头只证明一个空间或体验点。",
    strength: "must",
  },
  {
    phase: "atmosphere_memory",
    title: "氛围记忆",
    goal: "用稳定画面收住调性，留下记忆点。",
    targetWindow: "后段",
    userQuestion: "我记住了什么？",
    recommendedCopyMove: "回到外观、全景、夜景或最有品质感的镜头。",
    strength: "soft",
  },
];

function getBeatTemplates(strategyKind: CommercialStrategyKind) {
  if (strategyKind === "transaction_seed") {
    return transactionBeatTemplates;
  }
  if (strategyKind === "guide_route") {
    return guideBeatTemplates;
  }
  return showcaseBeatTemplates;
}

function inferShotPhase(shot: ShotPlanItem, index: number, shotCount: number, strategyKind: CommercialStrategyKind): CommercialBeatPhase {
  if (shot.commercialPhase) {
    return shot.commercialPhase;
  }
  const text = getShotText(shot);
  if (index === 0 || /(hook|开场|钩子|吸引|第一眼|全新|新开|大品牌|巨无霸)/iu.test(text)) {
    return "attention_hook";
  }
  if (index === shotCount - 1 || /(closing|收尾|行动|关注|收藏|下单|先囤|快去囤)/iu.test(text)) {
    return "action_close";
  }
  if (strategyKind === "transaction_seed") {
    if (opportunityPattern.test(text)) return "opportunity_offer";
    if (/(价格|套餐|房券|一价全包|三天两晚|两晚|只要|\d+\s*(?:元|多))/u.test(text)) return "core_benefit";
    if (riskReversalPattern.test(text)) return "risk_reversal";
    if (/(平日|原价|性价比|划算|品牌|位置|C位|茶山|海景)/u.test(text)) return "value_anchor";
    if (benefitPattern.test(text)) return "benefit_stack";
    if (identityPattern.test(text)) return "identity_confirmation";
  }
  if (strategyKind === "guide_route") {
    if (/(没玩对|避坑|又贵|没意思|建议|按照|路线)/u.test(text)) return "route_correction";
    if (/(第[一二三四五六七八九十\d]+天|第一站|第二站|入园|交通|时间|路线|前往)/u.test(text)) return "itinerary_delivery";
  }
  if (identityPattern.test(text)) {
    return "identity_confirmation";
  }
  return strategyKind === "brand_showcase" ? "evidence_proof" : "evidence_proof";
}

function assignBeatShots(
  templates: Array<Omit<CommercialBeatPlanItem, "targetShotIndexes">>,
  strategyKind: CommercialStrategyKind,
  shotPlan?: ShotPlan | null,
): CommercialBeatPlanItem[] {
  const shots = [...(shotPlan?.shots ?? [])].sort((left, right) => left.shotIndex - right.shotIndex);
  const shotIndexesByPhase = new Map<CommercialBeatPhase, number[]>();
  shots.forEach((shot, index) => {
    const phase = inferShotPhase(shot, index, shots.length, strategyKind);
    shotIndexesByPhase.set(phase, [...(shotIndexesByPhase.get(phase) ?? []), shot.shotIndex]);
  });

  return templates.map((template, index) => ({
    ...template,
    targetShotIndexes:
      shotIndexesByPhase.get(template.phase) ??
      (shots[index] ? [shots[index]!.shotIndex] : []),
  }));
}

export function buildCommercialStrategyPlan(input: BuildCommercialStrategyPlanInput): TaskCommercialPlan {
  const strategyKind = inferCommercialStrategyKind(input);
  const meta = strategyMetaMap[strategyKind];
  const sourceText = collectSourceText(input);
  return {
    strategyKind,
    strategyLabel: meta.label,
    strategyReason: meta.reason,
    targetAudience: meta.targetAudience,
    coreHook: resolveCoreHook(sourceText, strategyKind),
    decisionPath: meta.decisionPath,
    score: scoreCommercialProgress(strategyKind, sourceText, input.shotPlan),
    beatPlan: assignBeatShots(getBeatTemplates(strategyKind), strategyKind, input.shotPlan),
  };
}

export function buildCommercialStrategyPromptContext(
  source: BuildCommercialStrategyPlanInput["source"],
  videoType?: VideoTaskVideoType | string | null,
) {
  const plan = buildCommercialStrategyPlan({ source, videoType });
  return {
    strategyKind: plan.strategyKind,
    strategyLabel: plan.strategyLabel,
    targetAudience: plan.targetAudience,
    coreHook: plan.coreHook,
    decisionPath: plan.decisionPath,
    requiredBeatPlan: plan.beatPlan.map((beat) => ({
      phase: beat.phase,
      title: beat.title,
      targetWindow: beat.targetWindow,
      userQuestion: beat.userQuestion,
      goal: beat.goal,
      recommendedCopyMove: beat.recommendedCopyMove,
      strength: beat.strength,
    })),
    scoringRubric: [
      "前 3 秒钩子强度 20 分：地域/人群/强利益要明确。",
      "前 8 秒主体和机会 20 分：品牌/地点/开业/价格/促销要尽早出现。",
      "权益密度 20 分：中段要连续给具体权益，不写空泛体验。",
      "素材证明 20 分：核心卖点要有对应实拍镜头或明确 AI 补镜头理由。",
      "结尾转化 20 分：价值锚定、风险解除和行动引导至少完成两项。",
    ],
  };
}
