import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

export type OpenAIProviderRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  chatEndpoint: string;
  providerLabel: string;
  configFileName: string;
};

function loadOpenAIConfig() {
  const localConfigFileName = "openai.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey = process.env.OPENAI_VISION_API_KEY ?? localConfig.OPENAI_VISION_API_KEY ?? "";
  const apiBase = (
    process.env.OPENAI_VISION_API_BASE ??
    localConfig.OPENAI_VISION_API_BASE ??
    "https://api.openai.com"
  ).replace(/\/$/, "");
  const chatEndpoint =
    process.env.OPENAI_VISION_CHAT_ENDPOINT ?? localConfig.OPENAI_VISION_CHAT_ENDPOINT ?? "/v1/chat/completions";

  return { configFileName, localConfig, apiKey, apiBase, chatEndpoint };
}

/** GPT-4o vision runtime (frame analysis) */
export function getVisionRuntime(): OpenAIProviderRuntime {
  const { configFileName, localConfig, apiKey, apiBase, chatEndpoint } = loadOpenAIConfig();
  const modelId = process.env.OPENAI_VISION_MODEL ?? localConfig.OPENAI_VISION_MODEL ?? "gpt-4o";
  const liveEnabled = parseBoolean(
    process.env.OPENAI_VISION_LIVE_ENABLED ?? localConfig.OPENAI_VISION_LIVE_ENABLED,
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

/** GPT-5.4 generation runtime (content script / prompt / subtitle) */
export function getGenerationRuntime(): OpenAIProviderRuntime {
  const { configFileName, localConfig, apiKey, apiBase, chatEndpoint } = loadOpenAIConfig();
  const modelId = process.env.OPENAI_GENERATION_MODEL ?? localConfig.OPENAI_GENERATION_MODEL ?? "gpt-5.4";
  const liveEnabled = parseBoolean(
    process.env.OPENAI_GENERATION_LIVE_ENABLED ?? localConfig.OPENAI_GENERATION_LIVE_ENABLED,
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
