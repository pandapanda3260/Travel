import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

const DEFAULT_VOLCENGINE_IMAGE_MODEL = "doubao-seedream-4-5-251128";

export type ImageGenerationRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
  configFileName: string;
};

function resolveImageModelId(...candidates: Array<string | undefined>) {
  const configuredModelId = candidates.find((candidate) => Boolean(candidate?.trim()))?.trim();
  return configuredModelId ?? DEFAULT_VOLCENGINE_IMAGE_MODEL;
}

function formatSeedreamProviderLabel(modelId: string, suffix?: string) {
  const suffixText = suffix ? `（${suffix}）` : "";
  if (modelId.includes("seedream-4-5")) {
    return `Doubao-Seedream-4.5${suffixText}`;
  }
  if (modelId.includes("seedream-5-0")) {
    return `Doubao-Seedream-5.0${suffixText}`;
  }
  return `Doubao-Seedream · ${modelId}${suffixText}`;
}

function getBaseImageRuntimeConfig() {
  const localConfigFileName = "image.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey =
    process.env.VOLCENGINE_IMAGE_API_KEY ??
    localConfig.VOLCENGINE_IMAGE_API_KEY ??
    process.env.ARK_API_KEY ??
    localConfig.ARK_API_KEY ??
    "";
  const apiBase =
    process.env.VOLCENGINE_IMAGE_API_BASE ??
    localConfig.VOLCENGINE_IMAGE_API_BASE ??
    "https://ark.cn-beijing.volces.com";
  const modelId = resolveImageModelId(process.env.VOLCENGINE_IMAGE_MODEL, localConfig.VOLCENGINE_IMAGE_MODEL);
  const liveEnabled = parseBoolean(
    process.env.VOLCENGINE_IMAGE_LIVE_ENABLED ?? localConfig.VOLCENGINE_IMAGE_LIVE_ENABLED,
    false,
  );

  return {
    apiBase,
    apiKey,
    configFileName,
    hasApiKey: Boolean(apiKey),
    liveEnabled,
    localConfig,
    modelId,
  };
}

export function getImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId: base.modelId,
    providerLabel: formatSeedreamProviderLabel(base.modelId),
    configFileName: base.configFileName,
  };
}

export function getVideoPipelineImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const modelId = resolveImageModelId(
    process.env.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL ?? base.localConfig.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL,
    base.modelId,
  );

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId,
    providerLabel: formatSeedreamProviderLabel(modelId),
    configFileName: base.configFileName,
  };
}

export function getImageCleaningRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const cleanModelId = resolveImageModelId(
    process.env.VOLCENGINE_IMAGE_CLEAN_MODEL ?? base.localConfig.VOLCENGINE_IMAGE_CLEAN_MODEL,
    base.modelId,
  );

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId: cleanModelId,
    providerLabel: formatSeedreamProviderLabel(cleanModelId, "清洗"),
    configFileName: base.configFileName,
  };
}
