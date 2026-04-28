import { extractBestJsonObject } from "./llm-json";
import { assertModelUsagePreflight, recordModelUsage, resolveDefaultModelPricingKey } from "./model-usage-service";
import { getDirectorPromptOptimizerRuntime } from "./director-video-generation-runtime";
import {
  type VideoTaskExpectedDurationRange,
  type VideoTaskSource,
  type VideoTaskVideoType,
} from "./video-task-schema";

export type TaskPromptOptimizationResult = {
  intentSummary: string;
  upgradedPrompt: string;
  mustKeep: string[];
  mustAvoid: string[];
  missingInfo: string[];
};

export type TaskPromptOptimizationInput = {
  title?: string | null;
  productInfoTitle?: string | null;
  productInfoSnapshot?: string | null;
  userPrompt: string;
  videoTemplatePrompt?: string | null;
  videoType: VideoTaskVideoType;
  videoTypeLabel?: string;
  expectedDurationRange?: VideoTaskExpectedDurationRange | string;
  expectedDurationLabel?: string;
  aspectRatio?: string;
};

const requiredOptimizationFields = ["intentSummary", "upgradedPrompt", "mustKeep", "mustAvoid", "missingInfo"];

function supportsTemperatureOverride(modelId: string) {
  return !/^gpt-5(?:[.-]|$)/i.test(modelId.trim());
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackOptimization(input: TaskPromptOptimizationInput): TaskPromptOptimizationResult {
  const userPrompt = input.userPrompt.trim();
  const productTitle = input.productInfoTitle?.trim();
  const duration = input.expectedDurationLabel?.trim();
  const videoType = input.videoTypeLabel?.trim() || input.videoType;
  const contextParts = [
    productTitle ? `产品/主题：${productTitle}` : "",
    videoType ? `视频类型：${videoType}` : "",
    duration ? `期望时长：${duration}` : "",
    input.aspectRatio ? `画面比例：${input.aspectRatio}` : "",
  ].filter(Boolean);

  return {
    intentSummary: userPrompt || productTitle || "根据已有商品信息生成旅行短视频",
    upgradedPrompt: [contextParts.join("；"), userPrompt].filter(Boolean).join("\n"),
    mustKeep: userPrompt ? [userPrompt] : [],
    mustAvoid: ["不要编造用户未提供的价格、服务、优惠、路线和承诺"],
    missingInfo: [],
  };
}

function parseOptimizationResponse(raw: string, input: TaskPromptOptimizationInput): TaskPromptOptimizationResult {
  const json = extractBestJsonObject(raw, requiredOptimizationFields);
  if (!json) {
    return fallbackOptimization(input);
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const fallback = fallbackOptimization(input);
    const upgradedPrompt =
      typeof parsed.upgradedPrompt === "string" && parsed.upgradedPrompt.trim()
        ? parsed.upgradedPrompt.trim()
        : fallback.upgradedPrompt;

    return {
      intentSummary:
        typeof parsed.intentSummary === "string" && parsed.intentSummary.trim()
          ? parsed.intentSummary.trim()
          : fallback.intentSummary,
      upgradedPrompt,
      mustKeep: normalizeTextList(parsed.mustKeep),
      mustAvoid: normalizeTextList(parsed.mustAvoid),
      missingInfo: normalizeTextList(parsed.missingInfo),
    };
  } catch {
    return fallbackOptimization(input);
  }
}

export function buildPlanningSourceWithOptimizedPrompt(source: VideoTaskSource): VideoTaskSource {
  const optimizedPrompt = source.optimizedUserPrompt?.trim() ?? "";
  if (!optimizedPrompt) {
    return source;
  }

  const originalPrompt = source.userPrompt.trim();
  const userPrompt = [
    originalPrompt ? `用户原始提示词：${originalPrompt}` : "",
    `系统优化后的创作提示词：${optimizedPrompt}`,
    "生成镜头计划时，以系统优化后的创作提示词为主要创作简报，同时不得违背用户原始提示词。",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ...source,
    userPrompt,
  };
}

export async function optimizeTaskCreationUserPrompt(
  input: TaskPromptOptimizationInput,
): Promise<{ result: TaskPromptOptimizationResult; usedFallback: boolean; providerLabel: string }> {
  const runtime = getDirectorPromptOptimizerRuntime();
  const fallback = fallbackOptimization(input);

  if (!input.userPrompt.trim()) {
    return { result: fallback, usedFallback: true, providerLabel: runtime.providerLabel };
  }

  if (!runtime.liveEnabled) {
    return { result: fallback, usedFallback: true, providerLabel: runtime.providerLabel };
  }

  const systemPrompt = [
    "你是旅行短视频导演的创作简报整理助手。",
    "任务：把用户输入的粗糙想法升级为可直接用于镜头计划生成的创作提示词。",
    "你只能增强表达、梳理结构和补充可拍摄方向，不能改变用户原意。",
    "严禁编造用户未提供的价格、服务、优惠、路线、品牌承诺和政策。",
    "输出必须是 JSON 对象，不要 markdown，不要解释。",
    "JSON 字段必须包含：intentSummary, upgradedPrompt, mustKeep, mustAvoid, missingInfo。",
    "upgradedPrompt 要写成一段完整创作要求，适合后续生成镜头计划、画面提示词、字幕和配音。",
  ].join("\n");

  const userContent = [
    `任务名称：${input.title?.trim() || "未填写"}`,
    `商品/主题：${input.productInfoTitle?.trim() || "未选择"}`,
    `视频类型：${input.videoTypeLabel?.trim() || input.videoType}`,
    `期望时长：${input.expectedDurationLabel?.trim() || input.expectedDurationRange || "未指定"}`,
    `画面比例：${input.aspectRatio?.trim() || "未指定"}`,
    "",
    "商品信息摘要：",
    input.productInfoSnapshot?.trim().slice(0, 1200) || "（无）",
    "",
    "参考视频模板提示词：",
    input.videoTemplatePrompt?.trim().slice(0, 800) || "（无）",
    "",
    "用户原始提示词：",
    input.userPrompt.trim(),
  ].join("\n");

  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "llm.chat",
  });

  const response = await fetch(`${runtime.apiBase}${runtime.chatEndpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.modelId,
      ...(supportsTemperatureOverride(runtime.modelId) ? { temperature: 0.2 } : {}),
      max_completion_tokens: 1800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
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
    throw new Error(payload.error?.message ?? "优化提示词生成失败");
  }

  recordModelUsage({
    pricingKey,
    serviceName: "llm.chat",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
      outputTokens: Number(payload.usage?.completion_tokens ?? 0),
      cachedInputTokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    },
    requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
    remark: "导演模式用户提示词优化",
  });

  return {
    result: parseOptimizationResponse(payload.choices?.[0]?.message?.content ?? "", input),
    usedFallback: false,
    providerLabel: runtime.providerLabel,
  };
}
