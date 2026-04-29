import { NextRequest, NextResponse } from "next/server";

import {
  directorPrimaryStepActionKeys,
  directorSecondaryStepActionKeys,
} from "../../../../../lib/director-step-actions";
import { getFfmpegLocalRuntime } from "../../../../../lib/local-service-runtime";
import { writeSrtSubtitleFile } from "../../../../../lib/subtitle-export";
import {
  buildSubtitleDisplayUnits,
  formatSubtitleDisplayUnitText,
  splitSegmentWordTimelineBySubtitleEntries,
} from "../../../../../lib/subtitle-display";
import { findNarrationClipsForSegment } from "../../../../../lib/video-composition-timeline";
import {
  getDefaultSubtitleConfig,
  hydrateSubtitleConfig,
  type SubtitleConfig,
} from "../../../../../lib/subtitle-style-config";
import { getSegmentSubtitleEntry } from "../../../../../lib/subtitle-plan-source";
import { buildTaskClipShotPayloads, getTaskClipNarrationResult } from "../../../../../lib/task-clip-store";
import { getTaskDirectorPlan } from "../../../../../lib/video-task-director";
import type { NarrationDraftClip } from "../../../../../lib/narration";
import { composeVideoProject, createCompositionRecord } from "../../../../../lib/video-composition-runner";
import {
  getLatestCompletedTaskVideoComposition,
  getLatestTaskVideoComposition,
  upsertVideoComposition,
  type CompositionAudioClip,
  type CompositionAudioPlan,
  type CompositionAudioTrack,
  type CompositionSegment,
  type CompositionTransition,
} from "../../../../../lib/video-composition-store";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskStatusIndex } from "../../../../../lib/video-task-schema";
import { createProgressStream } from "../../../../../lib/progress-stream";
import { taskStageProgressKeys } from "../../../../../lib/task-stage-progress";
import { createTaskStageProgressReporter } from "../../../../../lib/task-stage-progress-store";
import { normalizeNullableMediaSourceInput } from "../../../../../lib/media-source-input";
import { collectLocalMediaArtifactErrors } from "../../../../../lib/media-artifact-validator";
import {
  getCompositionBackgroundMusicVolumeGain,
  normalizeCompositionBackgroundMusicVolume,
} from "../../../../../lib/task-creation-parameters";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type TimelineItem = {
  segmentId?: string;
  shotIndex?: number;
  transition: CompositionTransition;
};

type NormalizedTimelineItem = {
  segmentId: string;
  shotIndex: number;
  transition: CompositionTransition;
};

type CompositionRunRequest = {
  action?:
    | typeof directorPrimaryStepActionKeys.composeStoryVideo
    | typeof directorSecondaryStepActionKeys.autoComposeStoryVideo
    | "compose"
    | "regenerate"
    | "auto_compose";
  timeline?: TimelineItem[];
  includeBackgroundMusic?: boolean;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  subtitleConfig?: Partial<SubtitleConfig>;
};

class BadRequestError extends Error {}

const compositionActionOptions = new Set<string>([
  directorPrimaryStepActionKeys.composeStoryVideo,
  directorSecondaryStepActionKeys.autoComposeStoryVideo,
  "compose",
  "regenerate",
  "auto_compose",
]);

function readOptionalBoolean(value: unknown, label: string) {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new BadRequestError(`${label} 必须是布尔值`);
}

function readOptionalNumber(value: unknown, label: string) {
  if (value == null || value === "") {
    return undefined;
  }
  const normalized = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(normalized)) {
    throw new BadRequestError(`${label} 必须是数字`);
  }
  return normalized;
}

function parseTimelineItem(value: unknown, index: number): TimelineItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`timeline[${index}] 必须是对象`);
  }

  const item = value as Record<string, unknown>;
  const rawSegmentId = item.segmentId;
  const rawShotIndex = item.shotIndex;
  const rawTransition = item.transition;

  if (rawSegmentId != null && typeof rawSegmentId !== "string") {
    throw new BadRequestError(`timeline[${index}].segmentId 必须是字符串`);
  }
  if (rawShotIndex != null && !["number", "string"].includes(typeof rawShotIndex)) {
    throw new BadRequestError(`timeline[${index}].shotIndex 必须是数字`);
  }
  if (rawTransition != null && rawTransition !== "cut" && rawTransition !== "fade") {
    throw new BadRequestError(`timeline[${index}].transition 仅支持 cut 或 fade`);
  }

  return {
    segmentId: typeof rawSegmentId === "string" ? rawSegmentId : undefined,
    shotIndex: rawShotIndex == null ? undefined : Number(rawShotIndex),
    transition: (rawTransition ?? "cut") as CompositionTransition,
  };
}

function parseCompositionRunRequest(rawBody: unknown): CompositionRunRequest {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return {};
  }

  const body = rawBody as Record<string, unknown>;
  const rawAction = body.action;
  if (rawAction != null && typeof rawAction !== "string") {
    throw new BadRequestError("action 必须是字符串");
  }
  if (typeof rawAction === "string" && !compositionActionOptions.has(rawAction)) {
    throw new BadRequestError("不支持的视频合成操作");
  }

  const rawTimeline = body.timeline;
  if (rawTimeline != null && !Array.isArray(rawTimeline)) {
    throw new BadRequestError("timeline 必须是数组");
  }

  const rawBackgroundMusicUrl = body.backgroundMusicUrl;
  if (rawBackgroundMusicUrl != null && typeof rawBackgroundMusicUrl !== "string") {
    throw new BadRequestError("backgroundMusicUrl 必须是字符串");
  }

  const rawSubtitleConfig = body.subtitleConfig;
  if (rawSubtitleConfig != null && (typeof rawSubtitleConfig !== "object" || Array.isArray(rawSubtitleConfig))) {
    throw new BadRequestError("subtitleConfig 必须是对象");
  }

  return {
    action: rawAction as CompositionRunRequest["action"],
    timeline: (rawTimeline as unknown[] | undefined)?.map(parseTimelineItem),
    includeBackgroundMusic: readOptionalBoolean(body.includeBackgroundMusic, "includeBackgroundMusic"),
    backgroundMusicUrl: typeof rawBackgroundMusicUrl === "string" ? rawBackgroundMusicUrl : undefined,
    backgroundMusicVolume: readOptionalNumber(body.backgroundMusicVolume, "backgroundMusicVolume"),
    subtitleConfig: rawSubtitleConfig as CompositionRunRequest["subtitleConfig"],
  };
}

function toSrtTimestamp(value: number) {
  const totalMilliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function buildSrtTextFromTimeline(
  input: Array<{
    subtitleText: string;
    startAtSeconds: number;
    durationSeconds: number;
    words: NarrationDraftClip["words"];
    subtitleDisplayCues?: NarrationDraftClip["subtitleDisplayCues"];
  }>,
  subtitleConfig: SubtitleConfig,
) {
  const blocks: string[] = [];
  let cueIndex = 1;

  for (const item of input) {
    const displayUnits = buildSubtitleDisplayUnits({
      text: item.subtitleText,
      durationSeconds: item.durationSeconds,
      words: item.words,
      maxCharsPerLine: subtitleConfig.maxCharsPerLine,
      displayMode: subtitleConfig.displayMode,
      trimEstimatedTail: true,
      manualCues: item.subtitleDisplayCues,
    });

    for (const unit of displayUnits) {
      const start = item.startAtSeconds + unit.startOffsetSeconds;
      const end = item.startAtSeconds + unit.endOffsetSeconds;
      blocks.push(`${cueIndex}\n${toSrtTimestamp(start)} --> ${toSrtTimestamp(end)}\n${formatSubtitleDisplayUnitText(unit)}`);
      cueIndex += 1;
    }
  }

  return blocks.join("\n\n");
}

function normalizeTimelineItems(timeline: TimelineItem[]) {
  return timeline
    .map((item) => {
      const shotIndex = Number(item.shotIndex);
      const segmentId = String(item.segmentId ?? (Number.isFinite(shotIndex) ? `segment-${shotIndex}` : "")).trim();
      if (!segmentId) {
        return null;
      }

      return {
        segmentId,
        shotIndex:
          Number.isFinite(shotIndex) && shotIndex > 0 ? shotIndex : Number(segmentId.replace(/^segment-/, "")) || 1,
        transition: item.transition ?? "cut",
      } satisfies NormalizedTimelineItem;
    })
    .filter((item): item is NormalizedTimelineItem => Boolean(item));
}

function buildTimelineStarts(
  timeline: NormalizedTimelineItem[],
  durationLookup: Map<string, number>,
  transitionDurationSeconds: number,
) {
  const starts = new Map<string, number>();
  let cursor = 0;

  timeline.forEach((item, index) => {
    if (index === 0) {
      starts.set(item.segmentId, 0);
      cursor = durationLookup.get(item.segmentId) ?? 0;
      return;
    }

    const transitionSeconds = item.transition === "fade" ? transitionDurationSeconds : 0;
    const startAtSeconds = Math.max(0, cursor - transitionSeconds);
    starts.set(item.segmentId, startAtSeconds);
    cursor = startAtSeconds + (durationLookup.get(item.segmentId) ?? 0);
  });

  return starts;
}

function resolveNarrationNaturalDuration(clip: NarrationDraftClip | null | undefined) {
  if (!clip) {
    return 0;
  }

  const wordDuration = clip.words?.length ? (clip.words[clip.words.length - 1]?.endTime ?? 0) : 0;
  return Math.max(clip.audioDurationSeconds ?? 0, wordDuration, clip.durationSeconds ?? 0, 0.6);
}

function resolveSubtitleSpeechDuration(input: {
  words: NarrationDraftClip["words"];
  audioDurationSeconds?: number | null;
  audioWindowDurationSeconds?: number | null;
  fallbackDurationSeconds?: number | null;
}) {
  const wordDurationSeconds = input.words?.length
    ? Math.max(...input.words.map((word) => Number(word.endTime) || 0))
    : 0;
  const audioDurationSeconds = Number(input.audioDurationSeconds) || 0;
  const audioWindowDurationSeconds = Number(input.audioWindowDurationSeconds) || 0;
  const fallbackDurationSeconds = Number(input.fallbackDurationSeconds) || 0;

  return Math.max(
    0.2,
    wordDurationSeconds ||
      audioDurationSeconds ||
      audioWindowDurationSeconds ||
      fallbackDurationSeconds ||
      0,
  );
}

function buildNarrationWindow(input: {
  currentStart: number;
  naturalDuration: number;
  nextAudioStart: number | null;
  compositionEnd: number;
}) {
  const videoTailDuration = Math.max(0.4, input.compositionEnd - input.currentStart);

  if (input.nextAudioStart == null) {
    const allowedDuration = Math.min(Math.max(0.4, input.naturalDuration), videoTailDuration);
    return {
      durationSeconds: allowedDuration,
      fadeOutSeconds:
        input.naturalDuration > videoTailDuration + 0.02 ? Math.min(0.5, Math.max(0.12, allowedDuration)) : 0,
    };
  }

  const availableDuration = Math.max(0.4, input.nextAudioStart - input.currentStart);
  if (input.naturalDuration <= availableDuration + 0.02) {
    return {
      durationSeconds: availableDuration,
      fadeOutSeconds: 0,
    };
  }

  const overlapSeconds = input.naturalDuration - availableDuration;
  return {
    durationSeconds: availableDuration,
    fadeOutSeconds:
      overlapSeconds <= 0.5
        ? Math.min(Math.max(overlapSeconds, 0.12), Math.max(0.12, availableDuration))
        : Math.min(0.5, Math.max(0.12, availableDuration)),
  };
}

function getSegmentSubtitleEntries(
  subtitlePlan: NonNullable<ReturnType<typeof getTaskDirectorPlan>>["subtitlePlan"],
  input: { segmentId?: string | null; segmentIndex?: number | null },
) {
  if (!subtitlePlan?.length) {
    return [];
  }

  const segment = subtitlePlan.find(
    (item) =>
      (input.segmentId && item.segmentId === input.segmentId) ||
      (input.segmentIndex != null && item.segmentIndex === input.segmentIndex),
  );
  return segment?.subtitles ?? [];
}

function hasPlayableVideo(
  job:
    | {
        status?: string | null;
        videoUrl?: string | null;
        remoteVideoUrl?: string | null;
      }
    | null
    | undefined,
) {
  return Boolean(job?.status === "COMPLETED" && (job.videoUrl || job.remoteVideoUrl));
}

function hasEmbeddedSegmentAudio(
  clipShot:
    | {
        job?: {
          status?: string | null;
          videoUrl?: string | null;
          remoteVideoUrl?: string | null;
          generationSettings?: {
            generateAudio?: boolean | null;
          } | null;
        } | null;
        lipSyncJob?: {
          status?: string | null;
          videoUrl?: string | null;
          remoteVideoUrl?: string | null;
        } | null;
      }
    | null
    | undefined,
) {
  if (hasPlayableVideo(clipShot?.lipSyncJob)) {
    return true;
  }

  return Boolean(hasPlayableVideo(clipShot?.job) && clipShot?.job?.generationSettings?.generateAudio === true);
}

async function buildCompositionPayload(taskId: string, options?: { readOnly?: boolean }) {
  const task = getVideoTask(taskId);
  if (!task) {
    throw new Error("视频任务不存在");
  }

  const directorPlan = getTaskDirectorPlan(task);
  const clipShots = await buildTaskClipShotPayloads(task, options);
  const narrationResult = getTaskClipNarrationResult(taskId);
  const latestComposition = getLatestTaskVideoComposition(taskId);
  const latestPlayableComposition = getLatestCompletedTaskVideoComposition(taskId);
  const voiceSegments = directorPlan.renderSegments.filter((segment) => segment.hasVoice);
  const subtitleSegments = directorPlan.renderSegments.filter((segment) => segment.hasSubtitle);
  const sourceAudioReady =
    voiceSegments.length === 0
      ? true
      : voiceSegments.every((segment) => {
          const clipShot = clipShots.find((item) => item.segmentId === segment.segmentId) ?? null;
          return hasEmbeddedSegmentAudio(clipShot);
        });
  const narrationTrackReady =
    voiceSegments.length === 0
      ? true
      : voiceSegments.every((segment) =>
          narrationResult?.clips.some(
            (clip) =>
              (clip.segmentId === segment.segmentId || clip.bindToSegmentId === segment.segmentId) &&
              Boolean(clip.audioUrl),
          ),
        );
  const narrationReady = sourceAudioReady || narrationTrackReady;
  const subtitleReady =
    subtitleSegments.length === 0
      ? true
      : Boolean(narrationResult?.subtitleSrtUrl) ||
        subtitleSegments.every((segment) =>
          Boolean(
            getSegmentSubtitleEntry(directorPlan.subtitlePlan, {
              segmentId: segment.segmentId,
              segmentIndex: segment.segmentIndex,
            })?.text?.trim() || segment.subtitleText?.trim(),
          ),
        );

  return {
    task,
    directorPlan,
    clipShots,
    narrationResult,
    latestComposition,
    latestPlayableComposition,
    statusSummary: {
      clipCount: clipShots.length,
      completedClipCount: clipShots.filter((item) => hasPlayableVideo(item.job)).length,
      subtitleReady,
      subtitleSourceLabel:
        subtitleSegments.length === 0
          ? "无需单独字幕轨"
          : narrationResult?.subtitleSrtUrl
            ? "独立字幕时间轴已就绪"
            : "将按第三步上屏字幕句时间轴显示",
      narrationReady,
      narrationSourceLabel:
        voiceSegments.length === 0
          ? "无需单独口播"
          : sourceAudioReady
            ? "片段原音已就绪"
            : narrationTrackReady
              ? "独立 TTS 音频已就绪"
              : "未检测到独立音频，合成时优先保留片段原音",
      latestResultAt:
        latestComposition?.updatedAt ??
        latestPlayableComposition?.updatedAt ??
        clipShots.find((item) => item.clipRecord?.generatedAt)?.clipRecord?.generatedAt ??
        narrationResult?.updatedAt ??
        task.updatedAt,
    },
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId);
    if ("response" in access) {
      return access.response;
    }
    const payload = await buildCompositionPayload(taskId, { readOnly: true });
    const runtime = getFfmpegLocalRuntime("FFmpeg 本地服务 · video-composition-runner");

    return NextResponse.json({
      ...payload,
      runtime: {
        serviceLabel: runtime.serviceLabel,
        available: runtime.available,
        statusLabel: runtime.statusLabel,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频合成数据加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权修改该视频任务",
    });
    if ("response" in access) {
      return access.response;
    }
    const body = parseCompositionRunRequest(await request.json().catch(() => ({})));
    return createProgressStream(async (onProgress) => {
      const runtime = getFfmpegLocalRuntime("FFmpeg 本地服务 · video-composition-runner");
      const stageProgress = createTaskStageProgressReporter({
        taskId,
        stageKey: taskStageProgressKeys.composition,
        provider: runtime.serviceLabel,
        modelId: "ffmpeg",
        initialMessage: "读取合成任务...",
        initialPercent: 2,
      });
      const emitProgress = (
        step: string,
        percent: number,
        message: string,
        extra?: Record<string, unknown>,
      ) => {
        onProgress(step, percent, message, extra);
        stageProgress.onProgress(step, percent, message);
      };

      try {
        emitProgress("composition_prepare", 2, "读取合成任务...");
        const payload = await buildCompositionPayload(taskId);
        const { task, directorPlan, clipShots, narrationResult, latestComposition } = payload;

        const timeline = normalizeTimelineItems(
          clipShots
            .filter((item) => hasPlayableVideo(item.job))
            .sort((left, right) => left.segmentIndex - right.segmentIndex)
            .map((item) => ({
              segmentId: item.segmentId,
              shotIndex: item.shotIndex,
              transition: "cut" as CompositionTransition,
            })),
        );

        if (!timeline.length) {
          throw new Error("没有已完成的片段可供合成，请先完成视频片段生成");
        }

        emitProgress("composition_prepare", 5, "整理片段时间线...");
        const materialMap = new Map(clipShots.map((item) => [item.segmentId, item]));
        const transitionDurationSeconds = 0.45;
        const durationLookup = new Map<string, number>(
          clipShots.map((item) => [
            item.segmentId,
            (item.job?.resolvedDurationSeconds ?? item.durationSeconds) ||
              item.job?.generationSettings?.durationSeconds ||
              task.parameters.video.durationSeconds,
          ]),
        );
        const startMap = buildTimelineStarts(timeline, durationLookup, transitionDurationSeconds);

      const segments: CompositionSegment[] = timeline.map((item, index) => {
        const clipShot = materialMap.get(item.segmentId);
        if (
          !clipShot?.job?.jobId ||
          clipShot.job.status !== "COMPLETED" ||
          !(clipShot.job.videoUrl || clipShot.job.remoteVideoUrl)
        ) {
          throw new Error(`片段 ${item.shotIndex} 尚未生成完成，无法加入视频合成`);
        }

        const useLipSync =
          clipShot.lipSyncJob?.status === "COMPLETED" &&
          Boolean(clipShot.lipSyncJob.videoUrl || clipShot.lipSyncJob.remoteVideoUrl);
        const effectiveJob = useLipSync ? clipShot.lipSyncJob! : clipShot.job;

        return {
          id: `${taskId}-${item.segmentId}`,
          sourceJobId: effectiveJob.jobId,
          sourceVideoUrl:
            effectiveJob.videoUrl ??
            effectiveJob.remoteVideoUrl ??
            clipShot.job.videoUrl ??
            clipShot.job.remoteVideoUrl ??
            "",
          order: index,
          durationSeconds: clipShot.durationSeconds,
          transition: item.transition ?? "cut",
          promptSnapshot: clipShot.videoPrompt,
          note: `片段 ${item.shotIndex}${useLipSync ? "（口型同步）" : ""}`,
        };
      });
      const segmentArtifactErrors = collectLocalMediaArtifactErrors(
        segments.map((segment) => ({
          sourceUrl: segment.sourceVideoUrl,
          label: segment.note || `片段 ${segment.order + 1}`,
        })),
      );
      if (segmentArtifactErrors.length > 0) {
        throw new Error(`合成素材校验失败：${segmentArtifactErrors.join("；")}`);
      }

      const timelineEntries = timeline.map((item) => {
        const clipShot = materialMap.get(item.segmentId);
        const renderSegment = directorPlan.renderSegments.find((segment) => segment.segmentId === item.segmentId) ?? null;
        const segmentIndex = renderSegment?.segmentIndex ?? item.shotIndex;
        const subtitleEntry = getSegmentSubtitleEntry(directorPlan.subtitlePlan, {
          segmentId: item.segmentId,
          segmentIndex,
        });
        const subtitleEntries = getSegmentSubtitleEntries(directorPlan.subtitlePlan, {
          segmentId: item.segmentId,
          segmentIndex,
        });
        const narrationClips = findNarrationClipsForSegment(narrationResult?.clips ?? [], {
          segmentId: item.segmentId,
          segmentIndex,
          shotIndex: item.shotIndex,
        });
        return {
          item,
          clipShot,
          narrationClips,
          renderSegment,
          subtitleEntry,
          subtitleEntries,
          currentStart: startMap.get(item.segmentId) ?? 0,
          segmentDuration: durationLookup.get(item.segmentId) ?? task.parameters.video.durationSeconds,
        };
      });

      const timedNarrationEntries = timelineEntries
        .flatMap((entry) => {
          const fallbackSubtitleWords = splitSegmentWordTimelineBySubtitleEntries(
            entry.subtitleEntries.map((subtitle) => ({
              text: subtitle.text,
              startAtSeconds: subtitle.startAtSeconds,
              durationSeconds: subtitle.durationSeconds,
            })),
            (entry.clipShot?.wordTimeline ?? []) as Array<{ word: string; startTime: number; endTime: number }>,
          );
          const sourceEntries =
            entry.narrationClips.length > 0
              ? entry.narrationClips.map((clip, index) => ({
                  id: clip.id || `${entry.item.segmentId}-clip-${index + 1}`,
                  bindToSegmentId: entry.item.segmentId,
                  sourceStartAtSeconds: clip.startAtSeconds,
                  durationSeconds: clip.durationSeconds,
                  audioDurationSeconds: clip.audioDurationSeconds ?? null,
                  subtitleText: clip.subtitleText || clip.narrationText || "",
                  hasSubtitle: clip.hasSubtitle !== false,
                  hasVoice: clip.hasVoice !== false,
                  audioUrl: clip.audioUrl ?? null,
                  words: clip.words?.length
                    ? clip.words
                    : ((fallbackSubtitleWords[index] ?? []) as NarrationDraftClip["words"]),
                  subtitleDisplayCues: clip.subtitleDisplayCues ?? null,
                  narrationClip: clip,
                }))
              : entry.subtitleEntries.map((subtitle, index) => ({
                  id: `${entry.item.segmentId}-subtitle-${index + 1}`,
                  bindToSegmentId: entry.item.segmentId,
                  sourceStartAtSeconds: subtitle.startAtSeconds,
                  durationSeconds: subtitle.durationSeconds,
                  audioDurationSeconds: null,
                  subtitleText: subtitle.text,
                  hasSubtitle: true,
                  hasVoice: false,
                  audioUrl: null,
                  words: (fallbackSubtitleWords[index] ?? []) as NarrationDraftClip["words"],
                  subtitleDisplayCues: null,
                  narrationClip: null,
                }));

          const segmentBaseSourceStart =
            sourceEntries[0]?.sourceStartAtSeconds ?? entry.subtitleEntry?.startAtSeconds ?? 0;

          return sourceEntries.map((sourceEntry) => ({
            ...sourceEntry,
            entry,
            compositionStartAtSeconds:
              entry.currentStart + Math.max(0, sourceEntry.sourceStartAtSeconds - segmentBaseSourceStart),
          }));
        })
        .sort((left, right) => left.compositionStartAtSeconds - right.compositionStartAtSeconds);

      const voiceEntries = timedNarrationEntries.filter((entry) => entry.hasVoice && Boolean(entry.audioUrl));
      const voiceTimelineEntries = timelineEntries.filter((entry) => entry.renderSegment?.hasVoice);
      const allVoiceSegmentsHaveEmbeddedAudio =
        voiceTimelineEntries.length === 0 ||
        voiceTimelineEntries.every((entry) => hasEmbeddedSegmentAudio(entry.clipShot));
      const compositionDurationSeconds = timeline.reduce((maxValue, item) => {
        const startAtSeconds = startMap.get(item.segmentId) ?? 0;
        const durationSeconds = durationLookup.get(item.segmentId) ?? 0;
        return Math.max(maxValue, startAtSeconds + durationSeconds);
      }, 0);

      const shouldUseNarrationTracks = !allVoiceSegmentsHaveEmbeddedAudio && voiceEntries.length > 0;
      const narrationTrackClips: CompositionAudioClip[] = shouldUseNarrationTracks
        ? voiceEntries.map((voiceEntry, index) => {
            const nextVoiceStart =
              index < voiceEntries.length - 1 ? voiceEntries[index + 1].compositionStartAtSeconds : null;
            const naturalDuration = voiceEntry.narrationClip
              ? resolveNarrationNaturalDuration(voiceEntry.narrationClip)
              : Math.max(voiceEntry.audioDurationSeconds ?? 0, voiceEntry.durationSeconds, 0.6);
            const audioWindow = buildNarrationWindow({
              currentStart: voiceEntry.compositionStartAtSeconds,
              naturalDuration,
              nextAudioStart: nextVoiceStart,
              compositionEnd: compositionDurationSeconds,
            });

            return {
              id: `${taskId}-narration-${voiceEntry.id}`,
              sourceUrl: voiceEntry.audioUrl ?? null,
              startAtSeconds: voiceEntry.compositionStartAtSeconds,
              durationSeconds: audioWindow.durationSeconds,
              fadeOutSeconds: audioWindow.fadeOutSeconds,
              bindToSegmentId: `${taskId}-${voiceEntry.bindToSegmentId}`,
              text: voiceEntry.subtitleText,
              note: `片段 ${voiceEntry.entry.item.shotIndex} 音频`,
            } satisfies CompositionAudioClip;
          })
        : [];

      const taskCompositionParameters = task.parameters.composition;
      const includeBackgroundMusic =
        typeof body.includeBackgroundMusic === "boolean"
          ? body.includeBackgroundMusic
          : taskCompositionParameters?.includeBackgroundMusic === true;
      const backgroundMusicUrl = includeBackgroundMusic
        ? normalizeNullableMediaSourceInput(body.backgroundMusicUrl ?? taskCompositionParameters?.backgroundMusicUrl)
        : null;
      const backgroundMusicVolume = normalizeCompositionBackgroundMusicVolume(
        body.backgroundMusicVolume ?? taskCompositionParameters?.backgroundMusicVolume,
      );
      const backgroundMusicGain = getCompositionBackgroundMusicVolumeGain(backgroundMusicVolume);
      const subtitleConfig = hydrateSubtitleConfig(
        body.subtitleConfig,
        taskCompositionParameters?.subtitleConfig ?? latestComposition?.subtitleConfig ?? getDefaultSubtitleConfig(),
      );
      const audioTracks: CompositionAudioTrack[] = [];
      if (narrationTrackClips.length > 0) {
        audioTracks.push({
          id: `${taskId}-narration-track`,
          kind: "narration",
          name: "分段音频",
          enabled: true,
          mute: false,
          volume: 1,
          clips: narrationTrackClips,
        });
      }
      if (backgroundMusicUrl) {
        audioTracks.push({
          id: `${taskId}-bgm-track`,
          kind: "bgm",
          name: "背景音乐",
          enabled: true,
          mute: false,
          volume: backgroundMusicGain,
          clips: [
            {
              id: `${taskId}-bgm-clip`,
              sourceUrl: backgroundMusicUrl,
              startAtSeconds: 0,
              loop: true,
              fadeInSeconds: 0.8,
              volume: 1,
            },
          ],
        });
      }
      const audioPlan: CompositionAudioPlan = {
        mode: "multi_track",
        tracks: audioTracks,
      };
      const audioArtifactErrors = collectLocalMediaArtifactErrors(
        audioTracks.flatMap((track) =>
          track.clips
            .filter((clip) => Boolean(clip.sourceUrl))
            .map((clip) => ({
              sourceUrl: clip.sourceUrl,
              label: `${track.name}${clip.note ? `（${clip.note}）` : ""}`,
            })),
        ),
      );
      if (audioArtifactErrors.length > 0) {
        throw new Error(`合成音频校验失败：${audioArtifactErrors.join("；")}`);
      }
      const audioMode = allVoiceSegmentsHaveEmbeddedAudio
        ? backgroundMusicUrl
          ? "source_with_bgm"
          : "source_only"
        : narrationTrackClips.length > 0
          ? backgroundMusicUrl
            ? "narration_with_bgm"
            : "narration_only"
          : backgroundMusicUrl
            ? "bgm_only"
            : "mute";

      const narrationTrackClipMap = new Map(narrationTrackClips.map((clip) => [clip.id, clip]));
      const subtitleTimeline = timedNarrationEntries
        .flatMap((entry) => {
          if (!entry.hasSubtitle || !entry.subtitleText.trim()) {
            return [];
          }

          const narrationTrackClip = narrationTrackClipMap.get(`${taskId}-narration-${entry.id}`);
          return [
            {
              subtitleText: entry.subtitleText,
              startAtSeconds: entry.compositionStartAtSeconds,
              durationSeconds: resolveSubtitleSpeechDuration({
                words: entry.words,
                audioDurationSeconds: entry.audioDurationSeconds,
                audioWindowDurationSeconds: narrationTrackClip?.durationSeconds,
                fallbackDurationSeconds: entry.durationSeconds ?? entry.entry.segmentDuration,
              }),
              words: entry.words,
              subtitleDisplayCues: entry.subtitleDisplayCues,
            } satisfies {
              subtitleText: string;
              startAtSeconds: number;
              durationSeconds: number;
              words: NarrationDraftClip["words"];
              subtitleDisplayCues?: NarrationDraftClip["subtitleDisplayCues"];
            },
          ];
        }) satisfies Array<{
            subtitleText: string;
            startAtSeconds: number;
            durationSeconds: number;
            words: NarrationDraftClip["words"];
            subtitleDisplayCues?: NarrationDraftClip["subtitleDisplayCues"];
          }>;
      const srtText =
        subtitleConfig.enabled && subtitleTimeline.length > 0
          ? buildSrtTextFromTimeline(subtitleTimeline, subtitleConfig)
          : "";

        emitProgress("composition_prepare", 8, "写入字幕时间轴...");
        const record = createCompositionRecord({
          taskId,
          title: task.title,
          aspectRatio: task.parameters.video.aspectRatio,
        transitionMode: timeline.some((item) => item.transition === "fade") ? "fade" : "cut",
        transitionDurationSeconds,
        audioMode,
        backgroundMusicUrl,
        backgroundMusicVolume,
        audioPlan,
        subtitleSrtUrl: null,
        subtitleConfig,
        segments,
        consistencyProfile: {
          subjectRule: task.title,
          sceneRule: "保持片段衔接流畅，字幕位置和风格统一",
          styleRule: "全片统一口播风格、字幕字号与安全边距",
          forbiddenRule: "禁止音画不同步、字幕错位、背景音乐压制台词",
          },
        });

        const subtitleFile =
          subtitleConfig.enabled && srtText.trim() ? writeSrtSubtitleFile(record.compositionId, srtText, taskId) : null;
        const recordWithSubtitle = {
          ...record,
          subtitleSrtUrl: subtitleFile?.publicUrl ?? null,
        };
        upsertVideoComposition(recordWithSubtitle);

        emitProgress("composition_prepare", 12, "提交本地合成服务...");
        const result = await composeVideoProject(recordWithSubtitle, { onProgress: emitProgress });
        if (!result || result.status !== "COMPLETED") {
          throw new Error(result?.error ?? "视频合成失败");
        }

        const nextTask = patchVideoTask(taskId, {
          status:
            getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("COMPOSITION_READY")
              ? "COMPOSITION_READY"
              : task.status,
        });

        const nextPayload = await buildCompositionPayload(taskId);
        stageProgress.complete("视频合成完成");
        return {
          ...nextPayload,
          task: nextTask ?? getVideoTask(taskId) ?? task,
          result,
          runtime: {
            serviceLabel: runtime.serviceLabel,
            available: runtime.available,
            statusLabel: runtime.statusLabel,
          },
        };
      } catch (error) {
        stageProgress.fail(error);
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "视频合成失败" }, { status: 500 });
  }
}
