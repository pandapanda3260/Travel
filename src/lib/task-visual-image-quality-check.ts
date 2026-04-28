import type { ImageGenerationResult } from "./image-provider";
import {
  assertModelUsagePreflight,
  ModelUsageBillingError,
  recordModelUsage,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";
import { getVisionRuntime } from "./vision-provider-config";

export type TaskVisualImageQualityStatus = "unchecked" | "passed" | "warning" | "failed";

export type TaskVisualImageQualityCheck = {
  status: TaskVisualImageQualityStatus;
  retrySuggested: boolean;
  issues: string[];
  summary: string;
  scorePenalty: number;
  checkedAt: string | null;
};

type ReviewInput = {
  prompt: string;
  shotTitle: string;
  hasMainCharacter: boolean;
  sceneContextText?: string;
  assets: ImageGenerationResult[];
};

type ReviewOutput = {
  enabled: boolean;
  checked: boolean;
  validCount: number;
  results: TaskVisualImageQualityCheck[];
};

type RawReviewResult = {
  index?: number;
  status?: string;
  retrySuggested?: boolean;
  issues?: unknown;
  summary?: string;
};

const ANATOMY_ISSUE_PATTERN =
  /多手|多臂|多腿|多脚|额外肢体|第三只手|第三只脚|肢体数量异常|错位手脚|融合身体|畸形肢体|extra limb|extra arm|extra hand|extra leg/i;

const TRAFFIC_OR_TAXI_CRITICAL_PATTERNS = [
  /右舵|right-hand drive|right hand drive/i,
  /驾驶员.*右侧|司机.*右侧|driver on the right/i,
  /日本出租车|日式出租车|日系出租车|Crown Comfort|JPN Taxi|东京出租车/i,
  /海外出租车|纽约黄的士|伦敦黑出租/i,
  /左侧通行|靠左行驶|keep left/i,
  /道路方向错误|交通规则错误|不符合中国大陆右侧通行|非中国大陆右侧通行/i,
  /(?:长城上|长城城墙上|城墙上|墙顶步道|敌楼上|敌楼里).*(出租车|观光车|固定座椅|停车位白线|停车格|停车场线框)/i,
  /(出租车|观光车|固定座椅|停车位白线|停车格|停车场线框).*(?:长城上|长城城墙上|城墙上|墙顶步道|敌楼上|敌楼里)/i,
  /(?:不是停车场|并非停车场|非停车场|普通道路路边|普通路边停靠|路边临停).*(停车位白线|停车格|停车场线框)/i,
  /(停车位白线|停车格|停车场线框).*(?:不是停车场|并非停车场|非停车场|普通道路路边|普通路边停靠|路边临停)/i,
] as const;

const TRAFFIC_OR_TAXI_NEGATED_PATTERNS = [
  /没有右舵|未见右舵|无右舵|不是右舵|并非右舵/i,
  /驾驶员.*左侧|司机.*左侧|left-hand drive|left hand drive/i,
  /不是日本出租车|并非日本出租车|未见日式出租车|无日式出租车/i,
  /符合中国大陆右侧通行|道路方向正确|交通规则正确/i,
  /合法停车场|停车场场景|停车位白线合理|停车格合理|合法上客区|合法下客区|落客区白线合理/i,
] as const;

const TEXT_OR_LAYOUT_CRITICAL_PATTERNS = [
  /(出现|有|存在|带有|含有).*(文字|汉字|中文字|英文|字母|数字|文本|标识|logo|水印|标牌文字|招牌文字|字幕|text|letters|words|numbers|watermark|caption|subtitle)/i,
  /(文字|汉字|中文字|英文|字母|数字|文本|标识|logo|水印|标牌文字|招牌文字|字幕|text|letters|words|numbers|watermark|caption|subtitle).*(残留|露出|可见|明显|清晰|错误|出现在画面)/i,
  /(拼图|拼贴|分屏|多画面|多图拼接|网格|并排对比|collage|split screen|multi-panel|grid|diptych|triptych)/i,
] as const;

const TEXT_OR_LAYOUT_NEGATED_PATTERNS = [
  /无文字|没有文字|未见文字|不是文字|并无文字|未出现文字/i,
  /无水印|没有水印|未见水印|不是水印|并无水印/i,
  /无logo|没有logo|未见logo|不是logo|并无logo/i,
  /无拼图|没有拼图|未见拼图|不是拼图/i,
  /无分屏|没有分屏|未见分屏|不是分屏/i,
] as const;

const ORIENTATION_CRITICAL_PATTERNS = [
  /(横图|横版|横向画面|横向内容|landscape|horizontal).*(塞进|放进|挤进|出现在|误塞到).*(竖图|竖版|9:16|portrait)/i,
  /(横图|横版|横向画面|横向内容|横版构图|16:9|landscape|horizontal).*(不符合|不满足|未满足|违背|偏离|不适合).*(竖图|竖版|竖版构图|9:16|portrait)/i,
  /(不符合|不满足|未满足|违背|偏离|不适合).*(竖图|竖版|竖版构图|9:16|portrait).*(横图|横版|横向|横版构图|16:9|landscape|horizontal)/i,
  /(竖版|竖图|9:16|portrait).*(却|但是|然而|结果).*(横图|横版|横向|sideways|rotated)/i,
  /(画面|主体|建筑|楼体|地平线|场景).*(横着|侧着|歪着|旋转90度|转了90度|被旋转|sideways|turnedsideways|rotated90)/i,
  /图片实际是横版|实际为横版|实际是横图|实际为横图|横向内容塞进竖版|竖版画布里是横图|横图塞进竖图|内容方向错误|构图方向错误|画面整体横着|整体侧着/i,
] as const;

const ORIENTATION_NEGATED_PATTERNS = [
  /符合竖版|竖版构图正确|纵向构图正确|9:16构图正确|portraitorientationcorrect/i,
  /没有横图|未见横图|不是横图|并非横图|无横图/i,
  /无旋转|没有旋转|未见旋转|方向正确|构图方向正确/i,
] as const;

const IMAGE_QUALITY_CHECK_SYSTEM_PROMPT = [
  "你是一名短视频参考图质量审核员。",
  "请逐张检查候选图片是否满足提示词要求，并输出严格 JSON。",
  "不要输出 markdown，不要解释，不要补充多余字段。",
  "",
  "重点检查：",
  "1. 人物解剖是否自然，不能出现多手、多胳膊、多腿、多脚、缺失肢体、融合身体、错位手脚、儿童长出第三只手等问题。",
  "2. 人物数量、主体关系、年龄、外貌、服装、角色是否符合提示词。",
  "3. 如果提示词要求无人主体/无主角人物，就不能出现明显人物主体。",
  "4. 如果提示词限制了司机、西装、老人、中老年、东方面孔等，也必须严格符合。",
  "5. 如果提示词涉及出租车或专车接人场景，车辆要符合中国大陆常见出租车/专车外观，不能像日本或其他海外出租车；驾驶员必须位于车内左侧驾驶位（左舵），不要右舵；道路呈现要符合中国大陆右侧通行规则。",
  "6. 如果提示词涉及出租车，要重点排查是否误生成日本 Crown Comfort、JPN Taxi 这类日式出租车外形，或把司机画在车内右侧。",
  "7. 如果画面主体是长城城墙、敌楼或墙顶步道等古迹空间，不要出现出租车、观光车、固定座椅、停车位白线、停车格或现代停车场设施。",
  "8. 如果出租车或专车只是停靠在普通道路路边，且提示词没有明确说明是停车场、停车位或上客区，不要出现停车位白线、停车格或停车场线框。",
  "9. 不能有文字、水印、拼图、分屏、明显不真实的结构。",
  "10. 如果当前提示词或画幅要求是竖图/9:16/portrait，就不能出现横图内容硬塞进竖版画布、主体整体横着、画面旋转90度、建筑或地平线 sideways 这类方向错误。",
  "",
  "判定标准：",
  "- passed：符合要求，可直接使用。",
  "- warning：大体可用，但有轻微偏差。",
  "- failed：明显不符合，建议重生成。",
  "- 一旦出现文字、水印、拼图、分屏、画面方向错误、横图内容塞进竖版、右舵/日式出租车/错误道路规则等问题，应直接判 failed。",
  "",
  '输出格式：{"results":[{"index":1,"status":"passed|warning|failed","retrySuggested":true,"issues":["..."],"summary":"..."}]}',
].join("\n");

function stripCodeFence(text: string) {
  const normalized = text.trim();
  if (normalized.startsWith("```")) {
    return normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return normalized;
}

function normalizeStatus(status: string | undefined): TaskVisualImageQualityStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "passed":
    case "pass":
      return "passed";
    case "warning":
    case "warn":
      return "warning";
    case "failed":
    case "fail":
      return "failed";
    default:
      return "unchecked";
  }
}

function buildUncheckedResults(count: number): TaskVisualImageQualityCheck[] {
  return Array.from({ length: count }, () => ({
    status: "unchecked",
    retrySuggested: false,
    issues: [],
    summary: "",
    scorePenalty: 0,
    checkedAt: null,
  }));
}

function sanitizeIssueText(text: string) {
  return text.replace(/\s+/g, "").trim();
}

function hasCriticalIssuePattern(
  text: string,
  criticalPatterns: readonly RegExp[],
  negatedPatterns: readonly RegExp[] = [],
) {
  const normalized = sanitizeIssueText(text);
  if (!normalized) {
    return false;
  }
  const strippedNegatedText = negatedPatterns.reduce(
    (currentText, pattern) => currentText.replace(pattern, ""),
    normalized,
  );
  if (!strippedNegatedText) {
    return false;
  }
  return criticalPatterns.some((pattern) => pattern.test(strippedNegatedText));
}

function isCriticalTrafficOrTaxiIssueText(text: string) {
  return hasCriticalIssuePattern(text, TRAFFIC_OR_TAXI_CRITICAL_PATTERNS, TRAFFIC_OR_TAXI_NEGATED_PATTERNS);
}

function isCriticalTextOrLayoutIssueText(text: string) {
  return hasCriticalIssuePattern(text, TEXT_OR_LAYOUT_CRITICAL_PATTERNS, TEXT_OR_LAYOUT_NEGATED_PATTERNS);
}

function isCriticalOrientationIssueText(text: string) {
  return hasCriticalIssuePattern(text, ORIENTATION_CRITICAL_PATTERNS, ORIENTATION_NEGATED_PATTERNS);
}

function hasCriticalIssueInTexts(
  input: { issues?: string[]; summary?: string },
  matcher: (text: string) => boolean,
) {
  const issueTexts = (input.issues ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const texts = issueTexts.length > 0 ? issueTexts : [String(input.summary ?? "").trim()];
  return texts.some(matcher);
}

export function hasCriticalSceneRealismMismatch(input: { issues?: string[]; summary?: string }) {
  return hasCriticalIssueInTexts(input, isCriticalTrafficOrTaxiIssueText);
}

export function hasCriticalTrafficOrTaxiMismatch(input: { issues?: string[]; summary?: string }) {
  return hasCriticalSceneRealismMismatch(input);
}

export function hasCriticalTextOrLayoutMismatch(input: { issues?: string[]; summary?: string }) {
  return hasCriticalIssueInTexts(input, isCriticalTextOrLayoutIssueText);
}

export function hasCriticalOrientationMismatch(input: { issues?: string[]; summary?: string }) {
  return hasCriticalIssueInTexts(input, isCriticalOrientationIssueText);
}

function hasHardFailureVisualMismatch(input: { issues?: string[]; summary?: string }) {
  return (
    hasCriticalSceneRealismMismatch(input) ||
    hasCriticalTextOrLayoutMismatch(input) ||
    hasCriticalOrientationMismatch(input)
  );
}

function computeScorePenalty(status: TaskVisualImageQualityStatus, issues: string[], summary?: string) {
  const joinedIssues = [...issues, summary ?? ""].join("，");

  if (ANATOMY_ISSUE_PATTERN.test(joinedIssues)) {
    return 60;
  }

  if (hasHardFailureVisualMismatch({ issues, summary })) {
    return 55;
  }

  if (status === "failed") {
    return 45;
  }
  if (status === "warning") {
    return 18;
  }
  return 0;
}

export function normalizeTaskVisualImageQualityResult(input: {
  status?: string;
  retrySuggested?: boolean;
  issues?: unknown;
  summary?: string;
  checkedAt: string | null;
}): TaskVisualImageQualityCheck {
  const issues = Array.isArray(input.issues) ? input.issues.map((item) => String(item).trim()).filter(Boolean) : [];
  const summary = String(input.summary ?? "").trim();
  const inferredStatus = normalizeStatus(input.status);
  const criticalMismatch = hasHardFailureVisualMismatch({ issues, summary });
  const status = criticalMismatch ? "failed" : inferredStatus;

  return {
    status,
    retrySuggested: criticalMismatch || Boolean(input.retrySuggested) || status === "failed",
    issues,
    summary,
    scorePenalty: computeScorePenalty(status, issues, summary),
    checkedAt: input.checkedAt,
  };
}

function buildImageUrl(asset: ImageGenerationResult) {
  if (asset.url?.trim()) {
    return asset.url.trim();
  }
  if (asset.b64Json?.trim()) {
    return `data:image/png;base64,${asset.b64Json.trim()}`;
  }
  return "";
}

export function shouldRunTaskVisualImageSelfCheck(input: { assets: ImageGenerationResult[] }) {
  const runtime = getVisionRuntime();
  return runtime.liveEnabled && input.assets.length > 0;
}

export async function reviewTaskVisualImageBatch(input: ReviewInput): Promise<ReviewOutput> {
  const runtime = getVisionRuntime();
  if (!runtime.liveEnabled || input.assets.length === 0) {
    return {
      enabled: runtime.liveEnabled,
      checked: false,
      validCount: 0,
      results: buildUncheckedResults(input.assets.length),
    };
  }

  const imageDetail: "high" | "low" = input.hasMainCharacter ? "high" : "low";
  const imageContents = input.assets.flatMap<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
  >((asset, index) => {
    const url = buildImageUrl(asset);
    if (!url) {
      return [];
    }

    return [
      {
        type: "text" as const,
        text: `候选图 ${index + 1}`,
      },
      {
        type: "image_url" as const,
        image_url: {
          url,
          detail: imageDetail,
        },
      },
    ];
  });

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
  > = [
    {
      type: "text",
      text: [
        `当前镜头：${input.shotTitle}`,
        `镜头上下文：${input.sceneContextText?.trim() || "未提供"}`,
        `生成提示词：${input.prompt}`,
        "",
        "请逐张检查候选图是否满足提示词和人物规则。",
        "尤其要严查：人物手/胳膊/脚/腿数量是否自然、是否出现多手多脚或儿童多出一只手；是否出现不该有的人物主体；是否出现错误年龄/外貌/服装；出租车是否像日本或其他海外出租车、司机是否被画在车内右侧、道路行驶方向是否不符合中国大陆右侧通行规则、接人车辆是否斜停乱停；长城城墙、敌楼或墙顶步道上是否错误出现出租车、观光车、固定座椅、停车位白线或停车场设施；普通道路路边停靠场景若不是停车场/上客区，是否错误出现停车位白线或停车格；是否有文字、水印、拼图或明显结构错误。",
      ].join("\n"),
    },
    ...imageContents,
  ];

  try {
    const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
    assertModelUsagePreflight({
      pricingKey,
      serviceName: "image.self_check",
    });

    const response = await fetch(`${runtime.apiBase}${runtime.chatEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: runtime.modelId,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: IMAGE_QUALITY_CHECK_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        max_completion_tokens: 2200,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: {
          cached_tokens?: number;
        };
      };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "图片自检失败");
    }

    recordModelUsage({
      pricingKey,
      serviceName: "image.self_check",
      provider: runtime.providerLabel,
      modelId: runtime.modelId,
      metrics: {
        inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
        outputTokens: Number(payload.usage?.completion_tokens ?? 0),
        cachedInputTokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      },
      requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
      remark: "参考图自检",
    });

    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(stripCodeFence(content)) as { results?: RawReviewResult[] };
    const checkedAt = new Date().toISOString();
    const fallbackResults = buildUncheckedResults(input.assets.length);

    const results = fallbackResults.map((fallback, index) => {
      const raw = parsed.results?.find((item) => Number(item.index) === index + 1);
      return normalizeTaskVisualImageQualityResult({
        status: raw?.status,
        retrySuggested: raw?.retrySuggested,
        issues: raw?.issues,
        summary: raw?.summary,
        checkedAt,
      });
    });

    return {
      enabled: true,
      checked: true,
      validCount: results.filter((item) => item.status === "passed" || item.status === "warning").length,
      results,
    };
  } catch (error) {
    if (error instanceof ModelUsageBillingError) {
      throw error;
    }
    return {
      enabled: true,
      checked: false,
      validCount: 0,
      results: buildUncheckedResults(input.assets.length),
    };
  }
}
