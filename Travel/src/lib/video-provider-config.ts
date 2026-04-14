import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LiveVideoProvider = "kling";

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

function loadOptionalEnvFile(fileName: string) {
  const filePath = join(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce<Record<string, string>>((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getProviderRuntime(_provider?: LiveVideoProvider): ProviderRuntime {
  const localConfig = loadOptionalEnvFile("video.env.local");
  const liveEnabled = parseBoolean(process.env.VIDEO_LIVE_ENABLED ?? localConfig.VIDEO_LIVE_ENABLED, false);
  const pollIntervalSeconds = parseNumber(
    process.env.VIDEO_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_POLL_INTERVAL_SECONDS,
    10,
  );
  const maxPollAttempts = parseNumber(
    process.env.VIDEO_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_MAX_POLL_ATTEMPTS,
    30,
  );
  const backgroundPollIntervalSeconds = parseNumber(
    process.env.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS ?? localConfig.VIDEO_BACKGROUND_POLL_INTERVAL_SECONDS,
    30,
  );
  const backgroundMaxPollAttempts = parseNumber(
    process.env.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS ?? localConfig.VIDEO_BACKGROUND_MAX_POLL_ATTEMPTS,
    30,
  );

  const accessKey = process.env.KLING_ACCESS_KEY ?? localConfig.KLING_ACCESS_KEY ?? "";
  const secretKey = process.env.KLING_SECRET_KEY ?? localConfig.KLING_SECRET_KEY ?? "";
  const apiToken = process.env.KLING_API_TOKEN ?? localConfig.KLING_API_TOKEN ?? "";

  return {
    provider: "kling",
    providerLabel: "Kling 官方 API",
    liveEnabled: liveEnabled && Boolean(apiToken || (accessKey && secretKey)),
    pollIntervalSeconds,
    maxPollAttempts,
    backgroundPollIntervalSeconds,
    backgroundMaxPollAttempts,
    modelId: process.env.KLING_VIDEO_MODEL ?? localConfig.KLING_VIDEO_MODEL ?? "kling-v3",
    hasApiKey: Boolean(apiToken || (accessKey && secretKey)),
    apiBase: process.env.KLING_API_BASE ?? localConfig.KLING_API_BASE ?? "https://api-beijing.klingai.com",
  };
}
