import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import ffmpegStatic from "ffmpeg-static";
import { loadOptionalEnvFile } from "./env-file";

function joinProjectPath(...segments: string[]) {
  return join(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

const requireCompat = createRequire(joinProjectPath("package.json"));

function normalizeConfiguredPath(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getConfiguredFfmpegPath() {
  const sharedConfig = loadOptionalEnvFile("travel.env.local");

  return (
    normalizeConfiguredPath(process.env.FFMPEG_PATH) ??
    normalizeConfiguredPath(process.env.FFMPEG_BIN) ??
    normalizeConfiguredPath(sharedConfig.FFMPEG_PATH) ??
    normalizeConfiguredPath(sharedConfig.FFMPEG_BIN)
  );
}

function resolveFfmpegStaticPath() {
  if (typeof ffmpegStatic === "string" && ffmpegStatic.trim()) {
    return ffmpegStatic;
  }

  try {
    const packageJsonPath = requireCompat.resolve("ffmpeg-static/package.json");
    return join(dirname(packageJsonPath), "ffmpeg");
  } catch {
    return null;
  }
}

function resolveNodeModulesFfmpegPath() {
  return joinProjectPath("node_modules", "ffmpeg-static", "ffmpeg");
}

function commandWorks(command: string) {
  try {
    const result = spawnSync(command, ["-version"], {
      stdio: "ignore",
      shell: false,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getFfmpegBinaryPathOrNull() {
  const configuredPath = getConfiguredFfmpegPath();
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const staticPath = resolveFfmpegStaticPath();
  if (staticPath && existsSync(staticPath)) {
    return staticPath;
  }

  const nodeModulesPath = resolveNodeModulesFfmpegPath();
  if (existsSync(nodeModulesPath)) {
    return nodeModulesPath;
  }

  if (commandWorks("ffmpeg")) {
    return "ffmpeg";
  }

  return null;
}

export function getFfmpegBinaryPath() {
  const runtimePath = getFfmpegBinaryPathOrNull();

  if (!runtimePath) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
}
