import { NextRequest, NextResponse } from "next/server";

import { getFfmpegLocalRuntime } from "../../../../../lib/local-service-runtime";
import { groupWordsIntoPhrases, splitTextIntoPhrases, writeSrtSubtitleFile } from "../../../../../lib/subtitle-export";
import { buildTaskClipShotPayloads, getTaskClipNarrationResult } from "../../../../../lib/task-clip-store";
import { getTaskDirectorPlan } from "../../../../../lib/video-task-director";
import type { NarrationDraftClip } from "../../../../../lib/narration";
import { composeVideoProject, createCompositionRecord } from "../../../../../lib/video-composition-runner";
import {
  deleteVideoComposition,
  listVideoCompositions,
  upsertVideoComposition,
  type CompositionAudioClip,
  type CompositionAudioPlan,
  type CompositionAudioTrack,
  type CompositionSegment,
  type CompositionTransition,
} from "../../../../../lib/video-composition-store";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskStatusIndex } from "../../../../../lib/video-task-schema";

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

type CompositionRunRequest =
  | {
      action: "compose";
      timeline: TimelineItem[];
      includeBackgroundMusic?: boolean;
      backgroundMusicUrl?: string;
    }
  | {
      action: "regenerate";
      timeline: TimelineItem[];
      includeBackgroundMusic?: boolean;
      backgroundMusicUrl?: string;
    }
  | {
      action: "auto_compose";
      includeBackgroundMusic?: boolean;
      backgroundMusicUrl?: string;
    };

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
  }>,
) {
  const blocks: string[] = [];
  let cueIndex = 1;

  for (const item of input) {
    const normalizedWords = item.words?.length ? item.words : null;

    if (normalizedWords) {
      const phrases = groupWordsIntoPhrases(normalizedWords, 8);
      for (const phrase of phrases) {
        const start = item.startAtSeconds + phrase.startTime;
        const end = Math.min(
          item.startAtSeconds + Math.max(item.durationSeconds, 0.4),
          item.startAtSeconds + Math.max(phrase.endTime, phrase.startTime + 0.3),
        );
        blocks.push(`${cueIndex}\n${toSrtTimestamp(start)} --> ${toSrtTimestamp(end)}\n${phrase.text}`);
        cueIndex += 1;
      }
      continue;
    }

    const phrases = splitTextIntoPhrases(item.subtitleText, 8);
    if (phrases.length <= 1) {
      blocks.push(
        `${cueIndex}\n${toSrtTimestamp(item.startAtSeconds)} --> ${toSrtTimestamp(item.startAtSeconds + Math.max(item.durationSeconds, 0.6))}\n${phrases[0] ?? item.subtitleText}`,
      );
      cueIndex += 1;
    } else {
      const phraseDuration = Math.max(0.4, item.durationSeconds / phrases.length);
      for (let i = 0; i < phrases.length; i += 1) {
        const start = item.startAtSeconds + i * phraseDuration;
        const end = start + phraseDuration;
        blocks.push(`${cueIndex}\n${toSrtTimestamp(start)} --> ${toSrtTimestamp(end)}\n${phrases[i]}`);
        cueIndex += 1;
      }
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

function getLatestTaskComposition(taskId: string) {
  return listVideoCompositions().find((item) => item.taskId === taskId) ?? null;
}

async function buildCompositionPayload(taskId: string, options?: { readOnly?: boolean }) {
  const task = getVideoTask(taskId);
  if (!task) {
    throw new Error("视频任务不存在");
  }

  const directorPlan = getTaskDirectorPlan(task);
  const clipShots = await buildTaskClipShotPayloads(task, options);
  const narrationResult = getTaskClipNarrationResult(taskId);
  const latestComposition = getLatestTaskComposition(taskId);
  const voiceCueCount = directorPlan.audioCues.filter((cue) => cue.hasVoice).length;
  const subtitleCueCount = directorPlan.audioCues.filter((cue) => cue.hasSubtitle).length;
  const narrationReady =
    voiceCueCount === 0
      ? true
      : directorPlan.audioCues
          .filter((cue) => cue.hasVoice)
          .every((cue) =>
            narrationResult?.clips.some(
              (clip) =>
                (clip.segmentId === cue.targetSegmentId || clip.bindToSegmentId === cue.targetSegmentId) &&
                Boolean(clip.audioUrl),
            ),
          );

  return {
    task,
    directorPlan,
    clipShots,
    narrationResult,
    latestComposition,
    statusSummary: {
      clipCount: clipShots.length,
      completedClipCount: clipShots.filter((item) => item.job?.status === "COMPLETED").length,
      subtitleReady: subtitleCueCount === 0 ? true : Boolean(narrationResult?.subtitleSrtUrl),
      narrationReady,
      latestResultAt:
        latestComposition?.updatedAt ??
        clipShots.find((item) => item.clipRecord?.generatedAt)?.clipRecord?.generatedAt ??
        narrationResult?.updatedAt ??
        task.updatedAt,
    },
  };
}

export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
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
    const body = (await request.json().catch(() => ({}))) as Partial<CompositionRunRequest> & {
      timeline?: TimelineItem[];
    };
    const payload = await buildCompositionPayload(taskId);
    const { task, directorPlan, clipShots, narrationResult, latestComposition } = payload;

    const isAutoCompose = body.action === "auto_compose";
    const timeline = normalizeTimelineItems(
      isAutoCompose
        ? clipShots
            .filter((item) => item.job?.status === "COMPLETED")
            .sort((left, right) => left.segmentIndex - right.segmentIndex)
            .map((item) => ({
              segmentId: item.segmentId,
              shotIndex: item.shotIndex,
              transition: "cut" as CompositionTransition,
            }))
        : Array.isArray(body.timeline)
          ? body.timeline
          : [],
    );

    if (!timeline.length) {
      return NextResponse.json(
        { error: isAutoCompose ? "没有已完成的片段可供自动排列合成" : "请先将素材加入 Timeline 后再生成视频" },
        { status: 400 },
      );
    }

    if (!narrationResult && directorPlan.audioCues.some((cue) => cue.hasVoice || cue.hasSubtitle)) {
      return NextResponse.json({ error: "请先完成音频/字幕制作" }, { status: 400 });
    }

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

    const timelineEntries = timeline.map((item) => {
      const clipShot = materialMap.get(item.segmentId);
      const narrationClip =
        narrationResult?.clips.find(
          (clip) => clip.segmentId === item.segmentId || clip.bindToSegmentId === item.segmentId,
        ) ??
        narrationResult?.clips.find(
          (clip) => clip.segmentIndex === item.shotIndex || clip.shotIndex === item.shotIndex,
        ) ??
        null;
      const cue = directorPlan.audioCues.find((audioCue) => audioCue.targetSegmentId === item.segmentId) ?? null;
      return {
        item,
        clipShot,
        narrationClip,
        cue,
        currentStart: startMap.get(item.segmentId) ?? 0,
        segmentDuration: durationLookup.get(item.segmentId) ?? task.parameters.video.durationSeconds,
      };
    });

    const voiceEntries = timelineEntries.filter(
      (entry) => entry.narrationClip?.hasVoice !== false && Boolean(entry.narrationClip?.audioUrl),
    );
    const voiceTimelineEntries = timelineEntries.filter((entry) => entry.cue?.hasVoice);
    const missingVoiceEntries = timelineEntries.filter(
      (entry) =>
        entry.cue?.hasVoice &&
        !entry.narrationClip?.audioUrl &&
        !(
          entry.clipShot?.lipSyncJob?.status === "COMPLETED" &&
          (entry.clipShot.lipSyncJob.videoUrl || entry.clipShot.lipSyncJob.remoteVideoUrl)
        ),
    );
    if (missingVoiceEntries.length > 0) {
      throw new Error(`片段 ${missingVoiceEntries[0]?.item.shotIndex ?? ""} 缺少可用口播音频，无法进行视频合成`);
    }
    const allVoiceSegmentsLipSynced =
      voiceTimelineEntries.length > 0 &&
      voiceTimelineEntries.every(
        (entry) =>
          entry.clipShot?.lipSyncJob?.status === "COMPLETED" &&
          Boolean(entry.clipShot.lipSyncJob.videoUrl || entry.clipShot.lipSyncJob.remoteVideoUrl),
      );
    const compositionDurationSeconds = timeline.reduce((maxValue, item) => {
      const startAtSeconds = startMap.get(item.segmentId) ?? 0;
      const durationSeconds = durationLookup.get(item.segmentId) ?? 0;
      return Math.max(maxValue, startAtSeconds + durationSeconds);
    }, 0);

    const narrationTrackClips: CompositionAudioClip[] = allVoiceSegmentsLipSynced
      ? []
      : voiceEntries.map((entry, index) => {
          const narrationClip = entry.narrationClip!;
          const nextVoiceStart = index < voiceEntries.length - 1 ? voiceEntries[index + 1].currentStart : null;
          const naturalDuration = resolveNarrationNaturalDuration(narrationClip);
          const audioWindow = buildNarrationWindow({
            currentStart: entry.currentStart,
            naturalDuration,
            nextAudioStart: nextVoiceStart,
            compositionEnd: compositionDurationSeconds,
          });

          return {
            id: `${taskId}-narration-${entry.item.segmentId}`,
            sourceUrl: narrationClip.audioUrl ?? null,
            startAtSeconds: entry.currentStart,
            durationSeconds: audioWindow.durationSeconds,
            fadeOutSeconds: audioWindow.fadeOutSeconds,
            bindToSegmentId: `${taskId}-${entry.item.segmentId}`,
            text: narrationClip.subtitleText,
            note: `片段 ${entry.item.shotIndex} 音频`,
          } satisfies CompositionAudioClip;
        });

    const includeBackgroundMusic = body.includeBackgroundMusic === true;
    const backgroundMusicUrl = includeBackgroundMusic ? String(body.backgroundMusicUrl ?? "").trim() || null : null;
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
        volume: 0.42,
        clips: [
          {
            id: `${taskId}-bgm-clip`,
            sourceUrl: backgroundMusicUrl,
            startAtSeconds: 0,
            loop: true,
            fadeInSeconds: 0.8,
            volume: 0.42,
          },
        ],
      });
    }
    const audioPlan: CompositionAudioPlan = {
      mode: "multi_track",
      tracks: audioTracks,
    };
    const audioMode = allVoiceSegmentsLipSynced
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

    const subtitleTimeline = timelineEntries
      .map((entry) => {
        const narrationClip = entry.narrationClip;
        const subtitleText = narrationClip?.subtitleText ?? entry.cue?.subtitleText ?? "";
        const hasSubtitle = narrationClip?.hasSubtitle ?? entry.cue?.hasSubtitle ?? Boolean(subtitleText);
        if (!hasSubtitle || !subtitleText.trim()) {
          return null;
        }

        const narrationTrackClip = narrationTrackClips.find(
          (clip) => clip.bindToSegmentId === `${taskId}-${entry.item.segmentId}`,
        );
        return {
          subtitleText,
          startAtSeconds: entry.currentStart,
          durationSeconds:
            narrationTrackClip?.durationSeconds ??
            narrationClip?.audioDurationSeconds ??
            narrationClip?.durationSeconds ??
            entry.segmentDuration,
          words: narrationClip?.words,
        };
      })
      .filter(
        (
          item,
        ): item is {
          subtitleText: string;
          startAtSeconds: number;
          durationSeconds: number;
          words: NarrationDraftClip["words"];
        } => Boolean(item),
      );
    const srtText = buildSrtTextFromTimeline(subtitleTimeline);

    if (latestComposition) {
      deleteVideoComposition(latestComposition.compositionId);
    }

    const record = createCompositionRecord({
      taskId,
      title: task.title,
      aspectRatio: task.parameters.video.aspectRatio,
      transitionMode: timeline.some((item) => item.transition === "fade") ? "fade" : "cut",
      transitionDurationSeconds,
      audioMode,
      backgroundMusicUrl,
      audioPlan,
      subtitleSrtUrl: null,
      segments,
      consistencyProfile: {
        subjectRule: task.title,
        sceneRule: "保持片段衔接流畅，字幕位置和风格统一",
        styleRule: "全片统一口播风格、字幕字号与安全边距",
        forbiddenRule: "禁止音画不同步、字幕错位、背景音乐压制台词",
      },
    });

    const subtitleFile = writeSrtSubtitleFile(record.compositionId, srtText, taskId);
    const recordWithSubtitle = {
      ...record,
      subtitleSrtUrl: subtitleFile.publicUrl,
    };
    upsertVideoComposition(recordWithSubtitle);
    const result = await composeVideoProject(recordWithSubtitle);

    const nextTask = patchVideoTask(taskId, {
      status:
        result?.status === "COMPLETED" &&
        getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("COMPOSITION_READY")
          ? "COMPOSITION_READY"
          : task.status,
    });

    const nextPayload = await buildCompositionPayload(taskId);
    const runtime = getFfmpegLocalRuntime("FFmpeg 本地服务 · video-composition-runner");
    return NextResponse.json({
      ...nextPayload,
      task: nextTask ?? getVideoTask(taskId) ?? task,
      result,
      runtime: {
        serviceLabel: runtime.serviceLabel,
        available: runtime.available,
        statusLabel: runtime.statusLabel,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "视频合成失败" }, { status: 500 });
  }
}
