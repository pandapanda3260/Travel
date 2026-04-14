import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const DEFAULT_SHARED_TRAVEL_ENV_FILE = "/Users/bytedance/Desktop/Travel 相关文件/key/travel.env.local";

export function getSharedTravelEnvFilePath() {
  return process.env.TRAVEL_SHARED_ENV_FILE?.trim() || DEFAULT_SHARED_TRAVEL_ENV_FILE;
}

export function getEnvConfigDisplayName(fileName: string) {
  return `${fileName}（若未单独配置，则回退到 ${getSharedTravelEnvFilePath()}）`;
}

function normalizeEnvValue(value: string) {
  const trimmed = value.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unwrapped = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unwrapped.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      : unwrapped;
  }

  return trimmed;
}

function parseEnvFileContent(content: string) {
  return content.split(/\r?\n/).reduce<Record<string, string>>((accumulator, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return accumulator;
    }

    const normalizedLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      return accumulator;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const value = normalizeEnvValue(normalizedLine.slice(separatorIndex + 1));
    accumulator[key] = value;
    return accumulator;
  }, {});
}

function readEnvFileIfExists(filePath: string) {
  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  return parseEnvFileContent(readFileSync(filePath, "utf8"));
}

export function loadOptionalEnvFile(fileName: string) {
  if (isAbsolute(fileName)) {
    return readEnvFileIfExists(fileName);
  }

  const sharedConfig = readEnvFileIfExists(getSharedTravelEnvFilePath());
  const localConfig = readEnvFileIfExists(join(process.cwd(), fileName));

  return {
    ...sharedConfig,
    ...localConfig,
  };
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
