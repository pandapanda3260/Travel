import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type { TaskClipSourceShot } from "./task-clip-store";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import type { VideoMaterialRecord } from "./video-material-store";
import { joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const execFileAsync = promisify(execFile);

export type DirectMaterialClipPlan = {
  materialId: string;
  sourceShotCount: number;
  requestedStartAtSeconds: number;
  requestedEndAtSeconds: number;
  requestedDurationSeconds: number;
  timeRangeLabel: string | null;
};

function isFinitePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolveDirectMaterialClipPlan(
  sourceShots: TaskClipSourceShot[],
  preferredDurationSeconds?: number | null,
) {
  if (!sourceShots.length) {
    return null;
  }

  const eligibleShots = sourceShots.filter((shot) => shot.assetSourceType === "video_material");
  if (eligibleShots.length !== sourceShots.length) {
    return null;
  }

  const materialIds = [...new Set(eligibleShots.map((shot) => shot.sourceMaterialId?.trim()).filter(Boolean))];
  if (materialIds.length !== 1) {
    return null;
  }

  const ranges = eligibleShots
    .map((shot) => ({
      startAtSeconds: shot.sourceStartAtSeconds,
      endAtSeconds: shot.sourceEndAtSeconds,
      timeRangeLabel: shot.sourceTimeRangeLabel ?? null,
    }))
    .filter(
      (range): range is { startAtSeconds: number; endAtSeconds: number; timeRangeLabel: string | null } => {
        const { startAtSeconds, endAtSeconds } = range;
        return (
          typeof endAtSeconds === "number" &&
          Number.isFinite(endAtSeconds) &&
          endAtSeconds > 0 &&
          typeof startAtSeconds === "number" &&
          Number.isFinite(startAtSeconds) &&
          endAtSeconds > startAtSeconds
        );
      },
    );

  if (ranges.length !== eligibleShots.length) {
    return null;
  }

  const requestedStartAtSeconds = Math.min(...ranges.map((range) => range.startAtSeconds));
  const requestedEndAtSeconds = Math.max(...ranges.map((range) => range.endAtSeconds));
  const requestedDurationSeconds = Number((requestedEndAtSeconds - requestedStartAtSeconds).toFixed(2));
  if (!isFinitePositiveNumber(requestedDurationSeconds) || requestedDurationSeconds < 0.8) {
    return null;
  }

  if (
    isFinitePositiveNumber(preferredDurationSeconds) &&
    eligibleShots.length > 1 &&
    requestedDurationSeconds > Number(preferredDurationSeconds) + 1.5
  ) {
    return null;
  }

  return {
    materialId: materialIds[0]!,
    sourceShotCount: eligibleShots.length,
    requestedStartAtSeconds,
    requestedEndAtSeconds,
    requestedDurationSeconds,
    timeRangeLabel:
      ranges.length === 1
        ? ranges[0]!.timeRangeLabel
        : `${requestedStartAtSeconds.toFixed(1)}秒-${requestedEndAtSeconds.toFixed(1)}秒`,
  } satisfies DirectMaterialClipPlan;
}

async function probeVideoDurationSeconds(inputPath: string) {
  const ffmpegPath = getFfmpegBinaryPath();

  try {
    const { stderr } = await execFileAsync(ffmpegPath, ["-i", inputPath, "-f", "null", "-"]);
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
}

export async function createDirectMaterialClipFromSource(input: {
  taskId: string;
  jobId: string;
  material: VideoMaterialRecord;
  clipPlan: DirectMaterialClipPlan;
  preferredDurationSeconds?: number | null;
}) {
  if (!input.material.videoFileUrl?.startsWith("/")) {
    throw new Error("参考视频素材文件不存在，无法直出片段");
  }

  const inputPath = resolveRuntimeAssetUrlToPath(input.material.videoFileUrl);
  if (!existsSync(inputPath)) {
    throw new Error("参考视频素材文件不存在，无法直出片段");
  }

  const ffmpegPath = getFfmpegBinaryPath();
  const outputDir = joinRuntimePublicStoragePath("generated-videos", input.taskId.trim() || "_unassigned");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${input.jobId}.mp4`);

  const sourceVideoDurationSeconds = await probeVideoDurationSeconds(inputPath);
  const preferredDurationSeconds =
    isFinitePositiveNumber(input.preferredDurationSeconds) ? Number(input.preferredDurationSeconds) : null;

  let clipStartAtSeconds = Math.max(0, input.clipPlan.requestedStartAtSeconds);
  let clipDurationSeconds = Math.max(0.8, input.clipPlan.requestedDurationSeconds);

  if (preferredDurationSeconds && input.clipPlan.sourceShotCount === 1) {
    clipDurationSeconds = Math.max(0.8, preferredDurationSeconds);
    const coverageMidpoint =
      input.clipPlan.requestedStartAtSeconds + input.clipPlan.requestedDurationSeconds / 2;
    clipStartAtSeconds = Math.max(0, coverageMidpoint - clipDurationSeconds / 2);
  }

  if (sourceVideoDurationSeconds != null) {
    if (clipStartAtSeconds + clipDurationSeconds > sourceVideoDurationSeconds) {
      clipStartAtSeconds = Math.max(0, sourceVideoDurationSeconds - clipDurationSeconds);
    }
    clipDurationSeconds = Math.min(clipDurationSeconds, Math.max(0.8, sourceVideoDurationSeconds - clipStartAtSeconds));
  }

  await execFileAsync(ffmpegPath, [
    "-y",
    "-ss",
    clipStartAtSeconds.toFixed(3),
    "-i",
    inputPath,
    "-t",
    clipDurationSeconds.toFixed(3),
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=25",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);

  return {
    videoUrl: `/generated-videos/${input.taskId.trim() || "_unassigned"}/${input.jobId}.mp4`,
    resolvedDurationSeconds: Number(clipDurationSeconds.toFixed(2)),
    usedStartAtSeconds: Number(clipStartAtSeconds.toFixed(2)),
    usedDurationSeconds: Number(clipDurationSeconds.toFixed(2)),
    usedTimeRangeLabel: `${clipStartAtSeconds.toFixed(1)}秒-${(clipStartAtSeconds + clipDurationSeconds).toFixed(1)}秒`,
  };
}
