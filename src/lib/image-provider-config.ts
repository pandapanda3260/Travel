import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

export type ImageGenerationRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
  configFileName: string;
};

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
  const modelId =
    process.env.VOLCENGINE_IMAGE_MODEL ?? localConfig.VOLCENGINE_IMAGE_MODEL ?? "doubao-seedream-5-0-lite-260128";
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
  };
}

export function getImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const modelId =
    process.env.VOLCENGINE_IMAGE_MODEL ?? base.localConfig.VOLCENGINE_IMAGE_MODEL ?? "doubao-seedream-5-0-lite-260128";

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId,
    providerLabel: "Doubao-Seedream-5.0-lite",
    configFileName: base.configFileName,
  };
}

export function getVideoPipelineImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const modelId =
    process.env.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL ??
    base.localConfig.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL ??
    process.env.VOLCENGINE_IMAGE_MODEL ??
    base.localConfig.VOLCENGINE_IMAGE_MODEL ??
    "doubao-seedream-4-5-251128";

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId,
    providerLabel: modelId.includes("seedream-4-5") ? "Doubao-Seedream-4.5" : `Doubao-Seedream · ${modelId}`,
    configFileName: base.configFileName,
  };
}

export function getImageCleaningRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const cleanModelId =
    process.env.VOLCENGINE_IMAGE_CLEAN_MODEL ??
    base.localConfig.VOLCENGINE_IMAGE_CLEAN_MODEL ??
    process.env.VOLCENGINE_IMAGE_MODEL ??
    base.localConfig.VOLCENGINE_IMAGE_MODEL ??
    "doubao-seedream-5-0-lite-260128";
  const hasDedicatedCleanModel = Boolean(
    process.env.VOLCENGINE_IMAGE_CLEAN_MODEL ?? base.localConfig.VOLCENGINE_IMAGE_CLEAN_MODEL,
  );

  return {
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId: cleanModelId,
    providerLabel: hasDedicatedCleanModel ? "Doubao-Seedream-4.5（清洗）" : "Doubao-Seedream（清洗）",
    configFileName: base.configFileName,
  };
}
