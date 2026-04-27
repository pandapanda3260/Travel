import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { joinRuntimePublicStoragePath } from "./runtime-storage";

export type TaskArtifactDeletionReason = "user_manual_delete" | "successful_replacement";

export type TaskArtifactDeletionOptions = {
  reason: TaskArtifactDeletionReason;
};

function getTaskArtifactRoots() {
  return [
    {
      rootPath: joinRuntimePublicStoragePath("generated-images"),
      reservedNames: new Set(["_unassigned", "archive", "candidates"]),
    },
    {
      rootPath: joinRuntimePublicStoragePath("generated-audio"),
      reservedNames: new Set(["_unassigned"]),
    },
    {
      rootPath: joinRuntimePublicStoragePath("generated-subtitles"),
      reservedNames: new Set(["_unassigned"]),
    },
    {
      rootPath: joinRuntimePublicStoragePath("generated-videos"),
      reservedNames: new Set(["_unassigned"]),
    },
    {
      rootPath: joinRuntimePublicStoragePath("generated-compositions"),
      reservedNames: new Set(["_unassigned"]),
    },
    {
      rootPath: joinRuntimePublicStoragePath("generated-final-videos"),
      reservedNames: new Set(["_unassigned"]),
    },
  ];
}

function isWithinRoot(rootPath: string, targetPath: string) {
  const normalizedRootPath = `${resolve(rootPath)}${rootPath.endsWith("/") ? "" : "/"}`;
  const normalizedTargetPath = `${resolve(targetPath)}${targetPath.endsWith("/") ? "" : "/"}`;
  return normalizedTargetPath.startsWith(normalizedRootPath);
}

function assertDeletionReason(options: TaskArtifactDeletionOptions | undefined) {
  if (options?.reason !== "user_manual_delete" && options?.reason !== "successful_replacement") {
    throw new Error("删除任务生成文件需要明确的手动删除或成功替换原因");
  }
}

export function deleteTaskArtifactDirectories(taskId: string, options: TaskArtifactDeletionOptions) {
  assertDeletionReason(options);

  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId || normalizedTaskId === "_unassigned") {
    return;
  }

  for (const { rootPath } of getTaskArtifactRoots()) {
    const targetPath = join(rootPath, normalizedTaskId);
    if (!isWithinRoot(rootPath, targetPath) || !existsSync(targetPath)) {
      continue;
    }

    rmSync(targetPath, { recursive: true, force: true });
  }
}

export function deleteOrphanedTaskArtifactDirectories(
  activeTaskIds: Iterable<string>,
  options: TaskArtifactDeletionOptions,
) {
  assertDeletionReason(options);

  const activeTaskIdSet = new Set(
    Array.from(activeTaskIds, (taskId) => taskId.trim()).filter((taskId) => Boolean(taskId) && taskId !== "_unassigned"),
  );

  for (const { rootPath, reservedNames } of getTaskArtifactRoots()) {
    if (!existsSync(rootPath)) {
      continue;
    }

    const entries = readdirSync(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryName = entry.name.trim();
      if (!entryName || reservedNames.has(entryName) || activeTaskIdSet.has(entryName)) {
        continue;
      }

      const targetPath = join(rootPath, entryName);
      if (!isWithinRoot(rootPath, targetPath)) {
        continue;
      }

      rmSync(targetPath, { recursive: true, force: true });
    }
  }
}
