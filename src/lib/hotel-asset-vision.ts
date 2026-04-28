import {
  assertModelUsagePreflight,
  ModelUsageBillingError,
  recordModelUsage,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";
import { getVisionRuntime } from "./vision-provider-config";
import type { HotelAssetSceneType } from "./video-task-schema";
import type {
  HotelAssetReviewStatus,
  HotelAssetShotScale,
  TaskHotelAssetRecord,
} from "./task-hotel-asset-store";

type VisionAssetInput = {
  imageDataUrl: string;
  width: number;
  height: number;
  fileName?: string | null;
  userNote?: string | null;
  preferredSceneType?: HotelAssetSceneType | null;
};

type HotelAssetAnalysisResult = Pick<
  TaskHotelAssetRecord,
  | "sceneType"
  | "subjectSummary"
  | "tags"
  | "compositionType"
  | "recommendedShotScale"
  | "isHeroCandidate"
  | "isCloseupCandidate"
  | "canDirectI2V"
  | "needEnhancement"
  | "qualityScore"
  | "commercialScore"
  | "reviewStatus"
> & {
  analysisMode: "model" | "fallback";
};

type RawHotelAssetVisionResult = {
  sceneType?: string;
  subjectSummary?: string;
  tags?: unknown;
  compositionType?: string;
  recommendedShotScale?: string;
  isHeroCandidate?: boolean;
  isCloseupCandidate?: boolean;
  canDirectI2V?: boolean;
  needEnhancement?: boolean;
  qualityScore?: number;
  commercialScore?: number;
  reviewStatus?: string;
};

const HOTEL_ASSET_ANALYSIS_SYSTEM_PROMPT = [
  "你是酒店探店视频的素材识别与镜头规划助手。",
  "你需要分析酒店实拍图片，输出严格 JSON，不要输出 markdown。",
  "目标不是提取商品信息，而是识别这张图属于什么酒店场景，并判断它是否适合生成真实感强、场景还原度高的酒店探店短视频镜头。",
  "",
  "请遵守：",
  "1. 只基于图片中真实存在的内容判断，不要幻想不存在的空间、家具、人物或设施。",
  "2. 如果用户提供了场景偏好，请尽量优先采用该场景，除非明显冲突。",
  "3. sceneType 仅可取：exterior,lobby,room,bathroom,dining,food,facility,neighborhood,service_detail,atmosphere,other。",
  "4. recommendedShotScale 仅可取：wide,medium,close,detail。",
  "5. reviewStatus 仅可取：passed,warning,rejected。",
  "6. qualityScore 与 commercialScore 取 0-100 的整数。",
  "7. subjectSummary 请用一句中文概括主体内容，避免空泛词。",
  "",
  "判断重点：",
  "- 是否适合作为酒店探店视频首镜头/主镜头",
  "- 是否适合做近景或特写",
  "- 是否可以直接图生视频，还是更适合先做图像增强",
  "- 画面是否清晰、构图是否稳定、商业表达是否明确",
  "",
  '输出格式：{"sceneType":"...","subjectSummary":"...","tags":["..."],"compositionType":"...","recommendedShotScale":"wide|medium|close|detail","isHeroCandidate":true,"isCloseupCandidate":false,"canDirectI2V":true,"needEnhancement":false,"qualityScore":88,"commercialScore":86,"reviewStatus":"passed"}',
].join("\n");

function normalizeSceneType(value: string | null | undefined): HotelAssetSceneType {
  switch (value) {
    case "exterior":
    case "lobby":
    case "room":
    case "bathroom":
    case "dining":
    case "food":
    case "facility":
    case "neighborhood":
    case "service_detail":
    case "atmosphere":
      return value;
    default:
      return "other";
  }
}

function normalizeShotScale(value: string | null | undefined): HotelAssetShotScale {
  switch (value) {
    case "wide":
    case "medium":
    case "close":
    case "detail":
      return value;
    default:
      return "medium";
  }
}

function normalizeReviewStatus(value: string | null | undefined): HotelAssetReviewStatus {
  switch (value) {
    case "passed":
    case "warning":
    case "rejected":
      return value;
    default:
      return "warning";
  }
}

function clampScore(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function stripCodeFence(content: string) {
  const normalized = content.trim();
  if (normalized.startsWith("```")) {
    return normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return normalized;
}

function normalizeApiUrl(apiBase: string, endpoint: string) {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  return `${apiBase.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
}

function detectSceneTypeFromText(text: string): HotelAssetSceneType | null {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return null;
  }
  if (/(门头|外观|外立面|酒店楼体|到达|drop off|外景|招牌|入口)/.test(normalized)) {
    return "exterior";
  }
  if (/(大堂|前台|接待|大厅|lobby|reception)/.test(normalized)) {
    return "lobby";
  }
  if (/(客房|卧室|双床|大床|套房|房间|床品|room|suite)/.test(normalized)) {
    return "room";
  }
  if (/(卫浴|浴室|洗手台|马桶|浴缸|淋浴|bath)/.test(normalized)) {
    return "bathroom";
  }
  if (/(餐厅|用餐|晚餐|包厢|dining|restaurant)/.test(normalized)) {
    return "dining";
  }
  if (/(早餐|甜品|菜品|餐食|摆盘|food|buffet)/.test(normalized)) {
    return "food";
  }
  if (/(泳池|健身房|会议室|儿童乐园|spa|温泉|设施|facility|gym|pool)/.test(normalized)) {
    return "facility";
  }
  if (/(周边|街景|海边|山景|景观|商圈|neighborhood|view)/.test(normalized)) {
    return "neighborhood";
  }
  if (/(欢迎礼|服务|摆件|香薰|洗漱包|细节|服务细节|service)/.test(normalized)) {
    return "service_detail";
  }
  if (/(氛围|光影|窗景|夜景|atmosphere)/.test(normalized)) {
    return "atmosphere";
  }
  return null;
}

function inferDefaultShotScale(sceneType: HotelAssetSceneType): HotelAssetShotScale {
  switch (sceneType) {
    case "food":
    case "service_detail":
      return "detail";
    case "bathroom":
      return "close";
    case "exterior":
    case "lobby":
    case "room":
    case "dining":
    case "facility":
    case "neighborhood":
      return "wide";
    default:
      return "medium";
  }
}

export function buildFallbackHotelAssetAnalysis(input: VisionAssetInput): HotelAssetAnalysisResult {
  const orientation = input.width > input.height ? "landscape" : input.width < input.height ? "portrait" : "square";
  const noteText = `${input.userNote ?? ""} ${input.fileName ?? ""}`.trim();
  const inferredSceneType = input.preferredSceneType ?? detectSceneTypeFromText(noteText) ?? "other";
  const longerEdge = Math.max(input.width, input.height);
  const shorterEdge = Math.min(input.width, input.height);
  const qualityBase = longerEdge >= 1800 ? 86 : longerEdge >= 1280 ? 76 : longerEdge >= 960 ? 68 : 56;
  const ratioPenalty = shorterEdge < 720 ? 8 : 0;
  const qualityScore = Math.max(42, qualityBase - ratioPenalty);
  const commercialBonus =
    inferredSceneType === "exterior" || inferredSceneType === "lobby" || inferredSceneType === "room" ? 6 : 0;
  const commercialScore = Math.max(40, Math.min(96, qualityScore + commercialBonus));
  const reviewStatus: HotelAssetReviewStatus = qualityScore >= 72 ? "passed" : qualityScore >= 58 ? "warning" : "rejected";
  const recommendedShotScale = inferDefaultShotScale(inferredSceneType);

  return {
    sceneType: inferredSceneType,
    subjectSummary: input.userNote?.trim() || `${sceneLabelMap[inferredSceneType]}实拍图`,
    tags: Array.from(new Set([sceneLabelMap[inferredSceneType], orientation, recommendedShotScale])).filter(Boolean),
    compositionType: orientation === "landscape" ? "横向稳定构图" : orientation === "portrait" ? "纵向主视觉构图" : "居中方构图",
    recommendedShotScale,
    isHeroCandidate:
      qualityScore >= 72 && orientation !== "portrait" && ["exterior", "lobby", "room"].includes(inferredSceneType),
    isCloseupCandidate: ["food", "service_detail", "bathroom"].includes(inferredSceneType),
    canDirectI2V: qualityScore >= 64,
    needEnhancement: qualityScore < 72,
    qualityScore,
    commercialScore,
    reviewStatus,
    analysisMode: "fallback",
  };
}

const sceneLabelMap: Record<HotelAssetSceneType, string> = {
  exterior: "酒店外观",
  lobby: "酒店大堂",
  room: "客房",
  bathroom: "卫浴",
  dining: "餐厅",
  food: "餐食",
  facility: "配套设施",
  neighborhood: "周边环境",
  service_detail: "服务细节",
  atmosphere: "氛围镜头",
  other: "其他场景",
};

function sanitizeAnalysisResult(raw: RawHotelAssetVisionResult, fallback: HotelAssetAnalysisResult): HotelAssetAnalysisResult {
  const sceneType = normalizeSceneType(raw.sceneType ?? fallback.sceneType);
  return {
    sceneType,
    subjectSummary: raw.subjectSummary?.trim() || fallback.subjectSummary,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : fallback.tags,
    compositionType: raw.compositionType?.trim() || fallback.compositionType,
    recommendedShotScale: normalizeShotScale(raw.recommendedShotScale ?? fallback.recommendedShotScale),
    isHeroCandidate: Boolean(raw.isHeroCandidate ?? fallback.isHeroCandidate),
    isCloseupCandidate: Boolean(raw.isCloseupCandidate ?? fallback.isCloseupCandidate),
    canDirectI2V: Boolean(raw.canDirectI2V ?? fallback.canDirectI2V),
    needEnhancement: Boolean(raw.needEnhancement ?? fallback.needEnhancement),
    qualityScore: clampScore(raw.qualityScore, fallback.qualityScore),
    commercialScore: clampScore(raw.commercialScore, fallback.commercialScore),
    reviewStatus: normalizeReviewStatus(raw.reviewStatus ?? fallback.reviewStatus),
    analysisMode: "model",
  };
}

export function getHotelAssetVisionProviderMeta() {
  const runtime = getVisionRuntime();
  return {
    providerLabel: runtime.providerLabel,
    modelId: runtime.modelId,
    liveEnabled: runtime.liveEnabled,
    hasApiKey: runtime.hasApiKey,
    configFileName: runtime.configFileName,
  };
}

export async function analyzeHotelAssetImage(input: VisionAssetInput): Promise<HotelAssetAnalysisResult> {
  const runtime = getVisionRuntime();
  const fallback = buildFallbackHotelAssetAnalysis(input);

  if (!runtime.liveEnabled) {
    return fallback;
  }

  try {
    const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
    assertModelUsagePreflight({
      pricingKey,
      serviceName: "vision.hotel_asset_analysis",
    });

    const response = await fetch(normalizeApiUrl(runtime.apiBase, runtime.chatEndpoint), {
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
          {
            role: "system",
            content: HOTEL_ASSET_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `用户补充说明：${input.userNote?.trim() || "无"}`,
                  `用户预设场景：${input.preferredSceneType ?? "auto"}`,
                  `原始文件名：${input.fileName?.trim() || "unknown"}`,
                  `图片尺寸：${input.width}x${input.height}`,
                  "",
                  "请识别这张酒店实拍图片在酒店探店视频中的素材价值，并按 JSON 返回。",
                ].join("\n"),
              },
              {
                type: "image_url",
                image_url: {
                  url: input.imageDataUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
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
      return fallback;
    }

    recordModelUsage({
      pricingKey,
      serviceName: "vision.hotel_asset_analysis",
      provider: runtime.providerLabel,
      modelId: runtime.modelId,
      metrics: {
        inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
        outputTokens: Number(payload.usage?.completion_tokens ?? 0),
        cachedInputTokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens ?? 0),
        requestCount: 1,
      },
      requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
      remark: "酒店探店素材识别",
    });

    const content = payload.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      return fallback;
    }

    const parsed = JSON.parse(stripCodeFence(content)) as RawHotelAssetVisionResult;
    return sanitizeAnalysisResult(parsed, fallback);
  } catch (error) {
    if (error instanceof ModelUsageBillingError) {
      throw error;
    }
    return fallback;
  }
}
