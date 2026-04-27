import { countNarrationSpeechUnits } from "./narration";

export type NarrationHumanizationMetricKey =
  | "audience"
  | "trust"
  | "specificity"
  | "imagery"
  | "continuity"
  | "cadence";

export type NarrationHumanizationScore = {
  score: number;
  grade: "excellent" | "good" | "needs_work" | "poor";
  textLength: number;
  sentenceCount: number;
  avgSentenceLength: number;
  metrics: Record<NarrationHumanizationMetricKey, number>;
  hollowSignalCount: number;
  emptyClaimCount: number;
  strengths: string[];
  issues: string[];
  matchedSignals: Partial<Record<NarrationHumanizationMetricKey | "hollow" | "emptyClaim", string[]>>;
};

export type NarrationHumanizationTarget = {
  averageScore: number;
  minSampleScore: number;
  maxFlaggedRatio: number;
  metrics: Partial<Record<NarrationHumanizationMetricKey, number>>;
};

export type NarrationHumanizationTargetResult = {
  passed: boolean;
  averageScore: number;
  minSampleScore: number;
  flaggedRatio: number;
  metricAverages: Record<NarrationHumanizationMetricKey, number>;
  failures: string[];
};

export const NARRATION_HUMANIZATION_TARGET = {
  averageScore: 65,
  minSampleScore: 55,
  maxFlaggedRatio: 0.15,
  metrics: {
    audience: 55,
    trust: 50,
    imagery: 50,
    continuity: 55,
  },
} satisfies NarrationHumanizationTarget;

const sentenceSplitPattern = /(?<=[。！？；!?;])|[\n\r]+/u;
const narrationLabelPattern = /(?:^|[\n\r])\s*(?:片段|镜头|Shot|Segment)\s*\d+\s*[：:]/giu;

const audienceSignals = [
  "带孩子",
  "带娃",
  "孩子",
  "小朋友",
  "亲子",
  "家人",
  "一家",
  "父母",
  "老人",
  "情侣",
  "朋友",
  "宝子",
  "姐妹",
  "第一次",
  "新手",
  "有计划",
  "想来",
];

const audiencePatternSignals = [
  { label: "第一次来", pattern: /第一次来/u },
  { label: "想...的人", pattern: /想[^。！？；，,]{2,24}的人/u },
  { label: "不想...的人", pattern: /不想[^。！？；，,]{2,24}的人/u },
  { label: "家庭/爸妈", pattern: /(家庭|爸妈|妈妈|爸爸)/u },
];

const trustSignals = [
  "没玩对",
  "又贵",
  "没意思",
  "最怕",
  "少走",
  "不用",
  "避免",
  "别",
  "坑",
  "建议",
  "注意",
  "提前",
  "随时可退",
  "卖完",
  "下架",
  "不加价",
  "不约",
];

const trustPatternSignals = [
  { label: "最怕...", pattern: /最怕[^。！？；，,]{2,28}/u },
  { label: "不用...", pattern: /不用[^。！？；，,]{2,28}/u },
  { label: "不要/别...", pattern: /(不要|别)[^。！？；，,]{2,18}/u },
  { label: "不是...是...", pattern: /不是[^。！？；，,]{1,24}是/u },
  { label: "少折腾/少消耗", pattern: /少[^。！？；，,]{0,12}(折腾|消耗|绕路|赶路|排队)/u },
];

const specificSignals = [
  "早餐",
  "夜宵",
  "停车",
  "房间",
  "大床",
  "双床",
  "亲子房",
  "浴缸",
  "泳池",
  "儿童",
  "托管",
  "门票",
  "接送",
  "专车",
  "地铁",
  "步行",
  "分钟",
  "国博",
  "故宫",
  "景山",
  "什刹海",
  "天安门",
  "八达岭",
  "颐和园",
  "圆明园",
  "天坛",
  "长城",
  "表演",
  "演出",
  "手环",
  "取不下来",
  "一价全包",
  "两晚",
  "三天两晚",
];

const imagerySignals = [
  "到达",
  "走进",
  "看看",
  "登上",
  "俯瞰",
  "感受",
  "吹吹",
  "泛舟",
  "打卡",
  "观看",
  "前往",
  "穿过",
  "刷身份证",
  "拍下",
  "释放",
  "坐拥",
  "出门",
  "入住",
  "带着",
  "逛",
  "玩",
  "囤",
];

const imageryPatternSignals = [
  { label: "落地/到店", pattern: /(落地|到店|到门口)/u },
  { label: "拖箱/拎行李", pattern: /(拖着|拎着|拉着)[^。！？；，,]{0,10}(箱|行李)/u },
  { label: "找路/找车", pattern: /找(路|车|入口|位置)/u },
  { label: "入住/住进", pattern: /(入住|住进|安顿)/u },
  { label: "排队/换车", pattern: /(排队|换车|赶路|折返)/u },
  { label: "放下/坐下", pattern: /(放下|坐下来|慢慢坐|缓过来)/u },
  { label: "洗澡/睡觉", pattern: /(洗个热水澡|洗完澡|睡稳|哄睡)/u },
  {
    label: "看具体景点",
    pattern: /看[^。！？；，,]{0,12}(天安门|故宫|长城|八达岭|颐和园|圆明园|天坛|国博|博物馆|升旗|夜景)/u,
  },
  { label: "走到/转到", pattern: /(走到|走进|走过|转到|转进)/u },
  { label: "拍照/打卡", pattern: /(拍照|拍完|打卡)/u },
  { label: "儿童玩乐动作", pattern: /(冲一轮|喘口气|滑梯|水乐园)/u },
];

const continuitySignals = [
  "第一天",
  "第二天",
  "第三天",
  "第四天",
  "先",
  "再",
  "然后",
  "接着",
  "最后",
  "入园后",
  "看完",
  "出来",
  "回来时候",
  "从",
  "下午",
  "晚上",
  "早上",
];

const hollowSignals = [
  "直接抄作业",
  "这趟就值了",
  "最舒服",
  "顺路看",
  "照样轻松",
  "接得稳",
  "经典景点都逛到了",
  "看底蕴",
  "都安排好了",
  "整套体验都挺完整",
  "这一路线",
  "更省心",
  "很放松",
  "氛围也很放松",
];

const emptyClaimSignals = [
  "省心",
  "轻松",
  "舒服",
  "值得",
  "值了",
  "划算",
  "高级",
  "治愈",
  "宝藏",
  "好逛",
  "好住",
  "好玩",
  "不错",
];

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function matchLiteralSignals(text: string, signals: string[]) {
  return signals.filter((signal) => text.includes(signal));
}

function matchPatternSignals(text: string, signals: Array<{ label: string; pattern: RegExp }>) {
  return signals.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreByHits(hits: number, perHit: number, base = 0) {
  return clampScore(base + hits * perHit);
}

export function normalizeNarrationForHumanization(text: string) {
  return String(text ?? "")
    .replace(narrationLabelPattern, "。")
    .replace(/\s*[\n\r]+\s*/g, "。")
    .replace(/[ \t]+/g, "")
    .replace(/([。！？；!?;]){2,}/gu, "$1")
    .trim();
}

export function splitNarrationSentences(text: string) {
  const normalized = normalizeNarrationForHumanization(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(sentenceSplitPattern)
    .map((item) => item.replace(/[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]+$/u, "").trim())
    .filter(Boolean);
}

function countRegexMatches(text: string, regex: RegExp) {
  return text.match(regex)?.length ?? 0;
}

function getGrade(score: number): NarrationHumanizationScore["grade"] {
  if (score >= 78) return "excellent";
  if (score >= 65) return "good";
  if (score >= 48) return "needs_work";
  return "poor";
}

export function scoreNarrationHumanization(text: string): NarrationHumanizationScore {
  const normalized = normalizeNarrationForHumanization(text);
  const sentences = splitNarrationSentences(normalized);
  const textLength = countNarrationSpeechUnits(normalized);
  const avgSentenceLength = sentences.length
    ? Number(
        (sentences.reduce((sum, sentence) => sum + countNarrationSpeechUnits(sentence), 0) / sentences.length).toFixed(
          1,
        ),
      )
    : 0;

  const audienceHits = unique([
    ...matchLiteralSignals(normalized, audienceSignals),
    ...matchPatternSignals(normalized, audiencePatternSignals),
  ]);
  const trustHits = unique([
    ...matchLiteralSignals(normalized, trustSignals),
    ...matchPatternSignals(normalized, trustPatternSignals),
  ]);
  const specificHits = unique(matchLiteralSignals(normalized, specificSignals));
  const imageryHits = unique([
    ...matchLiteralSignals(normalized, imagerySignals),
    ...matchPatternSignals(normalized, imageryPatternSignals),
  ]);
  const continuityHits = unique(matchLiteralSignals(normalized, continuitySignals));
  const hollowHits = unique(matchLiteralSignals(normalized, hollowSignals));
  const emptyClaimHits = unique(matchLiteralSignals(normalized, emptyClaimSignals));
  const numericHitCount = countRegexMatches(normalized, /\d+|[一二三四五六七八九十百千万]+(天|晚|点|米|元|多|个|次)/gu);
  const pauseCount = countRegexMatches(normalized, /[，。！？；、：,.!?;]/gu);
  const evidenceHitCount = specificHits.length + Math.min(8, numericHitCount);

  const metrics: Record<NarrationHumanizationMetricKey, number> = {
    audience: scoreByHits(audienceHits.length, 28, /您|你们|大家|家人们|宝子/u.test(normalized) ? 10 : 0),
    trust: scoreByHits(trustHits.length, 22, /我发现|我的建议|建议|注意/u.test(normalized) ? 12 : 0),
    specificity: scoreByHits(evidenceHitCount, 9, 8),
    imagery: scoreByHits(imageryHits.length, 12),
    continuity: scoreByHits(continuityHits.length, 12, sentences.length >= 4 ? 12 : 0),
    cadence: clampScore(
      (sentences.length >= 4 ? 28 : sentences.length * 7) +
        (pauseCount >= Math.max(2, sentences.length) ? 28 : pauseCount * 6) +
        (avgSentenceLength >= 12 && avgSentenceLength <= 34 ? 32 : avgSentenceLength > 0 ? 16 : 0),
    ),
  };

  const hollowSignalCount = hollowHits.length;
  const unsupportedEmptyClaimCount = emptyClaimHits.filter((claim) => {
    const claimIndex = normalized.indexOf(claim);
    const windowText = normalized.slice(Math.max(0, claimIndex - 18), claimIndex + claim.length + 24);
    return !(
      matchLiteralSignals(windowText, specificSignals).length ||
      matchLiteralSignals(windowText, audienceSignals).length ||
      /\d+|因为|不用|避免|省掉|适合|所以|能让|可以/u.test(windowText)
    );
  }).length;

  const weightedScore =
    metrics.audience * 0.14 +
    metrics.trust * 0.16 +
    metrics.specificity * 0.22 +
    metrics.imagery * 0.18 +
    metrics.continuity * 0.14 +
    metrics.cadence * 0.16 -
    Math.min(28, hollowSignalCount * 7 + unsupportedEmptyClaimCount * 4);
  const score = clampScore(weightedScore);

  const strengths: string[] = [];
  const issues: string[] = [];
  if (metrics.audience >= 55) strengths.push("有明确对象感");
  else issues.push("对象感不足，没说清这句话是给谁听的");
  if (metrics.trust >= 55) strengths.push("有判断、提醒或避坑感");
  else issues.push("缺少真实判断或痛点，像在平铺信息");
  if (metrics.specificity >= 65) strengths.push("具体信息和证据充足");
  else issues.push("具体理由或画面证据不足");
  if (metrics.imagery >= 55) strengths.push("有动作和画面推进");
  else issues.push("缺少动作/感受/场景，容易像清单");
  if (metrics.continuity >= 55) strengths.push("前后承接较自然");
  else issues.push("句子之间承接弱，像孤立短句");
  if (metrics.cadence >= 65) strengths.push("口播节奏接近真人表达");
  else issues.push("停顿或句长节奏不够像真人口播");
  if (hollowSignalCount > 0) issues.push("存在空泛种草口号");
  if (unsupportedEmptyClaimCount > 0) issues.push("有抽象推荐词但缺少支撑");

  return {
    score,
    grade: getGrade(score),
    textLength,
    sentenceCount: sentences.length,
    avgSentenceLength,
    metrics,
    hollowSignalCount,
    emptyClaimCount: unsupportedEmptyClaimCount,
    strengths,
    issues: unique(issues),
    matchedSignals: {
      audience: audienceHits,
      trust: trustHits,
      specificity: unique([...specificHits, numericHitCount ? `${numericHitCount} 个数字/时长/价格信号` : ""]).filter(
        Boolean,
      ),
      imagery: imageryHits,
      continuity: continuityHits,
      hollow: hollowHits,
      emptyClaim: emptyClaimHits,
    },
  };
}

export function averageNarrationHumanizationScores(scores: NarrationHumanizationScore[]) {
  if (!scores.length) {
    return {
      score: 0,
      metrics: {
        audience: 0,
        trust: 0,
        specificity: 0,
        imagery: 0,
        continuity: 0,
        cadence: 0,
      } satisfies Record<NarrationHumanizationMetricKey, number>,
    };
  }
  const total = scores.reduce(
    (sum, item) => {
      sum.score += item.score;
      for (const key of Object.keys(item.metrics) as NarrationHumanizationMetricKey[]) {
        sum.metrics[key] += item.metrics[key];
      }
      return sum;
    },
    {
      score: 0,
      metrics: {
        audience: 0,
        trust: 0,
        specificity: 0,
        imagery: 0,
        continuity: 0,
        cadence: 0,
      } satisfies Record<NarrationHumanizationMetricKey, number>,
    },
  );

  return {
    score: Number((total.score / scores.length).toFixed(1)),
    metrics: Object.fromEntries(
      (Object.keys(total.metrics) as NarrationHumanizationMetricKey[]).map((key) => [
        key,
        Number((total.metrics[key] / scores.length).toFixed(1)),
      ]),
    ) as Record<NarrationHumanizationMetricKey, number>,
  };
}

export function evaluateNarrationHumanizationTarget(
  scores: NarrationHumanizationScore[],
  target: NarrationHumanizationTarget = NARRATION_HUMANIZATION_TARGET,
): NarrationHumanizationTargetResult {
  const average = averageNarrationHumanizationScores(scores);
  const minSampleScore = scores.length ? Math.min(...scores.map((score) => score.score)) : 0;
  const flaggedCount = scores.filter((score) => score.hollowSignalCount > 0 || score.emptyClaimCount > 0).length;
  const flaggedRatio = scores.length ? Number((flaggedCount / scores.length).toFixed(3)) : 0;
  const failures: string[] = [];

  if (average.score < target.averageScore) {
    failures.push(`平均分 ${average.score} 未达到 ${target.averageScore}`);
  }
  if (minSampleScore < target.minSampleScore) {
    failures.push(`最低单条分 ${minSampleScore} 未达到 ${target.minSampleScore}`);
  }
  if (flaggedRatio > target.maxFlaggedRatio) {
    failures.push(
      `空泛/无支撑命中比例 ${Math.round(flaggedRatio * 100)}% 高于 ${Math.round(target.maxFlaggedRatio * 100)}%`,
    );
  }
  for (const [key, expected] of Object.entries(target.metrics) as Array<[NarrationHumanizationMetricKey, number]>) {
    const actual = average.metrics[key];
    if (actual < expected) {
      failures.push(`${key} 均分 ${actual} 未达到 ${expected}`);
    }
  }

  return {
    passed: failures.length === 0,
    averageScore: average.score,
    minSampleScore,
    flaggedRatio,
    metricAverages: average.metrics,
    failures,
  };
}

export function shouldRewriteNarrationForHumanization(
  score: NarrationHumanizationScore,
  target: NarrationHumanizationTarget = NARRATION_HUMANIZATION_TARGET,
) {
  return !evaluateNarrationHumanizationTarget([score], target).passed;
}
