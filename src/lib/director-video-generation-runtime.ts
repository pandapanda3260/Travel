import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";
import {
  confirmCommercialModelUsageCharge,
  estimateTextModelUsageMetrics,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";

export type DirectorPromptOptimizerRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  chatEndpoint: string;
  providerLabel: string;
  configFileName: string;
};

export type DirectorPromptOptimizeTarget = "image" | "video";

type PromptOptimizerResult = {
  optimizedPrompt: string;
  runtime: DirectorPromptOptimizerRuntime;
  usedFallback: boolean;
};

function normalizeApiBase(apiBase: string) {
  return apiBase.replace(/\/$/, "");
}

function buildFallbackOptimizedPrompt(originalPrompt: string, modificationInstruction: string) {
  const source = originalPrompt.trim();
  const requirement = modificationInstruction.trim();
  if (!source && !requirement) {
    return "";
  }
  if (!requirement) {
    return source;
  }
  if (!source) {
    return requirement;
  }
  return `${source}\n\n优化要求：${requirement}`;
}

function supportsTemperatureOverride(modelId: string) {
  return !/^gpt-5(?:[.-]|$)/i.test(modelId.trim());
}

export function getDirectorPromptOptimizerRuntime(): DirectorPromptOptimizerRuntime {
  const localConfigFileName = "openai.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey =
    process.env.OPENAI_PROMPT_OPTIMIZER_API_KEY ??
    localConfig.OPENAI_PROMPT_OPTIMIZER_API_KEY ??
    process.env.OPENAI_VISION_API_KEY ??
    localConfig.OPENAI_VISION_API_KEY ??
    process.env.OPENAI_API_KEY ??
    localConfig.OPENAI_API_KEY ??
    "";
  const apiBase = normalizeApiBase(
    process.env.OPENAI_PROMPT_OPTIMIZER_API_BASE ??
      localConfig.OPENAI_PROMPT_OPTIMIZER_API_BASE ??
      process.env.OPENAI_VISION_API_BASE ??
      localConfig.OPENAI_VISION_API_BASE ??
      "https://api.openai.com",
  );
  const chatEndpoint =
    process.env.OPENAI_PROMPT_OPTIMIZER_CHAT_ENDPOINT ??
    localConfig.OPENAI_PROMPT_OPTIMIZER_CHAT_ENDPOINT ??
    process.env.OPENAI_VISION_CHAT_ENDPOINT ??
    localConfig.OPENAI_VISION_CHAT_ENDPOINT ??
    "/v1/chat/completions";
  const modelId =
    process.env.OPENAI_PROMPT_OPTIMIZER_MODEL ??
    localConfig.OPENAI_PROMPT_OPTIMIZER_MODEL ??
    "gpt-5.5";
  const liveEnabled = parseBoolean(
    process.env.OPENAI_PROMPT_OPTIMIZER_LIVE_ENABLED ??
      localConfig.OPENAI_PROMPT_OPTIMIZER_LIVE_ENABLED ??
      process.env.OPENAI_GENERATION_LIVE_ENABLED ??
      localConfig.OPENAI_GENERATION_LIVE_ENABLED,
    false,
  );

  return {
    liveEnabled: liveEnabled && Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    apiBase,
    apiKey,
    modelId,
    chatEndpoint,
    providerLabel: `OpenAI · ${modelId}`,
    configFileName,
  };
}

export async function optimizeDirectorVideoPrompt(input: {
  originalPrompt: string;
  modificationInstruction: string;
  target?: DirectorPromptOptimizeTarget;
}): Promise<PromptOptimizerResult> {
  const runtime = getDirectorPromptOptimizerRuntime();
  const fallbackPrompt = buildFallbackOptimizedPrompt(input.originalPrompt, input.modificationInstruction);
  const target = input.target === "video" ? "video" : "image";

  if (!runtime.liveEnabled) {
    return {
      optimizedPrompt: fallbackPrompt,
      runtime,
      usedFallback: true,
    };
  }

  const systemPrompt = [
    "你是视频生成提示词优化助手。",
    target === "video"
      ? "目标：把用户的原始提示词改写为可直接用于图生视频的一段中文提示词。"
      : "目标：把用户的原始提示词改写为可直接用于文生图的一段中文提示词。",
    target === "video"
      ? "成功标准：镜头运动明确、主体动作可执行、节奏稳定、避免抽象空话和不可拍摄描述。"
      : "成功标准：画面主体清晰、构图和风格明确、细节稳定、避免抽象空话和多余动作指令。",
    "只输出优化后的提示词正文，不要解释，不要 markdown，不要编号。",
  ].join("\n");
  const userContent = [
    "原始提示词：",
    input.originalPrompt.trim() || "（空）",
    "",
    "修改要求：",
      input.modificationInstruction.trim() ||
        (target === "video"
          ? "请在保留原意的前提下增强镜头运动、主体动作和视频生成稳定性。"
          : "请在保留原意的前提下增强画面细节、构图和图片生成稳定性。"),
  ].join("\n");

  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  const estimatedMetrics = estimateTextModelUsageMetrics({
    inputText: `${systemPrompt}\n${userContent}`,
    maxOutputTokens: 1_800,
  });
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "llm.chat",
    estimatedMetrics,
  });

  try {
    const response = await fetch(`${runtime.apiBase}${runtime.chatEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: runtime.modelId,
        ...(supportsTemperatureOverride(runtime.modelId) ? { temperature: 0.25 } : {}),
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
      throw new Error(payload.error?.message ?? "GPT-5.5 提示词优化失败");
    }

    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
      serviceName: "llm.chat",
      provider: runtime.providerLabel,
      modelId: runtime.modelId,
      metrics: {
        inputTokens: Number(payload.usage?.prompt_tokens ?? estimatedMetrics.inputTokens ?? 0),
        outputTokens: Number(payload.usage?.completion_tokens ?? estimatedMetrics.outputTokens ?? 0),
        cachedInputTokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      },
      requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
      remark: target === "video" ? "快速生成图生视频提示词优化" : "快速生成文生图提示词优化",
    });

    return {
      optimizedPrompt: payload.choices?.[0]?.message?.content?.trim() || fallbackPrompt,
      runtime,
      usedFallback: false,
    };
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }
}
