import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { getVideoJob } from "./video-job-store";
import { createVideoJobRecord } from "./video-job-runner";
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

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");
const tempDir = join(process.cwd(), "data", "composition-temp");

function getCompositionOutputDir(taskId?: string | null) {
  return join(process.cwd(), "public", "generated-compositions", taskId?.trim() || "_unassigned");
}

function getGeneratedVideoDir(taskId?: string | null) {
  return join(process.cwd(), "public", "generated-videos", taskId?.trim() || "_unassigned");
}

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
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

function getLocalSourcePath(sourceVideoUrl: string, fileId: string) {
  if (sourceVideoUrl.startsWith("/")) {
    return join(process.cwd(), "public", sourceVideoUrl);
  }

  return join(tempDir, `${fileId}-source${sourceVideoUrl.endsWith(".mp3") ? ".mp3" : ".mp4"}`);
}

async function ensureMediaSource(sourceUrl: string, fileId: string) {
  const localPath = getLocalSourcePath(sourceUrl, fileId);

  if (sourceUrl.startsWith("/")) {
    return localPath;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("素材下载失败");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, bytes);
  return localPath;
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
      volume: 1,
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

async function applyAudioPlan(
  baseVideoPath: string,
  record: VideoCompositionRecord,
  keepSourceAudio: boolean,
) {
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

      const sourcePath = await ensureMediaSource(clip.sourceUrl, `${record.compositionId}-${track.id}-${clip.id}`);
      if (!clip.sourceUrl.startsWith("/")) {
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
        clip.fadeInSeconds != null
          ? getSafeSeconds(clip.fadeInSeconds)
          : track.kind === "bgm"
            ? 0.8
            : 0;
      const fadeOutSeconds = getSafeSeconds(clip.fadeOutSeconds);
      const inputLabel = `[${inputIndex}:a]`;
      const chain = ["aresample=48000", `volume=${volume}`];

      if (clipDuration != null && clipDuration > 0) {
        chain.push(`atrim=duration=${clipDuration}`);
      }
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
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=2,apad=pad_dur=${safeDuration},atrim=duration=${safeDuration}[a]`,
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
  if (!record.subtitleSrtUrl?.startsWith("/")) {
    return null;
  }

  const subtitlePath = join(process.cwd(), "public", record.subtitleSrtUrl.replace(/^\//, ""));
  if (!existsSync(subtitlePath)) {
    return null;
  }

  const ffmpegPath = resolveFfmpegPath();
  const outputPath = join(tempDir, `${record.compositionId}-subtitled.mp4`);
  const escapedSubtitlePath = subtitlePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/'/g, "\\'");

  const { height } = getOutputSize(record.aspectRatio);
  const fontSize = Math.round(height * 0.028);
  const marginV = Math.round(height * 0.08);
  const outline = Math.max(2, Math.round(fontSize * 0.12));

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    baseVideoPath,
    "-vf",
    `subtitles='${escapedSubtitlePath}':force_style='FontName=PingFang SC,FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H0032260F,BorderStyle=1,Outline=${outline},Shadow=1,BackColour=&H80000000,MarginV=${marginV},Alignment=2'`,
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
      status:
        record.status === "COMPLETED"
          ? "COMPLETED"
          : record.status === "FAILED"
            ? "FAILED"
            : "IN_PROGRESS",
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
  audioPlan: CompositionAudioPlan;
  subtitleSrtUrl?: string | null;
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
    audioPlan: input.audioPlan,
    subtitleSrtUrl: input.subtitleSrtUrl ?? null,
    segments: input.segments,
    consistencyProfile: input.consistencyProfile,
    outputVideoUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  } satisfies VideoCompositionRecord;
}

export async function composeVideoProject(record: VideoCompositionRecord) {
  ensureDirectories();
  patchVideoComposition(record.compositionId, { status: "PROCESSING", error: null });
  syncCompositionJob({
    ...record,
    status: "PROCESSING",
    error: null,
    outputVideoUrl: null,
  });

  const tempArtifacts: string[] = [];

  try {
    const orderedSegments = [...record.segments].sort((left, right) => left.order - right.order);
    const resolvedSegments: CompositionSegment[] = [];
    const normalizedPaths: string[] = [];
    const keepSourceAudio = shouldKeepSourceAudio(record.audioMode);

    for (const segment of orderedSegments) {
      const job = getVideoJob(segment.sourceJobId);
      const sourceVideoUrl = resolveSegmentSourceUrl({
        ...segment,
        sourceVideoUrl: job?.videoUrl ?? segment.sourceVideoUrl,
      });

      if (!sourceVideoUrl) {
        throw new Error("存在未生成完成的视频片段，无法发起拼接");
      }

      const sourcePath = await ensureMediaSource(sourceVideoUrl, segment.id);
      const normalizedPath = await normalizeSegment(sourcePath, segment.id, record.aspectRatio, keepSourceAudio);

      if (!sourceVideoUrl.startsWith("/")) {
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
            : segment.durationSeconds ?? null,
      });
    }

    patchVideoComposition(record.compositionId, { segments: resolvedSegments });

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

    if (baseResult.listFilePath) {
      tempArtifacts.push(baseResult.listFilePath);
    }
    tempArtifacts.push(baseResult.outputFilePath);

    let finalVideoPath = baseResult.outputFilePath;
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

    const subtitledResult = await burnSubtitles(finalVideoPath, {
      ...record,
      segments: resolvedSegments,
    });
    if (subtitledResult) {
      tempArtifacts.push(subtitledResult.outputFilePath);
      finalVideoPath = subtitledResult.outputFilePath;
    }

    const outputVideoUrl = finalizeOutput(finalVideoPath, record.compositionId, record.taskId);

    const completedRecord = patchVideoComposition(record.compositionId, {
      status: "COMPLETED",
      outputVideoUrl,
      error: null,
    });
    if (completedRecord?.taskId) {
      const task = getVideoTask(completedRecord.taskId);
      if (task && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("COMPOSITION_READY")) {
        patchVideoTask(completedRecord.taskId, {
          status: "COMPOSITION_READY",
        });
      }
    }
    return completedRecord;
  } catch (error) {
    return patchVideoComposition(record.compositionId, {
      status: "FAILED",
      error: error instanceof Error ? error.message : "拼接任务执行失败",
    });
  } finally {
    const latest = getVideoComposition(record.compositionId);

    if (latest) {
      syncCompositionJob(latest);
    }

    await Promise.all(tempArtifacts.map((filePath) => rm(filePath, { force: true })));
  }
}
