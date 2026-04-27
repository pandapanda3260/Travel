import { existsSync, statSync } from "node:fs";

import { normalizeMediaSourceInput } from "./media-source-input";
import { resolveLocalMediaSource } from "./media-source-resolver";

export type MediaArtifactValidationResult = {
  passed: boolean;
  checked: boolean;
  message: string | null;
  localPath: string | null;
};

function failed(message: string, localPath: string | null = null): MediaArtifactValidationResult {
  return {
    passed: false,
    checked: true,
    message,
    localPath,
  };
}

export function validateLocalMediaArtifact(sourceUrl: string | null | undefined, label: string): MediaArtifactValidationResult {
  const normalized = normalizeMediaSourceInput(sourceUrl);
  if (!normalized) {
    return failed(`${label} 缺少媒体地址`);
  }

  let localSource: ReturnType<typeof resolveLocalMediaSource>;
  try {
    localSource = resolveLocalMediaSource(normalized);
  } catch (error) {
    return failed(`${label} 无法读取：${error instanceof Error ? error.message : "媒体路径无效"}`);
  }

  if (!localSource) {
    return {
      passed: true,
      checked: false,
      message: null,
      localPath: null,
    };
  }

  const localPath = localSource.localPath;
  if (!existsSync(localPath)) {
    return failed(`${label} 本地文件不存在`, localPath);
  }

  const stats = statSync(localPath);
  if (!stats.isFile()) {
    return failed(`${label} 不是可读取的媒体文件`, localPath);
  }

  if (stats.size <= 0) {
    return failed(`${label} 文件为空`, localPath);
  }

  return {
    passed: true,
    checked: true,
    message: null,
    localPath,
  };
}

export function collectLocalMediaArtifactErrors(items: Array<{ sourceUrl: string | null | undefined; label: string }>) {
  return items
    .map((item) => validateLocalMediaArtifact(item.sourceUrl, item.label))
    .filter((result) => !result.passed)
    .map((result) => result.message ?? "媒体文件不可用");
}
