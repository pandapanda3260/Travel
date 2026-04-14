import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import type { NarrationDraftClip } from "./narration";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");
const dataDir = join(process.cwd(), "data", "narration-audio-temp");

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
}

function toAbsoluteLocalPath(publicUrl: string) {
  return join(process.cwd(), "public", publicUrl.replace(/^\//, ""));
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

function getMergedNarrationOutputDir(taskId?: string | null) {
  return join(process.cwd(), "public", "generated-audio", taskId?.trim() || "_unassigned", "narration-merged");
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

  const trimmedPaths: string[] = [];
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

  const listFilePath = join(dataDir, `${resultId}-concat.txt`);
  const outputFileName = `${resultId}.mp3`;
  const outputPath = join(outputDir, outputFileName);

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

  for (const p of trimmedPaths) {
    if (p.includes("-trim-") && existsSync(p)) {
      unlinkSync(p);
    }
  }

  return {
    publicUrl: `/generated-audio/${taskId?.trim() || "_unassigned"}/narration-merged/${outputFileName}`,
  };
}
