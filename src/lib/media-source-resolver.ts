import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeMediaSourceInput } from "./media-source-input";
import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const runtimePublicMediaUrlPrefixes = [
  "/generated-images/",
  "/generated-videos/",
  "/generated-final-videos/",
  "/generated-compositions/",
  "/generated-audio/",
  "/generated-subtitles/",
  "/video-materials/",
  "/video-tasks/",
  "/product-archives/",
] as const;

const localMediaFileExtensions = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".webm",
]);

export type ResolvedLocalMediaSource = {
  kind: "runtime_asset" | "local_file";
  localPath: string;
  shouldCopyToTemp: boolean;
};

export function isRuntimePublicMediaUrl(sourceUrl: string) {
  return runtimePublicMediaUrlPrefixes.some((prefix) => sourceUrl.startsWith(prefix));
}

export function getMediaSourceFileExtension(sourceUrl: string) {
  const normalized = normalizeMediaSourceInput(sourceUrl);
  const filePath = tryParseFileUrl(normalized) ?? tryParseUrlPathname(normalized) ?? normalized;
  const extension = extname(filePath).toLowerCase();
  return localMediaFileExtensions.has(extension) ? extension : ".mp4";
}

export function resolveLocalMediaSource(sourceUrl: string): ResolvedLocalMediaSource | null {
  const normalized = normalizeMediaSourceInput(sourceUrl);
  if (!normalized) {
    return null;
  }

  if (isRuntimePublicMediaUrl(normalized)) {
    return {
      kind: "runtime_asset",
      localPath: resolveRuntimeAssetUrlToPath(normalized),
      shouldCopyToTemp: false,
    };
  }

  const fileUrlPath = tryParseFileUrl(normalized);
  if (fileUrlPath) {
    return resolveExistingLocalMediaFile(fileUrlPath);
  }

  if (isAbsolute(normalized)) {
    return resolveExistingLocalMediaFile(normalized);
  }

  return null;
}

function tryParseFileUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "file:" ? fileURLToPath(url) : null;
  } catch {
    return null;
  }
}

function tryParseUrlPathname(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return url.pathname;
  } catch {
    return null;
  }
}

function resolveExistingLocalMediaFile(filePath: string): ResolvedLocalMediaSource {
  const extension = extname(filePath).toLowerCase();
  if (!localMediaFileExtensions.has(extension)) {
    throw new Error("本机媒体文件格式不支持，请使用常见音频或视频文件");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error("本机媒体文件不存在或不可读取，请检查路径是否正确");
  }

  return {
    kind: "local_file",
    localPath: filePath,
    shouldCopyToTemp: true,
  };
}
