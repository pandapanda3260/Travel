"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveNarrationClipWordTimestamps } from "../../../../lib/audio-alignment";
import { PageBrandTitle } from "../../../_components/page-brand-title";
import { formatDurationSecondsLabel, formatTimelineSecondLabel } from "../../../../lib/duration-format";
import { estimateNarrationReadingSeconds, type AudioAlignment } from "../../../../lib/narration";
import {
  countSubtitlePlanTextEntries,
  getSegmentSubtitleEntry,
  usesSegmentLevelSubtitleSource,
} from "../../../../lib/subtitle-plan-source";
import {
  buildSubtitleDisplayUnits,
  normalizeSubtitleDisplayCues,
  type SubtitleDisplayCueInput,
} from "../../../../lib/subtitle-display";
import { resolveNarrationClipFullSemanticText } from "../../../../lib/subtitle-text-contract";
import {
  applyParameterSettingsToTaskCreationState,
  getDefaultParameterSettingsState,
  readParameterSettingsState,
} from "../../../../lib/parameter-settings";
import {
  resolveTaskSelectionAfterIndexReady,
  shouldAllowHotelAssetInputTaskEnsure,
  shouldDeferTaskIdUrlSync,
  shouldResumeTaskCreationDraft,
  shouldSyncTaskSelectionFromUrl,
} from "../../../../lib/task-creation-navigation";
import {
  audioFormatOptions,
  audioLoudnessRateOptions,
  audioSampleRateOptions,
  audioSpeechRateOptions,
  buildTaskCreationDraftKey,
  getDefaultTaskCreationParameterState,
  getTaskCreationExpectedDurationDefaults,
  getTaskCreationImageSizeForAspectRatio,
  getTaskCreationVideoTypeDefaults,
  hydrateTaskCreationParameterState,
  imageGuidanceOptions,
  imageSizeOptions,
  serializeTaskCreationParameterState,
  taskCreationVisibleVideoTypeOptions,
  videoAspectRatioOptions,
  videoCameraControlOptions,
  videoCfgScaleOptions,
  videoDurationOptions,
  videoExpectedDurationOptions,
  videoModeOptions,
  videoSegmentCountOptions,
  videoShotTypeOptions,
  videoTypeOptions,
  type TaskCreationParameterState,
} from "../../../../lib/task-creation-parameters";
import { ModuleStatusBadge, ModuleTitle, TaskNextStepButton, type TaskStepActionState } from "./task-ui";
import {
  type ClipPipelineSummary,
  type PipelineMetricItem,
  type PipelineStageRuntime,
  type VisualPipelineSummary,
} from "./pipeline-flow";
import { useTaskCreationIndexData } from "./task-creation-index-provider";
import { useStreamProgress } from "./use-stream-progress";
import { resolveTaskVoiceOptionLabel } from "../../../../lib/speaker-display-overrides";
import {
  directorPrimaryStepActionKeys,
  getDirectorPrimaryStepButtonLabel,
} from "../../../../lib/director-step-actions";
import {
  resolveDirectorUpstreamBlockedReason,
  resolveKeyMaterialActionRuntime,
} from "../../../../lib/director-action-runtime";
import {
  filterTaskStageProgressByTaskId,
  isTaskStageProgressRunning,
  taskStageProgressKeys,
  type TaskStageProgressKey,
  type TaskStageProgressPayload,
  type TaskStageProgressSnapshot,
} from "../../../../lib/task-stage-progress";
import {
  isVideoGenerationWorkflowRunning,
  videoGenerationStepKeys,
  type VideoGenerationWorkflowRecord,
} from "../../../../lib/video-generation-workflow";
import {
  getVideoTaskTypeProfile,
  getVideoTaskStatusIndex,
  getVideoTaskModuleStatusMeta,
  usesCapturedMaterialFirstWorkflow,
  type VideoTaskGeneratedVideoRecord,
  type VideoTaskRecord,
  type VideoTaskStatus,
  type TimedWord,
} from "../../../../lib/video-task-schema";
import {
  getDefaultVideoTypeForTaskCreationWorkflowMode,
  getTaskCreationWorkflowModeConfig,
  getTaskCreationWorkflowModeForVideoType,
  taskMatchesCreationWorkflowMode,
  type TaskCreationWorkflowMode,
} from "../../../../lib/task-creation-workflow-mode";
import { replaceGeneratedVideoRecord } from "../../../../lib/task-generated-video-state";
import { hasGeneratedShotPlanArtifacts } from "../../../../lib/video-task-generation-state";
import {
  mergeNumericSummaryState,
  mergeStructuredState,
  mergeTaskStepActionState,
  upsertTaskRecordIfChanged,
} from "../../../../lib/task-ui-state-sync";
import type { TaskCreationIndexPayload } from "../../../../lib/task-creation-index-data";
import type { TaskCreationVoiceOption } from "../../../../lib/task-creation-voice-options";

const VisualImageModule = dynamic(() => import("./visual-image-module").then((module) => module.VisualImageModule), {
  loading: () => <div className="task-module-empty">视觉图片模块加载中…</div>,
});

const GenerationTasksPanel = dynamic(
  () => import("./generation-tasks-panel").then((module) => module.GenerationTasksPanel),
  { loading: () => <div className="task-module-empty">任务列表加载中…</div> },
);

const PipelineFlow = dynamic(() => import("./pipeline-flow").then((module) => module.PipelineFlow), {
  loading: () => <div className="task-module-empty">工作流进度加载中…</div>,
});

const HotelAssetPanel = dynamic(() => import("./hotel-asset-panel").then((module) => module.HotelAssetPanel), {
  loading: () => <div className="task-module-empty">素材上传面板加载中…</div>,
});

const CompositionSettingsPanel = dynamic(
  () => import("./composition-settings-panel").then((module) => module.CompositionSettingsPanel),
  { loading: () => <div className="task-module-empty">字幕与背景音设置加载中…</div> },
);

const SubtitlePreviewPanel = dynamic(
  () => import("./subtitle-preview-panel").then((module) => module.SubtitlePreviewPanel),
  { loading: () => <div className="task-module-empty">字幕预览加载中…</div> },
);

const ClipGenerationModule = dynamic(
  () => import("./clip-generation-module").then((module) => module.ClipGenerationModule),
  { loading: () => <div className="task-module-empty">片段生成模块加载中…</div> },
);

const CompositionModule = dynamic(() => import("./composition-module").then((module) => module.CompositionModule), {
  loading: () => <div className="task-module-empty">视频合成模块加载中…</div>,
});

type TaskCreationVoiceOptionsPayload = {
  voiceOptions?: TaskCreationVoiceOption[];
  error?: string;
};

type TaskSubtitleAudioResult = {
  resultId: string;
  title: string;
  voiceId: string | null;
  subtitleSrtUrl: string | null;
  mergedAudioUrl: string | null;
  updatedAt: string;
  clips: Array<{
    id: string;
    shotIndex: number;
    segmentIndex?: number | null;
    startAtSeconds: number;
    durationSeconds: number;
    characterFocus: string;
    fullSemanticSentence?: string | null;
    subtitleText: string;
    narrationText: string;
    spokenText?: string | null;
    hasVoice?: boolean;
    hasSubtitle?: boolean;
    voiceId?: string | null;
    audioUrl?: string | null;
    audioDurationSeconds?: number | null;
    words?: TimedWord[];
    audioAlignment?: AudioAlignment | null;
    subtitleDisplayCues?: SubtitleDisplayCueInput[] | null;
  }>;
};

type KeyMaterialWorkflowStepKey = "subtitle_audio" | "visual_images";
type KeyMaterialWorkflowStatus = "pending" | "running" | "success" | "failed" | "partial_failed";
type KeyMaterialWorkflowStepStatus = "pending" | "running" | "success" | "failed";

type KeyMaterialWorkflowStep = {
  stepKey: KeyMaterialWorkflowStepKey;
  label: string;
  status: KeyMaterialWorkflowStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  errorMessage: string | null;
  retryCount: number;
  runId: string | null;
  carriedFromWorkflowId: string | null;
  output: {
    narrationResultId?: string | null;
    subtitleSrtUrl?: string | null;
    mergedAudioUrl?: string | null;
    generatedShotCount?: number | null;
    selectedShotCount?: number | null;
    validationPassed?: boolean | null;
  } | null;
};

type KeyMaterialWorkflowRecord = {
  workflowId: string;
  taskId: string;
  ownerUserId: string | null;
  requestId: string;
  mode: "run" | "retry_failed_step" | "retry_all";
  status: KeyMaterialWorkflowStatus;
  currentStepKey: KeyMaterialWorkflowStepKey | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryOfWorkflowId: string | null;
  lastError: string | null;
  steps: Record<KeyMaterialWorkflowStepKey, KeyMaterialWorkflowStep>;
};

type KeyMaterialWorkflowResponse = {
  taskId?: string;
  task?: VideoTaskRecord | null;
  workflow?: KeyMaterialWorkflowRecord | null;
  hasActiveWorkflow?: boolean;
  reused?: boolean;
  subtitle?: {
    result?: TaskSubtitleAudioResult | null;
    validation?: { passed?: boolean } | null;
    error?: string;
  };
  visual?: {
    shots?: Array<{ selectedCandidateId?: string | null }> | null;
    validation?: { passed?: boolean } | null;
    error?: string;
  };
  error?: string;
};

function formatRealPhotoShotAssetSource(input: {
  sourceTrace?: string | null;
  generationMode?: string | null;
  needsAiFallback?: boolean;
  referenceImageUrl?: string | null;
}) {
  if (input.needsAiFallback || input.generationMode === "ai_generated_broll" || input.sourceTrace === "ai_generated") {
    return "AI 补图";
  }
  switch (input.sourceTrace) {
    case "user_photo":
      return "用户上传";
    case "enhanced_from_user_photo":
      return "AI 增强";
    case "reference_video_keyframe":
      return "参考视频帧";
    default:
      return input.referenceImageUrl ? "已绑定素材" : "未绑定素材";
  }
}

type TaskShellResponse = {
  task?: VideoTaskRecord | null;
  generatedVideo?: VideoTaskGeneratedVideoRecord | null;
  error?: string;
};

type TaskSourceAutosavePayload = {
  title: string;
  productInfoId: string | null;
  productInfoTitle: string | null;
  productInfoSnapshot: string;
  userPrompt: string;
  optimizedUserPrompt: string;
  videoMaterialId: string | null;
  videoMaterialName: string | null;
  videoTemplatePrompt: string;
};

type TaskDraftAutosaveSnapshot = {
  taskId: string;
  fallbackTitle: string;
  sourcePayload: TaskSourceAutosavePayload;
  sourceDraftKey: string;
  selectedSourceDraftKey: string;
  parameterPayload: ReturnType<typeof buildTaskParameterPatchPayload>;
  parameterDraftKey: string;
  selectedParameterDraftKey: string;
  canSave: boolean;
};

type SubtitleAudioLineUpdateResponse = {
  task?: VideoTaskRecord | null;
  result?: TaskSubtitleAudioResult | null;
  validation?: { passed?: boolean } | null;
  updatedClipId?: string;
  error?: string;
};

type VideoGenerationWorkflowResponse = {
  task?: VideoTaskRecord | null;
  workflow?: VideoGenerationWorkflowRecord | null;
  hasActiveWorkflow?: boolean;
  reused?: boolean;
  result?: {
    compositionId: string;
    status: "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
    outputVideoUrl: string | null;
  } | null;
  error?: string;
};

const taskCreateDraftLegacyStorageKey = "task-creation-inline-draft";
type TaskCreateStatus = "idle" | "editing" | "created";
const taskDetailModules: Array<{
  title: string;
  targetStatus: VideoTaskStatus;
  placeholder: string;
  combinedMaterialWorkbench?: boolean;
}> = [
  {
    title: "第三步：台词配音生成",
    targetStatus: "SUBTITLE_AUDIO_READY",
    placeholder: "",
  },
  {
    title: "第四步：视觉图片生成",
    targetStatus: "IMAGES_READY",
    placeholder: "完成镜头规划后，这里会基于片段级视觉提示词生成参考图片，作为后续片段生成的主要输入。",
  },
  {
    title: "第五步：片段生成",
    targetStatus: "CLIPS_READY",
    placeholder: "完成音频/字幕和视觉图片生成后，这里会按输出片段规划组合素材与参数，生成视频片段。",
  },
  {
    title: "第六步：视频合成",
    targetStatus: "COMPOSITION_READY",
    placeholder: "完成片段生成后，这里会将片段拼接为完整视频，并统一处理转场与节奏。",
  },
];

function getTaskCreateStatusMeta(status: TaskCreateStatus, hasExistingTask = false) {
  switch (status) {
    case "created":
      return {
        label: "任务已创建",
        tone: "created" as const,
      };
    case "editing":
      return {
        label: hasExistingTask ? "信息修改中" : "信息输入中",
        tone: "editing" as const,
      };
    default:
      return {
        label: "任务未创建",
        tone: "idle" as const,
      };
  }
}

function getReadingCheckMeta(text: string, targetDurationSeconds: number) {
  const estimatedSeconds = estimateNarrationReadingSeconds(text);
  const overflowSeconds = Number((estimatedSeconds - targetDurationSeconds).toFixed(1));
  const isOvertime = overflowSeconds > Math.max(0.6, targetDurationSeconds * 0.12);

  return {
    estimatedSeconds,
    overflowSeconds,
    isOvertime,
  };
}

function getTaskCreateDraftStorageKey(mode: TaskCreationWorkflowMode | null | undefined) {
  return mode ? `${taskCreateDraftLegacyStorageKey}:${mode}` : taskCreateDraftLegacyStorageKey;
}

function getSubtitleAudioClipLineText(clip: TaskSubtitleAudioResult["clips"][number]) {
  return resolveNarrationClipFullSemanticText(clip);
}

function normalizeSubtitleAudioEditText(text: string) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.reduce((output, line) => {
    if (!output) {
      return line;
    }
    return /[。！？!?；;，,、]$/u.test(output) ? `${output}${line}` : `${output}，${line}`;
  }, "");
}

function parseSubtitleAudioDisplayCues(
  text: string,
  subtitleConfig: TaskCreationParameterState["compositionSubtitleConfig"],
) {
  const cueBlocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0)
    .map((lines) => ({
      text: lines.join(""),
      lines,
    }));

  return normalizeSubtitleDisplayCues(cueBlocks, subtitleConfig.maxCharsPerLine);
}

function getSubtitleDisplayCueSignature(cues: SubtitleDisplayCueInput[] | null | undefined) {
  return JSON.stringify(
    (cues ?? []).map((cue) => ({
      text: cue.text ?? "",
      lines: cue.lines ?? [],
    })),
  );
}

function buildSubtitleAudioDisplayUnits(
  clip: TaskSubtitleAudioResult["clips"][number],
  subtitleConfig: TaskCreationParameterState["compositionSubtitleConfig"],
) {
  const lineText = getSubtitleAudioClipLineText(clip);
  if (!lineText.trim()) {
    return [];
  }

  return buildSubtitleDisplayUnits({
    text: lineText,
    durationSeconds: clip.audioDurationSeconds ?? clip.durationSeconds,
    words: resolveNarrationClipWordTimestamps(clip),
    maxCharsPerLine: subtitleConfig.maxCharsPerLine,
    displayMode: subtitleConfig.displayMode,
    trimEstimatedTail: true,
    manualCues: clip.subtitleDisplayCues,
  });
}

function buildSubtitleAudioEditText(
  clip: TaskSubtitleAudioResult["clips"][number],
  subtitleConfig: TaskCreationParameterState["compositionSubtitleConfig"],
) {
  const displayText = buildSubtitleAudioDisplayUnits(clip, subtitleConfig)
    .map((unit) => unit.lines.join("\n"))
    .join("\n\n")
    .trim();
  return displayText || getSubtitleAudioClipLineText(clip);
}

function normalizeSupportedVoiceId(
  voiceId: string | null | undefined,
  supportedVoiceIds: Set<string>,
  fallbackVoiceId: string,
) {
  return voiceId && supportedVoiceIds.has(voiceId) ? voiceId : fallbackVoiceId;
}

function buildTaskParameterStateFromTask(task: VideoTaskRecord) {
  const defaults = getDefaultTaskCreationParameterState();
  return hydrateTaskCreationParameterState({
    imageSize: task.parameters.image.size,
    imageGuidanceScale: task.parameters.image.guidanceScale,
    imageWatermark: task.parameters.image.watermark,
    imageSeedMode: task.parameters.image.seed == null ? "random" : "fixed",
    imageSeedValue: task.parameters.image.seed == null ? defaults.imageSeedValue : String(task.parameters.image.seed),
    videoType: task.parameters.video.videoType,
    videoMode: task.parameters.video.mode,
    videoMultiShot: task.parameters.video.multiShot,
    videoShotType: task.parameters.video.shotType,
    videoEnableTailFrame: task.parameters.video.enableTailFrame,
    videoExpectedDurationRange: task.parameters.video.expectedDurationRange,
    videoSegmentCount: task.parameters.video.segmentCount,
    videoDurationSeconds: task.parameters.video.durationSeconds,
    videoAspectRatio: task.parameters.video.aspectRatio,
    videoCfgScale: task.parameters.video.cfgScale,
    videoCameraControl: task.parameters.video.cameraControl,
    videoGenerateAudio: task.parameters.video.generateAudio,
    videoWatermark: task.parameters.video.watermark,
    videoNegativePrompt: task.parameters.video.negativePrompt,
    audioStoryboardEnabled: task.parameters.audio.storyboardEnabled,
    audioVoiceId: task.parameters.audio.voiceId ?? defaults.audioVoiceId,
    audioStoryboardVoiceIds: task.parameters.audio.storyboardVoiceIds,
    audioFormat: task.parameters.audio.format,
    audioSampleRate: task.parameters.audio.sampleRate,
    audioSpeechRate: task.parameters.audio.speechRate,
    audioLoudnessRate: task.parameters.audio.loudnessRate,
    audioEnableSubtitle: task.parameters.audio.enableSubtitle,
    compositionIncludeBackgroundMusic: task.parameters.composition.includeBackgroundMusic,
    compositionBackgroundMusicUrl: task.parameters.composition.backgroundMusicUrl ?? "",
    compositionBackgroundMusicVolume:
      task.parameters.composition.backgroundMusicVolume ?? defaults.compositionBackgroundMusicVolume,
    compositionSubtitleConfig: task.parameters.composition.subtitleConfig,
  });
}

function buildTaskParameterPatchPayload(input: {
  imageSize: (typeof imageSizeOptions)[number]["value"];
  imageGuidanceScale: (typeof imageGuidanceOptions)[number]["value"];
  imageWatermark: boolean;
  imageSeedMode: "random" | "fixed";
  imageSeedValue: string;
  videoType: (typeof videoTypeOptions)[number]["value"];
  videoMode: (typeof videoModeOptions)[number]["value"];
  videoMultiShot: boolean;
  videoShotType: (typeof videoShotTypeOptions)[number]["value"];
  videoEnableTailFrame: boolean;
  videoExpectedDurationRange: (typeof videoExpectedDurationOptions)[number]["value"];
  videoSegmentCount: (typeof videoSegmentCountOptions)[number];
  videoDurationSeconds: (typeof videoDurationOptions)[number];
  videoAspectRatio: (typeof videoAspectRatioOptions)[number];
  videoCfgScale: (typeof videoCfgScaleOptions)[number];
  videoCameraControl: (typeof videoCameraControlOptions)[number]["value"];
  videoGenerateAudio: boolean;
  videoWatermark: boolean;
  videoNegativePrompt: string;
  audioStoryboardEnabled: boolean;
  audioVoiceId: string;
  audioStoryboardVoiceIds: string[];
  audioFormat: (typeof audioFormatOptions)[number]["value"];
  audioSampleRate: (typeof audioSampleRateOptions)[number]["value"];
  audioSpeechRate: (typeof audioSpeechRateOptions)[number]["value"];
  audioLoudnessRate: (typeof audioLoudnessRateOptions)[number]["value"];
  audioEnableSubtitle: boolean;
  compositionIncludeBackgroundMusic: boolean;
  compositionBackgroundMusicUrl: string;
  compositionBackgroundMusicVolume: TaskCreationParameterState["compositionBackgroundMusicVolume"];
  compositionSubtitleConfig: TaskCreationParameterState["compositionSubtitleConfig"];
}) {
  return {
    imageSize: input.imageSize,
    imageGuidanceScale: input.imageGuidanceScale,
    imageWatermark: input.imageWatermark,
    imageSeedMode: input.imageSeedMode,
    imageSeedValue: input.imageSeedValue,
    videoType: input.videoType,
    videoMode: input.videoMode,
    videoMultiShot: input.videoMultiShot,
    videoShotType: input.videoShotType,
    videoEnableTailFrame: input.videoEnableTailFrame,
    videoExpectedDurationRange: input.videoExpectedDurationRange,
    videoSegmentCount: input.videoSegmentCount,
    videoDurationSeconds: input.videoDurationSeconds,
    videoAspectRatio: input.videoAspectRatio,
    videoCfgScale: input.videoCfgScale,
    videoCameraControl: input.videoCameraControl,
    videoGenerateAudio: input.videoGenerateAudio,
    videoWatermark: input.videoWatermark,
    videoNegativePrompt: input.videoNegativePrompt,
    audioStoryboardEnabled: input.audioStoryboardEnabled,
    audioVoiceId: input.audioVoiceId,
    audioStoryboardVoiceIds: input.audioStoryboardVoiceIds,
    audioFormat: input.audioFormat,
    audioSampleRate: input.audioSampleRate,
    audioSpeechRate: input.audioSpeechRate,
    audioLoudnessRate: input.audioLoudnessRate,
    audioEnableSubtitle: input.audioEnableSubtitle,
    compositionIncludeBackgroundMusic: input.compositionIncludeBackgroundMusic,
    compositionBackgroundMusicUrl: input.compositionBackgroundMusicUrl,
    compositionBackgroundMusicVolume: input.compositionBackgroundMusicVolume,
    compositionSubtitleConfig: input.compositionSubtitleConfig,
  };
}

function buildTaskParameterDraftKeyFromPayload(parameters: ReturnType<typeof buildTaskParameterPatchPayload>) {
  return buildTaskCreationDraftKey({
    ...getDefaultTaskCreationParameterState(),
    ...parameters,
  });
}

function buildTaskCreationDraftKeyFromTask(task: VideoTaskRecord) {
  return buildTaskCreationDraftKey({
    ...getDefaultTaskCreationParameterState(),
    ...buildTaskParameterStateFromTask(task),
    taskTitle: task.title,
    selectedProductId: task.source.productInfoId ?? "",
    userPrompt: task.source.userPrompt,
    optimizedUserPrompt: task.source.optimizedUserPrompt ?? "",
    videoMaterialId: task.source.videoMaterialId ?? "",
  });
}

function sortTasksByCreatedAtDesc(tasks: VideoTaskRecord[]) {
  return [...tasks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function getDefaultTaskCreationStateForWorkflowMode(mode: TaskCreationWorkflowMode | null | undefined) {
  const defaults = getDefaultTaskCreationParameterState();
  const videoType = getDefaultVideoTypeForTaskCreationWorkflowMode(mode);
  if (videoType === defaults.videoType) {
    return defaults;
  }

  const videoDefaults = getTaskCreationVideoTypeDefaults(videoType);
  const durationDefaults = getTaskCreationExpectedDurationDefaults(defaults.videoExpectedDurationRange, videoType);

  return {
    ...defaults,
    ...durationDefaults,
    videoType,
    videoMultiShot: videoDefaults.videoMultiShot,
    videoShotType: videoDefaults.videoShotType,
    videoEnableTailFrame: videoDefaults.videoEnableTailFrame,
    videoGenerateAudio: videoDefaults.videoGenerateAudio,
    constraintPreset: videoDefaults.constraintPreset as TaskCreationParameterState["constraintPreset"],
  };
}

function normalizeTaskCreationStateForWorkflowMode(
  state: TaskCreationParameterState,
  mode: TaskCreationWorkflowMode | null | undefined,
) {
  if (!mode || getTaskCreationWorkflowModeForVideoType(state.videoType) === mode) {
    return state;
  }

  const defaults = getDefaultTaskCreationStateForWorkflowMode(mode);
  return {
    ...state,
    videoType: defaults.videoType,
    videoMultiShot: defaults.videoMultiShot,
    videoShotType: defaults.videoShotType,
    videoEnableTailFrame: defaults.videoEnableTailFrame,
    videoExpectedDurationRange: defaults.videoExpectedDurationRange,
    videoSegmentCount: defaults.videoSegmentCount,
    videoDurationSeconds: defaults.videoDurationSeconds,
    videoGenerateAudio: defaults.videoGenerateAudio,
    constraintPreset: defaults.constraintPreset,
  };
}

function upsertTaskRecord(current: VideoTaskRecord[], nextTask: VideoTaskRecord) {
  return upsertTaskRecordIfChanged(current, nextTask);
}

function mapTaskVoiceOptions(rawVoiceOptions: TaskCreationVoiceOption[]) {
  return rawVoiceOptions.map((item) => ({
    ...item,
    label: resolveTaskVoiceOptionLabel(item),
  }));
}

function scheduleAfterInitialPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  const browserWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

  if (browserWindow.requestIdleCallback) {
    const idleHandle = browserWindow.requestIdleCallback(callback, { timeout: 900 });
    return () => {
      browserWindow.cancelIdleCallback?.(idleHandle);
    };
  }

  const timeoutHandle = globalThis.setTimeout(callback, 120);
  return () => {
    globalThis.clearTimeout(timeoutHandle);
  };
}

function getStoryboardVoiceSlotCount(input: { selectedTask: VideoTaskRecord | null; fallbackSegmentCount: number }) {
  if (!input.selectedTask) {
    return Math.max(1, input.fallbackSegmentCount);
  }

  return Math.max(
    1,
    input.selectedTask.directorPlan?.storyShots?.length ??
      input.selectedTask.parameters?.video?.storyShotCount ??
      input.selectedTask.shotPlan?.shots?.length ??
      input.fallbackSegmentCount,
  );
}

function buildTaskSourceDraftKey(input: {
  title: string;
  productInfoId: string | null;
  productInfoTitle: string | null;
  productInfoSnapshot: string;
  userPrompt: string;
  optimizedUserPrompt: string;
  videoMaterialId: string | null;
}) {
  return JSON.stringify({
    title: input.title,
    productInfoId: input.productInfoId,
    productInfoTitle: input.productInfoTitle,
    productInfoSnapshot: input.productInfoSnapshot,
    userPrompt: input.userPrompt,
    optimizedUserPrompt: input.optimizedUserPrompt,
    videoMaterialId: input.videoMaterialId ?? "",
  });
}

function isKeyMaterialWorkflowActive(workflow: KeyMaterialWorkflowRecord | null | undefined) {
  return workflow?.status === "pending" || workflow?.status === "running";
}

function resolveKeyMaterialFailedStep(
  workflow: KeyMaterialWorkflowRecord | null | undefined,
): KeyMaterialWorkflowStepKey | null {
  if (!workflow) {
    return null;
  }
  if (workflow.steps.subtitle_audio.status === "failed") {
    return "subtitle_audio";
  }
  if (workflow.steps.visual_images.status === "failed") {
    return "visual_images";
  }
  return null;
}

type TaskCreationIndexPageProps = {
  workflowMode?: TaskCreationWorkflowMode | null;
};

export function TaskCreationWorkflowPage({ workflowMode = null }: TaskCreationIndexPageProps = {}) {
  const initialIndexData = useTaskCreationIndexData();
  const workflowModeConfig = workflowMode ? getTaskCreationWorkflowModeConfig(workflowMode) : null;
  const taskCreateDraftStorageKey = useMemo(() => getTaskCreateDraftStorageKey(workflowMode), [workflowMode]);
  const defaultTaskCreationState = useMemo(
    () => getDefaultTaskCreationStateForWorkflowMode(workflowMode),
    [workflowMode],
  );
  const pageLoadErrorMessage = `${workflowModeConfig?.label ?? "任务创建"}页面加载失败`;
  const [systemParameterSettings, setSystemParameterSettings] = useState(getDefaultParameterSettingsState);
  const [tasks, setTasks] = useState<VideoTaskRecord[]>(() => sortTasksByCreatedAtDesc(initialIndexData?.tasks ?? []));
  const [generatedVideos, setGeneratedVideos] = useState<VideoTaskGeneratedVideoRecord[]>(
    () => initialIndexData?.generatedVideos ?? [],
  );
  const [isTaskIndexReady, setIsTaskIndexReady] = useState(() => Boolean(initialIndexData));
  const [highlightedTaskId, setHighlightedTaskId] = useState("");
  const [productOptions, setProductOptions] = useState<TaskCreationIndexPayload["productOptions"]>(
    () => initialIndexData?.productOptions ?? [],
  );
  const [referenceVideoMaterialOptions, setReferenceVideoMaterialOptions] = useState<
    TaskCreationIndexPayload["referenceVideoMaterialOptions"]
  >(() => initialIndexData?.referenceVideoMaterialOptions ?? []);
  const [selectedTaskId, setSelectedTaskId] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return new URLSearchParams(window.location.search).get("taskId") ?? "";
  });
  const [isNewTaskDraftMode, setIsNewTaskDraftMode] = useState(false);
  const [createTaskTitle, setCreateTaskTitle] = useState("");
  const [createSelectedProductId, setCreateSelectedProductId] = useState("");
  const [createUserPrompt, setCreateUserPrompt] = useState("");
  const [createOptimizedUserPrompt, setCreateOptimizedUserPrompt] = useState("");
  const [isOptimizingUserPrompt, setIsOptimizingUserPrompt] = useState(false);
  const [promptOptimizationMessage, setPromptOptimizationMessage] = useState("");
  const [createVideoMaterialId, setCreateVideoMaterialId] = useState("");
  const [imageSize, setImageSize] = useState<(typeof imageSizeOptions)[number]["value"]>(
    defaultTaskCreationState.imageSize,
  );
  const [imageGuidanceScale, setImageGuidanceScale] = useState<(typeof imageGuidanceOptions)[number]["value"]>(
    defaultTaskCreationState.imageGuidanceScale,
  );
  const [imageWatermark, setImageWatermark] = useState(defaultTaskCreationState.imageWatermark);
  const [imageSeedMode, setImageSeedMode] = useState<"random" | "fixed">(defaultTaskCreationState.imageSeedMode);
  const [imageSeedValue, setImageSeedValue] = useState(defaultTaskCreationState.imageSeedValue);
  const [videoType, setVideoType] = useState<(typeof videoTypeOptions)[number]["value"]>(
    defaultTaskCreationState.videoType,
  );
  const [videoMode, setVideoMode] = useState<(typeof videoModeOptions)[number]["value"]>(
    defaultTaskCreationState.videoMode,
  );
  const [videoMultiShot, setVideoMultiShot] = useState(defaultTaskCreationState.videoMultiShot);
  const [videoShotType, setVideoShotType] = useState<(typeof videoShotTypeOptions)[number]["value"]>(
    defaultTaskCreationState.videoShotType,
  );
  const [videoEnableTailFrame, setVideoEnableTailFrame] = useState(defaultTaskCreationState.videoEnableTailFrame);
  const [videoExpectedDurationRange, setVideoExpectedDurationRange] = useState<
    (typeof videoExpectedDurationOptions)[number]["value"]
  >(defaultTaskCreationState.videoExpectedDurationRange);
  const [videoSegmentCount, setVideoSegmentCount] = useState<(typeof videoSegmentCountOptions)[number]>(
    defaultTaskCreationState.videoSegmentCount,
  );
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<(typeof videoDurationOptions)[number]>(
    defaultTaskCreationState.videoDurationSeconds,
  );
  const [videoAspectRatio, setVideoAspectRatio] = useState<(typeof videoAspectRatioOptions)[number]>(
    defaultTaskCreationState.videoAspectRatio,
  );
  const [videoCfgScale, setVideoCfgScale] = useState<(typeof videoCfgScaleOptions)[number]>(
    defaultTaskCreationState.videoCfgScale,
  );
  const [videoCameraControl, setVideoCameraControl] = useState<(typeof videoCameraControlOptions)[number]["value"]>(
    defaultTaskCreationState.videoCameraControl,
  );
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(defaultTaskCreationState.videoGenerateAudio);
  const [videoWatermark, setVideoWatermark] = useState(defaultTaskCreationState.videoWatermark);
  const [videoNegativePrompt, setVideoNegativePrompt] = useState(defaultTaskCreationState.videoNegativePrompt);
  const [audioVoiceOptions, setAudioVoiceOptions] = useState<
    Array<{ label: string; value: string; description?: string }>
  >([]);
  const [audioVoiceOptionLoadStatus, setAudioVoiceOptionLoadStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [audioStoryboardEnabled, setAudioStoryboardEnabled] = useState(false);
  const [audioVoiceId, setAudioVoiceId] = useState<string>(defaultTaskCreationState.audioVoiceId);
  const [audioStoryboardVoiceIds, setAudioStoryboardVoiceIds] = useState<string[]>([]);
  const [audioFormat, setAudioFormat] = useState<(typeof audioFormatOptions)[number]["value"]>(
    defaultTaskCreationState.audioFormat,
  );
  const [audioSampleRate, setAudioSampleRate] = useState<(typeof audioSampleRateOptions)[number]["value"]>(
    defaultTaskCreationState.audioSampleRate,
  );
  const [audioSpeechRate, setAudioSpeechRate] = useState<(typeof audioSpeechRateOptions)[number]["value"]>(
    defaultTaskCreationState.audioSpeechRate,
  );
  const [audioLoudnessRate, setAudioLoudnessRate] = useState<(typeof audioLoudnessRateOptions)[number]["value"]>(
    defaultTaskCreationState.audioLoudnessRate,
  );
  const [audioEnableSubtitle, setAudioEnableSubtitle] = useState(defaultTaskCreationState.audioEnableSubtitle);
  const [compositionIncludeBackgroundMusic, setCompositionIncludeBackgroundMusic] = useState(
    defaultTaskCreationState.compositionIncludeBackgroundMusic,
  );
  const [compositionBackgroundMusicUrl, setCompositionBackgroundMusicUrl] = useState(
    defaultTaskCreationState.compositionBackgroundMusicUrl,
  );
  const [compositionBackgroundMusicVolume, setCompositionBackgroundMusicVolume] = useState(
    defaultTaskCreationState.compositionBackgroundMusicVolume,
  );
  const [compositionSubtitleConfig, setCompositionSubtitleConfig] = useState(
    defaultTaskCreationState.compositionSubtitleConfig,
  );
  const [constraintPreset, setConstraintPreset] = useState<TaskCreationParameterState["constraintPreset"]>(
    defaultTaskCreationState.constraintPreset,
  );
  const [constraintCustomRules, setConstraintCustomRules] = useState<string>("");
  const [voiceValidationStatus, setVoiceValidationStatus] = useState<"idle" | "validating" | "valid" | "invalid">(
    "idle",
  );
  const [voiceValidationError, setVoiceValidationError] = useState<string | null>(null);
  const voiceValidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceFailCountRef = useRef<{ count: number; firstFailAt: number }>({ count: 0, firstFailAt: 0 });
  const [lastCreatedDraftKey, setLastCreatedDraftKey] = useState("");
  const [lastSelectedTaskId, setLastSelectedTaskId] = useState("");
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const createStreamProgress = useStreamProgress();
  const [isGeneratingKeyMaterials, setIsGeneratingKeyMaterials] = useState(false);
  const keyMaterialStreamProgress = useStreamProgress();
  const keyMaterialProgress = keyMaterialStreamProgress.progress;
  const readKeyMaterialStream = keyMaterialStreamProgress.readStream;
  const resetKeyMaterialStream = keyMaterialStreamProgress.reset;
  const videoGenerationStreamProgress = useStreamProgress();
  const videoGenerationProgress = videoGenerationStreamProgress.progress;
  const readVideoGenerationStream = videoGenerationStreamProgress.readStream;
  const resetVideoGenerationStream = videoGenerationStreamProgress.reset;
  const [subtitleAudioResult, setSubtitleAudioResult] = useState<TaskSubtitleAudioResult | null>(null);
  const [isSubtitleAudioPanelOpen, setIsSubtitleAudioPanelOpen] = useState(true);
  const [editingSubtitleAudioClipId, setEditingSubtitleAudioClipId] = useState<string | null>(null);
  const [editingSubtitleAudioLineText, setEditingSubtitleAudioLineText] = useState("");
  const [savingSubtitleAudioClipIds, setSavingSubtitleAudioClipIds] = useState<string[]>([]);
  const [subtitleAudioLoadStatus, setSubtitleAudioLoadStatus] = useState<
    "idle" | "loading" | "success" | "empty" | "error"
  >("idle");
  const [selectedTaskStageProgress, setSelectedTaskStageProgress] = useState<
    Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>
  >({});
  const [selectedTaskStageProgressLoadStatus, setSelectedTaskStageProgressLoadStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [keyMaterialWorkflow, setKeyMaterialWorkflow] = useState<KeyMaterialWorkflowRecord | null>(null);
  const [videoGenerationWorkflow, setVideoGenerationWorkflow] = useState<VideoGenerationWorkflowRecord | null>(null);
  const [keyMaterialLoadStatus, setKeyMaterialLoadStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [videoGenerationLoadStatus, setVideoGenerationLoadStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [visualPrimaryAction, setVisualPrimaryAction] = useState<TaskStepActionState | null>(null);
  const [clipPrimaryAction, setClipPrimaryAction] = useState<TaskStepActionState | null>(null);
  const [compositionPrimaryAction, setCompositionPrimaryAction] = useState<TaskStepActionState | null>(null);
  const [visualPipelineSummary, setVisualPipelineSummary] = useState<VisualPipelineSummary | null>(null);
  const [clipPipelineSummary, setClipPipelineSummary] = useState<ClipPipelineSummary | null>(null);
  const [hotelAssetCount, setHotelAssetCount] = useState(0);
  const [, setLipSyncReady] = useState(false);
  const [mergeTaskSourceFromSelectedTask, setMergeTaskSourceFromSelectedTask] = useState(true);
  const firstStepSectionRef = useRef<HTMLElement | null>(null);
  const highlightTaskTimerRef = useRef<number | null>(null);
  const previousSelectedTaskIdRef = useRef("");
  const lastTaskShellSnapshotRefreshRef = useRef<Record<string, string>>({});
  const isApplyingSelectedTaskSourceRef = useRef(false);
  const lastPersistedTaskSourceDraftKeyRef = useRef("");
  const taskSourceSaveInFlightRef = useRef("");
  const isApplyingSelectedTaskParametersRef = useRef(false);
  const lastPersistedTaskParameterDraftKeyRef = useRef("");
  const parameterSaveInFlightRef = useRef("");
  const editingSubtitleAudioClipIdRef = useRef<string | null>(null);
  const savingSubtitleAudioClipIdsRef = useRef<Set<string>>(new Set());
  const subtitleAudioLineSaveInFlightRef = useRef<Set<string>>(new Set());
  const skipSubtitleAudioBlurCommitRef = useRef(false);
  const videoGenerationContinueInFlightRef = useRef("");
  const videoGenerationFailInFlightRef = useRef("");
  const videoGenerationClipKickoffRef = useRef("");
  const createInputDraftTaskInFlightRef = useRef<Promise<VideoTaskRecord | null> | null>(null);
  const ensureHotelAssetInputTaskInFlightRef = useRef<Promise<string | null> | null>(null);
  const explicitNewTaskDraftModeRef = useRef(false);
  const latestTaskDraftAutosaveRef = useRef<TaskDraftAutosaveSnapshot | null>(null);
  const visibleTasks = useMemo(
    () => (workflowMode ? tasks.filter((task) => taskMatchesCreationWorkflowMode(task, workflowMode)) : tasks),
    [tasks, workflowMode],
  );
  const visibleTaskIdList = useMemo(() => visibleTasks.map((task) => task.taskId), [visibleTasks]);
  const visibleTaskIds = useMemo(() => new Set(visibleTaskIdList), [visibleTaskIdList]);
  const visibleGeneratedVideos = useMemo(
    () => (workflowMode ? generatedVideos.filter((item) => visibleTaskIds.has(item.taskId)) : generatedVideos),
    [generatedVideos, visibleTaskIds, workflowMode],
  );
  const selectedTask = isNewTaskDraftMode
    ? null
    : (visibleTasks.find((task) => task.taskId === selectedTaskId) ?? null);
  const selectedProductOption = productOptions.find((item) => item.id === createSelectedProductId) ?? null;
  const selectedReferenceVideoMaterialOption =
    referenceVideoMaterialOptions.find((item) => item.materialId === createVideoMaterialId) ?? null;
  const storyboardPlan = selectedTask?.shotPlan?.storyboard ?? selectedTask?.directorPlan?.storyboard ?? null;
  const storyboardSummary = useMemo(() => {
    if (!storyboardPlan) {
      return null;
    }

    return {
      boundMaterialCount: storyboardPlan.materialIntents.filter((asset) => asset.mappedShotIndexes.length > 0).length,
    };
  }, [storyboardPlan]);
  const storyboardBindingByShotIndex = useMemo(
    () => new Map((storyboardPlan?.shotBindings ?? []).map((binding) => [binding.shotIndex, binding])),
    [storyboardPlan],
  );
  const subtitlePreviewMaterials = useMemo(
    () =>
      (selectedTask?.directorPlan?.storyShots ?? []).map((shot) => ({
        segmentId: shot.segmentId,
        segmentIndex: shot.segmentIndex,
        shotIndex: shot.shotIndex,
        subtitleText: shot.subtitleText,
        narrationText: shot.narrationText,
        durationSeconds: shot.durationSeconds,
      })),
    [selectedTask?.directorPlan?.storyShots],
  );

  const selectedTaskIdForHashScroll = selectedTask?.taskId ?? "";
  const handleSelectedTaskStageProgressChange = useCallback(
    (next: Partial<Record<TaskStageProgressKey, TaskStageProgressSnapshot>>) => {
      setSelectedTaskStageProgress((current) => mergeStructuredState(current, next));
    },
    [],
  );

  const handleKeyMaterialWorkflowChange = useCallback((next: KeyMaterialWorkflowRecord | null) => {
    setKeyMaterialWorkflow((current) => mergeStructuredState(current, next));
  }, []);

  const handleVideoGenerationWorkflowChange = useCallback((next: VideoGenerationWorkflowRecord | null) => {
    setVideoGenerationWorkflow((current) => mergeStructuredState(current, next));
  }, []);

  const handleSubtitleAudioResultChange = useCallback((next: TaskSubtitleAudioResult | null) => {
    setSubtitleAudioResult((current) => mergeStructuredState(current, next));
  }, []);

  function setSubtitleAudioClipSaving(clipId: string, saving: boolean) {
    const next = new Set(savingSubtitleAudioClipIdsRef.current);
    if (saving) {
      next.add(clipId);
    } else {
      next.delete(clipId);
    }
    savingSubtitleAudioClipIdsRef.current = next;
    setSavingSubtitleAudioClipIds(Array.from(next));
  }

  const loadSelectedTaskStageProgress = useCallback(
    async (silently = false) => {
      if (!selectedTaskIdForHashScroll) {
        handleSelectedTaskStageProgressChange({});
        setSelectedTaskStageProgressLoadStatus("idle");
        return null;
      }

      if (!silently) {
        setSelectedTaskStageProgressLoadStatus("loading");
      }
      const response = await fetch(`/api/video-tasks/${selectedTaskIdForHashScroll}/stage-progress`, {
        cache: "no-store",
      });
      const data = (await response.json()) as TaskStageProgressPayload & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "任务阶段进度加载失败");
      }
      handleSelectedTaskStageProgressChange(data.stages ?? {});
      setSelectedTaskStageProgressLoadStatus("success");
      return data.stages ?? {};
    },
    [handleSelectedTaskStageProgressChange, selectedTaskIdForHashScroll],
  );

  const applyTaskShellResponse = useCallback((data: TaskShellResponse, fallbackTaskId?: string | null) => {
    if (data.task) {
      const nextTask = data.task;
      setTasks((current) => upsertTaskRecord(current, nextTask));
    }

    const taskId = data.task?.taskId ?? fallbackTaskId ?? null;
    if (!taskId) {
      return;
    }

    setGeneratedVideos((current) => replaceGeneratedVideoRecord(current, taskId, data.generatedVideo ?? null));
  }, []);

  const handleVisualPrimaryActionChange = useCallback((next: TaskStepActionState | null) => {
    setVisualPrimaryAction((current) => mergeTaskStepActionState(current, next));
  }, []);

  const handleClipPrimaryActionChange = useCallback((next: TaskStepActionState | null) => {
    setClipPrimaryAction((current) => mergeTaskStepActionState(current, next));
  }, []);

  const handleCompositionPrimaryActionChange = useCallback((next: TaskStepActionState | null) => {
    setCompositionPrimaryAction((current) => mergeTaskStepActionState(current, next));
  }, []);

  const handleVisualPipelineSummaryChange = useCallback((next: VisualPipelineSummary | null) => {
    setVisualPipelineSummary((current) => mergeNumericSummaryState(current, next));
  }, []);

  const handleClipPipelineSummaryChange = useCallback((next: ClipPipelineSummary | null) => {
    setClipPipelineSummary((current) => mergeNumericSummaryState(current, next));
  }, []);

  const loadTaskShellSnapshot = useCallback(
    async (taskId: string) => {
      if (!taskId) {
        return null;
      }

      const response = await fetch(`/api/video-tasks/${taskId}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as TaskShellResponse;
      if (!response.ok || !data.task) {
        throw new Error(data.error ?? "视频任务详情加载失败");
      }

      applyTaskShellResponse(data, taskId);
      return data.task;
    },
    [applyTaskShellResponse],
  );

  const loadSelectedTaskSnapshot = useCallback(async () => {
    if (!selectedTaskIdForHashScroll) {
      return null;
    }

    return loadTaskShellSnapshot(selectedTaskIdForHashScroll);
  }, [loadTaskShellSnapshot, selectedTaskIdForHashScroll]);

  const loadKeyMaterialWorkflow = useCallback(
    async (silently = false) => {
      if (!selectedTaskIdForHashScroll) {
        handleKeyMaterialWorkflowChange(null);
        setKeyMaterialLoadStatus("idle");
        return null;
      }

      if (!silently) {
        setKeyMaterialLoadStatus("loading");
      }

      const response = await fetch(`/api/video-tasks/${selectedTaskIdForHashScroll}/key-materials`, {
        cache: "no-store",
      });
      const data = (await response.json()) as KeyMaterialWorkflowResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "关键素材任务状态加载失败");
      }

      if (data.task) {
        const nextTask = data.task;
        setTasks((current) => upsertTaskRecord(current, nextTask));
      }

      handleKeyMaterialWorkflowChange(data.workflow ?? null);
      setKeyMaterialLoadStatus("success");
      return data.workflow ?? null;
    },
    [handleKeyMaterialWorkflowChange, selectedTaskIdForHashScroll],
  );

  const loadVideoGenerationWorkflow = useCallback(
    async (silently = false) => {
      if (!selectedTaskIdForHashScroll) {
        handleVideoGenerationWorkflowChange(null);
        setVideoGenerationLoadStatus("idle");
        return null;
      }

      if (!silently) {
        setVideoGenerationLoadStatus("loading");
      }

      const response = await fetch(`/api/video-tasks/${selectedTaskIdForHashScroll}/video-generation`, {
        cache: "no-store",
      });
      const data = (await response.json()) as VideoGenerationWorkflowResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "视频生成任务状态加载失败");
      }

      if (data.task) {
        setTasks((current) => upsertTaskRecord(current, data.task!));
      }

      handleVideoGenerationWorkflowChange(data.workflow ?? null);
      setVideoGenerationLoadStatus("success");
      return data.workflow ?? null;
    },
    [handleVideoGenerationWorkflowChange, selectedTaskIdForHashScroll],
  );

  const loadSubtitleAudioResult = useCallback(
    async (silently = false) => {
      if (!selectedTaskIdForHashScroll) {
        handleSubtitleAudioResultChange(null);
        setSubtitleAudioLoadStatus("idle");
        return null;
      }

      if (!silently) {
        setSubtitleAudioLoadStatus("loading");
      }

      const response = await fetch(`/api/video-tasks/${selectedTaskIdForHashScroll}/subtitle-audio-run`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        task?: VideoTaskRecord | null;
        result?: TaskSubtitleAudioResult | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "字幕音频结果加载失败");
      }

      if (data.task) {
        const nextTask = data.task;
        setTasks((current) => upsertTaskRecord(current, nextTask));
      }

      handleSubtitleAudioResultChange(data.result ?? null);
      setSubtitleAudioLoadStatus(data.result ? "success" : "empty");
      return data.result ?? null;
    },
    [handleSubtitleAudioResultChange, selectedTaskIdForHashScroll],
  );

  useEffect(() => {
    if (!initialIndexData) {
      return;
    }

    startTransition(() => {
      setTasks(sortTasksByCreatedAtDesc(initialIndexData.tasks));
      setGeneratedVideos(initialIndexData.generatedVideos ?? []);
      setProductOptions(initialIndexData.productOptions ?? []);
      setReferenceVideoMaterialOptions(initialIndexData.referenceVideoMaterialOptions ?? []);
      setIsTaskIndexReady(true);
    });
  }, [initialIndexData]);

  useEffect(() => {
    setVisualPipelineSummary(null);
    setClipPipelineSummary(null);
  }, [selectedTask?.taskId]);

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      try {
        const stages = await loadSelectedTaskStageProgress();
        if (!isActive || stages == null) {
          return;
        }
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        handleSelectedTaskStageProgressChange({});
        setSelectedTaskStageProgressLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "任务阶段进度加载失败"));
      }
    };

    const cancelDeferredRun = scheduleAfterInitialPaint(() => {
      void run();
    });

    return () => {
      isActive = false;
      cancelDeferredRun();
    };
  }, [handleSelectedTaskStageProgressChange, loadSelectedTaskStageProgress]);

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      try {
        await loadKeyMaterialWorkflow();
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        handleKeyMaterialWorkflowChange(null);
        setKeyMaterialLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "关键素材任务状态加载失败"));
      }
    };

    const cancelDeferredRun = scheduleAfterInitialPaint(() => {
      void run();
    });

    return () => {
      isActive = false;
      cancelDeferredRun();
    };
  }, [handleKeyMaterialWorkflowChange, loadKeyMaterialWorkflow]);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#shot-plan-detail-entry") {
      return;
    }

    let isCancelled = false;
    let attemptCount = 0;
    const maxAttemptCount = 30;

    const scrollToShotPlanEntry = () => {
      if (isCancelled || window.location.hash !== "#shot-plan-detail-entry") {
        return;
      }

      const target = document.getElementById("shot-plan-detail-entry");
      if (!target) {
        attemptCount += 1;
        if (attemptCount <= maxAttemptCount) {
          window.setTimeout(scrollToShotPlanEntry, 100);
        }
        return;
      }

      target.scrollIntoView({ block: "center", behavior: "smooth" });

      // 定位完成后清掉 hash，避免后续刷新或状态切换时重复跳转。
      const currentUrl = new URL(window.location.href);
      currentUrl.hash = "";
      window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}`);
    };

    window.requestAnimationFrame(scrollToShotPlanEntry);

    return () => {
      isCancelled = true;
    };
  }, [selectedTask?.taskId]);

  const storyboardVoiceSlotCount = useMemo(
    () =>
      getStoryboardVoiceSlotCount({
        selectedTask,
        fallbackSegmentCount: videoSegmentCount,
      }),
    [selectedTask, videoSegmentCount],
  );
  const videoTypeProfile = useMemo(() => getVideoTaskTypeProfile(videoType), [videoType]);
  const selectedExpectedDurationOption =
    videoExpectedDurationOptions.find((option) => option.value === videoExpectedDurationRange) ?? null;
  const modeVisibleVideoTypeOptions = useMemo(() => {
    if (!workflowMode) {
      return taskCreationVisibleVideoTypeOptions;
    }

    const filteredOptions = taskCreationVisibleVideoTypeOptions.filter(
      (option) => getTaskCreationWorkflowModeForVideoType(option.value) === workflowMode,
    );
    return filteredOptions.length ? filteredOptions : taskCreationVisibleVideoTypeOptions;
  }, [workflowMode]);
  const taskCreationVideoTypeOptions = useMemo(() => {
    const currentOption = videoTypeOptions.find((option) => option.value === videoType) ?? null;
    if (!currentOption || modeVisibleVideoTypeOptions.some((option) => option.value === currentOption.value)) {
      return modeVisibleVideoTypeOptions;
    }

    return [
      ...modeVisibleVideoTypeOptions,
      {
        ...currentOption,
        label: `${currentOption.label}（已隐藏）`,
      },
    ];
  }, [modeVisibleVideoTypeOptions, videoType]);

  function applyExpectedDurationRangePreset(
    nextRange: (typeof videoExpectedDurationOptions)[number]["value"],
    nextVideoType: (typeof videoTypeOptions)[number]["value"] = videoType,
  ) {
    const durationDefaults = getTaskCreationExpectedDurationDefaults(nextRange, nextVideoType);
    setVideoExpectedDurationRange(durationDefaults.videoExpectedDurationRange);
    setVideoSegmentCount(durationDefaults.videoSegmentCount);
    setVideoDurationSeconds(durationDefaults.videoDurationSeconds);

    const nextProfile = getVideoTaskTypeProfile(nextVideoType);
    if (!nextProfile.hasVoice) {
      setAudioStoryboardEnabled(false);
      setAudioStoryboardVoiceIds([]);
    }
  }

  function applyVideoTypePreset(nextVideoType: (typeof videoTypeOptions)[number]["value"]) {
    const defaults = getTaskCreationVideoTypeDefaults(nextVideoType);
    const nextProfile = getVideoTaskTypeProfile(nextVideoType);
    setVideoType(nextVideoType);
    setVideoMultiShot(defaults.videoMultiShot);
    setVideoShotType(defaults.videoShotType);
    setVideoEnableTailFrame(defaults.videoEnableTailFrame);
    setVideoGenerateAudio(defaults.videoGenerateAudio);

    if (!nextProfile.hasVoice) {
      setAudioStoryboardEnabled(false);
      setAudioStoryboardVoiceIds([]);
    }

    applyExpectedDurationRangePreset(videoExpectedDurationRange, nextVideoType);
  }

  const scrollToFirstStepSection = useCallback(() => {
    window.requestAnimationFrame(() => {
      firstStepSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const applyTaskCreationDraftState = useCallback(
    (draft: TaskCreationParameterState) => {
      const nextDraft = normalizeTaskCreationStateForWorkflowMode(draft, workflowMode);
      setCreateTaskTitle(nextDraft.taskTitle);
      setCreateSelectedProductId(nextDraft.selectedProductId);
      setCreateUserPrompt(nextDraft.userPrompt);
      setCreateOptimizedUserPrompt(nextDraft.optimizedUserPrompt);
      setCreateVideoMaterialId(nextDraft.videoMaterialId);
      setImageSize(nextDraft.imageSize);
      setImageGuidanceScale(nextDraft.imageGuidanceScale);
      setImageWatermark(nextDraft.imageWatermark);
      setImageSeedMode(nextDraft.imageSeedMode);
      setImageSeedValue(nextDraft.imageSeedValue);
      setVideoType(nextDraft.videoType);
      setVideoMode(nextDraft.videoMode);
      setVideoMultiShot(nextDraft.videoMultiShot);
      setVideoShotType(nextDraft.videoShotType);
      setVideoEnableTailFrame(nextDraft.videoEnableTailFrame);
      setVideoExpectedDurationRange(nextDraft.videoExpectedDurationRange);
      setVideoSegmentCount(nextDraft.videoSegmentCount);
      setVideoDurationSeconds(nextDraft.videoDurationSeconds);
      setVideoAspectRatio(nextDraft.videoAspectRatio);
      setVideoCfgScale(nextDraft.videoCfgScale);
      setVideoCameraControl(nextDraft.videoCameraControl);
      setVideoGenerateAudio(nextDraft.videoGenerateAudio);
      setVideoWatermark(nextDraft.videoWatermark);
      setVideoNegativePrompt(nextDraft.videoNegativePrompt);
      setAudioStoryboardEnabled(nextDraft.audioStoryboardEnabled);
      setAudioVoiceId(nextDraft.audioVoiceId);
      setAudioStoryboardVoiceIds(nextDraft.audioStoryboardVoiceIds);
      setAudioFormat(nextDraft.audioFormat);
      setAudioSampleRate(nextDraft.audioSampleRate);
      setAudioSpeechRate(nextDraft.audioSpeechRate);
      setAudioLoudnessRate(nextDraft.audioLoudnessRate);
      setAudioEnableSubtitle(nextDraft.audioEnableSubtitle);
      setCompositionIncludeBackgroundMusic(nextDraft.compositionIncludeBackgroundMusic);
      setCompositionBackgroundMusicUrl(nextDraft.compositionBackgroundMusicUrl);
      setCompositionBackgroundMusicVolume(nextDraft.compositionBackgroundMusicVolume);
      setCompositionSubtitleConfig(nextDraft.compositionSubtitleConfig);
      setConstraintPreset(nextDraft.constraintPreset);
      setConstraintCustomRules(nextDraft.constraintCustomRules);
      setLastCreatedDraftKey(nextDraft.lastCreatedDraftKey);
      setLastSelectedTaskId(nextDraft.lastSelectedTaskId);
    },
    [workflowMode],
  );

  const resetTaskCreationDraft = useCallback(() => {
    const defaults = applyParameterSettingsToTaskCreationState(defaultTaskCreationState, systemParameterSettings);
    explicitNewTaskDraftModeRef.current = true;
    setIsNewTaskDraftMode(true);
    setSelectedTaskId("");
    setSelectedTaskStageProgress({});
    setHighlightedTaskId("");
    setMergeTaskSourceFromSelectedTask(false);
    setSubtitleAudioResult(null);
    setSubtitleAudioLoadStatus("idle");
    setKeyMaterialWorkflow(null);
    setVideoGenerationWorkflow(null);
    setKeyMaterialLoadStatus("idle");
    setVideoGenerationLoadStatus("idle");
    setSelectedTaskStageProgressLoadStatus("idle");
    setVisualPrimaryAction(null);
    setClipPrimaryAction(null);
    setCompositionPrimaryAction(null);
    setVisualPipelineSummary(null);
    setClipPipelineSummary(null);
    setLipSyncReady(false);
    setError(null);
    createStreamProgress.reset();
    resetKeyMaterialStream();
    resetVideoGenerationStream();
    applyTaskCreationDraftState(defaults);
  }, [
    applyTaskCreationDraftState,
    createStreamProgress,
    defaultTaskCreationState,
    resetKeyMaterialStream,
    resetVideoGenerationStream,
    systemParameterSettings,
  ]);

  const handleCreateInputDraftTask = useCallback(async () => {
    if (createInputDraftTaskInFlightRef.current) {
      const existingRequestTask = await createInputDraftTaskInFlightRef.current;
      if (existingRequestTask?.taskId) {
        scrollToFirstStepSection();
      }
      return;
    }

    const defaults = applyParameterSettingsToTaskCreationState(defaultTaskCreationState, systemParameterSettings);
    resetTaskCreationDraft();
    setIsCreating(true);
    setError(null);

    const request = (async () => {
      const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ensure_input_task",
          title: "",
          productInfoId: null,
          productInfoTitle: null,
          productInfoSnapshot: "",
          userPrompt: "",
          optimizedUserPrompt: "",
          videoMaterialId: null,
          videoMaterialName: null,
          videoTemplatePrompt: "",
          parameters: {
            ...buildTaskParameterPatchPayload(defaults),
            constraintPreset: defaults.constraintPreset,
            constraintCustomRules: defaults.constraintCustomRules,
          },
        }),
      });
      const data = (await response.json()) as TaskShellResponse;
      if (!response.ok || !data.task?.taskId) {
        throw new Error(data.error ?? "创建任务草稿失败");
      }

      const createdTask = data.task;
      setTasks((current) => upsertTaskRecord(current, createdTask));
      explicitNewTaskDraftModeRef.current = false;
      setIsNewTaskDraftMode(false);
      setSelectedTaskId(createdTask.taskId);
      setLastSelectedTaskId(createdTask.taskId);
      setMergeTaskSourceFromSelectedTask(true);
      setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(createdTask));
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("empty");
      setKeyMaterialWorkflow(null);
      setVideoGenerationWorkflow(null);
      setKeyMaterialLoadStatus("idle");
      setVideoGenerationLoadStatus("idle");
      setSelectedTaskStageProgressLoadStatus("idle");
      setSelectedTaskStageProgress({});
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      setVisualPipelineSummary(null);
      setClipPipelineSummary(null);
      setLipSyncReady(false);
      setHighlightedTaskId(createdTask.taskId);
      if (highlightTaskTimerRef.current) {
        window.clearTimeout(highlightTaskTimerRef.current);
      }
      highlightTaskTimerRef.current = window.setTimeout(() => {
        setHighlightedTaskId((current) => (current === createdTask.taskId ? "" : current));
        highlightTaskTimerRef.current = null;
      }, 2600);
      void loadTaskShellSnapshot(createdTask.taskId).catch(() => null);
      scrollToFirstStepSection();
      return createdTask;
    })();

    createInputDraftTaskInFlightRef.current = request;
    try {
      await request;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建任务草稿失败");
    } finally {
      if (createInputDraftTaskInFlightRef.current === request) {
        createInputDraftTaskInFlightRef.current = null;
      }
      setIsCreating(false);
    }
  }, [
    defaultTaskCreationState,
    loadTaskShellSnapshot,
    resetTaskCreationDraft,
    scrollToFirstStepSection,
    systemParameterSettings,
  ]);

  const currentParameterPayload = useMemo(
    () =>
      buildTaskParameterPatchPayload({
        imageSize,
        imageGuidanceScale,
        imageWatermark,
        imageSeedMode,
        imageSeedValue,
        videoType,
        videoMode,
        videoMultiShot,
        videoShotType,
        videoEnableTailFrame,
        videoExpectedDurationRange,
        videoSegmentCount,
        videoDurationSeconds,
        videoAspectRatio,
        videoCfgScale,
        videoCameraControl,
        videoGenerateAudio,
        videoWatermark,
        videoNegativePrompt,
        audioStoryboardEnabled,
        audioVoiceId,
        audioStoryboardVoiceIds,
        audioFormat,
        audioSampleRate,
        audioSpeechRate,
        audioLoudnessRate,
        audioEnableSubtitle,
        compositionIncludeBackgroundMusic,
        compositionBackgroundMusicUrl,
        compositionBackgroundMusicVolume,
        compositionSubtitleConfig,
      }),
    [
      audioEnableSubtitle,
      audioFormat,
      audioLoudnessRate,
      audioSampleRate,
      audioSpeechRate,
      audioStoryboardEnabled,
      audioStoryboardVoiceIds,
      audioVoiceId,
      compositionBackgroundMusicUrl,
      compositionBackgroundMusicVolume,
      compositionIncludeBackgroundMusic,
      compositionSubtitleConfig,
      imageGuidanceScale,
      imageSeedMode,
      imageSeedValue,
      imageSize,
      imageWatermark,
      videoAspectRatio,
      videoCameraControl,
      videoCfgScale,
      videoDurationSeconds,
      videoEnableTailFrame,
      videoExpectedDurationRange,
      videoGenerateAudio,
      videoSegmentCount,
      videoMultiShot,
      videoMode,
      videoNegativePrompt,
      videoShotType,
      videoType,
      videoWatermark,
    ],
  );
  const currentTaskParameterDraftKey = useMemo(
    () => buildTaskParameterDraftKeyFromPayload(currentParameterPayload),
    [currentParameterPayload],
  );
  const currentTaskSourcePayload = useMemo(() => {
    const fromTask = mergeTaskSourceFromSelectedTask ? selectedTask : null;
    return {
      title: createTaskTitle,
      productInfoId: createSelectedProductId || null,
      productInfoTitle: selectedProductOption?.title ?? fromTask?.source.productInfoTitle ?? null,
      productInfoSnapshot: selectedProductOption?.snapshot ?? fromTask?.source.productInfoSnapshot ?? "",
      userPrompt: createUserPrompt,
      optimizedUserPrompt: createOptimizedUserPrompt,
      videoMaterialId: selectedReferenceVideoMaterialOption?.materialId ?? fromTask?.source.videoMaterialId ?? null,
      videoMaterialName: selectedReferenceVideoMaterialOption?.name ?? fromTask?.source.videoMaterialName ?? null,
      videoTemplatePrompt:
        selectedReferenceVideoMaterialOption?.videoTemplatePrompt ?? fromTask?.source.videoTemplatePrompt ?? "",
    };
  }, [
    createSelectedProductId,
    createTaskTitle,
    createUserPrompt,
    createOptimizedUserPrompt,
    mergeTaskSourceFromSelectedTask,
    selectedReferenceVideoMaterialOption,
    selectedProductOption?.snapshot,
    selectedProductOption?.title,
    selectedTask,
  ]);
  const currentTaskSourceDraftKey = useMemo(
    () => buildTaskSourceDraftKey(currentTaskSourcePayload),
    [currentTaskSourcePayload],
  );
  const selectedTaskSourceDraftKey = useMemo(
    () =>
      selectedTask
        ? buildTaskSourceDraftKey({
            title: selectedTask.title,
            productInfoId: selectedTask.source.productInfoId,
            productInfoTitle: selectedTask.source.productInfoTitle,
            productInfoSnapshot: selectedTask.source.productInfoSnapshot,
            userPrompt: selectedTask.source.userPrompt,
            optimizedUserPrompt: selectedTask.source.optimizedUserPrompt ?? "",
            videoMaterialId: selectedTask.source.videoMaterialId,
          })
        : "",
    [selectedTask],
  );
  const selectedTaskParameterDraftKey = useMemo(
    () =>
      selectedTask
        ? buildTaskParameterDraftKeyFromPayload(
            buildTaskParameterPatchPayload(buildTaskParameterStateFromTask(selectedTask)),
          )
        : "",
    [selectedTask],
  );
  const handleHotelAssetCountChange = useCallback((count: number) => {
    setHotelAssetCount((current) => (current === count ? current : count));
  }, []);
  const ensureHotelAssetInputTask = useCallback(async () => {
    if (selectedTask?.taskId) {
      return selectedTask.taskId;
    }
    if (!usesCapturedMaterialFirstWorkflow(videoType)) {
      return null;
    }
    const taskIdFromUrl =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("taskId");
    const recoverableTaskId =
      taskIdFromUrl && visibleTaskIdList.includes(taskIdFromUrl)
        ? taskIdFromUrl
        : lastSelectedTaskId && visibleTaskIdList.includes(lastSelectedTaskId)
          ? lastSelectedTaskId
          : "";
    if (
      !shouldAllowHotelAssetInputTaskEnsure({
        isDraftHydrated,
        isTaskIndexReady,
        isNewTaskDraftMode,
        isExplicitNewTaskDraftMode: explicitNewTaskDraftModeRef.current,
        taskIdFromUrl,
        taskIds: visibleTaskIdList,
        selectedTaskId,
        lastSelectedTaskId,
      })
    ) {
      if (recoverableTaskId) {
        setIsNewTaskDraftMode(false);
        explicitNewTaskDraftModeRef.current = false;
        setSelectedTaskId(recoverableTaskId);
        setLastSelectedTaskId(recoverableTaskId);
      }
      throw new Error(
        recoverableTaskId
          ? "任务状态正在恢复，请稍后再上传酒店实拍图"
          : "任务状态未恢复，请刷新或重新选择任务后再上传酒店实拍图",
      );
    }
    if (ensureHotelAssetInputTaskInFlightRef.current) {
      return ensureHotelAssetInputTaskInFlightRef.current;
    }

    const request = (async () => {
      const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ensure_input_task",
          title: currentTaskSourcePayload.title.trim() || "酒店探店素材草稿",
          productInfoId: currentTaskSourcePayload.productInfoId,
          productInfoTitle: currentTaskSourcePayload.productInfoTitle,
          productInfoSnapshot: currentTaskSourcePayload.productInfoSnapshot,
          userPrompt: currentTaskSourcePayload.userPrompt,
          optimizedUserPrompt: currentTaskSourcePayload.optimizedUserPrompt,
          videoMaterialId: currentTaskSourcePayload.videoMaterialId,
          videoMaterialName: currentTaskSourcePayload.videoMaterialName,
          videoTemplatePrompt: currentTaskSourcePayload.videoTemplatePrompt,
          parameters: {
            ...currentParameterPayload,
            constraintPreset,
            constraintCustomRules,
          },
        }),
      });
      const data = (await response.json()) as TaskShellResponse;
      if (!response.ok || !data.task?.taskId) {
        throw new Error(data.error ?? "酒店实拍图上传准备失败");
      }

      setTasks((current) => upsertTaskRecord(current, data.task!));
      explicitNewTaskDraftModeRef.current = false;
      setIsNewTaskDraftMode(false);
      setSelectedTaskId(data.task.taskId);
      setLastSelectedTaskId(data.task.taskId);
      setMergeTaskSourceFromSelectedTask(true);
      setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(data.task));
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("empty");
      setKeyMaterialWorkflow(null);
      setVideoGenerationWorkflow(null);
      setKeyMaterialLoadStatus("idle");
      setVideoGenerationLoadStatus("idle");
      setSelectedTaskStageProgressLoadStatus("idle");
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      setVisualPipelineSummary(null);
      setClipPipelineSummary(null);
      void loadTaskShellSnapshot(data.task.taskId).catch(() => null);

      return data.task.taskId;
    })();

    ensureHotelAssetInputTaskInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (ensureHotelAssetInputTaskInFlightRef.current === request) {
        ensureHotelAssetInputTaskInFlightRef.current = null;
      }
    }
  }, [
    constraintCustomRules,
    constraintPreset,
    currentParameterPayload,
    currentTaskSourcePayload,
    isDraftHydrated,
    isNewTaskDraftMode,
    isTaskIndexReady,
    lastSelectedTaskId,
    loadTaskShellSnapshot,
    selectedTask?.taskId,
    selectedTaskId,
    visibleTaskIdList,
    videoType,
  ]);

  useEffect(() => {
    if (initialIndexData) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadPageData = async () => {
      try {
        const response = await fetch("/api/video-tasks?includeVoiceOptions=0&resumePendingVideoJobs=0", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as TaskCreationIndexPayload & { error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? pageLoadErrorMessage);
        }

        if (!isActive) {
          return;
        }

        startTransition(() => {
          setTasks(sortTasksByCreatedAtDesc(data.tasks));
          setGeneratedVideos(data.generatedVideos ?? []);
          setProductOptions(data.productOptions ?? []);
          setReferenceVideoMaterialOptions(data.referenceVideoMaterialOptions ?? []);
          setIsTaskIndexReady(true);
        });
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        if (!isActive) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : pageLoadErrorMessage);
      }
    };

    void loadPageData();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [initialIndexData, pageLoadErrorMessage]);

  useEffect(() => {
    if (!isTaskIndexReady) {
      return;
    }

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const loadVoiceOptions = async () => {
      setAudioVoiceOptionLoadStatus("loading");

      try {
        const response = await fetch("/api/video-tasks/voice-options", { cache: "no-store" });
        const data = (await response.json()) as TaskCreationVoiceOptionsPayload;

        if (!response.ok) {
          throw new Error(data.error ?? "任务音色选项加载失败");
        }

        if (cancelled) {
          return;
        }

        const nextVoiceOptions = mapTaskVoiceOptions(data.voiceOptions ?? []);
        const supportedVoiceIds = new Set(nextVoiceOptions.map((item) => item.value));
        const fallbackVoiceId = nextVoiceOptions[0]?.value || getDefaultTaskCreationParameterState().audioVoiceId;

        startTransition(() => {
          setAudioVoiceOptions(nextVoiceOptions);
          setAudioVoiceId((current) => normalizeSupportedVoiceId(current, supportedVoiceIds, fallbackVoiceId));
          setAudioStoryboardVoiceIds((current) =>
            Array.from({ length: current.length }, (_, index) =>
              normalizeSupportedVoiceId(current[index], supportedVoiceIds, fallbackVoiceId),
            ),
          );
          setAudioVoiceOptionLoadStatus("success");
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setAudioVoiceOptionLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "任务音色选项加载失败"));
      }
    };

    const scheduleLoad = () => {
      void loadVoiceOptions();
    };

    if ("requestIdleCallback" in window) {
      idleHandle = window.requestIdleCallback(scheduleLoad, { timeout: 1200 });
    } else {
      timeoutHandle = globalThis.setTimeout(scheduleLoad, 120);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [isTaskIndexReady]);

  useEffect(() => {
    const settings = readParameterSettingsState(window.localStorage);
    setSystemParameterSettings(settings);

    const storageKeys =
      taskCreateDraftStorageKey === taskCreateDraftLegacyStorageKey
        ? [taskCreateDraftStorageKey]
        : [taskCreateDraftStorageKey, taskCreateDraftLegacyStorageKey];

    for (const storageKey of storageKeys) {
      const rawDraft = window.localStorage.getItem(storageKey);
      if (!rawDraft) {
        continue;
      }

      try {
        const parsedDraft = JSON.parse(rawDraft) as Partial<TaskCreationParameterState>;
        const draft = applyParameterSettingsToTaskCreationState(
          hydrateTaskCreationParameterState(parsedDraft),
          settings,
        );
        if (
          storageKey === taskCreateDraftLegacyStorageKey &&
          workflowMode &&
          getTaskCreationWorkflowModeForVideoType(draft.videoType) !== workflowMode
        ) {
          continue;
        }
        applyTaskCreationDraftState(draft);
        setIsDraftHydrated(true);
        return;
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    applyTaskCreationDraftState(applyParameterSettingsToTaskCreationState(defaultTaskCreationState, settings));
    setIsDraftHydrated(true);
  }, [applyTaskCreationDraftState, defaultTaskCreationState, taskCreateDraftStorageKey, workflowMode]);

  useEffect(() => {
    if (voiceValidationTimerRef.current) {
      clearTimeout(voiceValidationTimerRef.current);
    }

    if (!audioVoiceId || audioVoiceOptionLoadStatus !== "success") {
      return;
    }

    setVoiceValidationStatus("idle");
    setVoiceValidationError(null);

    let cancelled = false;

    voiceValidationTimerRef.current = setTimeout(() => {
      const validate = async () => {
        setVoiceValidationStatus("validating");
        try {
          const res = await fetch("/api/voice-management/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ speakerId: audioVoiceId }),
          });
          if (cancelled) return;
          const data = (await res.json()) as { valid: boolean; error?: string };
          if (cancelled) return;

          if (data.valid) {
            setVoiceValidationStatus("valid");
            setVoiceValidationError(null);
            voiceFailCountRef.current = { count: 0, firstFailAt: 0 };
          } else {
            const now = Date.now();
            const failInfo = voiceFailCountRef.current;
            if (now - failInfo.firstFailAt > 10000) {
              voiceFailCountRef.current = { count: 1, firstFailAt: now };
            } else {
              voiceFailCountRef.current.count += 1;
            }

            if (voiceFailCountRef.current.count >= 3) {
              setVoiceValidationStatus("invalid");
              setVoiceValidationError("该音色多次调用失败，建议更换其他音色");
            } else {
              setVoiceValidationStatus("invalid");
              setVoiceValidationError(data.error ?? "音色验证失败，请重试");
            }
          }
        } catch {
          if (cancelled) return;
          setVoiceValidationStatus("invalid");
          setVoiceValidationError("音色验证网络异常");
        }
      };
      void validate();
    }, 800);

    return () => {
      cancelled = true;
      if (voiceValidationTimerRef.current) {
        clearTimeout(voiceValidationTimerRef.current);
      }
    };
  }, [audioVoiceId, audioVoiceOptionLoadStatus]);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    window.localStorage.setItem(
      taskCreateDraftStorageKey,
      serializeTaskCreationParameterState({
        taskTitle: createTaskTitle,
        selectedProductId: createSelectedProductId,
        userPrompt: createUserPrompt,
        optimizedUserPrompt: createOptimizedUserPrompt,
        videoMaterialId: createVideoMaterialId,
        imageSize,
        imageGuidanceScale,
        imageWatermark,
        imageSeedMode,
        imageSeedValue,
        videoType,
        videoMode,
        videoMultiShot,
        videoShotType,
        videoEnableTailFrame,
        videoExpectedDurationRange,
        videoSegmentCount,
        videoDurationSeconds,
        videoAspectRatio,
        videoCfgScale,
        videoCameraControl,
        videoGenerateAudio,
        videoWatermark,
        videoNegativePrompt,
        audioStoryboardEnabled,
        audioVoiceId,
        audioStoryboardVoiceIds,
        audioFormat,
        audioSampleRate,
        audioSpeechRate,
        audioLoudnessRate,
        audioEnableSubtitle,
        compositionIncludeBackgroundMusic,
        compositionBackgroundMusicUrl,
        compositionBackgroundMusicVolume,
        compositionSubtitleConfig,
        constraintPreset,
        constraintCustomRules,
        lastCreatedDraftKey,
        lastSelectedTaskId,
      }),
    );
  }, [
    audioEnableSubtitle,
    audioFormat,
    audioLoudnessRate,
    audioSampleRate,
    audioSpeechRate,
    audioStoryboardEnabled,
    audioStoryboardVoiceIds,
    audioVoiceId,
    compositionBackgroundMusicVolume,
    compositionBackgroundMusicUrl,
    compositionIncludeBackgroundMusic,
    compositionSubtitleConfig,
    constraintPreset,
    constraintCustomRules,
    createSelectedProductId,
    createTaskTitle,
    createOptimizedUserPrompt,
    createUserPrompt,
    createVideoMaterialId,
    imageGuidanceScale,
    imageSeedMode,
    imageSeedValue,
    imageSize,
    imageWatermark,
    isDraftHydrated,
    lastCreatedDraftKey,
    lastSelectedTaskId,
    taskCreateDraftStorageKey,
    videoAspectRatio,
    videoCameraControl,
    videoCfgScale,
    videoDurationSeconds,
    videoEnableTailFrame,
    videoExpectedDurationRange,
    videoGenerateAudio,
    videoSegmentCount,
    videoMultiShot,
    videoMode,
    videoNegativePrompt,
    videoShotType,
    videoType,
    videoWatermark,
  ]);

  useEffect(() => {
    const supportedVoiceIds = new Set(audioVoiceOptions.map((item) => item.value));
    const fallbackVoiceId =
      audioVoiceOptions[0]?.value || audioVoiceId || getDefaultTaskCreationParameterState().audioVoiceId;
    setAudioVoiceId((current) => normalizeSupportedVoiceId(current, supportedVoiceIds, fallbackVoiceId));
    setAudioStoryboardVoiceIds((current) =>
      Array.from({ length: storyboardVoiceSlotCount }, (_, index) =>
        normalizeSupportedVoiceId(current[index], supportedVoiceIds, fallbackVoiceId),
      ),
    );
  }, [audioVoiceId, audioVoiceOptions, storyboardVoiceSlotCount]);

  const selectedTaskId_stable = selectedTask?.taskId ?? null;
  useEffect(() => {
    if (!selectedTask || !selectedTaskId_stable) {
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      isApplyingSelectedTaskSourceRef.current = false;
      lastPersistedTaskSourceDraftKeyRef.current = "";
      previousSelectedTaskIdRef.current = "";
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("idle");
      setSelectedTaskStageProgressLoadStatus("idle");
      setKeyMaterialLoadStatus("idle");
      setVideoGenerationLoadStatus("idle");
      setVideoGenerationWorkflow(null);
      return;
    }

    const isTaskSwitched = previousSelectedTaskIdRef.current !== selectedTaskId_stable;
    previousSelectedTaskIdRef.current = selectedTaskId_stable;

    if (!isTaskSwitched) {
      return;
    }

    explicitNewTaskDraftModeRef.current = false;
    setVisualPrimaryAction(null);
    setClipPrimaryAction(null);
    setCompositionPrimaryAction(null);

    setLastSelectedTaskId(selectedTask.taskId);
    setMergeTaskSourceFromSelectedTask(true);
    setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(selectedTask));
    lastPersistedTaskSourceDraftKeyRef.current = buildTaskSourceDraftKey({
      title: selectedTask.title,
      productInfoId: selectedTask.source.productInfoId,
      productInfoTitle: selectedTask.source.productInfoTitle,
      productInfoSnapshot: selectedTask.source.productInfoSnapshot,
      userPrompt: selectedTask.source.userPrompt,
      optimizedUserPrompt: selectedTask.source.optimizedUserPrompt ?? "",
      videoMaterialId: selectedTask.source.videoMaterialId,
    });
    isApplyingSelectedTaskSourceRef.current = true;
    setCreateTaskTitle(selectedTask.title);
    setCreateSelectedProductId(selectedTask.source.productInfoId ?? "");
    setCreateUserPrompt(selectedTask.source.userPrompt);
    setCreateOptimizedUserPrompt(selectedTask.source.optimizedUserPrompt ?? "");
    setCreateVideoMaterialId(selectedTask.source.videoMaterialId ?? "");
    setSubtitleAudioResult(null);
    setSubtitleAudioLoadStatus("loading");
    setEditingSubtitleAudioClipId(null);
    setEditingSubtitleAudioLineText("");
    savingSubtitleAudioClipIdsRef.current = new Set();
    subtitleAudioLineSaveInFlightRef.current = new Set();
    setSavingSubtitleAudioClipIds([]);
    setKeyMaterialWorkflow(null);
    setKeyMaterialLoadStatus(selectedTask ? "loading" : "idle");
    setVideoGenerationWorkflow(null);
    setVideoGenerationLoadStatus(selectedTask ? "loading" : "idle");
    setSelectedTaskStageProgressLoadStatus(selectedTask ? "loading" : "idle");
    setIsGeneratingKeyMaterials(false);
    resetKeyMaterialStream();
  }, [resetKeyMaterialStream, selectedTask, selectedTaskId_stable]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    if (isApplyingSelectedTaskSourceRef.current && currentTaskSourceDraftKey === selectedTaskSourceDraftKey) {
      isApplyingSelectedTaskSourceRef.current = false;
    }
  }, [currentTaskSourceDraftKey, selectedTask, selectedTaskSourceDraftKey]);

  useEffect(() => {
    if (!selectedTask || isApplyingSelectedTaskSourceRef.current) {
      return;
    }

    if (isKeyMaterialWorkflowActive(keyMaterialWorkflow)) {
      return;
    }

    const nextTitle = createTaskTitle.trim() || selectedTask.title || "未命名视频任务";

    const saveSignature = `${selectedTask.taskId}:${currentTaskSourceDraftKey}`;
    if (
      currentTaskSourceDraftKey === selectedTaskSourceDraftKey ||
      saveSignature === lastPersistedTaskSourceDraftKeyRef.current
    ) {
      return;
    }

    if (taskSourceSaveInFlightRef.current === saveSignature) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      taskSourceSaveInFlightRef.current = saveSignature;
      try {
        const response = await fetch(`/api/video-tasks/${selectedTask.taskId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: nextTitle,
            source: currentTaskSourcePayload,
          }),
        });
        const data = (await response.json()) as TaskShellResponse;
        if (!response.ok || !data.task) {
          throw new Error(data.error ?? "保存任务基础信息失败");
        }

        lastPersistedTaskSourceDraftKeyRef.current = saveSignature;
        setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(data.task));
        applyTaskShellResponse(data, selectedTask.taskId);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存任务基础信息失败");
      } finally {
        if (taskSourceSaveInFlightRef.current === saveSignature) {
          taskSourceSaveInFlightRef.current = "";
        }
      }
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    applyTaskShellResponse,
    createTaskTitle,
    currentTaskSourceDraftKey,
    currentTaskSourcePayload,
    keyMaterialWorkflow,
    selectedTask,
    selectedTaskSourceDraftKey,
  ]);

  useEffect(() => {
    if (!selectedTask) {
      isApplyingSelectedTaskParametersRef.current = false;
      lastPersistedTaskParameterDraftKeyRef.current = "";
      return;
    }

    const taskParameters = buildTaskParameterStateFromTask(selectedTask);
    lastPersistedTaskParameterDraftKeyRef.current = `${selectedTask.taskId}:${buildTaskParameterDraftKeyFromPayload(
      buildTaskParameterPatchPayload(taskParameters),
    )}`;
    isApplyingSelectedTaskParametersRef.current = true;
    setImageSize(taskParameters.imageSize);
    setImageGuidanceScale(taskParameters.imageGuidanceScale);
    setImageWatermark(taskParameters.imageWatermark);
    setImageSeedMode(taskParameters.imageSeedMode);
    setImageSeedValue(taskParameters.imageSeedValue);
    setVideoType(taskParameters.videoType);
    setVideoMode(taskParameters.videoMode);
    setVideoMultiShot(taskParameters.videoMultiShot);
    setVideoShotType(taskParameters.videoShotType);
    setVideoEnableTailFrame(taskParameters.videoEnableTailFrame);
    setVideoExpectedDurationRange(taskParameters.videoExpectedDurationRange);
    setVideoSegmentCount(taskParameters.videoSegmentCount);
    setVideoDurationSeconds(taskParameters.videoDurationSeconds);
    setVideoAspectRatio(taskParameters.videoAspectRatio);
    setVideoCfgScale(taskParameters.videoCfgScale);
    setVideoCameraControl(taskParameters.videoCameraControl);
    setVideoGenerateAudio(taskParameters.videoGenerateAudio);
    setVideoWatermark(taskParameters.videoWatermark);
    setVideoNegativePrompt(taskParameters.videoNegativePrompt);
    setAudioStoryboardEnabled(taskParameters.audioStoryboardEnabled);
    setAudioVoiceId(taskParameters.audioVoiceId);
    setAudioStoryboardVoiceIds(taskParameters.audioStoryboardVoiceIds);
    setAudioFormat(taskParameters.audioFormat);
    setAudioSampleRate(taskParameters.audioSampleRate);
    setAudioSpeechRate(taskParameters.audioSpeechRate);
    setAudioLoudnessRate(taskParameters.audioLoudnessRate);
    setAudioEnableSubtitle(taskParameters.audioEnableSubtitle);
    setCompositionIncludeBackgroundMusic(taskParameters.compositionIncludeBackgroundMusic);
    setCompositionBackgroundMusicUrl(taskParameters.compositionBackgroundMusicUrl);
    setCompositionBackgroundMusicVolume(taskParameters.compositionBackgroundMusicVolume);
    setCompositionSubtitleConfig(taskParameters.compositionSubtitleConfig);
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    if (isApplyingSelectedTaskParametersRef.current && currentTaskParameterDraftKey === selectedTaskParameterDraftKey) {
      isApplyingSelectedTaskParametersRef.current = false;
    }
  }, [currentTaskParameterDraftKey, selectedTask, selectedTaskParameterDraftKey]);

  useEffect(() => {
    if (!selectedTask || isApplyingSelectedTaskParametersRef.current) {
      return;
    }

    if (isKeyMaterialWorkflowActive(keyMaterialWorkflow)) {
      return;
    }

    const saveSignature = `${selectedTask.taskId}:${currentTaskParameterDraftKey}`;
    if (
      currentTaskParameterDraftKey === selectedTaskParameterDraftKey ||
      saveSignature === lastPersistedTaskParameterDraftKeyRef.current
    ) {
      return;
    }

    if (parameterSaveInFlightRef.current === saveSignature) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      parameterSaveInFlightRef.current = saveSignature;
      try {
        const response = await fetch(`/api/video-tasks/${selectedTask.taskId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parameters: currentParameterPayload,
          }),
        });
        const data = (await response.json()) as TaskShellResponse;
        if (!response.ok || !data.task) {
          throw new Error(data.error ?? "保存任务参数失败");
        }

        lastPersistedTaskParameterDraftKeyRef.current = saveSignature;
        setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(data.task));
        applyTaskShellResponse(data, selectedTask.taskId);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存任务参数失败");
      } finally {
        if (parameterSaveInFlightRef.current === saveSignature) {
          parameterSaveInFlightRef.current = "";
        }
      }
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    applyTaskShellResponse,
    currentParameterPayload,
    currentTaskParameterDraftKey,
    keyMaterialWorkflow,
    selectedTask,
    selectedTaskParameterDraftKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !visibleTasks.length) {
      return;
    }

    const taskIdFromUrl = new URLSearchParams(window.location.search).get("taskId");
    // 草稿态是用户显式切换出来的编辑上下文，不允许被旧 URL 反向覆盖回历史任务。
    if (
      !shouldSyncTaskSelectionFromUrl({
        taskIdFromUrl,
        taskIds: visibleTaskIdList,
        selectedTaskId,
        isNewTaskDraftMode,
        isExplicitNewTaskDraftMode: explicitNewTaskDraftModeRef.current,
      })
    ) {
      return;
    }

    if (taskIdFromUrl) {
      explicitNewTaskDraftModeRef.current = false;
      setIsNewTaskDraftMode(false);
      setSelectedTaskId(taskIdFromUrl);
      setLastSelectedTaskId(taskIdFromUrl);
    }
  }, [isNewTaskDraftMode, selectedTaskId, visibleTaskIdList, visibleTasks.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const currentTaskIdInUrl = currentUrl.searchParams.get("taskId");
    if (
      shouldDeferTaskIdUrlSync({
        isDraftHydrated,
        isTaskIndexReady,
        isNewTaskDraftMode,
        isExplicitNewTaskDraftMode: explicitNewTaskDraftModeRef.current,
        taskIdFromUrl: currentTaskIdInUrl,
        taskIds: visibleTaskIdList,
        selectedTaskId,
      })
    ) {
      return;
    }

    const nextTaskId = isNewTaskDraftMode ? "" : (selectedTask?.taskId ?? "");

    if (!nextTaskId) {
      if (!currentTaskIdInUrl) {
        return;
      }
      currentUrl.searchParams.delete("taskId");
      window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
      return;
    }

    if (currentTaskIdInUrl === nextTaskId) {
      return;
    }

    currentUrl.searchParams.set("taskId", nextTaskId);
    window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }, [isDraftHydrated, isNewTaskDraftMode, isTaskIndexReady, selectedTask?.taskId, selectedTaskId, visibleTaskIdList]);

  const videoTotalDurationSeconds =
    videoTypeProfile.defaultSegmentMode === "hybrid_intro_plus_montage"
      ? Math.min(3, videoDurationSeconds) + Math.max(0, videoSegmentCount - 1) * videoDurationSeconds
      : videoDurationSeconds * videoSegmentCount;
  const subtitleAudioVoiceModeLabel = subtitleAudioResult?.voiceId ? "统一音色" : "分段音色";
  const currentDraftKey = buildTaskCreationDraftKey({
    ...getDefaultTaskCreationParameterState(),
    taskTitle: createTaskTitle,
    selectedProductId: createSelectedProductId,
    userPrompt: createUserPrompt,
    optimizedUserPrompt: createOptimizedUserPrompt,
    videoMaterialId: createVideoMaterialId,
    imageSize,
    imageGuidanceScale,
    imageWatermark,
    imageSeedMode,
    imageSeedValue,
    videoType,
    videoMode,
    videoMultiShot,
    videoShotType,
    videoEnableTailFrame,
    videoExpectedDurationRange,
    videoSegmentCount,
    videoDurationSeconds,
    videoAspectRatio,
    videoCfgScale,
    videoCameraControl,
    videoGenerateAudio,
    videoWatermark,
    videoNegativePrompt,
    audioStoryboardEnabled,
    audioVoiceId,
    audioStoryboardVoiceIds,
    audioFormat,
    audioSampleRate,
    audioSpeechRate,
    audioLoudnessRate,
    audioEnableSubtitle,
    compositionIncludeBackgroundMusic,
    compositionBackgroundMusicUrl,
    compositionBackgroundMusicVolume,
    compositionSubtitleConfig,
    constraintPreset,
    constraintCustomRules,
    lastCreatedDraftKey,
  });
  const hasCapturedMaterialInputAssets = usesCapturedMaterialFirstWorkflow(videoType) && hotelAssetCount > 0;
  const hasAnyCreateInput = Boolean(
    createTaskTitle.trim() ||
    createSelectedProductId ||
    createUserPrompt.trim() ||
    createOptimizedUserPrompt.trim() ||
    selectedReferenceVideoMaterialOption?.materialId ||
    hasCapturedMaterialInputAssets,
  );
  const hasAnyPlanningSource = Boolean(
    currentTaskSourcePayload.userPrompt.trim() ||
    currentTaskSourcePayload.optimizedUserPrompt.trim() ||
    currentTaskSourcePayload.productInfoSnapshot.trim() ||
    currentTaskSourcePayload.videoTemplatePrompt.trim() ||
    hasCapturedMaterialInputAssets,
  );
  const taskCreateStatus: TaskCreateStatus = !hasAnyCreateInput
    ? "idle"
    : currentDraftKey === lastCreatedDraftKey
      ? "created"
      : "editing";

  useEffect(() => {
    if (!selectedTask) {
      latestTaskDraftAutosaveRef.current = null;
      return;
    }

    latestTaskDraftAutosaveRef.current = {
      taskId: selectedTask.taskId,
      fallbackTitle: selectedTask.title || "未命名视频任务",
      sourcePayload: currentTaskSourcePayload,
      sourceDraftKey: currentTaskSourceDraftKey,
      selectedSourceDraftKey: selectedTaskSourceDraftKey,
      parameterPayload: currentParameterPayload,
      parameterDraftKey: currentTaskParameterDraftKey,
      selectedParameterDraftKey: selectedTaskParameterDraftKey,
      canSave:
        !isApplyingSelectedTaskSourceRef.current &&
        !isApplyingSelectedTaskParametersRef.current &&
        !isKeyMaterialWorkflowActive(keyMaterialWorkflow),
    };
  }, [
    currentParameterPayload,
    currentTaskParameterDraftKey,
    currentTaskSourceDraftKey,
    currentTaskSourcePayload,
    keyMaterialWorkflow,
    selectedTask,
    selectedTaskParameterDraftKey,
    selectedTaskSourceDraftKey,
  ]);

  useEffect(() => {
    const flushPendingDraftSave = () => {
      const snapshot = latestTaskDraftAutosaveRef.current;
      if (!snapshot?.canSave) {
        return;
      }

      const sourceDirty = snapshot.sourceDraftKey !== snapshot.selectedSourceDraftKey;
      const parametersDirty = snapshot.parameterDraftKey !== snapshot.selectedParameterDraftKey;
      if (!sourceDirty && !parametersDirty) {
        return;
      }

      const body: {
        title?: string;
        source?: TaskSourceAutosavePayload;
        parameters?: ReturnType<typeof buildTaskParameterPatchPayload>;
      } = {};
      if (sourceDirty) {
        body.title = snapshot.sourcePayload.title.trim() || snapshot.fallbackTitle || "未命名视频任务";
        body.source = snapshot.sourcePayload;
      }
      if (parametersDirty) {
        body.parameters = snapshot.parameterPayload;
      }

      void fetch(`/api/video-tasks/${snapshot.taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => null);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingDraftSave();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushPendingDraftSave);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushPendingDraftSave);
    };
  }, []);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    if (isNewTaskDraftMode && explicitNewTaskDraftModeRef.current) {
      setSelectedTaskId("");
      return;
    }

    const taskIdFromUrl =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("taskId");

    if (!visibleTasks.length) {
      if (taskIdFromUrl) {
        return;
      }
      setSelectedTaskId("");
      return;
    }

    if (
      typeof window !== "undefined" &&
      shouldResumeTaskCreationDraft({
        isDraftHydrated,
        hasTaskIdInUrl: Boolean(new URLSearchParams(window.location.search).get("taskId")),
        hasAnyCreateInput,
        currentDraftKey,
        lastCreatedDraftKey,
      })
    ) {
      explicitNewTaskDraftModeRef.current = false;
      setIsNewTaskDraftMode(true);
      setSelectedTaskId("");
      return;
    }

    const resolvedTaskId = resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl,
      taskIds: visibleTaskIdList,
      selectedTaskId,
      isNewTaskDraftMode,
      isExplicitNewTaskDraftMode: explicitNewTaskDraftModeRef.current,
      lastSelectedTaskId,
    });

    if (resolvedTaskId) {
      explicitNewTaskDraftModeRef.current = false;
      setIsNewTaskDraftMode(false);
    }
    setSelectedTaskId((current) => (current === resolvedTaskId ? current : resolvedTaskId));
  }, [
    currentDraftKey,
    hasAnyCreateInput,
    isDraftHydrated,
    isNewTaskDraftMode,
    lastCreatedDraftKey,
    lastSelectedTaskId,
    selectedTaskId,
    visibleTaskIdList,
    visibleTasks.length,
  ]);

  const hasExistingTaskForShotPlanRun = Boolean(selectedTask && !isNewTaskDraftMode);
  const hasGeneratedShotPlanForSelectedTask = Boolean(
    hasExistingTaskForShotPlanRun && hasGeneratedShotPlanArtifacts(selectedTask),
  );
  const hasExistingTaskForRerun = hasGeneratedShotPlanForSelectedTask;
  const scopedSelectedTaskStageProgress = useMemo(
    () => filterTaskStageProgressByTaskId(selectedTaskStageProgress, selectedTaskIdForHashScroll),
    [selectedTaskIdForHashScroll, selectedTaskStageProgress],
  );
  const shotPlanStageProgress = scopedSelectedTaskStageProgress[taskStageProgressKeys.shotPlan] ?? null;
  const subtitleStageProgress = scopedSelectedTaskStageProgress[taskStageProgressKeys.subtitleAudio] ?? null;
  const visualStageProgress = scopedSelectedTaskStageProgress[taskStageProgressKeys.visualImages] ?? null;
  const clipGenerationStageProgress = scopedSelectedTaskStageProgress[taskStageProgressKeys.clipGeneration] ?? null;
  const compositionStageProgress = scopedSelectedTaskStageProgress[taskStageProgressKeys.composition] ?? null;
  const videoGenerationWorkflowRunning = isVideoGenerationWorkflowRunning(videoGenerationWorkflow);
  const videoGenerationCurrentStep = videoGenerationWorkflow?.currentStepKey ?? null;
  const keyMaterialSubtitleStep = keyMaterialWorkflow?.steps.subtitle_audio ?? null;
  const keyMaterialVisualStep = keyMaterialWorkflow?.steps.visual_images ?? null;
  const keyMaterialFailedStep = resolveKeyMaterialFailedStep(keyMaterialWorkflow);
  const keyMaterialVisualFailureResolved =
    keyMaterialFailedStep === "visual_images" &&
    (visualStageProgress?.status === "COMPLETED" ||
      Boolean(selectedTask && getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("IMAGES_READY")));
  const persistedVisualStageRunning = isTaskStageProgressRunning(visualStageProgress);
  const persistedClipStageRunning = isTaskStageProgressRunning(clipGenerationStageProgress);
  const persistedCompositionStageRunning = isTaskStageProgressRunning(compositionStageProgress);
  const hasPersistedRunningStage = Object.values(scopedSelectedTaskStageProgress).some((progress) =>
    isTaskStageProgressRunning(progress),
  );
  const stageProgressLoading = Boolean(
    selectedTask &&
    (selectedTaskStageProgressLoadStatus === "idle" || selectedTaskStageProgressLoadStatus === "loading"),
  );
  const keyMaterialStatusLoading = Boolean(
    selectedTask && (keyMaterialLoadStatus === "idle" || keyMaterialLoadStatus === "loading"),
  );
  const videoGenerationStatusLoading = Boolean(
    selectedTask && (videoGenerationLoadStatus === "idle" || videoGenerationLoadStatus === "loading"),
  );
  const createActionStatusLoading = stageProgressLoading && !isCreating && !shotPlanStageProgress;
  const createActionRunning = isCreating || isTaskStageProgressRunning(shotPlanStageProgress);
  const createActionFailedWithoutPlan = Boolean(
    shotPlanStageProgress?.status === "FAILED" && !hasGeneratedShotPlanForSelectedTask,
  );
  const subtitleActionRunning = isTaskStageProgressRunning(subtitleStageProgress);
  const keyMaterialComplete = Boolean(
    selectedTask &&
    (getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("IMAGES_READY") ||
      keyMaterialWorkflow?.status === "success"),
  );
  const keyMaterialIdleLabel = keyMaterialComplete ? "重新生成关键素材" : "生成关键素材";
  const keyMaterialRuntime = resolveKeyMaterialActionRuntime({
    liveRunning: isGeneratingKeyMaterials,
    liveMessage: keyMaterialProgress.message,
    livePercent: keyMaterialProgress.percent,
    workflowStatus: keyMaterialWorkflow?.status,
    subtitleStepStatus: keyMaterialSubtitleStep?.status,
    visualStepStatus: keyMaterialVisualStep?.status,
    subtitleStageProgress,
    visualStageProgress,
    idleLabel: keyMaterialIdleLabel,
    fallbackRunningLabel: "关键素材生成中...",
  });
  const keyMaterialWorkflowRunning = keyMaterialRuntime.isRunning;
  const upstreamGenerationBlockedReason = resolveDirectorUpstreamBlockedReason({
    planningRunning: createActionRunning || createActionStatusLoading,
    keyMaterialRunning: keyMaterialWorkflowRunning || keyMaterialStatusLoading,
  });
  const keyMaterialWorkflowErrorMessage =
    keyMaterialSubtitleStep?.status === "failed"
      ? keyMaterialSubtitleStep.errorMessage
      : keyMaterialVisualFailureResolved
        ? null
        : (keyMaterialWorkflow?.lastError ?? keyMaterialVisualStep?.errorMessage ?? null);
  const taskCreateStatusMeta = createActionRunning
    ? {
        label: "镜头规划中",
        tone: "editing" as const,
      }
    : createActionStatusLoading
      ? {
          label: "状态加载中",
          tone: "editing" as const,
        }
      : getTaskCreateStatusMeta(taskCreateStatus, hasExistingTaskForRerun);
  const contentBuildStatusMeta = createActionRunning
    ? {
        label: "规划中",
        tone: "editing" as const,
      }
    : createActionStatusLoading
      ? {
          label: "加载中",
          tone: "editing" as const,
        }
      : getVideoTaskModuleStatusMeta(selectedTask?.status, "CREATED");
  const createActionHasDirtyChanges = hasExistingTaskForRerun && taskCreateStatus === "editing";
  const createActionBlockedReason = !createTaskTitle.trim()
    ? "请先填写任务名称。"
    : !hasAnyPlanningSource
      ? (workflowModeConfig?.sourceRequirementText ??
        "请先提供酒店/商品信息、主动提示词、参考视频素材或酒店实拍图中的至少一项内容。")
      : selectedTask && keyMaterialWorkflowRunning
        ? "关键素材生成中，请等待当前任务完成后再调整镜头规划。"
        : null;
  const createActionBaseLabel = createActionRunning
    ? getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.buildShotPlan, {
        running: true,
      })
    : createActionHasDirtyChanges
      ? "更新镜头规划"
      : createActionFailedWithoutPlan
        ? "重新生成镜头规划"
      : getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.buildShotPlan, {
          rerun: hasExistingTaskForRerun,
        });
  const createActionLabel = createActionStatusLoading
    ? "任务状态加载中..."
    : isCreating && createStreamProgress.progress.message
      ? createStreamProgress.progress.message
      : !isCreating && isTaskStageProgressRunning(shotPlanStageProgress) && shotPlanStageProgress?.message
        ? shotPlanStageProgress.message
        : createActionBaseLabel;
  const createActionProgressPercent = isCreating
    ? createStreamProgress.progress.percent
    : isTaskStageProgressRunning(shotPlanStageProgress)
      ? (shotPlanStageProgress?.percent ?? 0)
      : 0;
  const subtitleDrivenSegments =
    selectedTask?.directorPlan?.renderSegments.filter((segment) => segment.hasVoice || segment.hasSubtitle) ?? [];
  const subtitleHasMissingCueText = Boolean(
    subtitleDrivenSegments.some((segment) => {
      const subtitleEntry = getSegmentSubtitleEntry(selectedTask?.directorPlan?.subtitlePlan, {
        segmentId: segment.segmentId,
        segmentIndex: segment.segmentIndex,
      });
      return !subtitleEntry?.text?.trim() && !(segment.narrationText || segment.subtitleText).trim();
    }),
  );
  const subtitleStageReady =
    selectedTask && getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("SUBTITLE_AUDIO_READY");
  const subtitleHasExistingResult =
    subtitleAudioLoadStatus === "success" &&
    Boolean(subtitleAudioResult?.clips.length || subtitleAudioResult?.mergedAudioUrl);
  const subtitleSilentMode = selectedTask
    ? (() => {
        const profile = getVideoTaskTypeProfile(selectedTask.parameters?.video?.videoType);
        return !profile.hasVoice && !profile.hasSubtitle;
      })()
    : false;
  const subtitleActionLabel = getDirectorPrimaryStepButtonLabel(directorPrimaryStepActionKeys.buildSubtitleAudio, {
    running: subtitleActionRunning,
    rerun: Boolean(subtitleStageReady && subtitleHasExistingResult),
    silent: subtitleSilentMode,
  });
  const subtitleActionDisplayLabel =
    isTaskStageProgressRunning(subtitleStageProgress) && subtitleStageProgress?.message
      ? subtitleStageProgress.message
      : subtitleActionLabel;
  const subtitleActionProgressPercent = isTaskStageProgressRunning(subtitleStageProgress)
    ? (subtitleStageProgress?.percent ?? 0)
    : 0;
  const keyMaterialActionBlockedReason = !selectedTask
    ? "请先生成镜头规划。"
    : !hasGeneratedShotPlanForSelectedTask
      ? "请先生成镜头规划。"
    : keyMaterialStatusLoading || stageProgressLoading
      ? "关键素材状态加载中，请稍后再试。"
      : subtitleHasMissingCueText
        ? "请先补全有口播/字幕镜头的台词文本。"
        : createActionRunning || createActionStatusLoading
          ? "镜头规划处理中，请等待当前任务完成后再生成关键素材。"
          : null;
  const keyMaterialActionState: TaskStepActionState = {
    label: keyMaterialStatusLoading ? "关键素材状态加载中..." : keyMaterialRuntime.label,
    isRunning: keyMaterialWorkflowRunning || keyMaterialStatusLoading,
    busyDisplay: keyMaterialStatusLoading ? "status" : "progress",
    progressPercent: keyMaterialWorkflowRunning ? keyMaterialRuntime.progressPercent : null,
    canRun: !keyMaterialActionBlockedReason,
    blockedReason: keyMaterialActionBlockedReason,
    onAction: () => {
      void handleGenerateKeyMaterials("run");
    },
  };
  const visualStageAvailable =
    selectedTask && getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("SUBTITLE_AUDIO_READY");
  const selectedTaskCapturedMaterialFirst = Boolean(
    selectedTask && usesCapturedMaterialFirstWorkflow(selectedTask.parameters.video.videoType),
  );
  const pagePrefersCapturedMaterialFirst = workflowMode === "real_photo_to_video";
  const visualStageRequirementLabel =
    selectedTaskCapturedMaterialFirst || (!selectedTask && pagePrefersCapturedMaterialFirst)
      ? "素材镜头同步与确认"
      : "参考图生成与选图";
  const visualStageRunningLabel =
    selectedTaskCapturedMaterialFirst || (!selectedTask && pagePrefersCapturedMaterialFirst)
      ? "素材镜头仍在处理中，请等待完成后再生成视频。"
      : "参考图仍在处理中，请等待完成后再生成视频。";
  const clipStageAvailable =
    selectedTask && getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("IMAGES_READY");
  const clipRuntimeRunning = Boolean(clipPrimaryAction?.isRunning);
  const clipOutputsComplete =
    selectedTask && clipPipelineSummary
      ? clipPipelineSummary.totalCount > 0 &&
        clipPipelineSummary.availableClipCount >= clipPipelineSummary.totalCount &&
        clipPipelineSummary.failedClipCount === 0 &&
        !clipRuntimeRunning
      : Boolean(
          selectedTask &&
          getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("CLIPS_READY") &&
          !clipRuntimeRunning,
        );
  const compositionStageAvailable = selectedTask && clipOutputsComplete;
  const videoGenerationActionRunning =
    videoGenerationStatusLoading ||
    videoGenerationWorkflowRunning ||
    clipRuntimeRunning ||
    persistedClipStageRunning ||
    persistedCompositionStageRunning;
  const videoGenerationActionBlockedReason = !selectedTask
    ? `请先完成${visualStageRequirementLabel}。`
    : videoGenerationStatusLoading
      ? "视频生成状态加载中，请稍后再试。"
      : keyMaterialStatusLoading || stageProgressLoading
        ? "上游任务状态加载中，请稍后再试。"
        : upstreamGenerationBlockedReason
          ? upstreamGenerationBlockedReason
          : visualPrimaryAction?.isRunning || persistedVisualStageRunning
            ? visualStageRunningLabel
            : !clipStageAvailable
              ? `请先完成${visualStageRequirementLabel}。`
              : !clipPrimaryAction
                ? "视频片段模块加载中，请稍后再试。"
                : clipPrimaryAction.canRun === false || clipPrimaryAction.blockedReason
                  ? (clipPrimaryAction.blockedReason ?? "视频片段模块尚未准备完成，请稍后再试。")
                  : null;
  const videoGenerationBaseLabel =
    selectedTask && getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("COMPOSITION_READY")
      ? "重新生成视频"
      : "生成视频";
  const videoGenerationActionLabel = (() => {
    if (videoGenerationStatusLoading) {
      return "视频生成状态加载中...";
    }

    if (clipPrimaryAction?.blockedReason?.includes("加载中")) {
      return clipPrimaryAction.label;
    }

    if (videoGenerationWorkflowRunning) {
      if (videoGenerationCurrentStep === videoGenerationStepKeys.composition) {
        return (
          videoGenerationProgress.message ||
          compositionPrimaryAction?.label ||
          (persistedCompositionStageRunning
            ? compositionStageProgress?.message || "正在合成视频..."
            : "正在合成视频...")
        );
      }
      return clipPrimaryAction?.isRunning ? clipPrimaryAction.label : "正在生成视频片段...";
    }

    if (clipRuntimeRunning) {
      return clipPrimaryAction?.label || "正在生成视频片段...";
    }

    if (persistedClipStageRunning) {
      return clipGenerationStageProgress?.message || clipPrimaryAction?.label || "正在生成视频片段...";
    }

    if (persistedCompositionStageRunning) {
      return compositionStageProgress?.message || compositionPrimaryAction?.label || "正在合成视频...";
    }

    return videoGenerationBaseLabel;
  })();
  const videoGenerationActionProgressPercent = (() => {
    if (videoGenerationWorkflowRunning) {
      if (videoGenerationCurrentStep === videoGenerationStepKeys.composition) {
        return videoGenerationProgress.percent > 0
          ? videoGenerationProgress.percent
          : (compositionPrimaryAction?.progressPercent ??
              (persistedCompositionStageRunning ? (compositionStageProgress?.percent ?? 50) : 50));
      }
      return clipPrimaryAction?.progressPercent ?? 0;
    }

    if (clipRuntimeRunning) {
      return clipPrimaryAction?.progressPercent ?? 0;
    }

    if (persistedClipStageRunning) {
      return clipPrimaryAction?.progressPercent ?? clipGenerationStageProgress?.percent ?? 0;
    }

    if (persistedCompositionStageRunning) {
      return compositionPrimaryAction?.progressPercent ?? compositionStageProgress?.percent ?? 50;
    }

    return null;
  })();
  const videoGenerationActionState: TaskStepActionState | null =
    selectedTask && clipStageAvailable
      ? {
          label: videoGenerationActionLabel,
          isRunning: videoGenerationActionRunning,
          busyDisplay: videoGenerationStatusLoading ? "status" : "progress",
          progressPercent: videoGenerationActionRunning ? videoGenerationActionProgressPercent : null,
          canRun: !videoGenerationActionBlockedReason,
          blockedReason: videoGenerationActionBlockedReason,
          onAction: () => {
            void handleStartVideoGeneration();
          },
        }
      : null;
  const pipelineStageRuntime = useMemo(
    (): Partial<Record<"draft" | "subtitle_audio" | "images" | "clips" | "composition", PipelineStageRuntime>> => ({
      draft: {
        percent: createActionRunning ? createActionProgressPercent : undefined,
        isRunning: createActionRunning || createActionStatusLoading,
        message: createActionRunning || createActionStatusLoading ? createActionLabel : undefined,
      },
      subtitle_audio: {
        percent: subtitleActionRunning ? subtitleActionProgressPercent : undefined,
        isRunning: subtitleActionRunning,
        message: subtitleActionRunning ? subtitleActionDisplayLabel : undefined,
        hasError: keyMaterialSubtitleStep?.status === "failed",
      },
      images: {
        percent:
          visualPrimaryAction?.progressPercent ??
          (persistedVisualStageRunning ? (visualStageProgress?.percent ?? 0) : undefined),
        isRunning: visualPrimaryAction?.isRunning ?? persistedVisualStageRunning,
        message: visualPrimaryAction?.isRunning
          ? visualPrimaryAction.label
          : persistedVisualStageRunning
            ? visualStageProgress?.message
            : undefined,
        hasError: keyMaterialVisualStep?.status === "failed",
      },
      clips: {
        percent:
          clipPrimaryAction?.progressPercent ??
          (persistedClipStageRunning ? (clipGenerationStageProgress?.percent ?? 0) : undefined),
        isRunning: clipPrimaryAction?.isRunning ?? persistedClipStageRunning,
        message: clipPrimaryAction?.isRunning
          ? clipPrimaryAction.label
          : persistedClipStageRunning
            ? clipGenerationStageProgress?.message
            : undefined,
      },
      composition: {
        percent:
          compositionPrimaryAction?.progressPercent ??
          (persistedCompositionStageRunning ? (compositionStageProgress?.percent ?? 0) : undefined),
        isRunning: compositionPrimaryAction?.isRunning ?? persistedCompositionStageRunning,
        message: compositionPrimaryAction?.isRunning
          ? compositionPrimaryAction.label
          : persistedCompositionStageRunning
            ? compositionStageProgress?.message
            : undefined,
      },
    }),
    [
      clipPrimaryAction?.isRunning,
      clipPrimaryAction?.label,
      clipPrimaryAction?.progressPercent,
      compositionPrimaryAction?.isRunning,
      compositionPrimaryAction?.label,
      compositionPrimaryAction?.progressPercent,
      compositionStageProgress?.message,
      compositionStageProgress?.percent,
      createActionLabel,
      createActionProgressPercent,
      createActionRunning,
      createActionStatusLoading,
      clipGenerationStageProgress?.message,
      clipGenerationStageProgress?.percent,
      persistedClipStageRunning,
      persistedCompositionStageRunning,
      persistedVisualStageRunning,
      subtitleActionDisplayLabel,
      subtitleActionProgressPercent,
      subtitleActionRunning,
      keyMaterialSubtitleStep?.status,
      keyMaterialVisualStep?.status,
      visualStageProgress?.message,
      visualStageProgress?.percent,
      visualPrimaryAction?.isRunning,
      visualPrimaryAction?.label,
      visualPrimaryAction?.progressPercent,
    ],
  );

  const pipelineMetricItems = useMemo((): PipelineMetricItem[] => {
    if (!selectedTask) {
      return [];
    }

    const selectedTaskVideoTypeProfile = getVideoTaskTypeProfile(selectedTask.parameters.video.videoType);
    const metricsCapturedMaterialFirst = usesCapturedMaterialFirstWorkflow(selectedTask.parameters.video.videoType);
    const usesSegmentAudioMetric = usesSegmentLevelSubtitleSource(selectedTask.parameters.video.videoType);
    const plannedShotCount =
      selectedTask.directorPlan?.storyShots.length ??
      selectedTask.shotPlan?.shots.length ??
      selectedTask.parameters.video.storyShotCount ??
      0;
    const narrationDraft = selectedTask.draftBundle.narrationScript.trim();
    const audioCueTotal = usesSegmentAudioMetric
      ? ((selectedTask.directorPlan?.renderSegments.filter((segment) => segment.hasVoice || segment.hasSubtitle)
          .length ||
          selectedTask.parameters.video.segmentCount ||
          subtitleAudioResult?.clips.length) ??
        0)
      : ((countSubtitlePlanTextEntries(selectedTask.directorPlan?.subtitlePlan) ||
          selectedTask.directorPlan?.renderSegments.filter((segment) => segment.hasVoice || segment.hasSubtitle)
            .length ||
          subtitleAudioResult?.clips.length) ??
        0);
    const subtitleReadyCount = usesSegmentAudioMetric
      ? new Set(
          (subtitleAudioResult?.clips ?? [])
            .filter((clip) => Boolean(clip.audioUrl))
            .map((clip) => String(clip.segmentIndex ?? clip.shotIndex)),
        ).size
      : (subtitleAudioResult?.clips.filter((clip) => Boolean(clip.audioUrl)).length ?? 0);
    const storyShots = selectedTask.directorPlan?.storyShots ?? selectedTask.shotPlan?.shots ?? [];
    const hotelPhotoDrivenCount = storyShots.filter(
      (shot) => shot.generationMode === "photo_direct_i2v" || shot.generationMode === "photo_enhanced_i2v",
    ).length;
    const hotelAiFallbackCount = storyShots.filter((shot) => shot.generationMode === "ai_generated_broll").length;
    const audioCueMetricLabel = usesSegmentAudioMetric ? "分段音频就绪" : "分镜音频就绪";
    const audioCueUnitLabel = usesSegmentAudioMetric ? "段" : "镜";
    const visualTotal = Math.max(visualPipelineSummary?.totalCount ?? 0, plannedShotCount);
    const visualStagePendingText = metricsCapturedMaterialFirst ? "待进入素材镜头阶段" : "待进入图片阶段";
    const candidateReadyCount = visualPipelineSummary?.candidateReadyCount ?? 0;
    const finalSelectedCount = visualPipelineSummary?.finalSelectedCount ?? 0;
    const segmentTotal =
      clipPipelineSummary?.totalCount ??
      selectedTask.directorPlan?.renderSegments.length ??
      selectedTask.parameters.video.segmentCount ??
      0;
    const referenceBoundCount = clipPipelineSummary?.referenceBoundCount ?? 0;
    const availableClipCount = clipPipelineSummary?.availableClipCount ?? 0;
    const subtitleSkipped = !selectedTaskVideoTypeProfile.hasVoice && !selectedTaskVideoTypeProfile.hasSubtitle;
    const subtitleTone = subtitleSkipped
      ? "neutral"
      : audioCueTotal && subtitleReadyCount === audioCueTotal
        ? "success"
        : subtitleActionRunning || subtitleAudioLoadStatus === "loading" || subtitleReadyCount > 0
          ? "progress"
          : audioCueTotal
            ? "danger"
            : "neutral";

    const metrics: PipelineMetricItem[] = [
      {
        label: "口播/字幕草稿",
        value: narrationDraft ? `已填写 · ${narrationDraft.length} 字` : subtitleSkipped ? "当前类型跳过" : "待填写",
        tone: narrationDraft ? "success" : subtitleSkipped ? "neutral" : "progress",
      },
      {
        label: audioCueMetricLabel,
        value: subtitleSkipped
          ? "当前类型跳过"
          : audioCueTotal
            ? `${subtitleReadyCount}/${audioCueTotal} ${audioCueUnitLabel}`
            : subtitleActionRunning || subtitleAudioLoadStatus === "loading"
              ? "处理中"
              : "待生成",
        tone: subtitleTone,
      },
      {
        label: metricsCapturedMaterialFirst ? "素材候选覆盖" : "候选图覆盖",
        value: !visualStageAvailable
          ? visualStagePendingText
          : visualTotal
            ? `${candidateReadyCount}/${visualTotal} 镜`
            : "—",
        tone: !visualStageAvailable
          ? "neutral"
          : visualTotal && candidateReadyCount === visualTotal
            ? "success"
            : candidateReadyCount > 0
              ? "progress"
              : "danger",
      },
      {
        label: metricsCapturedMaterialFirst ? "确认素材镜头" : "定稿选图",
        value: !visualStageAvailable
          ? visualStagePendingText
          : visualTotal
            ? `${finalSelectedCount}/${visualTotal} 镜`
            : "—",
        tone: !visualStageAvailable
          ? "neutral"
          : visualTotal && finalSelectedCount === visualTotal
            ? "success"
            : finalSelectedCount > 0
              ? "progress"
              : "danger",
      },
      {
        label: metricsCapturedMaterialFirst ? "素材镜头绑定" : "参考图绑定",
        value: !clipStageAvailable
          ? "待进入片段阶段"
          : segmentTotal
            ? `${referenceBoundCount}/${segmentTotal} 段`
            : "—",
        tone: !clipStageAvailable
          ? "neutral"
          : segmentTotal && referenceBoundCount === segmentTotal
            ? "success"
            : referenceBoundCount > 0
              ? "progress"
              : "danger",
      },
      {
        label: "可用视频片段",
        value: !clipStageAvailable ? "待进入片段阶段" : segmentTotal ? `${availableClipCount}/${segmentTotal} 段` : "—",
        tone: !clipStageAvailable
          ? "neutral"
          : segmentTotal && availableClipCount === segmentTotal
            ? "success"
            : availableClipCount > 0
              ? "progress"
              : "danger",
      },
    ];

    if (usesCapturedMaterialFirstWorkflow(selectedTask.parameters.video.videoType)) {
      metrics.push(
        {
          label: "实拍驱动镜头",
          value: plannedShotCount ? `${hotelPhotoDrivenCount}/${plannedShotCount} 镜` : "—",
          tone:
            plannedShotCount > 0 && hotelPhotoDrivenCount === plannedShotCount
              ? "success"
              : hotelPhotoDrivenCount > 0
                ? "progress"
                : "danger",
        },
        {
          label: "AI 补镜头",
          value: plannedShotCount ? `${hotelAiFallbackCount}/${plannedShotCount} 镜` : "—",
          tone:
            plannedShotCount === 0
              ? "neutral"
              : hotelAiFallbackCount === 0
                ? "success"
                : hotelAiFallbackCount < plannedShotCount
                  ? "progress"
                  : "danger",
        },
      );
    }

    return metrics;
  }, [
    clipPipelineSummary,
    clipStageAvailable,
    selectedTask,
    subtitleActionRunning,
    subtitleAudioLoadStatus,
    subtitleAudioResult,
    visualPipelineSummary,
    visualStageAvailable,
  ]);

  const shotPlanDisplay = useMemo(() => {
    if (!selectedTask) {
      return null;
    }

    const rawShots = selectedTask.shotPlan?.shots?.length
      ? selectedTask.shotPlan.shots
      : (selectedTask.directorPlan?.storyShots ?? []);
    if (!rawShots.length) {
      return null;
    }

    const shots = rawShots.map((shot) => ({
      shotIndex: shot.shotIndex,
      segmentIndex: shot.segmentIndex ?? null,
      purpose: shot.purpose,
      location: shot.location,
      durationSeconds: shot.durationSeconds,
      sceneDescription: shot.sceneDescription,
      action: shot.action,
      emotion: shot.emotion,
      cameraMovement: shot.cameraMovement,
      hasVoice: Boolean(shot.hasVoice),
      hasSubtitle: Boolean(shot.hasSubtitle),
      requiresLipSync: Boolean(shot.requiresLipSync),
      assetId: "assetId" in shot ? (shot.assetId ?? null) : null,
      assetSubjectSummary: "assetSubjectSummary" in shot ? (shot.assetSubjectSummary ?? null) : null,
      referenceImageUrl: "referenceImageUrl" in shot ? (shot.referenceImageUrl ?? null) : null,
      sourceTrace: "sourceTrace" in shot ? (shot.sourceTrace ?? null) : null,
      generationMode: "generationMode" in shot ? (shot.generationMode ?? null) : null,
      needsAiFallback: "needsAiFallback" in shot ? Boolean(shot.needsAiFallback) : false,
      fallbackReason: "fallbackReason" in shot ? (shot.fallbackReason ?? null) : null,
      narrationText: String(
        ("sourceSpokenText" in shot && shot.sourceSpokenText
          ? shot.sourceSpokenText
          : "narrationText" in shot && shot.narrationText
            ? shot.narrationText
            : "sourceSubtitleText" in shot && shot.sourceSubtitleText
              ? shot.sourceSubtitleText
              : shot.narrationHint) ?? "",
      ),
    }));

    const totalDurationSeconds =
      selectedTask.shotPlan?.totalDurationSeconds ??
      selectedTask.directorPlan?.totalDurationSeconds ??
      shots.reduce((total, shot) => total + shot.durationSeconds, 0);

    return {
      shots,
      totalDurationSeconds,
      globalStyle: selectedTask.shotPlan?.globalStyle || "默认风格",
      renderSegmentCount:
        selectedTask.directorPlan?.renderSegments?.length ?? selectedTask.parameters?.video?.segmentCount ?? 1,
      audioCueCount:
        countSubtitlePlanTextEntries(selectedTask.directorPlan?.subtitlePlan) ||
        selectedTask.directorPlan?.renderSegments?.filter((segment) => segment.hasVoice || segment.hasSubtitle)
          .length ||
        0,
      validationErrors: selectedTask.shotPlan?.validationErrors ?? [],
    };
  }, [selectedTask]);

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      try {
        await loadSubtitleAudioResult();
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        handleSubtitleAudioResultChange(null);
        setSubtitleAudioLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "字幕音频结果加载失败"));
      }
    };

    const cancelDeferredRun = scheduleAfterInitialPaint(() => {
      void run();
    });

    return () => {
      isActive = false;
      cancelDeferredRun();
    };
  }, [handleSubtitleAudioResultChange, loadSubtitleAudioResult]);

  useEffect(() => {
    let isActive = true;

    const run = async () => {
      try {
        await loadVideoGenerationWorkflow();
      } catch (loadError) {
        if (!isActive || !selectedTaskIdForHashScroll) {
          return;
        }
        handleVideoGenerationWorkflowChange(null);
        setVideoGenerationLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "视频生成任务状态加载失败"));
      }
    };

    const cancelDeferredRun = scheduleAfterInitialPaint(() => {
      void run();
    });

    return () => {
      isActive = false;
      cancelDeferredRun();
    };
  }, [handleVideoGenerationWorkflowChange, loadVideoGenerationWorkflow, selectedTaskIdForHashScroll]);

  useEffect(() => {
    if (!selectedTaskIdForHashScroll || !subtitleActionRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadSubtitleAudioResult(true).catch(() => undefined);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadSubtitleAudioResult, selectedTaskIdForHashScroll, subtitleActionRunning]);

  useEffect(() => {
    if (
      !selectedTaskIdForHashScroll ||
      !(createActionRunning || keyMaterialWorkflowRunning || videoGenerationWorkflowRunning || hasPersistedRunningStage)
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadSelectedTaskSnapshot().catch(() => undefined);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    createActionRunning,
    hasPersistedRunningStage,
    keyMaterialWorkflowRunning,
    loadSelectedTaskSnapshot,
    selectedTaskIdForHashScroll,
    videoGenerationWorkflowRunning,
  ]);

  useEffect(() => {
    if (!selectedTaskIdForHashScroll || !(isCreating || keyMaterialWorkflowRunning || hasPersistedRunningStage)) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadSelectedTaskStageProgress(true).catch(() => undefined);
    }, 1800);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    hasPersistedRunningStage,
    isCreating,
    keyMaterialWorkflowRunning,
    loadSelectedTaskStageProgress,
    selectedTaskIdForHashScroll,
  ]);

  useEffect(() => {
    if (!selectedTaskIdForHashScroll || !keyMaterialWorkflowRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadKeyMaterialWorkflow(true).catch(() => undefined);
    }, 2200);

    return () => {
      window.clearInterval(timer);
    };
  }, [keyMaterialWorkflowRunning, loadKeyMaterialWorkflow, selectedTaskIdForHashScroll]);

  useEffect(() => {
    if (!selectedTaskIdForHashScroll || !isVideoGenerationWorkflowRunning(videoGenerationWorkflow)) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadVideoGenerationWorkflow(true).catch(() => undefined);
    }, 2200);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadVideoGenerationWorkflow, selectedTaskIdForHashScroll, videoGenerationWorkflow]);

  useEffect(() => {
    if (
      !videoGenerationWorkflowRunning ||
      videoGenerationCurrentStep !== videoGenerationStepKeys.clipGeneration ||
      clipPrimaryAction?.isRunning
    ) {
      videoGenerationClipKickoffRef.current = "";
    }
  }, [clipPrimaryAction?.isRunning, videoGenerationCurrentStep, videoGenerationWorkflowRunning]);

  async function handleOptimizeUserPrompt() {
    const sourcePrompt = createUserPrompt.trim();
    if (!sourcePrompt) {
      setPromptOptimizationMessage("");
      setError(`请先${workflowModeConfig?.userPromptFieldLabel ?? "输入你对视频的要求和想法"}`);
      scrollToFirstStepSection();
      return;
    }

    setIsOptimizingUserPrompt(true);
    setPromptOptimizationMessage("");
    setError(null);

    try {
      const response = await fetch("/api/video-tasks/prompt-optimization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTaskTitle,
          productInfoTitle: selectedProductOption?.title ?? null,
          productInfoSnapshot: selectedProductOption?.snapshot ?? "",
          userPrompt: sourcePrompt,
          videoTemplatePrompt: currentTaskSourcePayload.videoTemplatePrompt,
          videoType,
          expectedDurationRange: videoExpectedDurationRange,
          expectedDurationLabel: selectedExpectedDurationOption?.label ?? "",
          aspectRatio: videoAspectRatio,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        optimizedPrompt?: string;
        usedFallback?: boolean;
        error?: string;
      };

      if (!response.ok || !data.optimizedPrompt) {
        throw new Error(data.error ?? "优化提示词生成失败");
      }

      setCreateOptimizedUserPrompt(data.optimizedPrompt);
      setPromptOptimizationMessage(
        data.usedFallback ? "已使用本地规则整理，可继续编辑。" : "已生成优化提示词，可继续编辑。",
      );
    } catch (optimizeError) {
      setError(optimizeError instanceof Error ? optimizeError.message : "优化提示词生成失败");
    } finally {
      setIsOptimizingUserPrompt(false);
    }
  }

  async function handleBuildShotPlan() {
    if (createActionBlockedReason) {
      setError(createActionBlockedReason);
      scrollToFirstStepSection();
      return;
    }

    setIsCreating(true);
    setError(null);

    const payload = {
      action: directorPrimaryStepActionKeys.buildShotPlan,
      title: createTaskTitle,
      productInfoId: selectedProductOption?.id ?? null,
      productInfoTitle: selectedProductOption?.title ?? null,
      productInfoSnapshot: selectedProductOption?.snapshot ?? "",
      userPrompt: createUserPrompt,
      optimizedUserPrompt: createOptimizedUserPrompt,
      videoMaterialId: createVideoMaterialId || null,
      videoMaterialName: currentTaskSourcePayload.videoMaterialName,
      videoTemplatePrompt: currentTaskSourcePayload.videoTemplatePrompt,
      parameters: currentParameterPayload,
    };

    try {
      const rerunCurrentTask = hasExistingTaskForShotPlanRun && Boolean(selectedTask?.taskId);
      const endpoint = rerunCurrentTask ? `/api/video-tasks/${selectedTask!.taskId}/shot-plan-run` : "/api/video-tasks";

      const data = await createStreamProgress.readStream<TaskShellResponse>(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        {
          onEvent: (event) => {
            if (event.step !== "task_created" || rerunCurrentTask) {
              return;
            }

            const createdTask = event.task as VideoTaskRecord | undefined;
            if (!createdTask?.taskId) {
              return;
            }

            setTasks((current) => upsertTaskRecord(current, createdTask));
            setIsNewTaskDraftMode(false);
            setSelectedTaskId(createdTask.taskId);
            setLastSelectedTaskId(createdTask.taskId);
            setMergeTaskSourceFromSelectedTask(true);
            setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(createdTask));
            setSubtitleAudioResult(null);
            setSubtitleAudioLoadStatus("empty");
            setKeyMaterialWorkflow(null);
            setVideoGenerationWorkflow(null);
            setKeyMaterialLoadStatus("idle");
            setVideoGenerationLoadStatus("idle");
            setSelectedTaskStageProgressLoadStatus("idle");
            setVisualPrimaryAction(null);
            setClipPrimaryAction(null);
            setCompositionPrimaryAction(null);
            setVisualPipelineSummary(null);
            setClipPipelineSummary(null);
            setHighlightedTaskId(createdTask.taskId);
            if (highlightTaskTimerRef.current) {
              window.clearTimeout(highlightTaskTimerRef.current);
            }
            highlightTaskTimerRef.current = window.setTimeout(() => {
              setHighlightedTaskId((current) => (current === createdTask.taskId ? "" : current));
              highlightTaskTimerRef.current = null;
            }, 2600);
          },
        },
      );

      if (!data.task) {
        throw new Error((data.error as string) ?? (rerunCurrentTask ? "镜头规划重建失败" : "创建视频任务失败"));
      }

      setTasks((current) => upsertTaskRecord(current, data.task!));
      if (hasExistingTaskForRerun) {
        setGeneratedVideos((current) => replaceGeneratedVideoRecord(current, data.task!.taskId, null));
      }
      setIsNewTaskDraftMode(false);
      setSelectedTaskId(data.task.taskId);
      setLastSelectedTaskId(data.task.taskId);
      setMergeTaskSourceFromSelectedTask(true);
      setLastCreatedDraftKey(buildTaskCreationDraftKeyFromTask(data.task));
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("empty");
      setKeyMaterialWorkflow(null);
      setVideoGenerationWorkflow(null);
      setKeyMaterialLoadStatus("idle");
      setVideoGenerationLoadStatus("idle");
      setSelectedTaskStageProgressLoadStatus("idle");
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      setLipSyncReady(false);
      void loadTaskShellSnapshot(data.task.taskId).catch(() => null);

      if (!rerunCurrentTask) {
        setHighlightedTaskId(data.task.taskId);
        if (highlightTaskTimerRef.current) {
          window.clearTimeout(highlightTaskTimerRef.current);
        }
        highlightTaskTimerRef.current = window.setTimeout(() => {
          setHighlightedTaskId((current) => (current === data.task!.taskId ? "" : current));
          highlightTaskTimerRef.current = null;
        }, 2600);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "镜头规划执行失败");
    } finally {
      setIsCreating(false);
      createStreamProgress.reset();
    }
  }

  async function handleGenerateKeyMaterials(action: "run" | "retry_failed_step" | "retry_all" = "run") {
    if (!selectedTask) {
      return;
    }

    setIsGeneratingKeyMaterials(true);
    setKeyMaterialLoadStatus("loading");
    setError(null);

    try {
      const data = await readKeyMaterialStream<KeyMaterialWorkflowResponse>(
        `/api/video-tasks/${selectedTask.taskId}/key-materials`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            requestId: crypto.randomUUID(),
            narrationScript: selectedTask.draftBundle.narrationScript,
            video: {
              segmentCount: videoSegmentCount,
              durationSeconds: videoDurationSeconds,
            },
            audio: {
              storyboardEnabled: audioStoryboardEnabled,
              voiceId: audioVoiceId,
              storyboardVoiceIds: audioStoryboardEnabled
                ? audioStoryboardVoiceIds.slice(0, storyboardVoiceSlotCount)
                : [],
              format: audioFormat,
              sampleRate: audioSampleRate,
              speechRate: audioSpeechRate,
              loudnessRate: audioLoudnessRate,
              enableSubtitle: audioEnableSubtitle,
            },
          }),
        },
        {
          onEvent: (event) => {
            const nextWorkflow = (event.workflow as KeyMaterialWorkflowRecord | undefined) ?? null;
            const nextTask = (event.task as VideoTaskRecord | undefined) ?? null;
            const subtitlePayload = (event.subtitle as KeyMaterialWorkflowResponse["subtitle"] | undefined) ?? null;

            if (nextWorkflow) {
              handleKeyMaterialWorkflowChange(nextWorkflow);
              setKeyMaterialLoadStatus("success");
            }

            if (nextTask) {
              setTasks((current) => upsertTaskRecord(current, nextTask));
            }

            if (subtitlePayload?.result) {
              handleSubtitleAudioResultChange(subtitlePayload.result);
              setSubtitleAudioLoadStatus("success");
            }
          },
        },
      );

      if (data.workflow) {
        handleKeyMaterialWorkflowChange(data.workflow);
        setKeyMaterialLoadStatus("success");
      }

      if (data.task) {
        const nextTask = data.task;
        setTasks((current) => upsertTaskRecord(current, nextTask));
      }

      if (data.subtitle?.result) {
        handleSubtitleAudioResultChange(data.subtitle.result);
        setSubtitleAudioLoadStatus("success");
      }

      await Promise.all([
        loadSelectedTaskSnapshot().catch(() => null),
        loadSelectedTaskStageProgress(true).catch(() => null),
        loadKeyMaterialWorkflow(true).catch(() => null),
        loadSubtitleAudioResult(true).catch(() => null),
      ]);

      if (data.error) {
        setError(data.error);
      }
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成关键素材失败");
    } finally {
      setIsGeneratingKeyMaterials(false);
      resetKeyMaterialStream();
    }
  }

  function handleStartSubtitleAudioLineEdit(clip: TaskSubtitleAudioResult["clips"][number]) {
    if (savingSubtitleAudioClipIdsRef.current.has(clip.id)) {
      return;
    }

    editingSubtitleAudioClipIdRef.current = clip.id;
    skipSubtitleAudioBlurCommitRef.current = false;
    setEditingSubtitleAudioClipId(clip.id);
    setEditingSubtitleAudioLineText(buildSubtitleAudioEditText(clip, compositionSubtitleConfig));
    setError(null);
  }

  function clearSubtitleAudioLineEditIfCurrent(clipId: string) {
    if (editingSubtitleAudioClipIdRef.current !== clipId) {
      return;
    }

    editingSubtitleAudioClipIdRef.current = null;
    setEditingSubtitleAudioClipId(null);
    setEditingSubtitleAudioLineText("");
  }

  async function handleConfirmSubtitleAudioLineEdit(clip: TaskSubtitleAudioResult["clips"][number]) {
    if (!selectedTask || !subtitleAudioResult || savingSubtitleAudioClipIdsRef.current.has(clip.id)) {
      return;
    }

    const nextText = normalizeSubtitleAudioEditText(editingSubtitleAudioLineText);
    const nextDisplayCues = parseSubtitleAudioDisplayCues(editingSubtitleAudioLineText, compositionSubtitleConfig);
    const nextDisplayText = normalizeSubtitleAudioEditText(nextDisplayCues.map((cue) => cue.text ?? "").join(""));
    if (!nextText) {
      setError("台词不能为空");
      return;
    }
    if (!nextDisplayCues.length || nextDisplayText !== nextText) {
      setError("上屏字幕句内容需要与台词内容一致");
      return;
    }

    const currentText = normalizeSubtitleAudioEditText(getSubtitleAudioClipLineText(clip));
    const currentDisplayCues = buildSubtitleAudioDisplayUnits(clip, compositionSubtitleConfig).map((unit) => ({
      text: unit.text,
      lines: unit.lines,
    }));
    const nextDisplaySignature = getSubtitleDisplayCueSignature(nextDisplayCues);
    const currentDisplaySignature = getSubtitleDisplayCueSignature(currentDisplayCues);

    if (nextText === currentText && nextDisplaySignature === currentDisplaySignature) {
      clearSubtitleAudioLineEditIfCurrent(clip.id);
      return;
    }

    const saveSignature = `${clip.id}:${nextText}:${nextDisplaySignature}`;
    if (subtitleAudioLineSaveInFlightRef.current.has(saveSignature)) {
      return;
    }

    subtitleAudioLineSaveInFlightRef.current.add(saveSignature);
    setSubtitleAudioClipSaving(clip.id, true);
    setError(null);

    try {
      const response = await fetch(`/api/video-tasks/${selectedTask.taskId}/subtitle-audio-run`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resultId: subtitleAudioResult.resultId,
          clipId: clip.id,
          narrationText: nextText,
          subtitleDisplayCues: nextDisplayCues,
        }),
      });
      const data = (await response.json()) as SubtitleAudioLineUpdateResponse;

      if (!response.ok || !data.result) {
        throw new Error(data.error ?? "修改台词失败");
      }

      if (data.task) {
        setTasks((current) => upsertTaskRecord(current, data.task!));
      }
      handleSubtitleAudioResultChange(data.result);
      setSubtitleAudioLoadStatus("success");
      clearSubtitleAudioLineEditIfCurrent(clip.id);
      setIsSubtitleAudioPanelOpen(true);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      handleVideoGenerationWorkflowChange(null);

      await Promise.all([
        loadSelectedTaskSnapshot().catch(() => null),
        loadSelectedTaskStageProgress(true).catch(() => null),
        loadSubtitleAudioResult(true).catch(() => null),
        loadVideoGenerationWorkflow(true).catch(() => null),
      ]);

      if (data.error) {
        setError(data.error);
      }
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "修改台词失败");
    } finally {
      subtitleAudioLineSaveInFlightRef.current.delete(saveSignature);
      setSubtitleAudioClipSaving(clip.id, false);
    }
  }

  function handleSubtitleAudioLineBlur(clip: TaskSubtitleAudioResult["clips"][number]) {
    if (skipSubtitleAudioBlurCommitRef.current) {
      skipSubtitleAudioBlurCommitRef.current = false;
      return;
    }

    if (editingSubtitleAudioClipIdRef.current !== clip.id || savingSubtitleAudioClipIdsRef.current.has(clip.id)) {
      return;
    }

    void handleConfirmSubtitleAudioLineEdit(clip);
  }

  async function handleStartVideoGeneration() {
    if (!selectedTask) {
      return;
    }

    if (videoGenerationActionBlockedReason) {
      setError(videoGenerationActionBlockedReason);
      return;
    }

    if (!clipPrimaryAction) {
      setError("视频片段模块加载中，请稍后再试。");
      return;
    }

    const blockedReason =
      clipPrimaryAction.blockedReason?.trim() || (clipPrimaryAction.canRun === false ? "请先完成当前步骤。" : "");
    if (blockedReason) {
      setError(blockedReason);
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/video-tasks/${selectedTask.taskId}/video-generation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "run",
          requestId: crypto.randomUUID(),
          composition: {
            includeBackgroundMusic: compositionIncludeBackgroundMusic,
            backgroundMusicUrl: compositionBackgroundMusicUrl,
            backgroundMusicVolume: compositionBackgroundMusicVolume,
            subtitleConfig: compositionSubtitleConfig,
          },
        }),
      });
      const data = (await response.json()) as VideoGenerationWorkflowResponse;
      if (!response.ok || !data.workflow) {
        throw new Error(data.error ?? "视频生成任务启动失败");
      }

      if (data.task) {
        setTasks((current) => upsertTaskRecord(current, data.task!));
      }
      handleVideoGenerationWorkflowChange(data.workflow ?? null);

      if (
        data.workflow.currentStepKey === videoGenerationStepKeys.clipGeneration &&
        !clipPrimaryAction.isRunning &&
        getVideoTaskStatusIndex(selectedTask.status) < getVideoTaskStatusIndex("CLIPS_READY")
      ) {
        clipPrimaryAction.onAction();
      }
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : "视频生成任务启动失败");
    }
  }

  const continueVideoGenerationWorkflow = useCallback(
    async (workflowId: string) => {
      if (!selectedTask || !workflowId) {
        return;
      }

      const saveSignature = `${selectedTask.taskId}:${workflowId}:continue`;
      if (videoGenerationContinueInFlightRef.current === saveSignature) {
        return;
      }

      videoGenerationContinueInFlightRef.current = saveSignature;
      setError(null);

      try {
        const data = await readVideoGenerationStream<VideoGenerationWorkflowResponse>(
          `/api/video-tasks/${selectedTask.taskId}/video-generation`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "continue",
              workflowId,
            }),
          },
          {
            onEvent: (event) => {
              const nextWorkflow = (event.workflow as VideoGenerationWorkflowRecord | undefined) ?? null;
              const nextTask = (event.task as VideoTaskRecord | undefined) ?? null;

              if (nextWorkflow) {
                handleVideoGenerationWorkflowChange(nextWorkflow);
              }
              if (nextTask) {
                setTasks((current) => upsertTaskRecord(current, nextTask));
              }
            },
          },
        );

        if (data.task) {
          setTasks((current) => upsertTaskRecord(current, data.task!));
        }
        if (data.workflow) {
          handleVideoGenerationWorkflowChange(data.workflow);
        }
        if (data.error) {
          throw new Error(data.error);
        }
      } catch (workflowError) {
        setError(workflowError instanceof Error ? workflowError.message : "视频合成执行失败");
      } finally {
        if (videoGenerationContinueInFlightRef.current === saveSignature) {
          videoGenerationContinueInFlightRef.current = "";
        }
        resetVideoGenerationStream();
      }
    },
    [handleVideoGenerationWorkflowChange, readVideoGenerationStream, resetVideoGenerationStream, selectedTask],
  );

  const failVideoGenerationWorkflow = useCallback(
    async (workflowId: string, errorMessage: string) => {
      if (!selectedTask || !workflowId) {
        return;
      }

      const saveSignature = `${selectedTask.taskId}:${workflowId}:fail`;
      if (videoGenerationFailInFlightRef.current === saveSignature) {
        return;
      }

      videoGenerationFailInFlightRef.current = saveSignature;

      try {
        const response = await fetch(`/api/video-tasks/${selectedTask.taskId}/video-generation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "fail",
            workflowId,
            error: errorMessage,
          }),
        });
        const data = (await response.json()) as VideoGenerationWorkflowResponse;
        if (!response.ok) {
          throw new Error(data.error ?? errorMessage);
        }

        if (data.task) {
          setTasks((current) => upsertTaskRecord(current, data.task!));
        }
        handleVideoGenerationWorkflowChange(data.workflow ?? null);
        setError(errorMessage);
      } catch (workflowError) {
        setError(workflowError instanceof Error ? workflowError.message : errorMessage);
      } finally {
        if (videoGenerationFailInFlightRef.current === saveSignature) {
          videoGenerationFailInFlightRef.current = "";
        }
      }
    },
    [handleVideoGenerationWorkflowChange, selectedTask],
  );

  useEffect(() => {
    if (
      !selectedTask ||
      !videoGenerationWorkflowRunning ||
      videoGenerationCurrentStep !== videoGenerationStepKeys.clipGeneration ||
      !clipPrimaryAction
    ) {
      return;
    }

    const workflowId = videoGenerationWorkflow?.workflowId ?? "";
    if (!workflowId) {
      return;
    }

    if (getVideoTaskStatusIndex(selectedTask.status) >= getVideoTaskStatusIndex("CLIPS_READY")) {
      void continueVideoGenerationWorkflow(workflowId);
      return;
    }

    if (!clipPrimaryAction.isRunning && (clipPipelineSummary?.failedClipCount ?? 0) > 0) {
      void failVideoGenerationWorkflow(workflowId, "部分视频片段生成失败，请处理失败片段后重新生成视频。");
      return;
    }

    if (
      !clipPrimaryAction.isRunning &&
      (clipPipelineSummary?.failedClipCount ?? 0) === 0 &&
      videoGenerationClipKickoffRef.current !== workflowId
    ) {
      videoGenerationClipKickoffRef.current = workflowId;
      clipPrimaryAction.onAction();
    }
  }, [
    clipPipelineSummary?.failedClipCount,
    clipPrimaryAction,
    continueVideoGenerationWorkflow,
    failVideoGenerationWorkflow,
    selectedTask,
    videoGenerationCurrentStep,
    videoGenerationWorkflow,
    videoGenerationWorkflowRunning,
  ]);

  const handleReplaceTask = useCallback(
    (updatedTask: VideoTaskRecord) => {
      setTasks((current) => upsertTaskRecord(current, updatedTask));
      if (updatedTask.taskId === selectedTaskIdForHashScroll) {
        const refreshKey = `${updatedTask.updatedAt}:${updatedTask.status}`;
        if (lastTaskShellSnapshotRefreshRef.current[updatedTask.taskId] === refreshKey) {
          return;
        }
        lastTaskShellSnapshotRefreshRef.current[updatedTask.taskId] = refreshKey;
        void loadTaskShellSnapshot(updatedTask.taskId).catch(() => {
          if (lastTaskShellSnapshotRefreshRef.current[updatedTask.taskId] === refreshKey) {
            delete lastTaskShellSnapshotRefreshRef.current[updatedTask.taskId];
          }
          return null;
        });
      }
    },
    [loadTaskShellSnapshot, selectedTaskIdForHashScroll],
  );

  const handleHotelAssetTaskChange = useCallback(
    (updatedTask: VideoTaskRecord) => {
      handleReplaceTask(updatedTask);
      if (updatedTask.shotPlan || updatedTask.directorPlan) {
        return;
      }

      setGeneratedVideos((current) => replaceGeneratedVideoRecord(current, updatedTask.taskId, null));
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("empty");
      handleKeyMaterialWorkflowChange(null);
      setKeyMaterialLoadStatus("idle");
      handleVideoGenerationWorkflowChange(null);
      setVideoGenerationLoadStatus("idle");
      handleSelectedTaskStageProgressChange({});
      setSelectedTaskStageProgressLoadStatus("idle");
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      setVisualPipelineSummary(null);
      setClipPipelineSummary(null);
      setLipSyncReady(false);
    },
    [
      handleKeyMaterialWorkflowChange,
      handleReplaceTask,
      handleSelectedTaskStageProgressChange,
      handleVideoGenerationWorkflowChange,
    ],
  );

  const taskDetailModuleConfigs = useMemo(
    () =>
      taskDetailModules.flatMap((module) => {
        const capturedMaterialTask = Boolean(
          selectedTask && usesCapturedMaterialFirstWorkflow(selectedTask.parameters.video.videoType),
        );
        if (!capturedMaterialTask) {
          return [module];
        }

        if (module.targetStatus === "SUBTITLE_AUDIO_READY") {
          return [
            {
              ...module,
              title: "第三步：素材镜头工作台",
              combinedMaterialWorkbench: true,
            },
          ];
        }

        if (module.targetStatus === "IMAGES_READY") {
          return [];
        }

        if (module.targetStatus === "CLIPS_READY") {
          return [{ ...module, title: "第四步：片段生成" }];
        }

        if (module.targetStatus === "COMPOSITION_READY") {
          return [{ ...module, title: "第五步：视频合成" }];
        }

        return [module];
      }),
    [selectedTask],
  );

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName={workflowModeConfig?.label ?? "任务创建"} />
            </div>
          </header>
          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>{workflowModeConfig?.label ?? "工作台说明"}</strong>
              <span>{workflowModeConfig?.description ?? "统一完成提示词增强、任务调用、状态追踪与结果回传。"}</span>
            </div>
            <button
              className="task-workbench-create-btn"
              type="button"
              disabled={isCreating}
              onClick={() => {
                void handleCreateInputDraftTask();
              }}
            >
              <span className="task-workbench-create-btn-text">{isCreating ? "创建中…" : "创建新的任务"}</span>
            </button>
          </section>
        </section>

        <section className="voice-page-stack">
          {error ? <div className="error-box">{error}</div> : null}
          {!isTaskIndexReady ? <div className="task-module-empty">任务数据加载中...</div> : null}

          <GenerationTasksPanel
            tasks={visibleTasks}
            generatedVideos={visibleGeneratedVideos}
            highlightedTaskId={highlightedTaskId}
            draftMode={isNewTaskDraftMode}
            selectedTaskId={selectedTaskId}
            taskListTitle={workflowModeConfig?.taskListTitle}
            taskListEyebrow={workflowModeConfig?.taskListEyebrow}
            generatedTypeLabel={workflowModeConfig?.generatedVideoTypeLabel}
            previewTitle={workflowModeConfig?.previewTitle}
            previewEyebrow={workflowModeConfig?.previewEyebrow}
            emptyPreviewLabel={workflowModeConfig ? `${workflowModeConfig.label}预览` : undefined}
            onSelectTask={(taskId) => {
              setIsNewTaskDraftMode(false);
              setSelectedTaskId(taskId);
              setLastSelectedTaskId(taskId);
            }}
            onDeleteTask={(taskId) => {
              setTasks((current) => current.filter((task) => task.taskId !== taskId));
              setGeneratedVideos((current) => current.filter((item) => item.taskId !== taskId));
              setHighlightedTaskId((current) => (current === taskId ? "" : current));
              setLastSelectedTaskId((current) => (current === taskId ? "" : current));
            }}
            onError={(message) => setError(message)}
          />

          <PipelineFlow task={selectedTask} stageRuntime={pipelineStageRuntime} metrics={pipelineMetricItems} />

          <section className="composer-card voice-section-card">
            <ModuleTitle
              title={workflowModeConfig?.detailTitle ?? "视频任务详情"}
              eyebrow="任务详情"
              inner
              level="primary"
            />
            <div className="task-detail-stack">
              <section ref={firstStepSectionRef} className="composer-card voice-section-card inner-card">
                <ModuleTitle
                  title={workflowModeConfig?.inputStepTitle ?? "第一步：输入信息"}
                  inner
                  level="secondary"
                  action={<ModuleStatusBadge label={taskCreateStatusMeta.label} tone={taskCreateStatusMeta.tone} />}
                />

                <div className="task-create-layout single-column">
                  <div className="task-create-main">
                    <div className="composer-settings-grid task-create-primary-grid">
                      <label className="setting-field">
                        <span>任务名称</span>
                        <input
                          className="setting-input"
                          type="text"
                          value={createTaskTitle}
                          onChange={(event) => setCreateTaskTitle(event.target.value)}
                          placeholder="输入任务名称"
                        />
                      </label>
                      <label className="setting-field task-product-field">
                        <span>{workflowModeConfig?.productFieldLabel ?? "选择商品信息"}</span>
                        <select
                          className="setting-select"
                          value={createSelectedProductId}
                          onChange={(event) => setCreateSelectedProductId(event.target.value)}
                        >
                          <option value="">{workflowModeConfig?.productEmptyLabel ?? "请选择商品信息"}</option>
                          {productOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="composer-settings-grid task-create-parameter-row-grid">
                      <label className="setting-field task-product-field">
                        <span>视频类型</span>
                        <select
                          className="setting-select"
                          value={videoType}
                          onChange={(event) =>
                            applyVideoTypePreset(event.target.value as (typeof videoTypeOptions)[number]["value"])
                          }
                        >
                          {taskCreationVideoTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="setting-field task-product-field">
                        <span id="task-create-video-material-label">
                          {workflowModeConfig?.videoMaterialFieldLabel ?? "选择参考视频素材（可选）"}
                        </span>
                        <select
                          id="task-create-video-material"
                          className="setting-select"
                          aria-labelledby="task-create-video-material-label"
                          value={createVideoMaterialId}
                          onChange={(event) => setCreateVideoMaterialId(event.target.value)}
                        >
                          <option value="">
                            {workflowModeConfig?.videoMaterialEmptyLabel ?? "不使用参考视频素材"}
                          </option>
                          {referenceVideoMaterialOptions.map((item) => (
                            <option key={item.materialId} value={item.materialId}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="setting-field task-product-field">
                        <span>期望视频时长</span>
                        <select
                          className="setting-select"
                          value={videoExpectedDurationRange}
                          onChange={(event) =>
                            applyExpectedDurationRangePreset(
                              event.target.value as (typeof videoExpectedDurationOptions)[number]["value"],
                            )
                          }
                        >
                          {videoExpectedDurationOptions.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="setting-field task-product-field">
                        <span>画面比例</span>
                        <select
                          className="setting-select"
                          value={videoAspectRatio}
                          onChange={(event) => {
                            const nextAspectRatio = event.target.value as (typeof videoAspectRatioOptions)[number];
                            setVideoAspectRatio(nextAspectRatio);
                            setImageSize(getTaskCreationImageSizeForAspectRatio(nextAspectRatio));
                          }}
                        >
                          {videoAspectRatioOptions.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <section className="task-prompt-optimization-panel" aria-label="提示词优化工作区">
                      <div className="task-prompt-optimization-header">
                        <div>
                          <h4>提示词优化</h4>
                          <p>把原始素材要求整理成更清晰的剪辑指令，生成视频计划时优先使用右侧内容。</p>
                        </div>
                        <span
                          className={`task-prompt-optimization-status ${
                            isOptimizingUserPrompt
                              ? "is-running"
                              : createOptimizedUserPrompt.trim()
                                ? "is-ready"
                                : createUserPrompt.trim()
                                  ? "is-waiting"
                                  : ""
                          }`}
                        >
                          {isOptimizingUserPrompt
                            ? "优化中"
                            : createOptimizedUserPrompt.trim()
                              ? "已优化"
                              : createUserPrompt.trim()
                                ? "可优化"
                                : "待输入"}
                        </span>
                      </div>
                      <div className="task-prompt-optimization-grid">
                        <div className="task-prompt-editor-card task-prompt-editor-card-source">
                          <div className="task-prompt-editor-title-row">
                            <span className="task-prompt-editor-icon" aria-hidden="true">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path
                                  d="M3.4 11.9 4 9.1l6.7-6.7a1.5 1.5 0 0 1 2.1 2.1L6.1 11.2l-2.7.7Z"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinejoin="round"
                                />
                                <path d="M9.7 3.4 11.8 5.5" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M3 13.2h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </span>
                            <div>
                              <label htmlFor="task-create-user-prompt">
                                {workflowModeConfig?.userPromptFieldLabel ?? "输入你对视频的要求和想法"}
                              </label>
                              <p>写清楚卖点、场景、节奏和必须保留的真实素材信息。</p>
                            </div>
                            <span className="task-prompt-editor-count">{createUserPrompt.length} 字</span>
                          </div>
                          <textarea
                            id="task-create-user-prompt"
                            className="prompt-box compact task-editor-textarea task-prompt-editor-textarea"
                            value={createUserPrompt}
                            onChange={(event) => {
                              setCreateUserPrompt(event.target.value);
                              setPromptOptimizationMessage("");
                            }}
                            placeholder={
                              workflowModeConfig?.userPromptPlaceholder ??
                              "输入你希望额外强调的卖点、风格、场景或视频方向。"
                            }
                          />
                          <p className="task-prompt-editor-helper">建议包含：目标人群、核心利益点、拍摄氛围和避雷要求。</p>
                        </div>

                        <div className="task-prompt-optimization-action" aria-hidden="false">
                          <span className="task-prompt-flow-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                              <path
                                d="M4 11h12.5M12.4 6.9 16.5 11l-4.1 4.1"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <button
                            className="btn-primary small task-prompt-optimize-button"
                            type="button"
                            disabled={isOptimizingUserPrompt || !createUserPrompt.trim()}
                            onClick={(event) => {
                              event.preventDefault();
                              void handleOptimizeUserPrompt();
                            }}
                          >
                            {isOptimizingUserPrompt ? "优化中…" : "优化提示词"}
                          </button>
                          <small>{createUserPrompt.trim() ? "点击后生成右侧提示词" : "先填写左侧内容"}</small>
                        </div>

                        <div className="task-prompt-editor-card task-prompt-editor-card-result">
                          <div className="task-prompt-editor-title-row">
                            <span className="task-prompt-editor-icon is-green" aria-hidden="true">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path
                                  d="M8 1.7c.5 3.1 2.2 4.8 5.3 5.3-3.1.5-4.8 2.2-5.3 5.3C7.5 9.2 5.8 7.5 2.7 7 5.8 6.5 7.5 4.8 8 1.7Z"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M12.6 10.2c.2 1.2.9 1.9 2.1 2.1-1.2.2-1.9.9-2.1 2.1-.2-1.2-.9-1.9-2.1-2.1 1.2-.2 1.9-.9 2.1-2.1Z"
                                  fill="currentColor"
                                />
                              </svg>
                            </span>
                            <div>
                              <label htmlFor="task-create-optimized-user-prompt">
                                {workflowModeConfig?.optimizedPromptFieldLabel ?? "系统优化后的创作提示词"}
                              </label>
                              <p>可直接编辑，后续镜头计划会优先读取这里。</p>
                            </div>
                            <span className="task-prompt-editor-count">{createOptimizedUserPrompt.length} 字</span>
                          </div>
                          <textarea
                            id="task-create-optimized-user-prompt"
                            className="prompt-box compact task-editor-textarea task-prompt-editor-textarea"
                            value={createOptimizedUserPrompt}
                            onChange={(event) => setCreateOptimizedUserPrompt(event.target.value)}
                            placeholder="点击“优化提示词”后生成，也可以手动修改。生成视频计划时会优先使用这里。"
                          />
                          <p className="task-prompt-editor-helper task-prompt-editor-helper-result">
                            {promptOptimizationMessage || "优化后会补齐结构、表达重点和素材使用边界。"}
                          </p>
                        </div>
                      </div>
                    </section>
                    <HotelAssetPanel
                      taskId={selectedTask?.taskId ?? null}
                      videoType={videoType}
                      ensureTaskId={ensureHotelAssetInputTask}
                      onAssetCountChange={handleHotelAssetCountChange}
                      onTaskChange={handleHotelAssetTaskChange}
                    />
                  </div>
                </div>

                <div className="task-create-next-step task-next-step-sticky-bar">
                  <TaskNextStepButton
                    state={{
                      label: createActionLabel,
                      isRunning: createActionRunning || createActionStatusLoading,
                      busyDisplay: createActionStatusLoading ? "status" : "progress",
                      progressPercent: createActionRunning ? createActionProgressPercent : null,
                      canRun: !createActionBlockedReason && !createActionStatusLoading,
                      blockedReason: createActionStatusLoading
                        ? "任务状态加载中，请稍后再试。"
                        : createActionBlockedReason,
                      onAction: () => {
                        void handleBuildShotPlan();
                      },
                    }}
                    onBlocked={(reason) => {
                      setError(reason);
                      scrollToFirstStepSection();
                    }}
                  />
                </div>
              </section>

              <section className="composer-card voice-section-card inner-card">
                <ModuleTitle
                  title={selectedTaskCapturedMaterialFirst ? "第二步：成片结构与镜头计划" : "第二步：镜头计划生成"}
                  inner
                  level="secondary"
                  action={<ModuleStatusBadge label={contentBuildStatusMeta.label} tone={contentBuildStatusMeta.tone} />}
                />

                {selectedTask ? (
                  <>
                    <div className="task-plan-workbench">
                      <div className="task-plan-content-stack">
                        <div className="task-plan-detail-entry" id="shot-plan-detail-entry">
                          <div className="task-plan-detail-entry-copy">
                            <strong>
                              {selectedTaskCapturedMaterialFirst
                                ? "成片结构与镜头计划展示页"
                                : "故事板与镜头计划展示页"}
                            </strong>
                            <span>
                              {selectedTaskCapturedMaterialFirst
                                ? "查看商业打法、成交节奏、素材证据绑定、台词字幕和时间参数。"
                                : "用表格查看叙事结构、素材镜头绑定、时间参数、提示词、台词和字幕。"}
                            </span>
                          </div>
                          <div className="task-plan-detail-entry-meta">
                            {shotPlanDisplay ? (
                              <>
                                {storyboardPlan ? (
                                  <Link
                                    className="task-plan-detail-entry-meta-link"
                                    href={`/studio/task-creation/${selectedTask.taskId}/shot-plan`}
                                  >
                                    商业故事板
                                  </Link>
                                ) : null}
                                <span>{`${shotPlanDisplay.renderSegmentCount} 个片段`}</span>
                                <span>{`${shotPlanDisplay.shots.length} 个镜头`}</span>
                                <span>
                                  {formatDurationSecondsLabel(shotPlanDisplay.totalDurationSeconds) ??
                                    `${shotPlanDisplay.totalDurationSeconds} 秒`}
                                </span>
                                {shotPlanDisplay.validationErrors.length ? (
                                  <span className="danger">{`${shotPlanDisplay.validationErrors.length} 项提醒`}</span>
                                ) : null}
                              </>
                            ) : (
                              <span>暂无镜头计划</span>
                            )}
                          </div>
                          <Link
                            className="btn-primary small task-plan-detail-entry-button"
                            href={`/studio/task-creation/${selectedTask.taskId}/shot-plan`}
                          >
                            编辑镜头计划
                          </Link>
                        </div>
                        {selectedTaskCapturedMaterialFirst && shotPlanDisplay ? (
                          <div className="task-plan-asset-binding-strip" aria-label="镜头绑定素材预览">
                            {shotPlanDisplay.shots.map((shot) => {
                              const sourceLabel = formatRealPhotoShotAssetSource(shot);
                              return (
                                <article
                                  key={`shot-asset-binding-${shot.shotIndex}`}
                                  className={`task-plan-asset-binding-item${shot.needsAiFallback ? " needs-fallback" : ""}`}
                                >
                                  {shot.referenceImageUrl ? (
                                    <span
                                      aria-label={`镜头 ${shot.shotIndex} 绑定素材`}
                                      className="task-plan-asset-binding-thumb"
                                      role="img"
                                      style={{ backgroundImage: `url("${shot.referenceImageUrl}")` }}
                                    />
                                  ) : (
                                    <span className="task-plan-asset-binding-thumb missing">补图</span>
                                  )}
                                  <div className="task-plan-asset-binding-copy">
                                    <strong>{`镜头 ${shot.shotIndex}`}</strong>
                                    <span>{sourceLabel}</span>
                                    <p>
                                      {shot.assetSubjectSummary ||
                                        shot.fallbackReason ||
                                        shot.assetId ||
                                        "等待素材绑定"}
                                    </p>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="task-create-parameter-stack task-plan-parameter-stack">
                        <section className="task-inline-parameter-group">
                          <div className="task-inline-parameter-label">音频参数</div>
                          <div className="task-inline-parameter-row">
                            <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-audio-primary-grid">
                              <label className="setting-field">
                                <span>全片时长（自动对齐）</span>
                                <input
                                  className="setting-select"
                                  value={formatDurationSecondsLabel(videoTotalDurationSeconds) ?? "0 秒"}
                                  type="text"
                                  readOnly
                                />
                              </label>
                              {videoTypeProfile.hasVoice ? (
                                <>
                                  {!audioStoryboardEnabled && (
                                    <label className="setting-field">
                                      <span>统一配音音色</span>
                                      <select
                                        className="setting-select"
                                        value={audioVoiceId}
                                        onChange={(event) => setAudioVoiceId(event.target.value)}
                                      >
                                        {audioVoiceOptions.length === 0 && (
                                          <option value="" disabled>
                                            请先在音色管理中收藏或复刻音色
                                          </option>
                                        )}
                                        {audioVoiceOptions.map((item) => (
                                          <option key={item.value} value={item.value}>
                                            {item.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  )}
                                  <label className="setting-field">
                                    <span>开启分段音色</span>
                                    <select
                                      className="setting-select"
                                      value={audioStoryboardEnabled ? "on" : "off"}
                                      onChange={(event) => {
                                        const nextEnabled = event.target.value === "on";
                                        setAudioStoryboardEnabled(nextEnabled);
                                        if (nextEnabled) {
                                          setAudioStoryboardVoiceIds(
                                            Array.from(
                                              { length: storyboardVoiceSlotCount },
                                              (_, index) => audioStoryboardVoiceIds[index] || audioVoiceId,
                                            ),
                                          );
                                        }
                                      }}
                                    >
                                      <option value="off">关闭</option>
                                      <option value="on">开启</option>
                                    </select>
                                  </label>
                                </>
                              ) : (
                                <label className="setting-field">
                                  <span>口播模式</span>
                                  <input
                                    className="setting-select"
                                    value="当前视频类型不生成口播"
                                    type="text"
                                    readOnly
                                  />
                                </label>
                              )}
                            </div>
                            {!videoTypeProfile.hasVoice && videoTypeProfile.hasSubtitle ? (
                              <div className="notice-bar compact inline">
                                <strong>字幕模式</strong>
                                <span>
                                  当前视频类型仅生成字幕和 BGM，不会创建配音音轨；字幕会按片段文案直接出现在成片中。
                                </span>
                              </div>
                            ) : null}
                            {!videoTypeProfile.hasVoice && !videoTypeProfile.hasSubtitle ? (
                              <div className="notice-bar compact inline">
                                <strong>静音混剪模式</strong>
                                <span>
                                  当前视频类型跳过口播和字幕阶段，只保留动作节奏与 BGM，点击下一步会直接同步阶段状态。
                                </span>
                              </div>
                            ) : null}
                            {videoTypeProfile.hasVoice && audioStoryboardEnabled ? (
                              <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-audio-storyboard-grid">
                                {Array.from({ length: storyboardVoiceSlotCount }, (_, index) => (
                                  <label key={`storyboard-voice-${index + 1}`} className="setting-field">
                                    <span>{`分镜音色${index + 1}`}</span>
                                    <select
                                      className="setting-select"
                                      value={audioStoryboardVoiceIds[index] ?? audioVoiceOptions[0]?.value ?? ""}
                                      onChange={(event) =>
                                        setAudioStoryboardVoiceIds((current) =>
                                          Array.from({ length: storyboardVoiceSlotCount }, (_, voiceIndex) =>
                                            voiceIndex === index
                                              ? event.target.value
                                              : current[voiceIndex] || audioVoiceId,
                                          ),
                                        )
                                      }
                                    >
                                      {audioVoiceOptions.length === 0 && (
                                        <option value="" disabled>
                                          请先在音色管理中收藏或复刻音色
                                        </option>
                                      )}
                                      {audioVoiceOptions.map((item) => (
                                        <option key={`${item.value}-${index + 1}`} value={item.value}>
                                          {item.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </section>
                        <CompositionSettingsPanel
                          title="字幕与背景音设置"
                          compact
                          includeBackgroundMusic={compositionIncludeBackgroundMusic}
                          backgroundMusicUrl={compositionBackgroundMusicUrl}
                          backgroundMusicVolume={compositionBackgroundMusicVolume}
                          subtitleConfig={compositionSubtitleConfig}
                          subtitleAspectRatio={selectedTask?.parameters.video.aspectRatio ?? "9:16"}
                          onIncludeBackgroundMusicChange={setCompositionIncludeBackgroundMusic}
                          onBackgroundMusicUrlChange={setCompositionBackgroundMusicUrl}
                          onBackgroundMusicVolumeChange={setCompositionBackgroundMusicVolume}
                          onSubtitleConfigChange={setCompositionSubtitleConfig}
                          previewSlot={
                            <SubtitlePreviewPanel
                              subtitleConfig={compositionSubtitleConfig}
                              materials={subtitlePreviewMaterials}
                              narrationClips={subtitleAudioResult?.clips ?? []}
                              subtitlePlan={selectedTask?.directorPlan?.subtitlePlan}
                              aspectRatio={selectedTask?.parameters.video.aspectRatio ?? "9:16"}
                            />
                          }
                        />
                      </div>
                    </div>
                    <div className="task-module-next-step task-next-step-sticky-bar">
                      <TaskNextStepButton
                        state={keyMaterialActionState}
                        onBlocked={(reason) => {
                          setError(reason);
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="task-module-empty">
                    创建任务后，这里会生成并展示文生图提示词、图生视频提示词和解说稿。
                  </div>
                )}
              </section>

              {taskDetailModuleConfigs.map((module) => {
                const subtitleAudioClipCount = subtitleAudioResult?.clips.length ?? 0;
                const subtitleAudioReadyCount =
                  subtitleAudioResult?.clips.filter((clip) => Boolean(clip.audioUrl)).length ?? 0;
                const subtitleAudioOvertimeCount =
                  subtitleAudioResult?.clips?.filter(
                    (clip) => getReadingCheckMeta(clip.narrationText, clip.durationSeconds).isOvertime,
                  ).length ?? 0;
                const subtitleAudioDurationSeconds =
                  subtitleAudioResult?.clips?.reduce(
                    (total, clip) => total + Math.max(0, clip.durationSeconds || 0),
                    0,
                  ) ?? 0;
                const visualModuleTotal =
                  visualPipelineSummary?.totalCount ??
                  selectedTask?.directorPlan?.storyShots.length ??
                  selectedTask?.parameters.video.storyShotCount ??
                  0;
                const visualCandidateReadyCount = visualPipelineSummary?.candidateReadyCount ?? 0;
                const visualSelectedCount = visualPipelineSummary?.finalSelectedCount ?? 0;
                const visualModuleRunning =
                  Boolean(visualPrimaryAction?.isRunning) || isTaskStageProgressRunning(visualStageProgress);
                const compositionModuleRunning =
                  Boolean(compositionPrimaryAction?.isRunning) || isTaskStageProgressRunning(compositionStageProgress);
                const compositionModulePercent =
                  compositionPrimaryAction?.progressPercent ??
                  (isTaskStageProgressRunning(compositionStageProgress) ? (compositionStageProgress?.percent ?? 0) : 0);
                const moduleStatusMeta =
                  module.combinedMaterialWorkbench && keyMaterialVisualStep?.status === "failed"
                    ? {
                        label: "失败待重试",
                        tone: "editing" as const,
                      }
                    : module.combinedMaterialWorkbench &&
                        selectedTask &&
                        visualStageAvailable &&
                        visualModuleTotal > 0 &&
                        visualModuleRunning
                      ? {
                          label: `生成中 ${visualCandidateReadyCount}/${visualModuleTotal} 镜`,
                          tone: "editing" as const,
                        }
                      : module.combinedMaterialWorkbench &&
                          selectedTask &&
                          visualStageAvailable &&
                          visualModuleTotal > 0 &&
                          visualCandidateReadyCount > 0 &&
                          visualCandidateReadyCount < visualModuleTotal
                        ? {
                            label: `进行中 ${visualCandidateReadyCount}/${visualModuleTotal} 镜`,
                            tone: "editing" as const,
                          }
                        : module.combinedMaterialWorkbench &&
                            selectedTask &&
                            visualStageAvailable &&
                            visualModuleTotal > 0 &&
                            visualCandidateReadyCount === visualModuleTotal &&
                            visualSelectedCount < visualModuleTotal
                          ? {
                              label: `待选图 ${visualSelectedCount}/${visualModuleTotal} 镜`,
                              tone: "editing" as const,
                            }
                          : module.targetStatus === "SUBTITLE_AUDIO_READY" &&
                              keyMaterialSubtitleStep?.status === "failed"
                            ? {
                                label: "失败待重试",
                                tone: "editing" as const,
                              }
                            : module.targetStatus === "SUBTITLE_AUDIO_READY" && selectedTask && subtitleActionRunning
                              ? {
                                  label:
                                    subtitleAudioClipCount > 0
                                      ? `生成中 ${subtitleAudioReadyCount}/${subtitleAudioClipCount}`
                                      : "生成中",
                                  tone: "editing" as const,
                                }
                              : module.targetStatus === "IMAGES_READY" && keyMaterialVisualStep?.status === "failed"
                                ? {
                                    label: "失败待重试",
                                    tone: "editing" as const,
                                  }
                                : module.targetStatus === "IMAGES_READY" &&
                                    selectedTask &&
                                    visualStageAvailable &&
                                    visualModuleTotal > 0 &&
                                    visualModuleRunning
                                  ? {
                                      label: `生成中 ${visualCandidateReadyCount}/${visualModuleTotal} 镜`,
                                      tone: "editing" as const,
                                    }
                                  : module.targetStatus === "IMAGES_READY" &&
                                      selectedTask &&
                                      visualStageAvailable &&
                                      visualModuleTotal > 0 &&
                                      visualCandidateReadyCount > 0 &&
                                      visualCandidateReadyCount < visualModuleTotal
                                    ? {
                                        label: `进行中 ${visualCandidateReadyCount}/${visualModuleTotal} 镜`,
                                        tone: "editing" as const,
                                      }
                                    : module.targetStatus === "IMAGES_READY" &&
                                        selectedTask &&
                                        visualStageAvailable &&
                                        visualModuleTotal > 0 &&
                                        visualCandidateReadyCount === visualModuleTotal &&
                                        visualSelectedCount < visualModuleTotal
                                      ? {
                                          label: `待选图 ${visualSelectedCount}/${visualModuleTotal} 镜`,
                                          tone: "editing" as const,
                                        }
                                      : module.targetStatus === "COMPOSITION_READY" &&
                                          selectedTask &&
                                          compositionStageAvailable &&
                                          compositionModuleRunning
                                        ? {
                                            label:
                                              compositionModulePercent > 0
                                                ? `合成中 ${compositionModulePercent}%`
                                                : "合成中",
                                            tone: "editing" as const,
                                          }
                                        : getVideoTaskModuleStatusMeta(selectedTask?.status, module.targetStatus);

                return (
                  <section key={module.title} className="composer-card voice-section-card inner-card task-module-shell">
                    <ModuleTitle
                      title={module.title}
                      inner
                      level="secondary"
                      action={<ModuleStatusBadge label={moduleStatusMeta.label} tone={moduleStatusMeta.tone} />}
                    />
                    {module.targetStatus === "SUBTITLE_AUDIO_READY" ? (
                      <div className="task-subtitle-audio-stack">
                        {keyMaterialWorkflowErrorMessage ? (
                          <div className="error-box">{keyMaterialWorkflowErrorMessage}</div>
                        ) : null}
                        {keyMaterialWorkflow &&
                        (keyMaterialWorkflow.status === "failed" || keyMaterialWorkflow.status === "partial_failed") ? (
                          <div className="task-module-next-step task-next-step-sticky-bar">
                            <div className="task-next-step-inline-actions">
                              <button
                                className="btn-primary"
                                type="button"
                                disabled={keyMaterialWorkflowRunning}
                                onClick={() => {
                                  void handleGenerateKeyMaterials("retry_failed_step");
                                }}
                              >
                                重试失败步骤
                              </button>
                              <button
                                className="btn-secondary"
                                type="button"
                                disabled={keyMaterialWorkflowRunning}
                                onClick={() => {
                                  void handleGenerateKeyMaterials("retry_all");
                                }}
                              >
                                重试全部关键素材
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {subtitleAudioResult ? (
                          <details
                            className="task-shot-plan-panel task-subtitle-audio-panel"
                            open={isSubtitleAudioPanelOpen}
                            onToggle={(event) => setIsSubtitleAudioPanelOpen(event.currentTarget.open)}
                          >
                            <summary className="task-shot-plan-panel-summary">
                              <div className="task-shot-plan-panel-title">
                                <strong>整体配音与分镜音频</strong>
                                <span>展开后查看整段音频、分镜台词时长与逐镜头音频状态。</span>
                              </div>
                              <div className="task-shot-plan-panel-metrics">
                                <span>{subtitleAudioVoiceModeLabel}</span>
                                <span>{subtitleAudioClipCount ? `${subtitleAudioClipCount} 个镜头` : "暂无镜头"}</span>
                                <span>
                                  {subtitleAudioClipCount
                                    ? `${subtitleAudioReadyCount}/${subtitleAudioClipCount} 音频就绪`
                                    : "待生成音频"}
                                </span>
                                <span>
                                  {formatDurationSecondsLabel(subtitleAudioDurationSeconds) ??
                                    `${subtitleAudioDurationSeconds} 秒`}
                                </span>
                                {storyboardSummary ? (
                                  <span>{`${storyboardSummary.boundMaterialCount} 个素材关联`}</span>
                                ) : null}
                                {subtitleAudioOvertimeCount ? (
                                  <span className="danger">{`${subtitleAudioOvertimeCount} 镜超时`}</span>
                                ) : null}
                              </div>
                              <span className="task-shot-plan-panel-toggle task-subtitle-audio-detail-toggle">
                                <span>{isSubtitleAudioPanelOpen ? "收起" : "展开"}</span>
                                <span
                                  className={`task-subtitle-audio-detail-toggle-icon${isSubtitleAudioPanelOpen ? " is-open" : ""}`}
                                  aria-hidden="true"
                                />
                              </span>
                            </summary>
                            <div className="task-shot-plan-panel-body task-subtitle-audio-stack">
                              {subtitleAudioResult.mergedAudioUrl ? (
                                <div className="task-subtitle-audio-merged-card">
                                  <div className="task-subtitle-audio-item-head">
                                    <strong>整体配音</strong>
                                    <div className="task-subtitle-audio-chips">
                                      <span className="modal-chip status-chip primary">
                                        {subtitleAudioVoiceModeLabel}
                                      </span>
                                      <a
                                        className="task-subtitle-audio-link"
                                        href={subtitleAudioResult.mergedAudioUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        下载音频
                                      </a>
                                    </div>
                                  </div>
                                  <audio
                                    className="task-subtitle-audio-player"
                                    src={subtitleAudioResult.mergedAudioUrl}
                                    controls
                                    preload="metadata"
                                  />
                                </div>
                              ) : null}
                              <div className="task-subtitle-audio-compact-board">
                                <div className="task-subtitle-audio-compact-head" aria-hidden="true">
                                  <span>镜头</span>
                                  <span>台词</span>
                                  <span>时长</span>
                                  <span>起读</span>
                                  <span>状态</span>
                                  <span>音频</span>
                                </div>
                                <div className="task-subtitle-audio-compact-list">
                                  {subtitleAudioResult.clips.map((clip) => {
                                    const lineText = getSubtitleAudioClipLineText(clip);
                                    const subtitleDisplayUnits = buildSubtitleAudioDisplayUnits(
                                      clip,
                                      compositionSubtitleConfig,
                                    );
                                    const isEditingLine = editingSubtitleAudioClipId === clip.id;
                                    const isSavingLine = savingSubtitleAudioClipIds.includes(clip.id);
                                    const storyboardBinding = storyboardBindingByShotIndex.get(clip.shotIndex);
                                    const editorLineCount = editingSubtitleAudioLineText
                                      .split(/\r?\n/)
                                      .filter(Boolean).length;
                                    const editButtonDisabled =
                                      isSavingLine || keyMaterialWorkflowRunning || subtitleActionRunning;
                                    const readingCheckMeta = getReadingCheckMeta(
                                      isEditingLine
                                        ? normalizeSubtitleAudioEditText(editingSubtitleAudioLineText)
                                        : lineText,
                                      clip.durationSeconds,
                                    );

                                    return (
                                      <article
                                        key={clip.id}
                                        className={`task-subtitle-audio-compact-row ${readingCheckMeta.isOvertime ? "warning" : ""}${isSavingLine ? " updating" : ""}`}
                                      >
                                        <div className="task-subtitle-audio-shot-cell">
                                          <strong>{`镜头 ${clip.shotIndex}`}</strong>
                                          {storyboardBinding ? (
                                            <span
                                              className={`task-subtitle-audio-shot-asset${storyboardBinding.needsAiFallback ? " needs-fallback" : ""}`}
                                            >
                                              {storyboardBinding.primaryAssetLabel}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="task-subtitle-audio-line-cell">
                                          <div
                                            className={`task-subtitle-audio-line-edit-row${isEditingLine ? " is-editing" : ""}`}
                                          >
                                            {isEditingLine ? (
                                              <textarea
                                                className="task-subtitle-audio-line-editor"
                                                value={editingSubtitleAudioLineText}
                                                rows={Math.max(2, Math.min(5, editorLineCount || 2))}
                                                disabled={isSavingLine}
                                                onChange={(event) => {
                                                  setEditingSubtitleAudioLineText(event.target.value);
                                                }}
                                                onBlur={() => {
                                                  handleSubtitleAudioLineBlur(clip);
                                                }}
                                                onKeyDown={(event) => {
                                                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                                    event.preventDefault();
                                                    void handleConfirmSubtitleAudioLineEdit(clip);
                                                  }
                                                  if (event.key === "Escape" && !isSavingLine) {
                                                    skipSubtitleAudioBlurCommitRef.current = true;
                                                    clearSubtitleAudioLineEditIfCurrent(clip.id);
                                                  }
                                                }}
                                              />
                                            ) : (
                                              <span className="task-subtitle-audio-line-text">
                                                {subtitleDisplayUnits.length ? (
                                                  subtitleDisplayUnits.map((unit, unitIndex) => (
                                                    <span
                                                      key={`${clip.id}-subtitle-unit-${unitIndex}`}
                                                      className="task-subtitle-audio-display-unit"
                                                    >
                                                      {unit.lines.map((line, lineIndex) => (
                                                        <span
                                                          key={`${clip.id}-subtitle-unit-${unitIndex}-line-${lineIndex}`}
                                                          className="task-subtitle-audio-display-line"
                                                        >
                                                          {line}
                                                        </span>
                                                      ))}
                                                    </span>
                                                  ))
                                                ) : (
                                                  <span>无台词</span>
                                                )}
                                              </span>
                                            )}
                                            <button
                                              className={`${isEditingLine ? "btn-primary" : "btn-secondary"} small task-subtitle-audio-line-edit-button${isEditingLine ? " is-editing" : ""}`}
                                              type="button"
                                              disabled={editButtonDisabled}
                                              aria-label={`${isEditingLine ? "确认修改" : "修改"}镜头 ${clip.shotIndex} 台词`}
                                              onClick={() => {
                                                if (isEditingLine) {
                                                  void handleConfirmSubtitleAudioLineEdit(clip);
                                                } else {
                                                  handleStartSubtitleAudioLineEdit(clip);
                                                }
                                              }}
                                            >
                                              {isSavingLine ? "生成中" : isEditingLine ? "确认" : "修改"}
                                            </button>
                                          </div>
                                          {readingCheckMeta.isOvertime ? (
                                            <span className="task-subtitle-audio-warning compact">{`预计超时 ${formatDurationSecondsLabel(readingCheckMeta.overflowSeconds) ?? "0 秒"}，建议压缩台词。`}</span>
                                          ) : null}
                                          {isEditingLine ? (
                                            <span className="task-subtitle-audio-impact-note">
                                              空行分隔上屏字幕句；改台词会同步本镜头配音，只调字幕行会复用原音频。
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="task-subtitle-audio-duration-cell">
                                          <span>{`镜头 ${formatDurationSecondsLabel(clip.durationSeconds) ?? "0 秒"}`}</span>
                                          <span>{`朗读 ${formatDurationSecondsLabel(readingCheckMeta.estimatedSeconds) ?? "0 秒"}`}</span>
                                        </div>
                                        <div className="task-subtitle-audio-start-cell">
                                          {formatTimelineSecondLabel(clip.startAtSeconds) ?? "第 0.0 秒"}
                                        </div>
                                        <div className="task-subtitle-audio-status-cell">
                                          <span
                                            className={`task-reading-check-chip ${readingCheckMeta.isOvertime ? "danger" : "safe"}`}
                                          >
                                            {readingCheckMeta.isOvertime ? "明显超时" : "时长正常"}
                                          </span>
                                        </div>
                                        <div className="task-subtitle-audio-audio-cell">
                                          {clip.audioUrl ? (
                                            <audio
                                              className="task-subtitle-audio-mini-player"
                                              src={clip.audioUrl}
                                              controls
                                              preload="metadata"
                                            />
                                          ) : (
                                            <span className="task-subtitle-audio-missing">未生成</span>
                                          )}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {module.combinedMaterialWorkbench ? (
                          <section className="task-material-workbench-panel">
                            <div className="task-material-workbench-panel-head">
                              <div>
                                <strong>素材镜头确认</strong>
                                <span>按镜头统一确认图片/视频素材、字幕台词和候选画面。</span>
                              </div>
                              {videoGenerationActionState ? (
                                <TaskNextStepButton
                                  state={videoGenerationActionState}
                                  onBlocked={(reason) => {
                                    setError(reason);
                                  }}
                                />
                              ) : null}
                            </div>
                            {visualStageAvailable ? (
                              <VisualImageModule
                                key={`visual-${selectedTask?.taskId ?? "empty"}`}
                                task={selectedTask}
                                persistedStageProgress={visualStageProgress}
                                narrationClips={subtitleAudioResult?.clips ?? []}
                                onTaskUpdate={handleReplaceTask}
                                onPrimaryActionChange={handleVisualPrimaryActionChange}
                                onSummaryChange={handleVisualPipelineSummaryChange}
                                workflowLocked={createActionRunning || keyMaterialWorkflowRunning}
                              />
                            ) : (
                              <div className="task-module-empty">
                                关键素材生成完成后，这里会展示素材镜头轨道、候选图和当前镜头检查器。
                              </div>
                            )}
                          </section>
                        ) : null}
                      </div>
                    ) : null}
                    {module.targetStatus === "IMAGES_READY" ? (
                      visualStageAvailable ? (
                        <>
                          <VisualImageModule
                            key={`visual-${selectedTask?.taskId ?? "empty"}`}
                            task={selectedTask}
                            persistedStageProgress={visualStageProgress}
                            narrationClips={subtitleAudioResult?.clips ?? []}
                            onTaskUpdate={handleReplaceTask}
                            onPrimaryActionChange={handleVisualPrimaryActionChange}
                            onSummaryChange={handleVisualPipelineSummaryChange}
                            workflowLocked={createActionRunning || keyMaterialWorkflowRunning}
                          />
                          {videoGenerationActionState ? (
                            <div className="task-module-next-step task-next-step-sticky-bar">
                              <TaskNextStepButton
                                state={videoGenerationActionState}
                                onBlocked={(reason) => {
                                  setError(reason);
                                }}
                              />
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="task-module-empty">{module.placeholder}</div>
                      )
                    ) : module.targetStatus === "CLIPS_READY" ? (
                      clipStageAvailable ? (
                        <>
                          <ClipGenerationModule
                            key={`clip-${selectedTask?.taskId ?? "empty"}`}
                            task={selectedTask}
                            onTaskUpdate={handleReplaceTask}
                            onPrimaryActionChange={handleClipPrimaryActionChange}
                            onLipSyncStatusChange={setLipSyncReady}
                            onSummaryChange={handleClipPipelineSummaryChange}
                            upstreamBlockedReason={upstreamGenerationBlockedReason}
                          />
                        </>
                      ) : (
                        <div className="task-module-empty">{module.placeholder}</div>
                      )
                    ) : module.targetStatus === "COMPOSITION_READY" && selectedTask && compositionStageAvailable ? (
                      <CompositionModule
                        key={`composition-${selectedTask?.taskId ?? "empty"}`}
                        task={selectedTask}
                        persistedStageProgress={compositionStageProgress}
                        onTaskUpdate={handleReplaceTask}
                        onPrimaryActionChange={handleCompositionPrimaryActionChange}
                        includeBackgroundMusic={compositionIncludeBackgroundMusic}
                        backgroundMusicUrl={compositionBackgroundMusicUrl}
                        backgroundMusicVolume={compositionBackgroundMusicVolume}
                        subtitleConfig={compositionSubtitleConfig}
                        upstreamBlockedReason={
                          createActionRunning || keyMaterialWorkflowRunning || persistedClipStageRunning
                            ? "上游步骤仍在处理中，请等待完成后再合成视频。"
                            : null
                        }
                      />
                    ) : module.targetStatus === "COMPOSITION_READY" ? (
                      <div className="task-module-empty">{module.placeholder}</div>
                    ) : module.targetStatus !== "SUBTITLE_AUDIO_READY" && module.placeholder ? (
                      <div className="task-module-empty">{module.placeholder}</div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
