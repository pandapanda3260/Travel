import { getEnvConfigDisplayName, loadOptionalEnvFile, parseBoolean } from "./env-file";

export type TextGenerationRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
  configFileName: string;
};

export function getTextGenerationRuntime(): TextGenerationRuntime {
  const localConfigFileName = "text.env.local";
  const configFileName = getEnvConfigDisplayName(localConfigFileName);
  const localConfig = loadOptionalEnvFile(localConfigFileName);
  const apiKey = process.env.VOLCENGINE_TEXT_API_KEY ?? localConfig.VOLCENGINE_TEXT_API_KEY ?? "";
  const apiBase =
    process.env.VOLCENGINE_TEXT_API_BASE ?? localConfig.VOLCENGINE_TEXT_API_BASE ?? "https://ark.cn-beijing.volces.com";
  const modelId = process.env.VOLCENGINE_TEXT_MODEL ?? localConfig.VOLCENGINE_TEXT_MODEL ?? "doubao-seed-2.0-pro";
  const liveEnabled = parseBoolean(
    process.env.VOLCENGINE_TEXT_LIVE_ENABLED ?? localConfig.VOLCENGINE_TEXT_LIVE_ENABLED,
    false,
  );

  return {
    liveEnabled: liveEnabled && Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    apiBase,
    apiKey,
    modelId,
    providerLabel: "火山方舟 · Doubao-Seed-2.0-pro",
    configFileName,
  };
}
