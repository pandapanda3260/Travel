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

export function getImageGenerationRuntime(): ImageGenerationRuntime {
  const localConfigFileName = "image.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey = process.env.VOLCENGINE_IMAGE_API_KEY ?? localConfig.VOLCENGINE_IMAGE_API_KEY ?? "";
  const apiBase =
    process.env.VOLCENGINE_IMAGE_API_BASE ??
    localConfig.VOLCENGINE_IMAGE_API_BASE ??
    "https://ark.cn-beijing.volces.com";
  const modelId =
    process.env.VOLCENGINE_IMAGE_MODEL ?? localConfig.VOLCENGINE_IMAGE_MODEL ?? "doubao-seedream-4-5-251128";
  const liveEnabled = parseBoolean(
    process.env.VOLCENGINE_IMAGE_LIVE_ENABLED ?? localConfig.VOLCENGINE_IMAGE_LIVE_ENABLED,
    false,
  );

  return {
    liveEnabled: liveEnabled && Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    apiBase,
    apiKey,
    modelId,
    providerLabel: "Doubao-Seedream-4.5",
    configFileName,
  };
}
