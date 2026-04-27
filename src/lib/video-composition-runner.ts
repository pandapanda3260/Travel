import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { withAdminProviderCallTracking, writeAdminTaskStageRun } from "./admin-data-flow-tracking";
import { getAsrRuntime } from "./asr-provider-config";
import { transcribeAudioFile } from "./asr-provider";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { writeFetchResponseToPath } from "./file-stream";
import { getFfmpegLocalRuntime } from "./local-service-runtime";
import { upsertMaterialLibraryItemBySource } from "./material-library-store";
import type { ProgressCallback } from "./progress-stream";
import { getVideoJob } from "./video-job-store";
import { createVideoJobRecord } from "./video-job-runner";
import { defaultMediaDownloadTimeoutMs, fetchWithTimeout } from "./timeout";
import {
  convertCssOpacityToAssAlpha,
  convertHexToAssColor,
  getDefaultSubtitleConfig,
  getSubtitleFontFamilyNames,
  getSubtitleOutputTypographyMetrics,
  getSubtitlePresetDecoration,
  getSubtitleToneStyle,
  type SubtitleConfig,
} from "./subtitle-style-config";
import { buildSubtitleAssPosition } from "./video-composition-timeline";
import {
  type CompositionAudioPlan,
  getVideoComposition,
  patchVideoComposition,
  type CompositionAudioTrack,
  type CompositionAudioMode,
  type CompositionAspectRatio,
  type CompositionSegment,
  type CompositionTransition,
  type GlobalConsistencyProfile,
  type VideoCompositionRecord,
} from "./video-composition-store";
import { getVideoTask, patchVideoTask } from "./video-task-store";
import { getVideoTaskStatusIndex } from "./video-task-schema";
import { upsertVideoJob } from "./video-job-store";
import { joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { WeightedProgressTracker } from "./weighted-progress-tracker";
import { normalizeMediaSourceInput } from "./media-source-input";
import { getMediaSourceFileExtension, resolveLocalMediaSource } from "./media-source-resolver";
import { getCompositionBackgroundMusicVolumeGain } from "./task-creation-parameters";

const rawExecFileAsync = promisify(execFile);
const tempDir = joinRuntimeDataPath("composition-temp");
const ffmpegExecutionTimeoutMs = 10 * 60 * 1000;
const ffmpegMaxBuffer = 16 * 1024 * 1024;

async function execFileAsync(file: string, args: string[]) {
  try {
    return await rawExecFileAsync(file, args, {
      timeout: ffmpegExecutionTimeoutMs,
      maxBuffer: ffmpegMaxBuffer,
    });
  } catch (error) {
    const maybeError = error as { killed?: boolean; signal?: string; message?: string };
    if (maybeError.killed || maybeError.signal === "SIGTERM") {
      throw new Error(`FFmpeg 执行超时（${Math.round(ffmpegExecutionTimeoutMs / 1000)} 秒），请检查素材格式或缩短任务后重试`);
    }
    throw error;
  }
}

function getCompositionOutputDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-compositions", taskId?.trim() || "_unassigned");
}

function getGeneratedVideoDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-videos", taskId?.trim() || "_unassigned");
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
}

function ensureDirectories() {
  mkdirSync(getCompositionOutputDir(), { recursive: true });
  mkdirSync(tempDir, { recursive: true });
}

function getOutputSize(aspectRatio: CompositionAspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1280, height: 720 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default:
      return { width: 720, height: 1280 };
  }
}

function getTempSourcePath(sourceUrl: string, fileId: string) {
  return join(tempDir, `${fileId}-source${getMediaSourceFileExtension(sourceUrl)}`);
}

async function ensureMediaSource(sourceUrl: string, fileId: string) {
  const normalizedSourceUrl = normalizeMediaSourceInput(sourceUrl);
  const localSource = resolveLocalMediaSource(normalizedSourceUrl);

  if (localSource) {
    if (!localSource.shouldCopyToTemp) {
      return { localPath: localSource.localPath, shouldCleanup: false };
    }

    const localPath = getTempSourcePath(normalizedSourceUrl, fileId);
    await copyFile(localSource.localPath, localPath);
    return { localPath, shouldCleanup: true };
  }

  const localPath = getTempSourcePath(normalizedSourceUrl, fileId);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      normalizedSourceUrl,
      {},
      {
        timeoutMs: defaultMediaDownloadTimeoutMs,
        timeoutMessage: "素材下载超时，请检查视频片段或背景音乐地址",
      },
    );
  } catch {
    throw new Error("素材地址无法读取，请使用 http(s) 链接、站内资源路径或服务器本机可访问的媒体文件路径");
  }
  if (!response.ok) {
    throw new Error("素材下载失败");
  }

  await writeFetchResponseToPath(response, localPath);
  return { localPath, shouldCleanup: true };
}

function resolveSegmentSourceUrl(segment: CompositionSegment) {
  const sourceJob = getVideoJob(segment.sourceJobId);
  const taskId = sourceJob?.sourceTaskId ?? null;
  const localGeneratedPath = join(getGeneratedVideoDir(taskId), `${segment.sourceJobId}.mp4`);

  if (existsSync(localGeneratedPath)) {
    return `/generated-videos/${taskId?.trim() || "_unassigned"}/${segment.sourceJobId}.mp4`;
  }

  return segment.sourceVideoUrl;
}

async function normalizeSegment(
  inputPath: string,
  segmentId: string,
  aspectRatio: CompositionAspectRatio,
  keepSourceAudio: boolean,
) {
  const ffmpegPath = resolveFfmpegPath();

  const outputPath = join(tempDir, `${segmentId}-normalized.mp4`);
  const { width, height } = getOutputSize(aspectRatio);

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(keepSourceAudio ? ["-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
    outputPath,
  ]);

  return outputPath;
}

async function probeMediaDurationSeconds(inputPath: string) {
  const ffmpegPath = resolveFfmpegPath();

  try {
    const { stderr } = await execFileAsync(ffmpegPath, ["-i", inputPath, "-f", "null", "-"]);
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  } catch (error) {
    const text =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : "";
    const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
}

async function concatSegments(segmentPaths: string[], compositionId: string, keepSourceAudio: boolean) {
  const ffmpegPath = resolveFfmpegPath();

  const listFilePath = join(tempDir, `${compositionId}-concat.txt`);
  const outputPath = join(tempDir, `${compositionId}-base.mp4`);
  const listContent = segmentPaths.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listFilePath, listContent, "utf8");
  await execFileAsync(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFilePath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(keepSourceAudio ? ["-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
    outputPath,
  ]);

  return {
    outputFilePath: outputPath,
    listFilePath,
  };
}

async function crossfadeSegments(
  segmentPaths: string[],
  segments: CompositionSegment[],
  compositionId: string,
  keepSourceAudio: boolean,
  transitionDurationSeconds: number,
) {
  const ffmpegPath = resolveFfmpegPath();

  const outputPath = join(tempDir, `${compositionId}-base.mp4`);
  const filterParts: string[] = [];
  let currentVideoLabel = "[0:v]";
  let currentAudioLabel = keepSourceAudio ? "[0:a]" : "";
  let outputDurationSeconds = segments[0]?.durationSeconds ?? 15;

  for (let index = 1; index < segmentPaths.length; index += 1) {
    const nextVideoLabel = `[v${index}]`;
    const currentTransitionSeconds = segments[index]?.transition === "fade" ? transitionDurationSeconds : 0.001;
    const offset = Math.max(0, outputDurationSeconds - currentTransitionSeconds);
    filterParts.push(
      `${currentVideoLabel}[${index}:v]xfade=transition=fade:duration=${currentTransitionSeconds}:offset=${offset}${nextVideoLabel}`,
    );
    currentVideoLabel = nextVideoLabel;

    if (keepSourceAudio) {
      const nextAudioLabel = `[a${index}]`;
      filterParts.push(`${currentAudioLabel}[${index}:a]acrossfade=d=${currentTransitionSeconds}${nextAudioLabel}`);
      currentAudioLabel = nextAudioLabel;
    }

    outputDurationSeconds += (segments[index]?.durationSeconds ?? 15) - currentTransitionSeconds;
  }

  const args = [
    "-y",
    ...segmentPaths.flatMap((filePath) => ["-i", filePath]),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    currentVideoLabel,
    ...(keepSourceAudio ? ["-map", currentAudioLabel] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(keepSourceAudio ? ["-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
    outputPath,
  ];

  await execFileAsync(ffmpegPath, args);
  return { outputFilePath: outputPath, listFilePath: undefined };
}

function getEnabledAudioTracks(record: VideoCompositionRecord) {
  const enabledTracks = (record.audioPlan.tracks ?? []).filter(
    (track) => track.enabled !== false && track.mute !== true && track.clips.some((clip) => clip.sourceUrl),
  );

  const hasBackgroundTrack = enabledTracks.some((track) => track.kind === "bgm");

  if (
    !hasBackgroundTrack &&
    record.backgroundMusicUrl &&
    (record.audioMode === "bgm_only" ||
      record.audioMode === "source_with_bgm" ||
      record.audioMode === "narration_with_bgm")
  ) {
    enabledTracks.push({
      id: "fallback-bgm-track",
      kind: "bgm",
      name: "背景音乐",
      enabled: true,
      mute: false,
      volume: getCompositionBackgroundMusicVolumeGain(record.backgroundMusicVolume),
      clips: [
        {
          id: "fallback-bgm-clip",
          sourceUrl: record.backgroundMusicUrl,
          startAtSeconds: 0,
          loop: true,
          fadeInSeconds: 0.8,
        },
      ],
    } satisfies CompositionAudioTrack);
  }

  return enabledTracks;
}

function shouldKeepSourceAudio(audioMode: CompositionAudioMode) {
  return audioMode === "source_only" || audioMode === "source_with_bgm";
}

function getCompositionOutputAudioLabel(audioMode: CompositionAudioMode) {
  switch (audioMode) {
    case "mute":
      return "静音输出";
    case "bgm_only":
      return "仅背景音乐";
    case "source_only":
      return "保留片段原音";
    case "source_with_bgm":
      return "片段原音 + 背景音乐";
    case "narration_only":
      return "解说音频";
    case "narration_with_bgm":
      return "解说音频 + 背景音乐";
    default:
      return "多轨音频";
  }
}

function getDefaultTrackBaseVolume(track: CompositionAudioTrack) {
  if (track.kind === "bgm") {
    return 0.28;
  }

  if (track.kind === "sfx") {
    return 0.9;
  }

  return 1;
}

function getSafeSeconds(value: number | null | undefined, fallback = 0) {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function normalizeNarrationValidationText(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/[零〇]/g, "0")
    .replace(/[一壹]/g, "1")
    .replace(/[二贰两]/g, "2")
    .replace(/[三叁]/g, "3")
    .replace(/[四肆]/g, "4")
    .replace(/[五伍]/g, "5")
    .replace(/[六陆]/g, "6")
    .replace(/[七柒]/g, "7")
    .replace(/[八捌]/g, "8")
    .replace(/[九玖]/g, "9")
    .replace(/\s+/g, "")
    .replace(/[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]/g, "")
    .trim();
}

function getLongestCommonSubsequenceLength(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }

    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return previous[right.length] ?? 0;
}

function getNarrationCoverage(expectedText: string, recognizedText: string) {
  const expected = normalizeNarrationValidationText(expectedText);
  const recognized = normalizeNarrationValidationText(recognizedText);
  if (!expected) {
    return 1;
  }

  return getLongestCommonSubsequenceLength(expected, recognized) / expected.length;
}

function getNarrationValidationThreshold(expectedText: string) {
  const length = normalizeNarrationValidationText(expectedText).length;
  if (length <= 8) {
    return 0.45;
  }

  if (length <= 16) {
    return 0.52;
  }

  return 0.58;
}

function getNarrationValidationTargets(record: VideoCompositionRecord) {
  return getEnabledAudioTracks(record)
    .filter((track) => track.kind === "narration")
    .flatMap((track) =>
      track.clips
        .map((clip, index) => {
          const expectedText = String(clip.text ?? "").trim();
          if (!clip.sourceUrl || !expectedText) {
            return null;
          }

          const clipDuration = Math.max(0.8, getSafeSeconds(clip.durationSeconds, 4));
          const sampleDuration = Math.min(10, Math.max(2.5, clipDuration + 0.25));
          const expectedSnippetLength = Math.max(
            Math.min(8, normalizeNarrationValidationText(expectedText).length),
            Math.ceil(
              normalizeNarrationValidationText(expectedText).length * Math.min(1, sampleDuration / clipDuration),
            ),
          );
          const expectedSnippet = Array.from(expectedText).slice(0, expectedSnippetLength).join("");

          return {
            id: clip.id || `${track.id}-${index + 1}`,
            note: clip.note || `口播 ${index + 1}`,
            startAtSeconds: Math.max(0, getSafeSeconds(clip.startAtSeconds) - 0.05),
            durationSeconds: sampleDuration,
            expectedText: expectedSnippet || expectedText,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    );
}

async function extractAudioWindowToWav(
  inputPath: string,
  outputPath: string,
  startAtSeconds: number,
  durationSeconds: number,
) {
  const ffmpegPath = resolveFfmpegPath();

  await execFileAsync(ffmpegPath, [
    "-y",
    "-ss",
    String(startAtSeconds),
    "-i",
    inputPath,
    "-t",
    String(durationSeconds),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    outputPath,
  ]);
}

async function validateComposedNarrationAudio(inputPath: string, record: VideoCompositionRecord) {
  const targets = getNarrationValidationTargets(record);
  if (targets.length === 0) {
    return { checkedCount: 0, skipped: true, skippedReason: "未检测到需校验的独立口播", issues: [] as string[] };
  }

  const asrRuntime = getAsrRuntime();
  if (!asrRuntime.liveEnabled) {
    return {
      checkedCount: 0,
      skipped: true,
      skippedReason: `ASR 未启用，无法执行成片口播完整性校验（${asrRuntime.configFileName}）`,
      issues: [] as string[],
    };
  }

  const issues: string[] = [];
  for (const target of targets) {
    const audioWindowPath = join(
      tempDir,
      `${record.compositionId}-asr-${target.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.wav`,
    );

    try {
      await extractAudioWindowToWav(inputPath, audioWindowPath, target.startAtSeconds, target.durationSeconds);
      const asrResult = await transcribeAudioFile(audioWindowPath, "wav");
      const coverage = getNarrationCoverage(target.expectedText, asrResult.text);

      if (coverage < getNarrationValidationThreshold(target.expectedText)) {
        issues.push(`${target.note} 口播疑似缺失：期望“${target.expectedText}”，ASR 识别“${asrResult.text || "空"}”`);
      }
    } finally {
      await rm(audioWindowPath, { force: true });
    }
  }

  return {
    checkedCount: targets.length,
    skipped: false,
    issues,
  };
}

function createCompositionProgressTracker(record: VideoCompositionRecord, onProgress?: ProgressCallback) {
  if (!onProgress) {
    return null;
  }

  const enabledTracks = getEnabledAudioTracks(record);
  const compositionDurationSeconds = Math.max(1, getCompositionDurationSeconds(record));
  const hasAudioWork = shouldKeepSourceAudio(record.audioMode) || enabledTracks.length > 0;
  const trackClipCount = enabledTracks.reduce(
    (sum, track) => sum + track.clips.filter((clip) => clip.sourceUrl).length,
    0,
  );
  const hasSubtitleWork =
    (record.subtitleConfig ?? getDefaultSubtitleConfig()).enabled && Boolean(record.subtitleSrtUrl?.startsWith("/"));

  const units = [
    { id: "prepare", weight: 1.2, estimatedMs: 900, label: "准备素材" },
    ...record.segments
      .sort((left, right) => left.order - right.order)
      .map((segment) => {
        const durationSeconds = Math.max(1, segment.durationSeconds ?? 5);
        return {
          id: `normalize-${segment.id}`,
          weight: 1.8 + durationSeconds * 0.45,
          estimatedMs: 8_000 + durationSeconds * 1_500,
          label: segment.note ?? segment.sourceJobId,
        };
      }),
    {
      id: "merge_video",
      weight: 2.4 + compositionDurationSeconds * 0.22,
      estimatedMs: 3_200 + compositionDurationSeconds * 260,
      label: "拼接视频轨",
    },
    {
      id: "mix_audio",
      weight: hasAudioWork ? 1.8 + trackClipCount * 0.35 : 0.2,
      estimatedMs: hasAudioWork ? 2_400 + compositionDurationSeconds * 180 + trackClipCount * 320 : 500,
      label: "混合音频轨",
    },
    {
      id: "burn_subtitles",
      weight: hasSubtitleWork ? 1.4 + compositionDurationSeconds * 0.18 : 0.2,
      estimatedMs: hasSubtitleWork ? 2_100 + compositionDurationSeconds * 140 : 500,
      label: "烧录字幕",
    },
    {
      id: "validate_audio",
      weight: hasAudioWork ? 1.6 : 0.2,
      estimatedMs: hasAudioWork ? 4_000 : 500,
      label: "校验口播",
    },
    {
      id: "finalize",
      weight: 1.1,
      estimatedMs: 900,
      label: "输出成片",
    },
  ];

  return new WeightedProgressTracker(onProgress, units, {
    step: "composition",
    floorPercent: 6,
    capPercent: 99,
    tickMs: 420,
  });
}

async function applyAudioPlan(baseVideoPath: string, record: VideoCompositionRecord, keepSourceAudio: boolean) {
  const ffmpegPath = resolveFfmpegPath();
  const enabledTracks = getEnabledAudioTracks(record);
  const baseVideoDurationSeconds = await probeMediaDurationSeconds(baseVideoPath);
  if (record.audioMode === "mute" && !keepSourceAudio && enabledTracks.length === 0) {
    return null;
  }

  if (!keepSourceAudio && enabledTracks.length === 0) {
    return null;
  }

  const outputPath = join(tempDir, `${record.compositionId}-audio.mp4`);
  const compositionDurationSeconds = Math.max(1, getCompositionDurationSeconds(record));
  const inputArgs = ["-y", "-i", baseVideoPath];
  const filterParts: string[] = [];
  const audioLabels: string[] = [];
  const cleanupPaths: string[] = [];
  let inputIndex = 1;

  if (keepSourceAudio) {
    filterParts.push(`[0:a]aresample=48000,volume=1[amix0]`);
    audioLabels.push("[amix0]");
  }

  for (const track of enabledTracks) {
    for (const clip of track.clips) {
      if (!clip.sourceUrl) {
        continue;
      }

      const source = await ensureMediaSource(clip.sourceUrl, `${record.compositionId}-${track.id}-${clip.id}`);
      const sourcePath = source.localPath;
      if (source.shouldCleanup) {
        cleanupPaths.push(sourcePath);
      }

      const loopClip = Boolean(clip.loop && track.kind === "bgm");
      if (loopClip) {
        inputArgs.push("-stream_loop", "-1");
      }
      inputArgs.push("-i", sourcePath);

      const delayMs = Math.round(getSafeSeconds(clip.startAtSeconds) * 1000);
      const baseVolume = getDefaultTrackBaseVolume(track);
      const volume = Math.max(0, baseVolume * (track.volume ?? 1) * (clip.volume ?? 1));
      const clipDuration =
        clip.durationSeconds != null
          ? getSafeSeconds(clip.durationSeconds)
          : loopClip
            ? compositionDurationSeconds
            : null;
      const fadeInSeconds =
        clip.fadeInSeconds != null ? getSafeSeconds(clip.fadeInSeconds) : track.kind === "bgm" ? 0.8 : 0;
      const fadeOutSeconds = getSafeSeconds(clip.fadeOutSeconds);
      const inputLabel = `[${inputIndex}:a]`;
      const chain = ["aresample=48000", `volume=${volume}`];

      if (track.kind === "narration") {
        chain.push("loudnorm=I=-16:LRA=7:TP=-1.5");
      }

      if (clipDuration != null && clipDuration > 0) {
        chain.push(`atrim=duration=${clipDuration}`);
      }
      chain.push("asetpts=PTS-STARTPTS");
      if (fadeInSeconds > 0) {
        chain.push(`afade=t=in:st=0:d=${fadeInSeconds}`);
      }
      if (fadeOutSeconds > 0 && clipDuration != null && clipDuration > fadeOutSeconds) {
        chain.push(`afade=t=out:st=${Math.max(0, clipDuration - fadeOutSeconds)}:d=${fadeOutSeconds}`);
      }
      if (delayMs > 0) {
        chain.push(`adelay=${delayMs}|${delayMs}`);
      }

      const label = `[amix${audioLabels.length}]`;
      filterParts.push(`${inputLabel}${chain.join(",")}${label}`);
      audioLabels.push(label);
      inputIndex += 1;
    }
  }

  if (audioLabels.length === 0) {
    return null;
  }

  const safeDuration = baseVideoDurationSeconds ?? Math.max(1, getCompositionDurationSeconds(record));
  filterParts.push(
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=2,apad=pad_dur=${safeDuration},atrim=duration=${safeDuration},alimiter=limit=0.95[a]`,
  );

  await execFileAsync(ffmpegPath, [
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ]);

  return {
    outputFilePath: outputPath,
    cleanupPaths,
  };
}

async function burnSubtitles(baseVideoPath: string, record: VideoCompositionRecord) {
  const subtitleConfig = record.subtitleConfig ?? getDefaultSubtitleConfig();

  if (!subtitleConfig.enabled || !record.subtitleSrtUrl?.startsWith("/")) {
    return null;
  }

  const subtitlePath = resolveRuntimeAssetUrlToPath(record.subtitleSrtUrl);
  if (!existsSync(subtitlePath)) {
    return null;
  }

  const ffmpegPath = resolveFfmpegPath();
  const outputPath = join(tempDir, `${record.compositionId}-subtitled.mp4`);
  const { width, height } = getOutputSize(record.aspectRatio);
  const decoration = getSubtitlePresetDecoration(subtitleConfig.stylePreset);
  const toneStyle = getSubtitleToneStyle(subtitleConfig);
  const typographyMetrics = getSubtitleOutputTypographyMetrics(subtitleConfig, record.aspectRatio);
  const fontSize = typographyMetrics.fontSizePx;
  const { x, y } = buildSubtitleAssPosition({
    frameWidth: width,
    frameHeight: height,
    positionOffsetRatio: subtitleConfig.positionOffsetRatio,
    horizontalPositionRatio: subtitleConfig.horizontalPositionRatio,
  });
  const outline = typographyMetrics.outlineWidthPx;
  const shadow = typographyMetrics.shadowPx;
  const fontName = getSubtitleFontFamilyNames(subtitleConfig.fontFamily).assFontName;
  const assPath = join(tempDir, `${record.compositionId}-subtitles.ass`);
  const subtitleCues = parseSrtCues(readFileSync(subtitlePath, "utf8"));
  const assContent = buildAssSubtitleDocument({
    cues: subtitleCues,
    width,
    height,
    x,
    y,
    fontName,
    fontSize,
    primaryColor: subtitleConfig.textColor,
    outlineColor: subtitleConfig.outlineColor,
    borderStyle: decoration.borderStyle,
    outline,
    shadow,
    toneStyle,
    bold: decoration.bold,
  });
  writeFileSync(assPath, assContent, "utf8");
  const escapedAssPath = assPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'");

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    baseVideoPath,
    "-vf",
    `ass='${escapedAssPath}'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    outputPath,
  ]);

  return {
    outputFilePath: outputPath,
  };
}

type AssSubtitleCue = {
  startAtSeconds: number;
  endAtSeconds: number;
  text: string;
};

function parseSrtTimestamp(value: string) {
  const match = value.trim().match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!match) {
    return 0;
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

function parseSrtCues(srtText: string): AssSubtitleCue[] {
  return srtText
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        return null;
      }

      const timeLineIndex = lines[0]?.includes("-->") ? 0 : 1;
      const timeLine = lines[timeLineIndex] ?? "";
      const textLines = lines.slice(timeLineIndex + 1);
      const [startRaw, endRaw] = timeLine.split(/\s*-->\s*/);
      if (!startRaw || !endRaw || textLines.length === 0) {
        return null;
      }

      return {
        startAtSeconds: parseSrtTimestamp(startRaw),
        endAtSeconds: parseSrtTimestamp(endRaw),
        text: textLines.join("\n"),
      } satisfies AssSubtitleCue;
    })
    .filter((item): item is AssSubtitleCue => Boolean(item));
}

function formatAssTimestamp(totalSeconds: number) {
  const totalCentiseconds = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "（")
    .replace(/\}/g, "）")
    .replace(/\r?\n/g, "\\N");
}

function buildAssSubtitleDocument(input: {
  cues: AssSubtitleCue[];
  width: number;
  height: number;
  x: number;
  y: number;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  toneStyle: ReturnType<typeof getSubtitleToneStyle>;
  bold: boolean;
}) {
  const events = input.cues
    .map((cue) => {
      const text = escapeAssText(cue.text);
      return `Dialogue: 0,${formatAssTimestamp(cue.startAtSeconds)},${formatAssTimestamp(cue.endAtSeconds)},Default,,0,0,0,,{\\pos(${input.x},${input.y})}${text}`;
    })
    .join("\n");

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${input.width}`,
    `PlayResY: ${input.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    [
      "Style: Default",
      input.fontName,
      input.fontSize,
      convertHexToAssColor(input.primaryColor),
      convertHexToAssColor(input.primaryColor),
      convertHexToAssColor(input.outlineColor),
      convertHexToAssColor(
        input.toneStyle.backgroundOpacity > 0 ? input.toneStyle.backgroundColor : input.toneStyle.shadowColor,
        convertCssOpacityToAssAlpha(
          input.toneStyle.backgroundOpacity > 0 ? input.toneStyle.backgroundOpacity : input.toneStyle.shadowOpacity,
        ),
      ),
      input.bold ? 1 : 0,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      input.borderStyle,
      input.outline,
      input.shadow,
      2,
      0,
      0,
      0,
      1,
    ].join(","),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events,
    "",
  ].join("\n");
}

function finalizeOutput(baseVideoPath: string, compositionId: string, taskId?: string | null) {
  const publicOutputDir = getCompositionOutputDir(taskId);
  mkdirSync(publicOutputDir, { recursive: true });
  const outputPath = join(publicOutputDir, `${compositionId}.mp4`);
  renameSync(baseVideoPath, outputPath);
  return `/generated-compositions/${taskId?.trim() || "_unassigned"}/${compositionId}.mp4`;
}

function buildCompositionSummary(record: VideoCompositionRecord) {
  return [
    `拼接项目：${record.title}`,
    `比例：${record.aspectRatio}`,
    `转场：${record.transitionMode === "fade" ? "淡入淡出" : "硬切"}`,
    `音频：${getCompositionOutputAudioLabel(record.audioMode)}`,
    `片段数：${record.segments.length}`,
    ...record.segments
      .sort((left, right) => left.order - right.order)
      .map((segment) =>
        `${segment.order}. ${segment.sourceJobId}${segment.note ? `｜${segment.note}` : ""} ${segment.durationSeconds ?? ""}`.trim(),
      ),
  ].join("\n");
}

function getCompositionDurationSeconds(record: VideoCompositionRecord) {
  const totalDuration = record.segments.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);

  if (!totalDuration) {
    return 0;
  }

  if (record.transitionMode !== "fade") {
    return totalDuration;
  }

  return Math.max(0, totalDuration - Math.max(0, record.segments.length - 1) * record.transitionDurationSeconds);
}

function syncCompositionJob(record: VideoCompositionRecord) {
  upsertVideoJob(
    createVideoJobRecord({
      jobId: record.compositionId,
      sourceTaskId: record.taskId,
      taskName: `任务合成-${record.title}`.slice(0, 18),
      originalPrompt: buildCompositionSummary(record),
      optimizedPrompt: buildCompositionSummary(record),
      strategy: {
        angle: "任务合成成片",
        hook: `${record.segments.length} 段任务合成`,
        style: record.transitionMode === "fade" ? "任务长视频淡入淡出合成" : "任务长视频硬切合成",
      },
      submittedAt: record.createdAt,
      status: record.status === "COMPLETED" ? "COMPLETED" : record.status === "FAILED" ? "FAILED" : "IN_PROGRESS",
      mode: "composition",
      logs:
        record.status === "FAILED"
          ? [record.error ?? "拼接任务执行失败"]
          : record.status === "COMPLETED"
            ? ["拼接任务已完成，成片已生成。"]
            : ["拼接任务处理中，正在生成测试成片。"],
      videoUrl: record.outputVideoUrl,
      error: record.error,
      modelId: "composition",
      generationSettings: {
        durationSeconds: Math.max(1, getCompositionDurationSeconds(record)),
        mode: "std",
        aspectRatio: record.aspectRatio,
        shotType: "customize",
        multiShot: false,
        multiPrompt: [],
        generateAudio: record.audioMode !== "mute",
        cfgScale: 0.5,
        cameraControl: "auto",
        watermark: false,
        negativePrompt: "",
      },
    }),
  );
}

export function createCompositionRecord(input: {
  taskId?: string | null;
  title: string;
  aspectRatio: CompositionAspectRatio;
  transitionMode: CompositionTransition;
  transitionDurationSeconds: number;
  audioMode: CompositionAudioMode;
  backgroundMusicUrl: string | null;
  backgroundMusicVolume: number;
  audioPlan: CompositionAudioPlan;
  subtitleSrtUrl?: string | null;
  subtitleConfig?: SubtitleConfig;
  segments: CompositionSegment[];
  consistencyProfile: GlobalConsistencyProfile;
}) {
  const now = new Date().toISOString();

  return {
    compositionId: crypto.randomUUID(),
    taskId: input.taskId ?? null,
    title: input.title,
    aspectRatio: input.aspectRatio,
    status: "DRAFT",
    transitionMode: input.transitionMode,
    transitionDurationSeconds: input.transitionDurationSeconds,
    audioMode: input.audioMode,
    backgroundMusicUrl: input.backgroundMusicUrl,
    backgroundMusicVolume: input.backgroundMusicVolume,
    audioPlan: input.audioPlan,
    subtitleSrtUrl: input.subtitleSrtUrl ?? null,
    subtitleConfig: input.subtitleConfig ?? getDefaultSubtitleConfig(),
    segments: input.segments,
    consistencyProfile: input.consistencyProfile,
    outputVideoUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  } satisfies VideoCompositionRecord;
}

export async function composeVideoProject(record: VideoCompositionRecord, options?: { onProgress?: ProgressCallback }) {
  ensureDirectories();
  patchVideoComposition(record.compositionId, { status: "PROCESSING", error: null });
  syncCompositionJob({
    ...record,
    status: "PROCESSING",
    error: null,
    outputVideoUrl: null,
  });

  const tempArtifacts: string[] = [];
  const progressTracker = createCompositionProgressTracker(record, options?.onProgress);
  const compositionRuntime = getFfmpegLocalRuntime("FFmpeg 本地服务 · video-composition-runner");
  writeAdminTaskStageRun({
    runId: record.compositionId,
    taskId: record.taskId ?? record.compositionId,
    stageKey: "composition",
    status: "IN_PROGRESS",
    provider: compositionRuntime.serviceLabel,
    modelId: "ffmpeg",
    startedAt: record.createdAt,
  });

  try {
    const completedRecord = await withAdminProviderCallTracking(
      {
        enabled: true,
        serviceName: "local.video_composition",
        provider: compositionRuntime.serviceLabel,
        modelId: "ffmpeg",
        objectType: "video_composition",
        objectId: record.compositionId,
      },
      async () => {
        const orderedSegments = [...record.segments].sort((left, right) => left.order - right.order);
        const resolvedSegments: CompositionSegment[] = [];
        const normalizedPaths: string[] = [];
        const keepSourceAudio = shouldKeepSourceAudio(record.audioMode);

        progressTracker?.start("prepare", "读取待合成素材...");
        progressTracker?.complete("prepare", "开始处理片段...");

        for (let index = 0; index < orderedSegments.length; index += 1) {
          const segment = orderedSegments[index];
          progressTracker?.start(`normalize-${segment.id}`, `规范化片段 ${index + 1}/${orderedSegments.length}...`);
          const job = getVideoJob(segment.sourceJobId);
          const sourceVideoUrl = resolveSegmentSourceUrl({
            ...segment,
            sourceVideoUrl: job?.videoUrl ?? segment.sourceVideoUrl,
          });

          if (!sourceVideoUrl) {
            throw new Error("存在未生成完成的视频片段，无法发起拼接");
          }

          const source = await ensureMediaSource(sourceVideoUrl, segment.id);
          const sourcePath = source.localPath;
          const normalizedPath = await normalizeSegment(sourcePath, segment.id, record.aspectRatio, keepSourceAudio);

          if (source.shouldCleanup) {
            tempArtifacts.push(sourcePath);
          }

          normalizedPaths.push(normalizedPath);
          tempArtifacts.push(normalizedPath);

          const measuredDurationSeconds =
            (await probeMediaDurationSeconds(normalizedPath)) ??
            (await probeMediaDurationSeconds(sourcePath)) ??
            segment.durationSeconds ??
            null;

          resolvedSegments.push({
            ...segment,
            durationSeconds:
              measuredDurationSeconds != null
                ? Math.round(measuredDurationSeconds * 100) / 100
                : (segment.durationSeconds ?? null),
          });

          progressTracker?.complete(`normalize-${segment.id}`, `片段 ${index + 1}/${orderedSegments.length} 处理完成`);
        }

        patchVideoComposition(record.compositionId, { segments: resolvedSegments });

        progressTracker?.start(
          "merge_video",
          record.transitionMode === "fade" || resolvedSegments.some((segment) => segment.transition === "fade")
            ? "拼接并计算转场..."
            : "拼接视频轨...",
        );
        const baseResult =
          record.transitionMode === "fade" || resolvedSegments.some((segment) => segment.transition === "fade")
            ? await crossfadeSegments(
                normalizedPaths,
                resolvedSegments,
                record.compositionId,
                keepSourceAudio,
                record.transitionDurationSeconds,
              )
            : await concatSegments(normalizedPaths, record.compositionId, keepSourceAudio);
        progressTracker?.complete("merge_video", "视频轨拼接完成");

        if (baseResult.listFilePath) {
          tempArtifacts.push(baseResult.listFilePath);
        }
        tempArtifacts.push(baseResult.outputFilePath);

        let finalVideoPath = baseResult.outputFilePath;
        progressTracker?.start("mix_audio", "处理音频轨...");
        const audioAppliedResult = await applyAudioPlan(
          finalVideoPath,
          {
            ...record,
            segments: resolvedSegments,
          },
          keepSourceAudio,
        );

        if (audioAppliedResult) {
          tempArtifacts.push(audioAppliedResult.outputFilePath, ...audioAppliedResult.cleanupPaths);
          finalVideoPath = audioAppliedResult.outputFilePath;
        }
        progressTracker?.complete("mix_audio", audioAppliedResult ? "音频轨已混合" : "跳过独立音频混合");

        progressTracker?.start("burn_subtitles", "烧录字幕...");
        const subtitledResult = await burnSubtitles(finalVideoPath, {
          ...record,
          segments: resolvedSegments,
        });
        if (subtitledResult) {
          tempArtifacts.push(subtitledResult.outputFilePath);
          finalVideoPath = subtitledResult.outputFilePath;
        }
        progressTracker?.complete("burn_subtitles", subtitledResult ? "字幕已写入成片" : "跳过字幕烧录");

        progressTracker?.start("validate_audio", "抽检成片口播完整性...");
        const narrationAudioValidation = await validateComposedNarrationAudio(finalVideoPath, {
          ...record,
          segments: resolvedSegments,
        });
        if (narrationAudioValidation.skipped && narrationAudioValidation.skippedReason?.startsWith("ASR 未启用")) {
          throw new Error(`${narrationAudioValidation.skippedReason}。请配置 ASR 后重新合成。`);
        }
        if (narrationAudioValidation.issues.length > 0) {
          throw new Error(`成片口播完整性校验未通过：${narrationAudioValidation.issues.join("；")}。请重新合成。`);
        }
        progressTracker?.complete(
          "validate_audio",
          narrationAudioValidation.skipped
            ? (narrationAudioValidation.skippedReason ?? "未检测到需校验的独立口播")
            : `已校验 ${narrationAudioValidation.checkedCount} 段口播`,
        );

        progressTracker?.start("finalize", "输出最终成片...");
        const outputVideoUrl = finalizeOutput(finalVideoPath, record.compositionId, record.taskId);

        const nextCompletedRecord = patchVideoComposition(record.compositionId, {
          status: "COMPLETED",
          outputVideoUrl,
          error: null,
        });
        if (nextCompletedRecord?.outputVideoUrl) {
          upsertMaterialLibraryItemBySource({
            type: "video",
            source: "video-composition-output",
            title: nextCompletedRecord.title,
            previewUrl: nextCompletedRecord.outputVideoUrl,
            assetUrl: nextCompletedRecord.outputVideoUrl,
            prompt: buildCompositionSummary(nextCompletedRecord),
            tags: ["composition", nextCompletedRecord.aspectRatio],
            width: null,
            height: null,
            durationSeconds: Math.max(0, getCompositionDurationSeconds(nextCompletedRecord)),
            aspectRatio: nextCompletedRecord.aspectRatio,
            sourceSessionId: nextCompletedRecord.compositionId,
          });
        }
        if (nextCompletedRecord?.taskId) {
          const task = getVideoTask(nextCompletedRecord.taskId);
          if (task && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("COMPOSITION_READY")) {
            patchVideoTask(nextCompletedRecord.taskId, {
              status: "COMPOSITION_READY",
            });
          }
        }
        progressTracker?.complete("finalize", "成片写出完成");
        progressTracker?.finish("合成完成");
        return nextCompletedRecord;
      },
    );
    writeAdminTaskStageRun({
      runId: record.compositionId,
      taskId: record.taskId ?? record.compositionId,
      stageKey: "composition",
      status: "COMPLETED",
      provider: compositionRuntime.serviceLabel,
      modelId: "ffmpeg",
      startedAt: record.createdAt,
      finishedAt: completedRecord?.updatedAt ?? new Date().toISOString(),
    });
    return completedRecord;
  } catch (error) {
    progressTracker?.dispose();
    const failedRecord = patchVideoComposition(record.compositionId, {
      status: "FAILED",
      error: error instanceof Error ? error.message : "拼接任务执行失败",
    });
    writeAdminTaskStageRun({
      runId: record.compositionId,
      taskId: record.taskId ?? record.compositionId,
      stageKey: "composition",
      status: "FAILED",
      provider: compositionRuntime.serviceLabel,
      modelId: "ffmpeg",
      startedAt: record.createdAt,
      finishedAt: failedRecord?.updatedAt ?? new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : "拼接任务执行失败",
    });
    return failedRecord;
  } finally {
    const latest = getVideoComposition(record.compositionId);

    if (latest) {
      syncCompositionJob(latest);
    }

    await Promise.all(tempArtifacts.map((filePath) => rm(filePath, { force: true })));
  }
}
