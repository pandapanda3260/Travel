import { NextRequest, NextResponse } from "next/server";

import { synthesizeSpeech } from "../../../../../lib/audio-provider";
import { getSpeechSynthesisRuntime } from "../../../../../lib/audio-provider-config";
import { resolveTimbreResourceId } from "../../../../../lib/doubao-timbre-service";
import { getFfmpegLocalRuntime } from "../../../../../lib/local-service-runtime";
import {
  createNarrationResult,
  listNarrationResults,
  patchNarrationResult,
} from "../../../../../lib/narration-result-store";
import type { NarrationDraft, NarrationDraftClip } from "../../../../../lib/narration";
import {
  countNarrationCharacters,
  getNarrationLengthGuidance,
  isNarrationSpeechRateTooSlow,
  sanitizeNarrationText,
  trimNarrationToCharacterLimit,
} from "../../../../../lib/narration";
import {
  buildNarrationDeliveryStrategies,
  type NarrationDeliveryStrategy,
} from "../../../../../lib/narration-standards";
import { buildSubtitleAudioRepairSystemPrompt } from "../../../../../lib/narration-prompt-library";
import {
  audioFormatOptions,
  audioLoudnessRateOptions,
  audioSampleRateOptions,
  audioSpeechRateOptions,
} from "../../../../../lib/task-creation-parameters";
import { callTaskGenerationLlm } from "../../../../../lib/task-generation-runtime";
import { getTaskGenerationRuntime } from "../../../../../lib/task-generation-runtime";
import { buildDirectorPlanFromTaskData } from "../../../../../lib/video-task-director";
import { validateNarrationResult } from "../../../../../lib/generation-validator";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import { getVideoTaskStatusIndex, type VideoTaskVideoType } from "../../../../../lib/video-task-schema";
import { deriveVideoTaskStructure } from "../../../../../lib/video-task-structure";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

type GenerateSubtitleAudioRequest = {
  narrationScript?: string;
  video?: {
    segmentCount?: number;
    durationSeconds?: number;
  };
  audio?: {
    storyboardEnabled?: boolean;
    voiceId?: string | null;
    storyboardVoiceIds?: string[];
    format?: "mp3" | "ogg_opus";
    sampleRate?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
    speechRate?: -10 | 0 | 10 | 20;
    loudnessRate?: -10 | 0 | 10;
    enableSubtitle?: boolean;
  };
};

type SubtitleAudioApiSettings = {
  format: "mp3" | "ogg_opus";
  sampleRate: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  speechRate: -10 | 0 | 10 | 20;
  loudnessRate: -10 | 0 | 10;
  enableSubtitle: boolean;
};

const NARRATION_AUDIO_REPAIR_ROUNDS = 2;

function isClipOverDuration(actualDurationSeconds: number, targetDurationSeconds: number) {
  return actualDurationSeconds > targetDurationSeconds + Math.max(0.35, targetDurationSeconds * 0.08);
}

async function rewriteNarrationClipToFit(input: {
  text: string;
  targetDurationSeconds: number;
  actualDurationSeconds: number;
  reason: "overflow" | "slow";
  videoType: VideoTaskVideoType;
}) {
  const guidance = getNarrationLengthGuidance(input.targetDurationSeconds);
  const fallbackText = trimNarrationToCharacterLimit(
    sanitizeNarrationText(input.text, {
      stripLeadingDayPrefix: true,
    }),
    input.reason === "overflow" ? guidance.suggestedCharacters : guidance.maxCharacters,
  );

  const repaired = await callTaskGenerationLlm({
    systemPrompt: buildSubtitleAudioRepairSystemPrompt(input.videoType),
    userContent: JSON.stringify(
      {
        currentText: input.text,
        currentLength: countNarrationCharacters(input.text),
        targetDurationSeconds: input.targetDurationSeconds,
        actualDurationSeconds: input.actualDurationSeconds,
        maxCharacters: guidance.maxCharacters,
        suggestedCharacters: guidance.suggestedCharacters,
        reason: input.reason === "overflow" ? "音频超时" : "语速偏慢",
      },
      null,
      2,
    ),
    temperature: 0.2,
    maxCompletionTokens: 500,
  }).catch(() => null);

  return (
    sanitizeNarrationText(repaired || fallbackText, {
      stripLeadingDayPrefix: true,
    }) || fallbackText
  );
}

function rewriteNarrationScriptWithClips(script: string, clips: NarrationDraftClip[]) {
  const matches = Array.from(script.matchAll(/镜头\s*(\d+)\s*[.．、:：]?\s*/g));
  if (matches.length === 0) {
    return script;
  }

  const clipMap = new Map(clips.map((clip) => [clip.shotIndex, clip]));

  return matches
    .map((match, matchIndex) => {
      const shotIndex = Number(match[1]) || matchIndex + 1;
      const startIndex = (match.index ?? 0) + match[0].length;
      const endIndex = matches[matchIndex + 1]?.index ?? script.length;
      const fallbackText = script.slice(startIndex, endIndex).trim();
      const clip = clipMap.get(shotIndex);
      const nextText =
        clip && (clip.hasVoice || clip.hasSubtitle)
          ? sanitizeNarrationText(clip.narrationText || clip.subtitleText)
          : clip
            ? ""
            : fallbackText;
      return `镜头${shotIndex}：${nextText}`;
    })
    .join("\n");
}

function normalizeSubtitleAudioApiSettings(
  body: GenerateSubtitleAudioRequest["audio"] | undefined,
  fallback: SubtitleAudioApiSettings,
): SubtitleAudioApiSettings {
  const format = audioFormatOptions.some((item) => item.value === body?.format) ? body!.format! : fallback.format;
  const sampleRate = audioSampleRateOptions.some((item) => item.value === body?.sampleRate)
    ? body!.sampleRate!
    : fallback.sampleRate;
  const speechRate = audioSpeechRateOptions.some((item) => item.value === body?.speechRate)
    ? body!.speechRate!
    : fallback.speechRate;
  const loudnessRate = audioLoudnessRateOptions.some((item) => item.value === body?.loudnessRate)
    ? body!.loudnessRate!
    : fallback.loudnessRate;

  return {
    format,
    sampleRate,
    speechRate,
    loudnessRate,
    enableSubtitle: typeof body?.enableSubtitle === "boolean" ? body.enableSubtitle : fallback.enableSubtitle,
  };
}

async function synthesizeNarrationClip(
  clip: NarrationDraftClip,
  globalVoiceId: string | null,
  taskId: string,
  apiSettings: SubtitleAudioApiSettings,
  videoType: VideoTaskVideoType,
  deliveryStrategy?: NarrationDeliveryStrategy | null,
) {
  if (clip.hasVoice === false || !clip.narrationText.trim()) {
    return {
      ...clip,
      voiceId: null,
      audioUrl: null,
      audioDurationSeconds: null,
      words: [],
      narrationText: "",
      subtitleText: clip.hasSubtitle === false ? "" : clip.subtitleText,
    } satisfies NarrationDraftClip;
  }

  const resolvedVoiceId = clip.voiceId?.trim() || globalVoiceId?.trim() || undefined;
  const resourceId = resolvedVoiceId ? resolveTimbreResourceId(resolvedVoiceId) : undefined;
  if (resolvedVoiceId && !resourceId) {
    throw new Error(`镜头 ${clip.shotIndex} 的音色 ${resolvedVoiceId} 暂不支持字幕音频制作`);
  }

  let currentText = sanitizeNarrationText(clip.narrationText, {
    stripLeadingDayPrefix: true,
  });
  let retriedSlowOnce = false;

  for (let attempt = 0; attempt <= NARRATION_AUDIO_REPAIR_ROUNDS; attempt += 1) {
    const effectiveSpeechRate = Math.max(
      -20,
      Math.min(35, apiSettings.speechRate + (deliveryStrategy?.speechRateDelta ?? 0)),
    );
    const effectiveLoudnessRate = Math.max(
      -20,
      Math.min(20, apiSettings.loudnessRate + (deliveryStrategy?.loudnessDelta ?? 0)),
    );
    const result = await synthesizeSpeech({
      text: currentText,
      taskId,
      voiceId: resolvedVoiceId,
      resourceId,
      format: apiSettings.format,
      sampleRate: apiSettings.sampleRate,
      speechRate: effectiveSpeechRate,
      loudnessRate: effectiveLoudnessRate,
      enableSubtitle: apiSettings.enableSubtitle,
    });

    const actualDurationSeconds = result.audioDurationSeconds ?? clip.audioDurationSeconds ?? null;
    const isOverflow =
      actualDurationSeconds != null ? isClipOverDuration(actualDurationSeconds, clip.durationSeconds) : false;
    const isSlow =
      actualDurationSeconds != null ? isNarrationSpeechRateTooSlow(currentText, actualDurationSeconds) : false;
    const synthesizedClip = {
      ...clip,
      narrationText: currentText,
      subtitleText: clip.hasSubtitle === false ? "" : currentText,
      voiceId: resolvedVoiceId ?? null,
      audioUrl: result.audioUrl,
      audioDurationSeconds: actualDurationSeconds,
      words: result.words,
    } satisfies NarrationDraftClip;

    if (!isOverflow && !isSlow) {
      return synthesizedClip;
    }

    if (isSlow && !isOverflow && !retriedSlowOnce) {
      retriedSlowOnce = true;
      continue;
    }

    if (attempt >= NARRATION_AUDIO_REPAIR_ROUNDS) {
      return synthesizedClip;
    }

    currentText = await rewriteNarrationClipToFit({
      text: currentText,
      targetDurationSeconds: clip.durationSeconds,
      actualDurationSeconds: actualDurationSeconds ?? clip.durationSeconds,
      reason: isOverflow ? "overflow" : "slow",
      videoType,
    });
  }

  return clip;
}

async function synthesizeNarrationClips(
  clips: NarrationDraftClip[],
  globalVoiceId: string | null,
  taskId: string,
  apiSettings: SubtitleAudioApiSettings,
  videoType: VideoTaskVideoType,
  deliveryStrategyMap: Map<number, NarrationDeliveryStrategy>,
) {
  return Promise.all(
    clips.map((clip) =>
      synthesizeNarrationClip(
        clip,
        globalVoiceId,
        taskId,
        apiSettings,
        videoType,
        clip.shotIndex ? (deliveryStrategyMap.get(clip.shotIndex) ?? null) : null,
      ),
    ),
  );
}

function buildNarrationDraftFromDirectorPlan(input: {
  title: string;
  narrationScript: string;
  directorPlan: NonNullable<ReturnType<typeof buildDirectorPlanFromTaskData>>;
}) {
  const clips: NarrationDraftClip[] = input.directorPlan.audioCues.map((cue) => {
    const boundSegment =
      input.directorPlan.renderSegments.find((segment) => segment.segmentId === cue.targetSegmentId) ?? null;

    return {
      id: cue.cueId,
      cueId: cue.cueId,
      shotIndex: cue.shotIndex ?? cue.targetSegmentIndex,
      segmentId: cue.targetSegmentId,
      segmentIndex: cue.targetSegmentIndex,
      bindToSegmentId: cue.targetSegmentId,
      startAtSeconds: cue.startAtSeconds,
      durationSeconds: cue.plannedDurationSeconds,
      audioDurationSeconds: cue.audioDurationSeconds ?? null,
      characterFocus: boundSegment?.hasTalent ? "主角" : "旁白",
      visualFocus: boundSegment?.videoPrompt ?? boundSegment?.imagePrompt ?? `片段 ${cue.targetSegmentIndex}`,
      narrationText: cue.narrationText,
      subtitleText: cue.subtitleText,
      note: `片段 ${cue.targetSegmentIndex}${cue.requiresLipSync ? "（需口型）" : ""}`,
      hasVoice: cue.hasVoice,
      hasSubtitle: cue.hasSubtitle,
      requiresLipSync: cue.requiresLipSync,
      voiceId: cue.voiceId,
      audioUrl: cue.audioUrl ?? null,
      words: cue.words ?? [],
    };
  });

  return {
    title: `${input.title} · 音频字幕草案`,
    sourcePrompt: input.narrationScript,
    totalDurationSeconds: input.directorPlan.totalDurationSeconds,
    strategySummary: "按 directorPlan.audioCues 生成口播/字幕单元，允许旁白跨静音片段延续。",
    clips,
  } satisfies NarrationDraft;
}

export async function GET(_: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getVideoTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
  }

  const latestResult =
    listNarrationResults()
      .filter((item) => item.taskId === taskId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
  const ttsRuntime = getSpeechSynthesisRuntime();
  const repairRuntime = getTaskGenerationRuntime();
  const mergeRuntime = getFfmpegLocalRuntime("FFmpeg 本地服务 · narration-audio-bundle");

  return NextResponse.json({
    task,
    result: latestResult,
    runtime: {
      ttsProviderLabel: ttsRuntime.providerLabel,
      ttsResourceId: ttsRuntime.resourceId,
      ttsLiveEnabled: ttsRuntime.liveEnabled,
      repairProviderLabel: repairRuntime.providerLabel,
      repairModelId: repairRuntime.modelId,
      repairLiveEnabled: repairRuntime.liveEnabled,
      mergeServiceLabel: mergeRuntime.serviceLabel,
      mergeServiceAvailable: mergeRuntime.available,
      mergeServiceStatus: mergeRuntime.statusLabel,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getVideoTask(taskId);
    const body = (await request.json().catch(() => ({}))) as GenerateSubtitleAudioRequest;

    if (!task) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    const segmentCount = Math.max(1, Number(body.video?.segmentCount) || task.parameters.video.segmentCount);
    const durationSeconds = Math.max(1, Number(body.video?.durationSeconds) || task.parameters.video.durationSeconds);
    const storyboardEnabled = body.audio?.storyboardEnabled ?? task.parameters.audio.storyboardEnabled;
    const unifiedVoiceId = body.audio?.voiceId?.trim() || task.parameters.audio.voiceId || null;
    const storyboardVoiceIds = Array.isArray(body.audio?.storyboardVoiceIds)
      ? body.audio!.storyboardVoiceIds.map((item) => String(item).trim())
      : task.parameters.audio.storyboardVoiceIds;
    const audioApiSettings = normalizeSubtitleAudioApiSettings(body.audio, {
      format: task.parameters.audio.format,
      sampleRate: task.parameters.audio.sampleRate,
      speechRate: task.parameters.audio.speechRate,
      loudnessRate: task.parameters.audio.loudnessRate,
      enableSubtitle: task.parameters.audio.enableSubtitle,
    });
    const sourcePrompt = body.narrationScript?.trim() || task.draftBundle.narrationScript.trim();
    const derivedStructure = deriveVideoTaskStructure({
      source: task.source,
      videoType: task.parameters.video.videoType,
      expectedDurationRange: task.parameters.video.expectedDurationRange,
      requestedSegmentCount: segmentCount,
      requestedDurationSeconds: durationSeconds,
      requestedStoryShotsPerSegment: task.parameters.video.storyShotsPerSegment,
    });
    const adjustedParameters = {
      ...task.parameters,
      video: {
        ...task.parameters.video,
        segmentMode: derivedStructure.segmentMode,
        segmentCount: derivedStructure.segmentCount,
        durationSeconds: derivedStructure.durationSeconds,
        storyShotsPerSegment: derivedStructure.storyShotsPerSegment,
        storyShotCount: derivedStructure.storyShotCount,
        introSegmentDurationSeconds: derivedStructure.introSegmentDurationSeconds,
      },
      audio: {
        ...task.parameters.audio,
        voiceId: storyboardEnabled ? null : unifiedVoiceId,
        storyboardEnabled,
        storyboardVoiceIds: storyboardEnabled ? storyboardVoiceIds.slice(0, derivedStructure.storyShotCount) : [],
        format: audioApiSettings.format,
        sampleRate: audioApiSettings.sampleRate,
        speechRate: audioApiSettings.speechRate,
        loudnessRate: audioApiSettings.loudnessRate,
        enableSubtitle: audioApiSettings.enableSubtitle,
      },
    };
    const adjustedDraftBundle = {
      ...task.draftBundle,
      narrationScript: sourcePrompt,
    };
    const directorPlan = buildDirectorPlanFromTaskData({
      draftBundle: adjustedDraftBundle,
      shotPlan: task.shotPlan,
      directorPlan: task.directorPlan,
      parameters: adjustedParameters,
      forceRebuild: true,
    });

    if (!sourcePrompt && directorPlan.audioCues.some((cue) => cue.hasVoice || cue.hasSubtitle)) {
      return NextResponse.json({ error: "请先在镜头规划中补充口播或字幕文案后再生成音频/字幕" }, { status: 400 });
    }

    const generatedDraft = buildNarrationDraftFromDirectorPlan({
      title: task.title,
      narrationScript: sourcePrompt,
      directorPlan,
    });
    const deliveryStrategyMap = new Map(
      buildNarrationDeliveryStrategies(
        directorPlan.storyShots.map((shot) => ({
          shotIndex: shot.shotIndex,
          purpose: shot.purpose,
          hasVoice: shot.hasVoice,
          hasSubtitle: shot.hasSubtitle,
          requiresLipSync: shot.requiresLipSync,
          hasTalent: shot.hasTalent,
          emotion: shot.emotion,
          durationSeconds: shot.durationSeconds,
        })),
        task.parameters.video.videoType,
      ).map((item) => [item.shotIndex, item]),
    );

    const clipsWithVoices = generatedDraft.clips.map((clip, index) => ({
      ...clip,
      voiceId: clip.hasVoice
        ? storyboardEnabled
          ? storyboardVoiceIds[Math.max(0, clip.shotIndex - 1)]?.trim() || unifiedVoiceId
          : unifiedVoiceId
        : null,
    }));

    const createdResult = createNarrationResult({
      taskId,
      voiceId: storyboardEnabled ? null : unifiedVoiceId,
      draft: {
        ...generatedDraft,
        clips: clipsWithVoices,
      },
    });

    const synthesizedClips = await synthesizeNarrationClips(
      clipsWithVoices,
      unifiedVoiceId,
      taskId,
      audioApiSettings,
      adjustedParameters.video.videoType,
      deliveryStrategyMap,
    );

    const savedResult = await patchNarrationResult(createdResult.resultId, {
      clips: synthesizedClips,
      voiceId: storyboardEnabled ? null : unifiedVoiceId,
    });

    const finalDraftBundle = {
      ...adjustedDraftBundle,
      narrationScript: rewriteNarrationScriptWithClips(adjustedDraftBundle.narrationScript, synthesizedClips),
    };
    const finalDirectorPlan = buildDirectorPlanFromTaskData({
      draftBundle: finalDraftBundle,
      shotPlan: task.shotPlan,
      directorPlan,
      parameters: adjustedParameters,
      forceRebuild: true,
    });

    const nextTask = patchVideoTask(taskId, {
      status:
        getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("SUBTITLE_AUDIO_READY")
          ? "SUBTITLE_AUDIO_READY"
          : task.status,
      draftBundle: finalDraftBundle,
      directorPlan: finalDirectorPlan,
      parameters: {
        video: adjustedParameters.video,
        audio: adjustedParameters.audio,
      },
    });

    const validation = nextTask && savedResult ? validateNarrationResult(savedResult, nextTask) : null;
    const ttsRuntime = getSpeechSynthesisRuntime();
    const repairRuntime = getTaskGenerationRuntime();
    const mergeRuntime = getFfmpegLocalRuntime("FFmpeg 本地服务 · narration-audio-bundle");
    const runtimePayload = {
      ttsProviderLabel: ttsRuntime.providerLabel,
      ttsResourceId: ttsRuntime.resourceId,
      ttsLiveEnabled: ttsRuntime.liveEnabled,
      repairProviderLabel: repairRuntime.providerLabel,
      repairModelId: repairRuntime.modelId,
      repairLiveEnabled: repairRuntime.liveEnabled,
      mergeServiceLabel: mergeRuntime.serviceLabel,
      mergeServiceAvailable: mergeRuntime.available,
      mergeServiceStatus: mergeRuntime.statusLabel,
    };

    if (validation && !validation.passed) {
      const errorMessages = validation.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("；");
      return NextResponse.json(
        {
          task: nextTask,
          result: savedResult,
          validation,
          runtime: runtimePayload,
          error: `字幕音频校验未通过：${errorMessages}`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      task: nextTask,
      result: savedResult,
      validation,
      runtime: runtimePayload,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成字幕音频失败" }, { status: 500 });
  }
}
