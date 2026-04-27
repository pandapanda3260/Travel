import { loadOptionalEnvFile, parseBoolean, parseNumber } from "./env-file";

export type LiveVideoProvider = "kling" | "seedance";

export type ProviderRuntime = {
  provider: LiveVideoProvider;
  providerLabel: string;
  liveEnabled: boolean;
  pollIntervalSeconds: number;
  maxPollAttempts: number;
  backgroundPollIntervalSeconds: number;
  backgroundMaxPollAttempts: number;
  modelId: string;
  hasApiKey: boolean;
  apiBase: string;
};

function resolveActiveProvider(localConfig: Record<string, string>): LiveVideoProvider {
  const raw = process.env.VIDEO_PROVIDER ?? localConfig.VIDEO_PROVIDER ?? "";
  if (raw === "seedance") return "seedance";
  if (raw === "kling") return "kling";
  return "seedance";
}

function getKlingRuntime(localConfig: Record<string, string>, shared: {
  liveEnabled: boolean;
  pollIntervalSeconds: number;
  maxPollAttempts: number;
  backgroundPollIntervalSeconds: number;
  backgroundMaxPollAttempts: number;
}): ProviderRuntime {
  const accessKey = process.env.KLING_ACCESS_KEY ?? localConfig.KLING_ACCESS_KEY ?? "";
  const secretKey = process.env.KLING_SECRET_KEY ?? localConfig.KLING_SECRET_KEY ?? "";
  const apiToken = process.env.KLING_API_TOKEN ?? localConfig.KLING_API_TOKEN ?? "";

  return {
    provider: "kling",
    providerLabel: "Kling 官方 API",
    liveEnabled: shared.liveEnabled && Boolean(apiToken || (accessKey && secretKey)),
    pollIntervalSeconds: shared.pollIntervalSeconds,
    maxPollAttempts: shared.maxPollAttempts,
    backgroundPollIntervalSeconds: shared.backgroundPollIntervalSeconds,
    backgroundMaxPollAttempts: shared.backgroundMaxPollAttempts,
    modelId: process.env.KLING_VIDEO_MODEL ?? localConfig.KLING_VIDEO_MODEL ?? "kling-v3",
    hasApiKey: Boolean(apiToken || (accessKey && secretKey)),
    apiBase: process.env.KLING_API_BASE ?? localConfig.KLING_API_BASE ?? "https://api-beijing.klingai.com",
  };
}

function getSeedanceRuntime(localConfig: Record<string, string>, shared: {
  liveEnabled: boolean;
  pollIntervalSeconds: number;
  maxPollAttempts: number;
  backgroundPollIntervalSeconds: number;
  backgroundMaxPollAttempts: number;
}): ProviderRuntime {
  const arkApiKey = process.env.ARK_API_KEY ?? localConfig.ARK_API_KEY ?? "";

  return {
    provider: "seedance",
    providerLabel: "Seedance 2.0（火山方舟）",
    liveEnabled: shared.liveEnabled && Boolean(arkApiKey),
    pollIntervalSeconds: shared.pollIntervalSeconds,
    maxPollAttempts: shared.maxPollAttempts,
    backgroundPollIntervalSeconds: shared.backgroundPollIntervalSeconds,
    backgroundMaxPollAttempts: shared.backgroundMaxPollAttempts,
    modelId: process.env.SEEDANCE_VIDEO_MODEL ?? localConfig.SEEDANCE_VIDEO_MODEL ?? "doubao-seedance-2-0-260128",
    hasApiKey: Boolean(arkApiKey),
    apiBase:
      process.env.SEEDANCE_API_BASE ??
      localConfig.SEEDANCE_API_BASE ??
      "https://ark.cn-beijing.volces.com/api/v3",
  };
}

export function getActiveVideoProvider(): LiveVideoProvider {
  const localConfig = loadOptionalEnvFile("video.env.local");
  return resolveActiveProvider(localConfig);
}

export function isSeedanceProvider(): boolean {
  return getActiveVideoProvider() === "seedance";
}

export function getLipSyncProviderRuntime(): ProviderRuntime {
  const localConfig = loadOptionalEnvFile("video.env.local");
  const liveEnabled = parseBoolean(process.env.VIDEO_LIVE_ENABLED ?? localConfig.VIDEO_LIVE_ENABLED, false);
  const pollIntervalSeconds = parseNumber(
    process.env.VIDEO_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_POLL_INTERVAL_SECONDS,
    10,
  );
  const maxPollAttempts = parseNumber(process.env.VIDEO_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_MAX_POLL_ATTEMPTS, 30);
  const backgroundPollIntervalSeconds = parseNumber(
    process.env.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS,
    30,
  );
  const backgroundMaxPollAttempts = parseNumber(
    process.env.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS,
    30,
  );

  return getKlingRuntime(localConfig, {
    liveEnabled,
    pollIntervalSeconds,
    maxPollAttempts,
    backgroundPollIntervalSeconds,
    backgroundMaxPollAttempts,
  });
}

export function getProviderRuntime(providerOverride?: LiveVideoProvider): ProviderRuntime {
  const localConfig = loadOptionalEnvFile("video.env.local");
  const liveEnabled = parseBoolean(process.env.VIDEO_LIVE_ENABLED ?? localConfig.VIDEO_LIVE_ENABLED, false);
  const pollIntervalSeconds = parseNumber(
    process.env.VIDEO_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_POLL_INTERVAL_SECONDS,
    10,
  );
  const maxPollAttempts = parseNumber(process.env.VIDEO_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_MAX_POLL_ATTEMPTS, 30);
  const backgroundPollIntervalSeconds = parseNumber(
    process.env.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS,
    30,
  );
  const backgroundMaxPollAttempts = parseNumber(
    process.env.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS,
    30,
  );

  const shared = { liveEnabled, pollIntervalSeconds, maxPollAttempts, backgroundPollIntervalSeconds, backgroundMaxPollAttempts };
  const activeProvider = providerOverride ?? resolveActiveProvider(localConfig);

  if (activeProvider === "seedance") {
    return getSeedanceRuntime(localConfig, shared);
  }
  return getKlingRuntime(localConfig, shared);
}
