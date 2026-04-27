import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import type { NarrationDraftClip } from "./narration";
import { joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const rawExecFileAsync = promisify(execFile);
const dataDir = joinRuntimeDataPath("narration-audio-temp");
const ffmpegExecutionTimeoutMs = 5 * 60 * 1000;
const ffmpegMaxBuffer = 8 * 1024 * 1024;

async function execFileAsync(file: string, args: string[]) {
  try {
    return await rawExecFileAsync(file, args, {
      timeout: ffmpegExecutionTimeoutMs,
      maxBuffer: ffmpegMaxBuffer,
    });
  } catch (error) {
    const maybeError = error as { killed?: boolean; signal?: string };
    if (maybeError.killed || maybeError.signal === "SIGTERM") {
      throw new Error(`音频合并超时（${Math.round(ffmpegExecutionTimeoutMs / 1000)} 秒），请重试或减少单次生成内容`);
    }
    throw error;
  }
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
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

function getSafeSeconds(value: number | null | undefined, fallback = 0) {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function getClipSegmentKey(clip: NarrationDraftClip, index: number) {
  const segmentIndex = clip.segmentIndex ?? clip.shotIndex ?? index + 1;
  const sortIndex = Math.round(segmentIndex * 1000);
  const segmentId = clip.segmentId?.trim() || clip.bindToSegmentId?.trim() || `segment-${segmentIndex}`;
  return `${String(sortIndex).padStart(8, "0")}-${segmentId}`;
}

function getClipWindowSeconds(clip: NarrationDraftClip) {
  return Math.max(
    0.2,
    getSafeSeconds(clip.durationSeconds),
    getSafeSeconds(clip.audioDurationSeconds),
    clip.words?.length ? Math.max(...clip.words.map((word) => getSafeSeconds(word.endTime))) : 0,
  );
}

function buildEffectiveClipStartMap(clips: NarrationDraftClip[]) {
  const segmentMap = new Map<
    string,
    {
      firstStartAtSeconds: number;
      endAtSeconds: number;
      clipIndexes: number[];
    }
  >();

  clips.forEach((clip, index) => {
    const key = getClipSegmentKey(clip, index);
    const startAtSeconds = getSafeSeconds(clip.startAtSeconds);
    const windowEndAtSeconds = startAtSeconds + getClipWindowSeconds(clip);
    const current = segmentMap.get(key);

    if (current) {
      current.firstStartAtSeconds = Math.min(current.firstStartAtSeconds, startAtSeconds);
      current.endAtSeconds = Math.max(current.endAtSeconds, windowEndAtSeconds);
      current.clipIndexes.push(index);
      return;
    }

    segmentMap.set(key, {
      firstStartAtSeconds: startAtSeconds,
      endAtSeconds: windowEndAtSeconds,
      clipIndexes: [index],
    });
  });

  const segments = Array.from(segmentMap.entries()).sort(([left], [right]) => left.localeCompare(right));
  let previousEndAtSeconds = segments[0] ? segments[0][1].endAtSeconds : 0;
  const startsOverlapAcrossSegments = segments.slice(1).some(([, segment]) => {
    const overlaps = segment.firstStartAtSeconds < previousEndAtSeconds - 0.05;
    previousEndAtSeconds = Math.max(previousEndAtSeconds, segment.endAtSeconds);
    return overlaps;
  });

  if (!startsOverlapAcrossSegments) {
    return new Map(clips.map((clip, index) => [index, getSafeSeconds(clip.startAtSeconds)]));
  }

  const startMap = new Map<number, number>();
  let cursor = 0;

  for (const [, segment] of segments) {
    for (const clipIndex of segment.clipIndexes) {
      const localStartAtSeconds = getSafeSeconds(clips[clipIndex]?.startAtSeconds);
      startMap.set(clipIndex, Number((cursor + localStartAtSeconds - segment.firstStartAtSeconds).toFixed(3)));
    }
    cursor = Number((cursor + segment.endAtSeconds - segment.firstStartAtSeconds).toFixed(3));
  }

  return startMap;
}

export async function buildMergedNarrationAudio(resultId: string, clips: NarrationDraftClip[], taskId?: string | null) {
  const audioClips = clips.map((clip, index) => ({ clip, index })).filter(({ clip }) => Boolean(clip.audioUrl));
  const requiredAudioMissing = clips.some(
    (clip) => clip.hasVoice !== false && Boolean(clip.narrationText.trim()) && !clip.audioUrl,
  );
  if (audioClips.length === 0 || requiredAudioMissing) {
    return null;
  }

  mkdirSync(dataDir, { recursive: true });
  const outputDir = getMergedNarrationOutputDir(taskId);
  mkdirSync(outputDir, { recursive: true });

  const ffmpegPath = resolveFfmpegPath();

  const outputFileName = `${resultId}.mp3`;
  const outputPath = join(outputDir, outputFileName);
  const effectiveStartMap = buildEffectiveClipStartMap(clips);
  const inputArgs = ["-y"];
  const filterParts: string[] = [];
  const audioLabels: string[] = [];

  audioClips.forEach(({ clip, index }, inputIndex) => {
    inputArgs.push("-i", toAbsoluteLocalPath(clip.audioUrl!));

    const clipDuration = Math.max(0.2, getSafeSeconds(clip.audioDurationSeconds ?? clip.durationSeconds, 2));
    const startAtSeconds = effectiveStartMap.get(index) ?? getSafeSeconds(clip.startAtSeconds);
    const delayMs = Math.round(startAtSeconds * 1000);
    const fadeOutSeconds = Math.min(0.5, Math.max(0.15, clipDuration));
    const label = `[a${inputIndex}]`;
    const chain = [
      "aresample=48000",
      `atrim=duration=${clipDuration}`,
      "asetpts=PTS-STARTPTS",
      `afade=t=out:st=${Math.max(0, clipDuration - fadeOutSeconds)}:d=${fadeOutSeconds}`,
      delayMs > 0 ? `adelay=${delayMs}|${delayMs}` : null,
    ].filter((item): item is string => Boolean(item));

    filterParts.push(`[${inputIndex}:a]${chain.join(",")}${label}`);
    audioLabels.push(label);
  });

  filterParts.push(
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95[a]`,
  );

  await execFileAsync(ffmpegPath, [
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[a]",
    "-vn",
    "-q:a",
    "2",
    outputPath,
  ]);

  return {
    publicUrl: `/generated-audio/${taskId?.trim() || "_unassigned"}/narration-merged/${outputFileName}`,
  };
}
