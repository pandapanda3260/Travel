import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

function getTaskArtifactRoots() {
  return [
    join(process.cwd(), "public", "generated-images"),
    join(process.cwd(), "public", "generated-audio"),
    join(process.cwd(), "public", "generated-subtitles"),
    join(process.cwd(), "public", "generated-videos"),
    join(process.cwd(), "public", "generated-compositions"),
    join(process.cwd(), "public", "generated-final-videos"),
  ];
}

function isWithinRoot(rootPath: string, targetPath: string) {
  const normalizedRootPath = `${resolve(rootPath)}${rootPath.endsWith("/") ? "" : "/"}`;
  const normalizedTargetPath = `${resolve(targetPath)}${targetPath.endsWith("/") ? "" : "/"}`;
  return normalizedTargetPath.startsWith(normalizedRootPath);
}

export function deleteTaskArtifactDirectories(taskId: string) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId || normalizedTaskId === "_unassigned") {
    return;
  }

  for (const rootPath of getTaskArtifactRoots()) {
    const targetPath = join(rootPath, normalizedTaskId);
    if (!isWithinRoot(rootPath, targetPath) || !existsSync(targetPath)) {
      continue;
    }

    rmSync(targetPath, { recursive: true, force: true });
  }
}
