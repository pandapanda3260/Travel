import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

export type VisionProvider = "openai" | "ark";

export type OpenAIProviderRuntime = {
  provider: VisionProvider;
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  chatEndpoint: string;
  providerLabel: string;
  configFileName: string;
  configHint: string;
};

function normalizeApiBase(apiBase: string) {
  return apiBase.replace(/\/$/, "");
}

function normalizeArkApiBase(apiBase: string) {
  const normalized = normalizeApiBase(apiBase);
  return normalized.endsWith("/api/v3") ? normalized : `${normalized}/api/v3`;
}

function loadOpenAiVisionConfig() {
  const localConfigFileName = "openai.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey =
    process.env.OPENAI_VISION_API_KEY ??
    localConfig.OPENAI_VISION_API_KEY ??
    process.env.OPENAI_API_KEY ??
    localConfig.OPENAI_API_KEY ??
    "";
  const apiBase = normalizeApiBase(
    process.env.OPENAI_VISION_API_BASE ?? localConfig.OPENAI_VISION_API_BASE ?? "https://api.openai.com",
  );
  const chatEndpoint =
    process.env.OPENAI_VISION_CHAT_ENDPOINT ?? localConfig.OPENAI_VISION_CHAT_ENDPOINT ?? "/v1/chat/completions";

  return { configFileName, localConfig, apiKey, apiBase, chatEndpoint };
}

function loadArkVisionConfig() {
  const localConfigFileName = "text.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey =
    process.env.VOLCENGINE_VISION_API_KEY ??
    localConfig.VOLCENGINE_VISION_API_KEY ??
    process.env.ARK_API_KEY ??
    localConfig.ARK_API_KEY ??
    "";
  const apiBase = normalizeArkApiBase(
    process.env.VOLCENGINE_VISION_API_BASE ??
      localConfig.VOLCENGINE_VISION_API_BASE ??
      "https://ark.cn-beijing.volces.com",
  );
  const chatEndpoint =
    process.env.VOLCENGINE_VISION_CHAT_ENDPOINT ?? localConfig.VOLCENGINE_VISION_CHAT_ENDPOINT ?? "/chat/completions";

  return { configFileName, localConfig, apiKey, apiBase, chatEndpoint };
}

function resolveVisionProvider(
  openAiConfig: Record<string, string>,
  arkConfig: Record<string, string>,
): VisionProvider {
  const rawProvider = (
    process.env.VISION_PROVIDER ??
    openAiConfig.VISION_PROVIDER ??
    arkConfig.VISION_PROVIDER ??
    process.env.VIDEO_ANALYSIS_PROVIDER ??
    openAiConfig.VIDEO_ANALYSIS_PROVIDER ??
    arkConfig.VIDEO_ANALYSIS_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();

  if (rawProvider === "ark" || rawProvider === "volcengine" || rawProvider === "doubao") {
    return "ark";
  }
  if (rawProvider === "openai") {
    return "openai";
  }

  const openAiLiveEnabled = parseBoolean(
    process.env.OPENAI_VISION_LIVE_ENABLED ?? openAiConfig.OPENAI_VISION_LIVE_ENABLED,
    false,
  );
  const arkLiveEnabled = parseBoolean(
    process.env.VOLCENGINE_VISION_LIVE_ENABLED ?? arkConfig.VOLCENGINE_VISION_LIVE_ENABLED,
    false,
  );

  if (openAiLiveEnabled) {
    return "openai";
  }
  if (arkLiveEnabled) {
    return "ark";
  }

  const hasOpenAiConfig = Boolean(
    process.env.OPENAI_VISION_API_KEY ??
    openAiConfig.OPENAI_VISION_API_KEY ??
    process.env.OPENAI_API_KEY ??
    openAiConfig.OPENAI_API_KEY ??
    process.env.OPENAI_VISION_MODEL ??
    openAiConfig.OPENAI_VISION_MODEL,
  );
  const hasArkConfig = Boolean(
    process.env.VOLCENGINE_VISION_API_KEY ??
    arkConfig.VOLCENGINE_VISION_API_KEY ??
    process.env.ARK_API_KEY ??
    arkConfig.ARK_API_KEY ??
    process.env.VOLCENGINE_VISION_MODEL ??
    arkConfig.VOLCENGINE_VISION_MODEL,
  );

  if (hasOpenAiConfig) {
    return "openai";
  }
  if (hasArkConfig) {
    return "ark";
  }

  return "openai";
}

/** Shared vision runtime (image/video understanding) */
export function getVisionRuntime(): OpenAIProviderRuntime {
  const openAi = loadOpenAiVisionConfig();
  const ark = loadArkVisionConfig();
  const provider = resolveVisionProvider(openAi.localConfig, ark.localConfig);

  if (provider === "ark") {
    const modelId = process.env.VOLCENGINE_VISION_MODEL ?? ark.localConfig.VOLCENGINE_VISION_MODEL ?? "";
    const liveEnabled = parseBoolean(
      process.env.VOLCENGINE_VISION_LIVE_ENABLED ?? ark.localConfig.VOLCENGINE_VISION_LIVE_ENABLED,
      false,
    );

    return {
      provider,
      liveEnabled: liveEnabled && Boolean(ark.apiKey) && Boolean(modelId),
      hasApiKey: Boolean(ark.apiKey),
      apiBase: ark.apiBase,
      apiKey: ark.apiKey,
      modelId: modelId || "未配置视觉模型",
      chatEndpoint: ark.chatEndpoint,
      providerLabel: `火山方舟 · ${modelId || "未配置视觉模型"}`,
      configFileName: ark.configFileName,
      configHint:
        "VISION_PROVIDER / VOLCENGINE_VISION_LIVE_ENABLED / VOLCENGINE_VISION_API_KEY / ARK_API_KEY / VOLCENGINE_VISION_MODEL",
    };
  }

  const modelId = process.env.OPENAI_VISION_MODEL ?? openAi.localConfig.OPENAI_VISION_MODEL ?? "gpt-4o";
  const liveEnabled = parseBoolean(
    process.env.OPENAI_VISION_LIVE_ENABLED ?? openAi.localConfig.OPENAI_VISION_LIVE_ENABLED,
    false,
  );

  return {
    provider,
    liveEnabled: liveEnabled && Boolean(openAi.apiKey),
    hasApiKey: Boolean(openAi.apiKey),
    apiBase: openAi.apiBase,
    apiKey: openAi.apiKey,
    modelId,
    chatEndpoint: openAi.chatEndpoint,
    providerLabel: `OpenAI · ${modelId}`,
    configFileName: openAi.configFileName,
    configHint: "VISION_PROVIDER / OPENAI_VISION_LIVE_ENABLED / OPENAI_VISION_API_KEY / OPENAI_API_KEY",
  };
}

/** GPT-5.4 generation runtime (content script / prompt / subtitle) */
export function getGenerationRuntime(): OpenAIProviderRuntime {
  const localConfigFileName = "openai.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey =
    process.env.OPENAI_GENERATION_API_KEY ??
    localConfig.OPENAI_GENERATION_API_KEY ??
    process.env.OPENAI_VISION_API_KEY ??
    localConfig.OPENAI_VISION_API_KEY ??
    process.env.OPENAI_API_KEY ??
    localConfig.OPENAI_API_KEY ??
    "";
  const apiBase = normalizeApiBase(
    process.env.OPENAI_GENERATION_API_BASE ??
      localConfig.OPENAI_GENERATION_API_BASE ??
      process.env.OPENAI_VISION_API_BASE ??
      localConfig.OPENAI_VISION_API_BASE ??
      "https://api.openai.com",
  );
  const chatEndpoint =
    process.env.OPENAI_GENERATION_CHAT_ENDPOINT ??
    localConfig.OPENAI_GENERATION_CHAT_ENDPOINT ??
    process.env.OPENAI_VISION_CHAT_ENDPOINT ??
    localConfig.OPENAI_VISION_CHAT_ENDPOINT ??
    "/v1/chat/completions";
  const modelId = process.env.OPENAI_GENERATION_MODEL ?? localConfig.OPENAI_GENERATION_MODEL ?? "gpt-5.4";
  const liveEnabled = parseBoolean(
    process.env.OPENAI_GENERATION_LIVE_ENABLED ?? localConfig.OPENAI_GENERATION_LIVE_ENABLED,
    false,
  );

  return {
    provider: "openai",
    liveEnabled: liveEnabled && Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    apiBase,
    apiKey,
    modelId,
    chatEndpoint,
    providerLabel: `OpenAI · ${modelId}`,
    configFileName,
    configHint: "OPENAI_GENERATION_LIVE_ENABLED / OPENAI_GENERATION_API_KEY / OPENAI_API_KEY",
  };
}
