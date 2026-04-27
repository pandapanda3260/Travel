import { NextRequest, NextResponse } from "next/server";

import { synthesizeSpeechWithResourceFallbacks, type SpeechSynthesisRequest } from "../../../../../lib/audio-provider";
import { getSpeechSynthesisRuntime } from "../../../../../lib/audio-provider-config";
import {
  createAdminTaskStageTracker,
  withAdminProviderCallTracking,
} from "../../../../../lib/admin-data-flow-tracking";
import { directorPrimaryStepActionKeys } from "../../../../../lib/director-step-actions";
import { getTimbreResourceFallbacks } from "../../../../../lib/doubao-timbre-service";
import { getFfmpegLocalRuntime } from "../../../../../lib/local-service-runtime";
import {
  createNarrationResult,
  listNarrationResults,
  patchNarrationResult,
} from "../../../../../lib/narration-result-store";
import type { NarrationDraft, NarrationDraftClip } from "../../../../../lib/narration";
import {
  countNarrationCharacters,
  getNarrationDurationOverflowTolerance,
  getNarrationLengthGuidance,
  isNarrationSpeechRateTooSlow,
  normalizeNarrationSpokenText,
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
import {
  buildNarrationScriptFromSubtitlePlan,
  hasSubtitlePlanText,
  syncNarrationClipsIntoSubtitlePlan,
  usesSegmentLevelSubtitleSource,
} from "../../../../../lib/subtitle-plan-source";
import { buildDirectorPlanFromTaskData, getTaskDirectorPlan } from "../../../../../lib/video-task-director";
import { validateNarrationResult } from "../../../../../lib/generation-validator";
import { requireOwnedVideoTask } from "../../../../../lib/video-task-route-guard";
import { clearTaskClipAndCompositionOutputs } from "../../../../../lib/video-task-output-reset";
import { getVideoTask, patchVideoTask } from "../../../../../lib/video-task-store";
import {
  listTaskVisualImageShots,
  autoSelectRecommendedCandidates,
} from "../../../../../lib/task-visual-image-store";
import { getActiveKeyMaterialWorkflow } from "../../../../../lib/key-material-task-store";
import type { VideoTaskDirectorPlan } from "../../../../../lib/video-task-schema";
import { type VideoTaskVideoType } from "../../../../../lib/video-task-schema";
import { deriveVideoTaskStructure } from "../../../../../lib/video-task-structure";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import { createProgressStream, type ProgressCallback } from "../../../../../lib/progress-stream";
import { taskStageProgressKeys } from "../../../../../lib/task-stage-progress";
import { createTaskStageProgressReporter } from "../../../../../lib/task-stage-progress-store";
import { WeightedProgressTracker } from "../../../../../lib/weighted-progress-tracker";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export type GenerateSubtitleAudioRequest = {
  action?: typeof directorPrimaryStepActionKeys.buildSubtitleAudio;
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

type UpdateSubtitleAudioLineRequest = {
  resultId?: string;
  clipId?: string;
  narrationText?: string;
};

type SubtitleAudioApiSettings = {
  format: "mp3" | "ogg_opus";
  sampleRate: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  speechRate: -10 | 0 | 10 | 20;
  loudnessRate: -10 | 0 | 10;
  enableSubtitle: boolean;
};

export type SubtitleAudioRunPayload = {
  task: ReturnType<typeof getVideoTask> | null;
  result: Awaited<ReturnType<typeof patchNarrationResult>> | ReturnType<typeof createNarrationResult> | null;
  validation: ReturnType<typeof validateNarrationResult> | null;
  runtime: {
    ttsProviderLabel: string;
    ttsResourceId: string;
    ttsLiveEnabled: boolean;
    repairProviderLabel: string;
    repairModelId: string;
    repairLiveEnabled: boolean;
    mergeServiceLabel: string;
    mergeServiceAvailable: boolean;
    mergeServiceStatus: string;
  };
  error?: string;
};

const NARRATION_AUDIO_REPAIR_ROUNDS = 2;
const NARRATION_OVERFLOW_SPEECH_RATE_BOOST = 10;
const NARRATION_SLOW_SPEECH_RATE_BOOST = 6;

type NarrationTtsExpressionOptions = Pick<
  SpeechSynthesisRequest,
  "contextTexts" | "emotion" | "emotionScale" | "pitch" | "silenceDuration"
>;

function getLatestTaskNarrationResult(taskId: string) {
  return (
    listNarrationResults()
      .filter((item) => item.taskId === taskId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null
  );
}

function buildStoryShotSignature(plan: VideoTaskDirectorPlan) {
  return plan.storyShots.map((shot) => `${shot.segmentId}:${shot.shotIndex}`).join("|");
}

function countSelectedVisualShots(taskId: string, plan: VideoTaskDirectorPlan) {
  const requiredShotIndexes = new Set(plan.storyShots.map((shot) => shot.shotIndex));
  return listTaskVisualImageShots(taskId).filter(
    (record) => Boolean(record.selectedCandidateId) && requiredShotIndexes.has(record.shotIndex),
  ).length;
}

function getNarrationUnitLabel(videoType: VideoTaskVideoType) {
  return usesSegmentLevelSubtitleSource(videoType) ? "片段" : "镜头";
}

function isClipOverDuration(actualDurationSeconds: number, targetDurationSeconds: number) {
  return actualDurationSeconds > targetDurationSeconds + getNarrationDurationOverflowTolerance(targetDurationSeconds);
}

function getNarrationGlobalVoiceDirection(videoType: VideoTaskVideoType) {
  switch (videoType) {
    case "agency_guide_voiceover":
    case "agency_guide_roaming_voiceover":
    case "agency_montage_roaming_voiceover":
      return "像真实旅行顾问在讲攻略，自然可信，先给结论，再补体验，不要播音腔";
    case "hotel_explore_voiceover":
    case "hotel_montage_voiceover":
    case "hotel_explore_roaming_voiceover":
      return "像真人探店博主在带看酒店，语气松弛、具体、有服务体验感";
    case "agency_guide_selfie_narration":
    case "agency_guide_presenter_narration":
    case "hotel_explore_selfie_narration":
    case "hotel_explore_presenter_narration":
    case "retail_explore_presenter_narration":
      return "像真人面对镜头自然交流，有亲和力和轻微互动感，不要端着念稿";
    case "agency_montage_scenery":
    case "agency_guide_scenery_voiceover":
      return "像旅行短片旁白，语气舒展沉浸，给画面留呼吸，不要硬塞信息";
    default:
      return "像真实短视频口播，自然、顺口、可信，有轻微情绪起伏";
  }
}

function getNarrationPaceDirection(deliveryStrategy: NarrationDeliveryStrategy | null | undefined) {
  switch (deliveryStrategy?.deliveryPace) {
    case "fast":
      return "这一句读得更利落一点，起势更明确，但不要喊麦";
    case "slow":
      return "这一句读得更舒展一点，允许自然停顿，给画面留呼吸";
    case "balanced":
    default:
      return "这一句保持自然口播节奏，重音放在具体价值点上";
  }
}

function getNarrationRoleDirection(deliveryStrategy: NarrationDeliveryStrategy | null | undefined) {
  switch (deliveryStrategy?.voiceRole) {
    case "hook":
      return "这一句是开场钩子，要有好奇感和轻微上扬的起势";
    case "highlight":
      return "这一句是重点亮点，要稍微提气，把价值感读出来";
    case "transition":
      return "这一句是过渡承接，要轻一点，像顺着上一句自然往下讲";
    case "closing":
      return "这一句是收尾，要回稳、真诚，有记忆点和收束感";
    case "guide":
      return "这一句是讲解带看，要清楚具体，像真人边看边说";
    case "silent":
    default:
      return "";
  }
}

function getNarrationSpokenTerminalPunctuation(
  text: string,
  deliveryStrategy: NarrationDeliveryStrategy | null | undefined,
) {
  if (/[吗呢吧]$/u.test(text)) {
    return "？";
  }

  switch (deliveryStrategy?.voiceRole) {
    case "hook":
    case "highlight":
      return "！";
    default:
      return "。";
  }
}

function buildNarrationSpokenText(
  text: string | null | undefined,
  deliveryStrategy: NarrationDeliveryStrategy | null | undefined,
) {
  const spokenBase = normalizeNarrationSpokenText(text, {
    stripLeadingDayPrefix: true,
  });
  const textWithoutTerminal = sanitizeNarrationText(spokenBase, {
    stripTerminalPunctuation: true,
    removeTerminalOh: true,
  });

  if (!textWithoutTerminal) {
    return "";
  }

  return `${textWithoutTerminal}${getNarrationSpokenTerminalPunctuation(textWithoutTerminal, deliveryStrategy)}`;
}

function buildNarrationTtsExpressionOptions(input: {
  clip: NarrationDraftClip;
  videoType: VideoTaskVideoType;
  deliveryStrategy?: NarrationDeliveryStrategy | null;
}): NarrationTtsExpressionOptions {
  const deliveryStrategy = input.deliveryStrategy ?? null;
  const voiceDirection = [
    getNarrationGlobalVoiceDirection(input.videoType),
    getNarrationRoleDirection(deliveryStrategy),
    deliveryStrategy?.deliveryTone ? `表演方向：${deliveryStrategy.deliveryTone}` : "",
    getNarrationPaceDirection(deliveryStrategy),
    input.clip.visualFocus ? `画面重点：${input.clip.visualFocus}` : "",
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("；");

  return {
    contextTexts: voiceDirection ? [voiceDirection] : [],
  };
}

async function rewriteNarrationClipToFit(input: {
  taskId: string;
  clipId: string;
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
  const repairRuntime = getTaskGenerationRuntime();
  const repaired = await withAdminProviderCallTracking(
    {
      enabled: repairRuntime.liveEnabled,
      serviceName: "llm.subtitle_repair",
      provider: repairRuntime.provider,
      modelId: repairRuntime.modelId,
      objectType: "video_task_subtitle_clip",
      objectId: `${input.taskId}:${input.clipId}`,
    },
    () =>
      callTaskGenerationLlm({
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
      }),
  ).catch(() => null);

  return (
    sanitizeNarrationText(repaired || fallbackText, {
      stripLeadingDayPrefix: true,
    }) || fallbackText
  );
}

function rewriteNarrationScriptWithClips(script: string, clips: NarrationDraftClip[]) {
  const matches = Array.from(script.matchAll(/(片段|镜头)\s*(\d+)\s*[.．、:：]?\s*/g));
  if (matches.length === 0) {
    return script;
  }

  const shotClipMap = new Map(clips.map((clip) => [clip.shotIndex, clip]));
  const segmentClipMap = new Map<number, NarrationDraftClip>();
  for (const clip of clips) {
    if (clip.segmentIndex == null || segmentClipMap.has(clip.segmentIndex)) {
      continue;
    }
    segmentClipMap.set(clip.segmentIndex, clip);
  }

  return matches
    .map((match, matchIndex) => {
      const label = match[1] === "片段" ? "片段" : "镜头";
      const targetIndex = Number(match[2]) || matchIndex + 1;
      const startIndex = (match.index ?? 0) + match[0].length;
      const endIndex = matches[matchIndex + 1]?.index ?? script.length;
      const fallbackText = script.slice(startIndex, endIndex).trim();
      const clip = label === "片段" ? segmentClipMap.get(targetIndex) : shotClipMap.get(targetIndex);
      const nextText =
        clip && (clip.hasVoice || clip.hasSubtitle)
          ? sanitizeNarrationText(clip.narrationText || clip.subtitleText)
          : clip
            ? ""
            : fallbackText;
      return `${label}${targetIndex}：${nextText}`;
    })
    .join("\n");
}

function buildNarrationScriptFromClips(clips: NarrationDraftClip[], videoType: VideoTaskVideoType) {
  const label = usesSegmentLevelSubtitleSource(videoType) ? "片段" : "镜头";
  const seenKeys = new Set<string>();

  return clips
    .map((clip) => {
      const targetIndex = usesSegmentLevelSubtitleSource(videoType)
        ? (clip.segmentIndex ?? clip.shotIndex)
        : clip.shotIndex;
      const key = `${label}-${targetIndex}`;
      if (!targetIndex || seenKeys.has(key)) {
        return "";
      }
      seenKeys.add(key);
      const text = sanitizeNarrationText(clip.narrationText || clip.subtitleText, {
        stripLeadingDayPrefix: true,
      });
      return `${label}${targetIndex}：${text}`;
    })
    .filter(Boolean)
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
  const sourceText = clip.spokenText || clip.narrationText || clip.subtitleText;
  if (clip.hasVoice === false || !sourceText.trim()) {
    return {
      ...clip,
      voiceId: null,
      audioUrl: null,
      audioDurationSeconds: null,
      words: [],
      narrationText: "",
      spokenText: "",
      subtitleText: clip.hasSubtitle === false ? "" : clip.subtitleText,
    } satisfies NarrationDraftClip;
  }

  const resolvedVoiceId = clip.voiceId?.trim() || globalVoiceId?.trim() || undefined;
  const resourceFallbacks = resolvedVoiceId ? getTimbreResourceFallbacks(resolvedVoiceId) : [];
  let preferredResourceId = resourceFallbacks[0];

  let currentText = buildNarrationSpokenText(sourceText, deliveryStrategy);
  let appliedOverflowBoost = false;
  let appliedSlowBoost = false;
  let currentSpeechRateBoost = 0;
  const speechRuntime = getSpeechSynthesisRuntime();

  for (let attempt = 0; attempt <= NARRATION_AUDIO_REPAIR_ROUNDS; attempt += 1) {
    const effectiveSpeechRate = Math.max(
      -20,
      Math.min(35, apiSettings.speechRate + (deliveryStrategy?.speechRateDelta ?? 0) + currentSpeechRateBoost),
    );
    const effectiveLoudnessRate = Math.max(
      -20,
      Math.min(20, apiSettings.loudnessRate + (deliveryStrategy?.loudnessDelta ?? 0)),
    );
    const result = await withAdminProviderCallTracking(
      {
        enabled: speechRuntime.liveEnabled,
        serviceName: "audio.tts",
        provider: speechRuntime.providerLabel,
        modelId: preferredResourceId ?? speechRuntime.resourceId,
        objectType: "video_task_subtitle_clip",
        objectId: `${taskId}:${clip.id}`,
      },
      () =>
        synthesizeSpeechWithResourceFallbacks({
          text: currentText,
          taskId,
          voiceId: resolvedVoiceId,
          resourceId: preferredResourceId,
          fallbackResourceIds: resourceFallbacks,
          format: apiSettings.format,
          sampleRate: apiSettings.sampleRate,
          speechRate: effectiveSpeechRate,
          loudnessRate: effectiveLoudnessRate,
          enableSubtitle: apiSettings.enableSubtitle,
          ...buildNarrationTtsExpressionOptions({
            clip,
            videoType,
            deliveryStrategy,
          }),
        }),
    );
    preferredResourceId = result.resolvedResourceId ?? preferredResourceId;

    const actualDurationSeconds = result.audioDurationSeconds ?? clip.audioDurationSeconds ?? null;
    const isOverflow =
      actualDurationSeconds != null ? isClipOverDuration(actualDurationSeconds, clip.durationSeconds) : false;
    const isSlow =
      actualDurationSeconds != null ? isNarrationSpeechRateTooSlow(currentText, actualDurationSeconds) : false;
    const synthesizedClip = {
      ...clip,
      narrationText: sanitizeNarrationText(currentText, {
        stripLeadingDayPrefix: true,
      }),
      spokenText: currentText,
      subtitleText:
        clip.hasSubtitle === false
          ? ""
          : sanitizeNarrationText(clip.subtitleText || clip.narrationText || currentText, {
              stripLeadingDayPrefix: true,
            }),
      voiceId: resolvedVoiceId ?? null,
      audioUrl: result.audioUrl,
      audioDurationSeconds: actualDurationSeconds,
      words: result.words,
    } satisfies NarrationDraftClip;

    if (!isOverflow && !isSlow) {
      return synthesizedClip;
    }

    if (isOverflow && !appliedOverflowBoost) {
      appliedOverflowBoost = true;
      currentSpeechRateBoost = Math.max(currentSpeechRateBoost, NARRATION_OVERFLOW_SPEECH_RATE_BOOST);
      continue;
    }

    if (isSlow && !isOverflow && !appliedSlowBoost) {
      appliedSlowBoost = true;
      currentSpeechRateBoost = Math.max(currentSpeechRateBoost, NARRATION_SLOW_SPEECH_RATE_BOOST);
      continue;
    }

    if (attempt >= NARRATION_AUDIO_REPAIR_ROUNDS) {
      return synthesizedClip;
    }

    currentText = buildNarrationSpokenText(
      await rewriteNarrationClipToFit({
        taskId,
        clipId: clip.id,
        text: currentText,
        targetDurationSeconds: clip.durationSeconds,
        actualDurationSeconds: actualDurationSeconds ?? clip.durationSeconds,
        reason: isOverflow ? "overflow" : "slow",
        videoType,
      }),
      deliveryStrategy,
    );
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
  options?: {
    concurrency?: number;
    onClipStart?: (clip: NarrationDraftClip, index: number) => void;
    onClipComplete?: (clip: NarrationDraftClip, index: number) => void;
  },
) {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, clips.length || 1));
  const results = new Array<NarrationDraftClip>(clips.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= clips.length) {
        return;
      }

      const clip = clips[currentIndex];
      options?.onClipStart?.(clip, currentIndex);
      const result = await synthesizeNarrationClip(
        clip,
        globalVoiceId,
        taskId,
        apiSettings,
        videoType,
        clip.shotIndex ? (deliveryStrategyMap.get(clip.shotIndex) ?? null) : null,
      );
      results[currentIndex] = result;
      options?.onClipComplete?.(result, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function estimateSubtitleClipDurationMs(clip: NarrationDraftClip) {
  const textLength = countNarrationCharacters(clip.narrationText || clip.subtitleText || "");
  const base = 1200;
  const audioBudget = Math.max(800, (clip.durationSeconds || 3) * 850);
  const textBudget = textLength * 55;
  return Math.round(base + audioBudget + textBudget);
}

function buildNarrationDraftFromDirectorPlan(input: {
  title: string;
  narrationScript: string;
  directorPlan: NonNullable<ReturnType<typeof buildDirectorPlanFromTaskData>>;
}) {
  const subtitlePlan = input.directorPlan.subtitlePlan;
  const hasSubtitlePlan = subtitlePlan && subtitlePlan.length > 0 && subtitlePlan.some((s) => s.subtitles.length > 0);

  let clips: NarrationDraftClip[];

  if (hasSubtitlePlan) {
    clips = [];
    for (const segPlan of subtitlePlan!) {
      const boundSegment = input.directorPlan.renderSegments.find((s) => s.segmentId === segPlan.segmentId) ?? null;
      const segmentShots = input.directorPlan.storyShots.filter((s) => s.segmentId === segPlan.segmentId);

      for (const sub of segPlan.subtitles) {
        const coveredShots = segmentShots.filter((s) => sub.coveredShotIndexes.includes(s.shotIndex));
        const anchorShot = coveredShots[0] ?? segmentShots[0] ?? null;
        const emotion = anchorShot?.emotion ?? "自然";
        const speechRate = sub.durationSeconds > 0 ? Math.round((sub.charCount / sub.durationSeconds) * 10) / 10 : 2.4;
        const hasVoice = coveredShots.some((shot) => shot.hasVoice) || Boolean(boundSegment?.hasVoice);
        const hasSubtitle = coveredShots.some((shot) => shot.hasSubtitle) || Boolean(boundSegment?.hasSubtitle);

        clips.push({
          id: `sub-${segPlan.segmentIndex}-${clips.length}`,
          cueId: `sub-${segPlan.segmentIndex}-${clips.length}`,
          shotIndex: anchorShot?.shotIndex ?? segPlan.segmentIndex,
          segmentId: segPlan.segmentId,
          segmentIndex: segPlan.segmentIndex,
          bindToSegmentId: segPlan.segmentId,
          startAtSeconds: sub.startAtSeconds,
          durationSeconds: sub.durationSeconds,
          audioDurationSeconds: null,
          characterFocus: boundSegment?.hasTalent ? "主角" : "旁白",
          visualFocus: anchorShot?.sceneDescription ?? boundSegment?.videoPrompt ?? `片段 ${segPlan.segmentIndex}`,
          narrationText: sub.text,
          subtitleText: sub.text,
          note: `片段 ${segPlan.segmentIndex} | 情绪: ${emotion} | 语速: ${speechRate}字/秒 | 覆盖镜头: ${sub.coveredShotIndexes.join(",")}`,
          hasVoice,
          hasSubtitle,
          requiresLipSync: hasVoice ? (boundSegment?.requiresLipSync ?? false) : false,
          voiceId: null,
          audioUrl: null,
          words: [],
        });
      }
    }
  } else {
    clips = input.directorPlan.audioCues.map((cue) => {
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
  }

  return {
    title: `${input.title} · 音频字幕草案`,
    sourcePrompt: input.narrationScript,
    totalDurationSeconds: input.directorPlan.totalDurationSeconds,
    strategySummary: hasSubtitlePlan
      ? "按 subtitlePlan 精确时间轴生成口播/字幕单元，字幕时间与镜头边界对齐。"
      : "按 legacy audioCues 兜底生成口播/字幕单元；新链路应优先使用 subtitlePlan。",
    clips,
  } satisfies NarrationDraft;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  const access = requireOwnedVideoTask(request, taskId);
  if ("response" in access) {
    return access.response;
  }
  const payload = loadLatestTaskSubtitleAudioPayload(taskId);

  return NextResponse.json({
    task: payload.task ?? access.task,
    result: payload.result,
    runtime: payload.runtime,
  });
}

function loadLatestTaskSubtitleAudioPayload(taskId: string) {
  const latestResult = getLatestTaskNarrationResult(taskId);
  const task = getVideoTask(taskId);
  const ttsRuntime = getSpeechSynthesisRuntime();
  const repairRuntime = getTaskGenerationRuntime();
  const mergeRuntime = getFfmpegLocalRuntime("FFmpeg 本地服务 · narration-audio-bundle");

  return {
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
  };
}

async function executeSubtitleAudioGeneration(input: {
  taskId: string;
  task: NonNullable<ReturnType<typeof getVideoTask>>;
  body: GenerateSubtitleAudioRequest;
  userId: string;
  routePath: string;
  onProgress?: ProgressCallback;
}): Promise<SubtitleAudioRunPayload> {
  const taskId = input.taskId;
  const task = getVideoTask(taskId) ?? input.task;
  const body = input.body;

  if (body.action && body.action !== directorPrimaryStepActionKeys.buildSubtitleAudio) {
    throw new Error("当前请求动作不支持字幕配音生成");
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
  const subtitlePlanSourceScript = buildNarrationScriptFromSubtitlePlan(task.shotPlan, task.parameters.video.videoType);
  const sourcePrompt = usesSegmentLevelSubtitleSource(task.parameters.video.videoType)
    ? body.narrationScript?.trim() || subtitlePlanSourceScript || task.draftBundle.narrationScript.trim()
    : body.narrationScript?.trim() || task.draftBundle.narrationScript.trim() || subtitlePlanSourceScript;
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

  const hasSubtitleSourceText = hasSubtitlePlanText(directorPlan.subtitlePlan);
  const hasNarrationDemand = directorPlan.renderSegments.some((segment) => segment.hasVoice || segment.hasSubtitle);

  if (!sourcePrompt && !hasSubtitleSourceText && hasNarrationDemand) {
    throw new Error("请先在镜头规划中补充口播或字幕文案后再生成音频/字幕");
  }

  const ttsRuntime = getSpeechSynthesisRuntime();
  const stageTracker = createAdminTaskStageTracker({
    taskId,
    stageKey: "subtitle_audio",
    provider: ttsRuntime.providerLabel,
    modelId: ttsRuntime.resourceId,
  });

  return runWithModelUsageContext(
    {
      userId: input.userId,
      routePath: input.routePath,
      objectType: "video_task",
      objectId: taskId,
    },
    async () => {
      const stageProgress = createTaskStageProgressReporter({
        taskId,
        stageKey: taskStageProgressKeys.subtitleAudio,
        provider: ttsRuntime.providerLabel,
        modelId: ttsRuntime.resourceId,
        initialMessage: "准备生成字幕音频...",
        initialPercent: 1,
      });
      const emitProgress = (step: string, percent: number, message: string, extra?: Record<string, unknown>) => {
        input.onProgress?.(step, percent, message, extra);
        stageProgress.onProgress(step, percent, message);
      };

      try {
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

        const clipsWithVoices = generatedDraft.clips.map((clip) => ({
          ...clip,
          voiceId: clip.hasVoice
            ? storyboardEnabled
              ? storyboardVoiceIds[
                  Math.max(
                    0,
                    (usesSegmentLevelSubtitleSource(adjustedParameters.video.videoType)
                      ? (clip.segmentIndex ?? clip.shotIndex)
                      : clip.shotIndex) - 1,
                  )
                ]?.trim() || unifiedVoiceId
              : unifiedVoiceId
            : null,
        }));

        const voicedClips = clipsWithVoices.filter((clip) => clip.hasVoice !== false && clip.narrationText.trim());
        const tracker = new WeightedProgressTracker(
          emitProgress,
          [
            { id: "prepare", weight: 10, estimatedMs: 900 },
            { id: "create_result", weight: 6, estimatedMs: 400 },
            ...voicedClips.map((clip) => ({
              id: `clip-${clip.id}`,
              weight: Math.max(1, countNarrationCharacters(clip.narrationText || clip.subtitleText || "") / 6),
              estimatedMs: estimateSubtitleClipDurationMs(clip),
              label: `${getNarrationUnitLabel(adjustedParameters.video.videoType)} ${
                usesSegmentLevelSubtitleSource(adjustedParameters.video.videoType)
                  ? (clip.segmentIndex ?? clip.shotIndex)
                  : clip.shotIndex
              }`,
            })),
            { id: "merge_bundle", weight: 12, estimatedMs: 2600 },
            { id: "sync_plan", weight: 10, estimatedMs: 1000 },
            { id: "save_task", weight: 10, estimatedMs: 500 },
            { id: "validate", weight: 8, estimatedMs: 700 },
            { id: "finalize", weight: 6, estimatedMs: 300 },
          ],
          {
            step: "subtitle_audio",
            floorPercent: 2,
            capPercent: 99,
          },
        );

        tracker.start("prepare", "整理台词与配音策略...");
        const createdResult = createNarrationResult({
          taskId,
          voiceId: storyboardEnabled ? null : unifiedVoiceId,
          draft: {
            ...generatedDraft,
            clips: clipsWithVoices,
          },
        });
        tracker.complete("prepare", "台词草稿已整理");

        tracker.start("create_result", "初始化字幕/音频结果...");
        tracker.complete("create_result", "开始生成分镜音频...");

        const synthesizedClips = await synthesizeNarrationClips(
          clipsWithVoices,
          unifiedVoiceId,
          taskId,
          audioApiSettings,
          adjustedParameters.video.videoType,
          deliveryStrategyMap,
          {
            concurrency: 3,
            onClipStart: (clip) => {
              if (clip.hasVoice === false || !clip.narrationText.trim()) {
                return;
              }
              const clipIndex = usesSegmentLevelSubtitleSource(adjustedParameters.video.videoType)
                ? (clip.segmentIndex ?? clip.shotIndex)
                : clip.shotIndex;
              tracker.start(
                `clip-${clip.id}`,
                `${getNarrationUnitLabel(adjustedParameters.video.videoType)} ${clipIndex} 配音生成中...`,
              );
            },
            onClipComplete: (clip) => {
              if (clip.hasVoice === false || !clip.narrationText.trim()) {
                return;
              }
              const clipIndex = usesSegmentLevelSubtitleSource(adjustedParameters.video.videoType)
                ? (clip.segmentIndex ?? clip.shotIndex)
                : clip.shotIndex;
              tracker.complete(
                `clip-${clip.id}`,
                `${getNarrationUnitLabel(adjustedParameters.video.videoType)} ${clipIndex} 配音完成`,
              );
            },
          },
        );

        tracker.start("merge_bundle", "合并整体音频与字幕文件...");
        const savedResult = await patchNarrationResult(createdResult.resultId, {
          clips: synthesizedClips,
          voiceId: storyboardEnabled ? null : unifiedVoiceId,
        });
        tracker.complete("merge_bundle", "字幕文件与整体音频已生成");

        tracker.start("sync_plan", "回写镜头计划与台词...");
        const finalShotPlan =
          syncNarrationClipsIntoSubtitlePlan(task.shotPlan, synthesizedClips, adjustedParameters.video.videoType) ??
          task.shotPlan;
        const finalDraftBundle = {
          ...adjustedDraftBundle,
          narrationScript: usesSegmentLevelSubtitleSource(adjustedParameters.video.videoType)
            ? buildNarrationScriptFromSubtitlePlan(finalShotPlan, adjustedParameters.video.videoType)
            : rewriteNarrationScriptWithClips(adjustedDraftBundle.narrationScript, synthesizedClips),
        };
        const finalDirectorPlan = buildDirectorPlanFromTaskData({
          draftBundle: finalDraftBundle,
          shotPlan: finalShotPlan,
          directorPlan,
          parameters: adjustedParameters,
          forceRebuild: true,
        });
        tracker.complete("sync_plan", "镜头计划已同步");

        tracker.start("save_task", "写回任务数据...");
        const previousDirectorPlan = getTaskDirectorPlan(task);
        const visualStructureChanged =
          buildStoryShotSignature(previousDirectorPlan) !== buildStoryShotSignature(finalDirectorPlan);
        if (!visualStructureChanged) {
          autoSelectRecommendedCandidates(taskId);
        }
        clearTaskClipAndCompositionOutputs(taskId);
        const selectedVisualShotCount = visualStructureChanged
          ? 0
          : countSelectedVisualShots(taskId, finalDirectorPlan);
        const allVisualShotsSelected =
          !visualStructureChanged &&
          finalDirectorPlan.storyShots.length > 0 &&
          selectedVisualShotCount >= finalDirectorPlan.storyShots.length;

        const baseTask = patchVideoTask(taskId, {
          status: "CREATED",
          draftBundle: finalDraftBundle,
          shotPlan: finalShotPlan,
          directorPlan: finalDirectorPlan,
          parameters: {
            video: adjustedParameters.video,
            audio: adjustedParameters.audio,
          },
          stageTimestamps: {
            SUBTITLE_AUDIO_READY: undefined,
            IMAGES_READY: undefined,
            CLIPS_READY: undefined,
            COMPOSITION_READY: undefined,
          },
        });
        tracker.complete("save_task", "任务数据已更新");

        tracker.start("validate", "校验字幕时间轴与音频结果...");
        const validation = baseTask && savedResult ? validateNarrationResult(savedResult, baseTask) : null;
        tracker.complete("validate", validation?.passed ? "字幕音频校验通过" : "字幕音频校验未通过");

        tracker.start("finalize", "收尾并同步阶段状态...");
        const saveTaskAt = new Date().toISOString();
        const nextTask =
          validation?.passed && baseTask
            ? patchVideoTask(taskId, {
                status: allVisualShotsSelected ? "IMAGES_READY" : "SUBTITLE_AUDIO_READY",
                stageTimestamps: {
                  SUBTITLE_AUDIO_READY: saveTaskAt,
                  IMAGES_READY: allVisualShotsSelected ? saveTaskAt : undefined,
                  CLIPS_READY: undefined,
                  COMPOSITION_READY: undefined,
                },
              })
            : baseTask;

        const runtimePayload = loadLatestTaskSubtitleAudioPayload(taskId).runtime;
        tracker.finish(validation?.passed ? "字幕音频生成完成" : "字幕音频生成失败");

        if (validation && !validation.passed) {
          const errorMessages = validation.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.message)
            .join("；");
          const validationError = `字幕音频校验未通过：${errorMessages || "结果不完整"}`;
          stageTracker.fail(validationError);
          stageProgress.fail(validationError, validationError);
          tracker.complete("finalize", "已记录失败原因");
          return {
            task: nextTask,
            result: savedResult,
            validation,
            runtime: runtimePayload,
            error: validationError,
          };
        }

        tracker.complete("finalize", "阶段状态已同步");
        stageTracker.complete();
        stageProgress.complete("字幕音频生成完成");

        return {
          task: nextTask,
          result: savedResult,
          validation,
          runtime: runtimePayload,
        };
      } catch (error) {
        stageTracker.fail(error);
        stageProgress.fail(error);
        throw error;
      }
    },
  );
}

async function executeSubtitleAudioLineUpdate(input: {
  taskId: string;
  task: NonNullable<ReturnType<typeof getVideoTask>>;
  body: UpdateSubtitleAudioLineRequest;
  userId: string;
  routePath: string;
}): Promise<SubtitleAudioRunPayload & { updatedClipId?: string }> {
  const taskId = input.taskId;
  const task = getVideoTask(taskId) ?? input.task;
  const clipId = input.body.clipId?.trim();
  const nextText = sanitizeNarrationText(input.body.narrationText ?? "", {
    stripLeadingDayPrefix: true,
  });

  if (!clipId) {
    throw new Error("缺少要修改的台词片段");
  }
  if (!nextText) {
    throw new Error("台词不能为空");
  }

  const latestResult = getLatestTaskNarrationResult(taskId);
  const requestedResultId = input.body.resultId?.trim();
  const currentResult =
    requestedResultId && latestResult?.resultId !== requestedResultId
      ? (listNarrationResults().find((item) => item.taskId === taskId && item.resultId === requestedResultId) ??
        latestResult)
      : latestResult;
  if (!currentResult) {
    throw new Error("当前任务还没有可修改的字幕音频结果");
  }

  const targetClipIndex = currentResult.clips.findIndex((clip) => clip.id === clipId || clip.cueId === clipId);
  if (targetClipIndex < 0) {
    throw new Error("没有找到要修改的台词片段");
  }

  const targetClip = currentResult.clips[targetClipIndex];
  const storyboardEnabled = task.parameters.audio.storyboardEnabled;
  const unifiedVoiceId = storyboardEnabled ? null : task.parameters.audio.voiceId || null;
  const audioApiSettings = normalizeSubtitleAudioApiSettings(undefined, {
    format: task.parameters.audio.format,
    sampleRate: task.parameters.audio.sampleRate,
    speechRate: task.parameters.audio.speechRate,
    loudnessRate: task.parameters.audio.loudnessRate,
    enableSubtitle: task.parameters.audio.enableSubtitle,
  });
  const directorPlan = getTaskDirectorPlan(task);
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
  const storyboardIndex = Math.max(
    0,
    (usesSegmentLevelSubtitleSource(task.parameters.video.videoType)
      ? (targetClip.segmentIndex ?? targetClip.shotIndex)
      : targetClip.shotIndex) - 1,
  );
  const targetVoiceId = targetClip.hasVoice
    ? targetClip.voiceId?.trim() ||
      (storyboardEnabled ? task.parameters.audio.storyboardVoiceIds[storyboardIndex]?.trim() : unifiedVoiceId) ||
      unifiedVoiceId
    : null;
  const editedClip = {
    ...targetClip,
    narrationText: targetClip.hasVoice === false ? "" : nextText,
    subtitleText: targetClip.hasSubtitle === false ? "" : nextText,
    spokenText: null,
    voiceId: targetVoiceId,
    audioUrl: null,
    audioDurationSeconds: null,
    words: [],
  } satisfies NarrationDraftClip;

  return runWithModelUsageContext(
    {
      userId: input.userId,
      routePath: input.routePath,
      objectType: "video_task_subtitle_clip",
      objectId: `${taskId}:${clipId}`,
    },
    async () => {
      const synthesizedClip = await synthesizeNarrationClip(
        editedClip,
        unifiedVoiceId,
        taskId,
        audioApiSettings,
        task.parameters.video.videoType,
        editedClip.shotIndex ? (deliveryStrategyMap.get(editedClip.shotIndex) ?? null) : null,
      );
      const latestResultForPatch = getLatestTaskNarrationResult(taskId);
      const resultForPatch =
        latestResultForPatch?.resultId === currentResult.resultId ? latestResultForPatch : currentResult;
      const nextClips = resultForPatch.clips.map((clip) =>
        clip.id === clipId || clip.cueId === clipId ? synthesizedClip : clip,
      );
      const savedResult = await patchNarrationResult(resultForPatch.resultId, {
        clips: nextClips,
        voiceId: storyboardEnabled ? null : unifiedVoiceId,
      });
      if (!savedResult) {
        throw new Error("台词音频结果写回失败");
      }

      const taskForPatch = getVideoTask(taskId) ?? task;
      const directorPlanForPatch = getTaskDirectorPlan(taskForPatch);
      const finalShotPlan =
        syncNarrationClipsIntoSubtitlePlan(
          taskForPatch.shotPlan,
          savedResult.clips,
          taskForPatch.parameters.video.videoType,
        ) ?? taskForPatch.shotPlan;
      const finalDraftBundle = {
        ...taskForPatch.draftBundle,
        narrationScript: usesSegmentLevelSubtitleSource(taskForPatch.parameters.video.videoType)
          ? buildNarrationScriptFromSubtitlePlan(finalShotPlan, taskForPatch.parameters.video.videoType)
          : buildNarrationScriptFromClips(savedResult.clips, taskForPatch.parameters.video.videoType) ||
            rewriteNarrationScriptWithClips(taskForPatch.draftBundle.narrationScript, savedResult.clips),
      };
      const finalDirectorPlan = buildDirectorPlanFromTaskData({
        draftBundle: finalDraftBundle,
        shotPlan: finalShotPlan,
        directorPlan: directorPlanForPatch,
        parameters: taskForPatch.parameters,
        forceRebuild: true,
      });
      const previousDirectorPlan = getTaskDirectorPlan(taskForPatch);
      const visualStructureChanged =
        buildStoryShotSignature(previousDirectorPlan) !== buildStoryShotSignature(finalDirectorPlan);
      if (!visualStructureChanged) {
        autoSelectRecommendedCandidates(taskId);
      }
      clearTaskClipAndCompositionOutputs(taskId);

      const selectedVisualShotCount = visualStructureChanged ? 0 : countSelectedVisualShots(taskId, finalDirectorPlan);
      const allVisualShotsSelected =
        !visualStructureChanged &&
        finalDirectorPlan.storyShots.length > 0 &&
        selectedVisualShotCount >= finalDirectorPlan.storyShots.length;
      const baseTask = patchVideoTask(taskId, {
        status: "CREATED",
        draftBundle: finalDraftBundle,
        shotPlan: finalShotPlan,
        directorPlan: finalDirectorPlan,
        stageTimestamps: {
          SUBTITLE_AUDIO_READY: undefined,
          IMAGES_READY: undefined,
          CLIPS_READY: undefined,
          COMPOSITION_READY: undefined,
        },
      });
      const validation = baseTask && savedResult ? validateNarrationResult(savedResult, baseTask) : null;
      const saveTaskAt = new Date().toISOString();
      const nextTask =
        validation?.passed && baseTask
          ? patchVideoTask(taskId, {
              status: allVisualShotsSelected ? "IMAGES_READY" : "SUBTITLE_AUDIO_READY",
              stageTimestamps: {
                SUBTITLE_AUDIO_READY: saveTaskAt,
                IMAGES_READY: allVisualShotsSelected ? saveTaskAt : undefined,
                CLIPS_READY: undefined,
                COMPOSITION_READY: undefined,
              },
            })
          : baseTask;
      const runtimePayload = loadLatestTaskSubtitleAudioPayload(taskId).runtime;

      if (validation && !validation.passed) {
        const errorMessages = validation.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join("；");
        return {
          task: nextTask,
          result: savedResult,
          validation,
          runtime: runtimePayload,
          updatedClipId: synthesizedClip.id,
          error: `字幕音频校验未通过：${errorMessages || "结果不完整"}`,
        };
      }

      return {
        task: nextTask,
        result: savedResult,
        validation,
        runtime: runtimePayload,
        updatedClipId: synthesizedClip.id,
      };
    },
  );
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

    const body = (await request.json().catch(() => ({}))) as GenerateSubtitleAudioRequest;
    const activeWorkflow = getActiveKeyMaterialWorkflow(taskId);
    const internalWorkflowId = request.headers.get("x-key-material-workflow-id")?.trim() || null;
    if (activeWorkflow && activeWorkflow.workflowId !== internalWorkflowId) {
      return NextResponse.json({ error: "关键素材生成中，请等待当前任务完成后再操作" }, { status: 409 });
    }
    return createProgressStream((onProgress) =>
      executeSubtitleAudioGeneration({
        taskId,
        task: getVideoTask(taskId) ?? access.task,
        body,
        userId: access.session.userId,
        routePath: "/api/video-tasks/[taskId]/subtitle-audio-run",
        onProgress,
      }),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成字幕音频失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const access = requireOwnedVideoTask(request, taskId, {
      forbiddenMessage: "无权修改该视频任务",
    });
    if ("response" in access) {
      return access.response;
    }

    const activeWorkflow = getActiveKeyMaterialWorkflow(taskId);
    if (activeWorkflow) {
      return NextResponse.json({ error: "关键素材生成中，请等待当前任务完成后再操作" }, { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as UpdateSubtitleAudioLineRequest;
    const payload = await executeSubtitleAudioLineUpdate({
      taskId,
      task: getVideoTask(taskId) ?? access.task,
      body,
      userId: access.session.userId,
      routePath: "/api/video-tasks/[taskId]/subtitle-audio-run",
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "修改台词失败" }, { status: 500 });
  }
}
