import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

const DEFAULT_VOLCENGINE_IMAGE_MODEL = "doubao-seedream-4-5-251128";
const DEFAULT_LIANGXIN_IMAGE_MODEL = "image2";

export type ImageProviderId = "volcengine" | "liangxin";

export type ImageGenerationRuntime = {
  provider: ImageProviderId;
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

function resolveLiangxinImageModelId(...candidates: Array<string | undefined>) {
  const configuredModelId = candidates.find((candidate) => Boolean(candidate?.trim()))?.trim();
  return configuredModelId ?? DEFAULT_LIANGXIN_IMAGE_MODEL;
}

function resolveImageProviderId(...candidates: Array<string | undefined>): ImageProviderId {
  const configuredProvider = candidates.find((candidate) => Boolean(candidate?.trim()))?.trim().toLowerCase();
  if (configuredProvider === "liangxin" || configuredProvider === "image2") {
    return "liangxin";
  }
  return "volcengine";
}

function normalizeHttpBaseUrl(rawValue: string) {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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

function formatLiangxinProviderLabel(modelId: string, suffix?: string) {
  return `良心中转站 · ${modelId}${suffix ? `（${suffix}）` : ""}`;
}

function getBaseImageRuntimeConfig() {
  const localConfigFileName = "image.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const provider = resolveImageProviderId(
    process.env.LIANGXIN_IMAGE_PROVIDER,
    localConfig.LIANGXIN_IMAGE_PROVIDER,
    process.env.IMAGE_PROVIDER,
    localConfig.IMAGE_PROVIDER,
  );

  if (provider === "liangxin") {
    const apiKey = process.env.LIANGXIN_IMAGE_API_KEY ?? localConfig.LIANGXIN_IMAGE_API_KEY ?? "";
    const apiBase = normalizeHttpBaseUrl(process.env.LIANGXIN_IMAGE_BASE_URL ?? localConfig.LIANGXIN_IMAGE_BASE_URL ?? "");
    const modelId = resolveLiangxinImageModelId(process.env.LIANGXIN_IMAGE_MODEL, localConfig.LIANGXIN_IMAGE_MODEL);
    const liveEnabled = parseBoolean(
      process.env.LIANGXIN_IMAGE_LIVE_ENABLED ?? localConfig.LIANGXIN_IMAGE_LIVE_ENABLED,
      true,
    );

    return {
      apiBase,
      apiKey,
      configFileName,
      hasApiKey: Boolean(apiKey),
      liveEnabled,
      localConfig,
      modelId,
      provider,
    };
  }

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
    provider,
  };
}

export function getImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();

  return {
    provider: base.provider,
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId: base.modelId,
    providerLabel:
      base.provider === "liangxin" ? formatLiangxinProviderLabel(base.modelId) : formatSeedreamProviderLabel(base.modelId),
    configFileName: base.configFileName,
  };
}

export function getVideoPipelineImageGenerationRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const modelId =
    base.provider === "liangxin"
      ? base.modelId
      : resolveImageModelId(
          process.env.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL ?? base.localConfig.VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL,
          base.modelId,
        );

  return {
    provider: base.provider,
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId,
    providerLabel:
      base.provider === "liangxin" ? formatLiangxinProviderLabel(modelId) : formatSeedreamProviderLabel(modelId),
    configFileName: base.configFileName,
  };
}

export function getImageCleaningRuntime(): ImageGenerationRuntime {
  const base = getBaseImageRuntimeConfig();
  const cleanModelId =
    base.provider === "liangxin"
      ? base.modelId
      : resolveImageModelId(process.env.VOLCENGINE_IMAGE_CLEAN_MODEL ?? base.localConfig.VOLCENGINE_IMAGE_CLEAN_MODEL, base.modelId);

  return {
    provider: base.provider,
    liveEnabled: base.liveEnabled && base.hasApiKey,
    hasApiKey: base.hasApiKey,
    apiBase: base.apiBase,
    apiKey: base.apiKey,
    modelId: cleanModelId,
    providerLabel:
      base.provider === "liangxin"
        ? formatLiangxinProviderLabel(cleanModelId, "清洗")
        : formatSeedreamProviderLabel(cleanModelId, "清洗"),
    configFileName: base.configFileName,
  };
}
