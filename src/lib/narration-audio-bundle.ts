import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import type { NarrationDraftClip } from "./narration";
import { joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");
const dataDir = joinRuntimeDataPath("narration-audio-temp");

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
}

function toAbsoluteLocalPath(publicUrl: string) {
  return resolveRuntimeAssetUrlToPath(publicUrl);
}

export function deleteMergedNarrationAudio(audioUrl: string | null | undefined) {
  if (!audioUrl?.startsWith("/")) {
    return;
  }

  const absolutePath = toAbsoluteLocalPath(audioUrl);
  if (existsSync(absolutePath)) {
    unlinkSync(absolutePath);
  }
}

export function deleteNarrationAudioTempArtifacts(resultId: string) {
  const normalizedResultId = resultId.trim();
  if (!normalizedResultId) {
    return;
  }

  const tempPaths = [
    join(dataDir, `${normalizedResultId}-concat.txt`),
    ...Array.from({ length: 24 }, (_, index) => join(dataDir, `${normalizedResultId}-trim-${index}.mp3`)),
  ];

  for (const absolutePath of tempPaths) {
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  }
}

function getMergedNarrationOutputDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-audio", taskId?.trim() || "_unassigned", "narration-merged");
}

async function trimAudioToDuration(ffmpegPath: string, inputPath: string, outputPath: string, maxDurationSeconds: number) {
  const fadeOutSeconds = Math.min(0.5, Math.max(0.15, maxDurationSeconds));
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-t", String(maxDurationSeconds),
    "-af", `afade=t=out:st=${Math.max(0, maxDurationSeconds - fadeOutSeconds)}:d=${fadeOutSeconds}`,
    "-q:a", "2",
    outputPath,
  ]);
}

export async function buildMergedNarrationAudio(resultId: string, clips: NarrationDraftClip[], taskId?: string | null) {
  const sourceUrls = clips.map((clip) => clip.audioUrl).filter((item): item is string => Boolean(item));
  if (sourceUrls.length === 0 || sourceUrls.length !== clips.length) {
    return null;
  }

  mkdirSync(dataDir, { recursive: true });
  const outputDir = getMergedNarrationOutputDir(taskId);
  mkdirSync(outputDir, { recursive: true });

  const ffmpegPath = resolveFfmpegPath();

  const listFilePath = join(dataDir, `${resultId}-concat.txt`);
  const outputFileName = `${resultId}.mp3`;
  const outputPath = join(outputDir, outputFileName);
  const trimmedPaths: string[] = [];

  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const srcPath = toAbsoluteLocalPath(sourceUrls[i]);
      const preferredDuration = clip.audioDurationSeconds ?? clip.durationSeconds;
      if (preferredDuration && preferredDuration > 0) {
        const trimmedPath = join(dataDir, `${resultId}-trim-${i}.mp3`);
        await trimAudioToDuration(ffmpegPath, srcPath, trimmedPath, preferredDuration);
        trimmedPaths.push(trimmedPath);
      } else {
        trimmedPaths.push(srcPath);
      }
    }

    writeFileSync(
      listFilePath,
      trimmedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );

    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFilePath,
      "-c", "copy",
      outputPath,
    ]);

    return {
      publicUrl: `/generated-audio/${taskId?.trim() || "_unassigned"}/narration-merged/${outputFileName}`,
    };
  } finally {
    for (const p of trimmedPaths) {
      if (p.includes("-trim-") && existsSync(p)) {
        unlinkSync(p);
      }
    }

    if (existsSync(listFilePath)) {
      unlinkSync(listFilePath);
    }
  }
}
