import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const LEGACY_SHARED_TRAVEL_ENV_FILE = "/Users/bytedance/Desktop/Travel 相关文件/key/travel.env.local";
const DEFAULT_SHARED_TRAVEL_ENV_FILE_CANDIDATES = ["travel.shared.env.local", "travel.env.shared.local"];

function joinProjectPath(fileName: string) {
  return join(/* turbopackIgnore: true */ process.cwd(), fileName);
}

export function getSharedTravelEnvFilePath() {
  const explicitPath = process.env.TRAVEL_SHARED_ENV_FILE?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  for (const candidate of DEFAULT_SHARED_TRAVEL_ENV_FILE_CANDIDATES) {
    const candidatePath = joinProjectPath(candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return existsSync(LEGACY_SHARED_TRAVEL_ENV_FILE) ? LEGACY_SHARED_TRAVEL_ENV_FILE : "";
}

export function getEnvConfigDisplayName(fileName: string) {
  const sharedPath = getSharedTravelEnvFilePath();
  return sharedPath
    ? `${fileName}（若未单独配置，则回退到 ${sharedPath}）`
    : `${fileName}（若未单独配置，则仅使用当前项目内配置）`;
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

  const sharedEnvPath = getSharedTravelEnvFilePath();
  const sharedConfig = sharedEnvPath ? readEnvFileIfExists(sharedEnvPath) : {};
  const localPath = joinProjectPath(fileName);
  const sharedSiblingPath = sharedEnvPath ? join(dirname(sharedEnvPath), fileName) : "";
  const sharedSiblingConfig =
    sharedSiblingPath && resolve(sharedSiblingPath) !== resolve(localPath)
      ? readEnvFileIfExists(sharedSiblingPath)
      : {};
  const localConfig = readEnvFileIfExists(localPath);

  return {
    ...sharedConfig,
    ...sharedSiblingConfig,
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
