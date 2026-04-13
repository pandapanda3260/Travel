"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatDurationMmSs } from "../../../lib/duration-format";
import { estimateNarrationReadingSeconds } from "../../../lib/narration";
import {
  audioFormatOptions,
  audioLoudnessRateOptions,
  audioSampleRateOptions,
  audioSpeechRateOptions,
  audioSubtitleOptions,
  buildTaskCreationDraftKey,
  getDefaultTaskCreationParameterState,
  getTaskCreationExpectedDurationDefaults,
  getTaskCreationImageSizeForAspectRatio,
  getTaskCreationVideoTypeDefaults,
  hydrateTaskCreationParameterState,
  imageGuidanceOptions,
  imageSizeOptions,
  serializeTaskCreationParameterState,
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
} from "../../../lib/task-creation-parameters";
import {
  formatLocalServiceDisplay,
  formatRuntimeDisplay,
  ModuleStatusBadge,
  ModuleTitle,
  TaskDraftEditors,
  TaskStatusHintPanel,
  type TaskStatusHintItem,
} from "./_components/task-ui";
import { PipelineFlow } from "./_components/pipeline-flow";
import { GenerationTasksPanel } from "./_components/generation-tasks-panel";
import { VisualImageModule } from "./_components/visual-image-module";
import { ClipGenerationModule } from "./_components/clip-generation-module";
import { CompositionModule } from "./_components/composition-module";
import { resolveTaskVoiceOptionLabel } from "../../../lib/speaker-display-overrides";
import {
  getVideoTaskTypeProfile,
  getVideoTaskModuleStatusMeta,
  getVideoTaskStatusMeta,
  type VideoTaskGeneratedVideoRecord,
  type VideoTaskRecord,
  type VideoTaskStatus,
} from "../../../lib/video-task-schema";

type TaskCreationIndexPayload = {
  tasks: VideoTaskRecord[];
  generatedVideos?: VideoTaskGeneratedVideoRecord[];
  productOptions: Array<{
    id: string;
    title: string;
    snapshot: string;
  }>;
  referenceVideoMaterialOptions: Array<{
    materialId: string;
    name: string;
    videoTemplatePrompt: string;
  }>;
  runtime: {
    textProviderLabel: string;
    textLiveEnabled: boolean;
    textModelId: string;
    productInfoReady: boolean;
    voiceOptions?: Array<{
      label: string;
      value: string;
      description?: string;
    }>;
  };
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
    startAtSeconds: number;
    durationSeconds: number;
    characterFocus: string;
    subtitleText: string;
    narrationText: string;
    voiceId?: string | null;
    audioUrl?: string | null;
  }>;
};

type TaskSubtitleAudioRuntime = {
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

const taskCreateDraftStorageKey = "task-creation-inline-draft";
type TaskCreateStatus = "idle" | "editing" | "created";
const taskDetailModules: Array<{ title: string; targetStatus: VideoTaskStatus; placeholder: string }> = [
  {
    title: "第三步：音频字幕生成",
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

function getTaskCreateStatusMeta(status: TaskCreateStatus) {
  switch (status) {
    case "created":
      return {
        label: "任务已创建",
        tone: "created" as const,
      };
    case "editing":
      return {
        label: "信息输入中",
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
  };
}

function buildTaskParameterDraftKeyFromPayload(parameters: ReturnType<typeof buildTaskParameterPatchPayload>) {
  return buildTaskCreationDraftKey({
    ...getDefaultTaskCreationParameterState(),
    ...parameters,
  });
}

type ModulePrimaryActionConfig = {
  label: string;
  disabled: boolean;
  onAction: () => void;
};

function sortTasksByCreatedAtDesc(tasks: VideoTaskRecord[]) {
  return [...tasks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function getVideoExpectedDurationLabel(value: (typeof videoExpectedDurationOptions)[number]["value"]) {
  return videoExpectedDurationOptions.find((item) => item.value === value)?.label ?? "15～25 秒";
}

function getVideoSegmentModeLabel(segmentMode: VideoTaskRecord["parameters"]["video"]["segmentMode"]) {
  switch (segmentMode) {
    case "single_speaking":
      return "单说话片段";
    case "single_action":
      return "单动作片段";
    case "hybrid_intro_plus_montage":
      return "3 秒开场 + 多镜头混剪";
    case "multi_shot_montage":
    default:
      return "多镜头混剪";
  }
}

function getShotTypeLabel(shotType: VideoTaskRecord["parameters"]["video"]["shotType"]) {
  return videoShotTypeOptions.find((item) => item.value === shotType)?.label ?? shotType;
}

function getEstimatedVideoTotalDurationSeconds(video: VideoTaskRecord["parameters"]["video"]) {
  if (video.segmentMode === "hybrid_intro_plus_montage") {
    const introDuration = Math.max(1, video.introSegmentDurationSeconds ?? Math.min(3, video.durationSeconds));
    if (video.segmentCount <= 1) {
      return introDuration;
    }

    return introDuration + Math.max(0, video.segmentCount - 1) * video.durationSeconds;
  }

  return video.segmentCount * video.durationSeconds;
}

function getVideoDurationSummary(video: VideoTaskRecord["parameters"]["video"]) {
  if (video.segmentMode === "hybrid_intro_plus_montage") {
    const introDuration = Math.max(1, video.introSegmentDurationSeconds ?? Math.min(3, video.durationSeconds));
    return `首段 ${formatDurationMmSs(introDuration) ?? `${introDuration} 秒`}，其余 ${formatDurationMmSs(video.durationSeconds) ?? `${video.durationSeconds} 秒`}`;
  }

  return formatDurationMmSs(video.durationSeconds) ?? `${video.durationSeconds} 秒`;
}

function getStoryboardVoiceSlotCount(input: { selectedTask: VideoTaskRecord | null; fallbackSegmentCount: number }) {
  if (!input.selectedTask) {
    return Math.max(1, input.fallbackSegmentCount);
  }

  return Math.max(
    1,
    input.selectedTask.directorPlan?.storyShots.length ??
      input.selectedTask.parameters.video.storyShotCount ??
      input.selectedTask.shotPlan?.shots.length ??
      input.fallbackSegmentCount,
  );
}

function buildTaskSourceDraftKey(input: {
  title: string;
  productInfoId: string | null;
  productInfoTitle: string | null;
  productInfoSnapshot: string;
  userPrompt: string;
  videoMaterialId: string | null;
}) {
  return JSON.stringify({
    title: input.title,
    productInfoId: input.productInfoId,
    productInfoTitle: input.productInfoTitle,
    productInfoSnapshot: input.productInfoSnapshot,
    userPrompt: input.userPrompt,
    videoMaterialId: input.videoMaterialId ?? "",
  });
}

export default function TaskCreationIndexPage() {
  const defaultTaskCreationState = getDefaultTaskCreationParameterState();
  const [tasks, setTasks] = useState<VideoTaskRecord[]>([]);
  const [generatedVideos, setGeneratedVideos] = useState<VideoTaskGeneratedVideoRecord[]>([]);
  const [highlightedTaskId, setHighlightedTaskId] = useState("");
  const [productOptions, setProductOptions] = useState<TaskCreationIndexPayload["productOptions"]>([]);
  const [referenceVideoMaterialOptions, setReferenceVideoMaterialOptions] = useState<
    TaskCreationIndexPayload["referenceVideoMaterialOptions"]
  >([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [isNewTaskDraftMode, setIsNewTaskDraftMode] = useState(false);
  const [savingKey, setSavingKey] = useState<"textToImagePrompt" | "imageToVideoPrompt" | "narrationScript" | null>(
    null,
  );
  const [createTaskTitle, setCreateTaskTitle] = useState("");
  const [createSelectedProductId, setCreateSelectedProductId] = useState("");
  const [createUserPrompt, setCreateUserPrompt] = useState("");
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
  const [showVideoNegativePrompt, setShowVideoNegativePrompt] = useState(false);
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
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingSubtitleAudio, setIsGeneratingSubtitleAudio] = useState(false);
  const [subtitleAudioResult, setSubtitleAudioResult] = useState<TaskSubtitleAudioResult | null>(null);
  const [subtitleAudioRuntime, setSubtitleAudioRuntime] = useState<TaskSubtitleAudioRuntime | null>(null);
  const [subtitleAudioLoadStatus, setSubtitleAudioLoadStatus] = useState<
    "idle" | "loading" | "success" | "empty" | "error"
  >("idle");
  const [subtitleAudioGenerateStatus, setSubtitleAudioGenerateStatus] = useState<
    "idle" | "running" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [visualPrimaryAction, setVisualPrimaryAction] = useState<ModulePrimaryActionConfig | null>(null);
  const [clipPrimaryAction, setClipPrimaryAction] = useState<ModulePrimaryActionConfig | null>(null);
  const [compositionPrimaryAction, setCompositionPrimaryAction] = useState<ModulePrimaryActionConfig | null>(null);
  const [lipSyncReady, setLipSyncReady] = useState(false);
  const [mergeTaskSourceFromSelectedTask, setMergeTaskSourceFromSelectedTask] = useState(true);
  const [studioRuntime, setStudioRuntime] = useState<{
    textProviderLabel: string;
    textLiveEnabled: boolean;
    textModelId: string;
    productInfoReady: boolean;
  } | null>(null);
  const firstStepSectionRef = useRef<HTMLElement | null>(null);
  const highlightTaskTimerRef = useRef<number | null>(null);
  const previousSelectedTaskIdRef = useRef("");
  const isApplyingSelectedTaskSourceRef = useRef(false);
  const lastPersistedTaskSourceDraftKeyRef = useRef("");
  const taskSourceSaveInFlightRef = useRef("");
  const isApplyingSelectedTaskParametersRef = useRef(false);
  const lastPersistedTaskParameterDraftKeyRef = useRef("");
  const parameterSaveInFlightRef = useRef("");
  const lastSavedDraftBundleRef = useRef("");
  const draftBundleSaveInFlightRef = useRef("");
  const selectedTask = isNewTaskDraftMode
    ? null
    : (tasks.find((task) => task.taskId === selectedTaskId) ?? tasks[0] ?? null);
  const selectedProductOption = productOptions.find((item) => item.id === createSelectedProductId) ?? null;
  const selectedReferenceVideoMaterialOption =
    referenceVideoMaterialOptions.find((item) => item.materialId === createVideoMaterialId) ?? null;
  const storyboardVoiceSlotCount = useMemo(
    () =>
      getStoryboardVoiceSlotCount({
        selectedTask,
        fallbackSegmentCount: videoSegmentCount,
      }),
    [selectedTask, videoSegmentCount],
  );
  const videoTypeProfile = useMemo(() => getVideoTaskTypeProfile(videoType), [videoType]);

  function applyExpectedDurationRangePreset(
    nextRange: (typeof videoExpectedDurationOptions)[number]["value"],
    nextVideoType: (typeof videoTypeOptions)[number]["value"] = videoType,
  ) {
    const durationDefaults = getTaskCreationExpectedDurationDefaults(nextRange);
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

  const resetTaskCreationDraft = useCallback(() => {
    const defaults = getDefaultTaskCreationParameterState();
    setIsNewTaskDraftMode(true);
    setSelectedTaskId("");
    setHighlightedTaskId("");
    setMergeTaskSourceFromSelectedTask(false);
    setError(null);
    setCreateTaskTitle(defaults.taskTitle);
    setCreateSelectedProductId(defaults.selectedProductId);
    setCreateUserPrompt(defaults.userPrompt);
    setCreateVideoMaterialId(defaults.videoMaterialId);
    setImageSize(defaults.imageSize);
    setImageGuidanceScale(defaults.imageGuidanceScale);
    setImageWatermark(defaults.imageWatermark);
    setImageSeedMode(defaults.imageSeedMode);
    setImageSeedValue(defaults.imageSeedValue);
    setVideoType(defaults.videoType);
    setVideoMode(defaults.videoMode);
    setVideoMultiShot(defaults.videoMultiShot);
    setVideoShotType(defaults.videoShotType);
    setVideoEnableTailFrame(defaults.videoEnableTailFrame);
    setVideoExpectedDurationRange(defaults.videoExpectedDurationRange);
    setVideoSegmentCount(defaults.videoSegmentCount);
    setVideoDurationSeconds(defaults.videoDurationSeconds);
    setVideoAspectRatio(defaults.videoAspectRatio);
    setVideoCfgScale(defaults.videoCfgScale);
    setVideoCameraControl(defaults.videoCameraControl);
    setVideoGenerateAudio(defaults.videoGenerateAudio);
    setVideoWatermark(defaults.videoWatermark);
    setVideoNegativePrompt(defaults.videoNegativePrompt);
    setShowVideoNegativePrompt(false);
    setAudioStoryboardEnabled(defaults.audioStoryboardEnabled);
    setAudioVoiceId(defaults.audioVoiceId);
    setAudioStoryboardVoiceIds(defaults.audioStoryboardVoiceIds);
    setAudioFormat(defaults.audioFormat);
    setAudioSampleRate(defaults.audioSampleRate);
    setAudioSpeechRate(defaults.audioSpeechRate);
    setAudioLoudnessRate(defaults.audioLoudnessRate);
    setAudioEnableSubtitle(defaults.audioEnableSubtitle);
    setConstraintPreset(defaults.constraintPreset);
    setConstraintCustomRules(defaults.constraintCustomRules);
    setLastCreatedDraftKey("");
  }, []);

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
      videoMaterialId: selectedReferenceVideoMaterialOption?.materialId ?? fromTask?.source.videoMaterialId ?? null,
      videoMaterialName: selectedReferenceVideoMaterialOption?.name ?? fromTask?.source.videoMaterialName ?? null,
      videoTemplatePrompt:
        selectedReferenceVideoMaterialOption?.videoTemplatePrompt ?? fromTask?.source.videoTemplatePrompt ?? "",
    };
  }, [
    createSelectedProductId,
    createTaskTitle,
    createUserPrompt,
    createVideoMaterialId,
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

  useEffect(() => {
    let isActive = true;

    const loadPageData = async () => {
      setAudioVoiceOptionLoadStatus("loading");
      try {
        const response = await fetch("/api/video-tasks", { cache: "no-store" });
        const data = (await response.json()) as TaskCreationIndexPayload;

        if (!response.ok) {
          throw new Error(data.error ?? "导演模式页面加载失败");
        }

        if (!isActive) {
          return;
        }

        setTasks(sortTasksByCreatedAtDesc(data.tasks));
        setGeneratedVideos(data.generatedVideos ?? []);
        setProductOptions(data.productOptions ?? []);
        setReferenceVideoMaterialOptions(data.referenceVideoMaterialOptions ?? []);
        const rawVoiceOptions = data.runtime.voiceOptions?.length ? data.runtime.voiceOptions : [];
        const nextVoiceOptions = rawVoiceOptions.map((item) => ({
          ...item,
          label: resolveTaskVoiceOptionLabel(item),
        }));
        const supportedVoiceIds = new Set(nextVoiceOptions.map((item) => item.value));
        const fallbackVoiceId = nextVoiceOptions[0]?.value || getDefaultTaskCreationParameterState().audioVoiceId;
        setAudioVoiceOptions(nextVoiceOptions);
        setAudioVoiceId((current) => normalizeSupportedVoiceId(current, supportedVoiceIds, fallbackVoiceId));
        setAudioStoryboardVoiceIds((current) =>
          Array.from({ length: current.length }, (_, index) =>
            normalizeSupportedVoiceId(current[index], supportedVoiceIds, fallbackVoiceId),
          ),
        );
        setAudioVoiceOptionLoadStatus("success");
        setStudioRuntime({
          textProviderLabel: data.runtime.textProviderLabel,
          textLiveEnabled: data.runtime.textLiveEnabled,
          textModelId: data.runtime.textModelId,
          productInfoReady: data.runtime.productInfoReady,
        });
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        setAudioVoiceOptionLoadStatus("error");
        setError(loadError instanceof Error ? loadError.message : "导演模式页面加载失败");
      }
    };

    void loadPageData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(taskCreateDraftStorageKey);
      if (!rawDraft) {
        setIsDraftHydrated(true);
        return;
      }

      const draft = hydrateTaskCreationParameterState(JSON.parse(rawDraft));

      setCreateTaskTitle(draft.taskTitle);
      setCreateSelectedProductId(draft.selectedProductId);
      setCreateUserPrompt(draft.userPrompt);
      setCreateVideoMaterialId(draft.videoMaterialId ?? "");
      setImageSize(draft.imageSize);
      setImageGuidanceScale(draft.imageGuidanceScale);
      setImageWatermark(draft.imageWatermark);
      setImageSeedMode(draft.imageSeedMode);
      setImageSeedValue(draft.imageSeedValue);
      setVideoType(draft.videoType);
      setVideoMode(draft.videoMode);
      setVideoMultiShot(draft.videoMultiShot);
      setVideoShotType(draft.videoShotType);
      setVideoEnableTailFrame(draft.videoEnableTailFrame);
      setVideoExpectedDurationRange(draft.videoExpectedDurationRange);
      setVideoSegmentCount(draft.videoSegmentCount);
      setVideoDurationSeconds(draft.videoDurationSeconds);
      setVideoAspectRatio(draft.videoAspectRatio);
      setVideoCfgScale(draft.videoCfgScale);
      setVideoCameraControl(draft.videoCameraControl);
      setVideoGenerateAudio(draft.videoGenerateAudio);
      setVideoWatermark(draft.videoWatermark);
      setVideoNegativePrompt(draft.videoNegativePrompt);
      setShowVideoNegativePrompt(false);
      setAudioStoryboardEnabled(draft.audioStoryboardEnabled);
      setAudioVoiceId(draft.audioVoiceId);
      setAudioStoryboardVoiceIds(draft.audioStoryboardVoiceIds);
      setAudioFormat(draft.audioFormat);
      setAudioSampleRate(draft.audioSampleRate);
      setAudioSpeechRate(draft.audioSpeechRate);
      setAudioLoudnessRate(draft.audioLoudnessRate);
      setAudioEnableSubtitle(draft.audioEnableSubtitle);
      setConstraintPreset(draft.constraintPreset);
      setConstraintCustomRules(draft.constraintCustomRules);
      setLastCreatedDraftKey(draft.lastCreatedDraftKey);
      setIsDraftHydrated(true);
    } catch {
      window.localStorage.removeItem(taskCreateDraftStorageKey);
      setIsDraftHydrated(true);
    }
  }, []);

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
        constraintPreset,
        constraintCustomRules,
        lastCreatedDraftKey,
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
    constraintPreset,
    constraintCustomRules,
    createSelectedProductId,
    createTaskTitle,
    createUserPrompt,
    createVideoMaterialId,
    imageGuidanceScale,
    imageSeedMode,
    imageSeedValue,
    imageSize,
    imageWatermark,
    isDraftHydrated,
    lastCreatedDraftKey,
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

  useLayoutEffect(() => {
    if (!selectedTask) {
      setVisualPrimaryAction(null);
      setClipPrimaryAction(null);
      setCompositionPrimaryAction(null);
      isApplyingSelectedTaskSourceRef.current = false;
      lastPersistedTaskSourceDraftKeyRef.current = "";
      previousSelectedTaskIdRef.current = "";
      setSubtitleAudioResult(null);
      setSubtitleAudioLoadStatus("idle");
      return;
    }

    const isTaskSwitched = previousSelectedTaskIdRef.current !== selectedTask.taskId;
    previousSelectedTaskIdRef.current = selectedTask.taskId;

    if (!isTaskSwitched) {
      return;
    }

    setVisualPrimaryAction(null);
    setClipPrimaryAction(null);
    setCompositionPrimaryAction(null);

    setMergeTaskSourceFromSelectedTask(true);
    lastPersistedTaskSourceDraftKeyRef.current = buildTaskSourceDraftKey({
      title: selectedTask.title,
      productInfoId: selectedTask.source.productInfoId,
      productInfoTitle: selectedTask.source.productInfoTitle,
      productInfoSnapshot: selectedTask.source.productInfoSnapshot,
      userPrompt: selectedTask.source.userPrompt,
      videoMaterialId: selectedTask.source.videoMaterialId,
    });
    isApplyingSelectedTaskSourceRef.current = true;
    setCreateTaskTitle(selectedTask.title);
    setCreateSelectedProductId(selectedTask.source.productInfoId ?? "");
    setCreateUserPrompt(selectedTask.source.userPrompt);
    setCreateVideoMaterialId(selectedTask.source.videoMaterialId ?? "");
    setSubtitleAudioResult(null);
    setSubtitleAudioLoadStatus("loading");
  }, [selectedTask]);

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

    const nextTitle = createTaskTitle.trim();
    if (!nextTitle) {
      return;
    }

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
        const data = (await response.json()) as { task?: VideoTaskRecord; error?: string };
        if (!response.ok || !data.task) {
          throw new Error(data.error ?? "保存任务基础信息失败");
        }

        lastPersistedTaskSourceDraftKeyRef.current = saveSignature;
        setTasks((current) =>
          sortTasksByCreatedAtDesc(current.map((task) => (task.taskId === data.task?.taskId ? data.task : task))),
        );
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
  }, [createTaskTitle, currentTaskSourceDraftKey, currentTaskSourcePayload, selectedTask, selectedTaskSourceDraftKey]);

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
        const data = (await response.json()) as { task?: VideoTaskRecord; error?: string };
        if (!response.ok || !data.task) {
          throw new Error(data.error ?? "保存任务参数失败");
        }

        lastPersistedTaskParameterDraftKeyRef.current = saveSignature;
        setTasks((current) =>
          sortTasksByCreatedAtDesc(current.map((task) => (task.taskId === data.task?.taskId ? data.task : task))),
        );
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
  }, [currentParameterPayload, currentTaskParameterDraftKey, selectedTask, selectedTaskParameterDraftKey]);

  useEffect(() => {
    if (isNewTaskDraftMode) {
      setSelectedTaskId("");
      return;
    }

    if (!tasks.length) {
      setSelectedTaskId("");
      return;
    }

    setSelectedTaskId((current) =>
      current && tasks.some((task) => task.taskId === current) ? current : tasks[0].taskId,
    );
  }, [isNewTaskDraftMode, tasks]);

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
    constraintPreset,
    constraintCustomRules,
    lastCreatedDraftKey,
  });
  const hasAnyCreateInput = Boolean(
    createTaskTitle.trim() ||
    createSelectedProductId ||
    createUserPrompt.trim() ||
    selectedReferenceVideoMaterialOption?.materialId,
  );
  const taskCreateStatus: TaskCreateStatus = !hasAnyCreateInput
    ? "idle"
    : currentDraftKey === lastCreatedDraftKey
      ? "created"
      : "editing";
  const taskCreateStatusMeta = getTaskCreateStatusMeta(taskCreateStatus);
  const contentBuildStatusMeta = getVideoTaskModuleStatusMeta(selectedTask?.status, "CREATED");

  const canBuildDirectorTask = Boolean(createTaskTitle.trim() && createUserPrompt.trim());

  const directorModeHintItems = useMemo((): TaskStatusHintItem[] => {
    const voiceTone: TaskStatusHintItem["tone"] =
      audioVoiceOptionLoadStatus === "error"
        ? "danger"
        : audioVoiceOptionLoadStatus === "success"
          ? "success"
          : audioVoiceOptionLoadStatus === "loading"
            ? "progress"
            : "neutral";
    const voiceValue =
      audioVoiceOptionLoadStatus === "loading"
        ? "拉取中"
        : audioVoiceOptionLoadStatus === "success"
          ? `成功 · ${audioVoiceOptions.length} 项`
          : audioVoiceOptionLoadStatus === "error"
            ? "失败"
            : "未开始";

    const textTone: TaskStatusHintItem["tone"] = !studioRuntime
      ? "progress"
      : studioRuntime.textLiveEnabled
        ? "success"
        : "neutral";
    const textValue = !studioRuntime
      ? "页面加载中"
      : formatRuntimeDisplay({
          providerLabel: studioRuntime.textProviderLabel,
          modelId: studioRuntime.textModelId,
          liveEnabled: studioRuntime.textLiveEnabled,
          offlineLabel: "本地规则兜底",
        });

    const productTone: TaskStatusHintItem["tone"] = !studioRuntime
      ? "neutral"
      : studioRuntime.productInfoReady
        ? "success"
        : "danger";
    const productValue = !studioRuntime ? "—" : studioRuntime.productInfoReady ? "商品档案接口可用" : "商品档案未就绪";

    const taskMeta = selectedTask ? getVideoTaskStatusMeta(selectedTask.status) : null;

    return [
      {
        label: "构建条件",
        value: canBuildDirectorTask ? "已满足（任务名称 + 输出提示词）" : "需填写任务名称和输出提示词",
        tone: canBuildDirectorTask ? "success" : "danger",
      },
      {
        label: "镜头计划 / 提示词模型",
        value: textValue,
        tone: textTone,
      },
      {
        label: "商品档案",
        value: productValue,
        tone: productTone,
      },
      {
        label: "音色接口",
        value: voiceValue,
        tone: voiceTone,
      },
      {
        label: "当前任务",
        value: selectedTask ? `${selectedTask.title} · ${taskMeta?.label ?? selectedTask.status}` : "未选择",
        tone: selectedTask ? "neutral" : "neutral",
      },
      {
        label: "基础信息同步",
        value: !selectedTask
          ? "—"
          : currentTaskSourceDraftKey === selectedTaskSourceDraftKey
            ? "与任务一致"
            : "有未保存修改（将自动保存）",
        tone: !selectedTask
          ? "neutral"
          : currentTaskSourceDraftKey === selectedTaskSourceDraftKey
            ? "success"
            : "progress",
      },
    ];
  }, [
    audioVoiceOptionLoadStatus,
    audioVoiceOptions.length,
    canBuildDirectorTask,
    currentTaskSourceDraftKey,
    selectedTask,
    selectedTaskSourceDraftKey,
    studioRuntime,
  ]);

  const contentBuildHintItems = useMemo((): TaskStatusHintItem[] => {
    if (!selectedTask) {
      return [
        {
          label: "当前任务",
          value: "请先点击“创建新的任务”并完成第一步信息填写",
          tone: "neutral",
        },
      ];
    }

    const narration = selectedTask.draftBundle.narrationScript.trim();
    const t2i = selectedTask.draftBundle.textToImagePrompt.trim();
    const i2v = selectedTask.draftBundle.imageToVideoPrompt.trim();
    const bothPrompts = Boolean(t2i && i2v);
    const promptsValue = bothPrompts
      ? "文生图 / 图生视频均已填"
      : !t2i && !i2v
        ? "均未填写"
        : !t2i
          ? "缺文生图提示词"
          : "缺图生视频提示词";

    const shotCount = selectedTask.shotPlan?.shots?.length ?? 0;
    const validationCount = selectedTask.shotPlan?.validationErrors?.length ?? 0;
    const plannerRuntimeValue = !studioRuntime
      ? "页面加载中"
      : formatRuntimeDisplay({
          providerLabel: studioRuntime.textProviderLabel,
          modelId: studioRuntime.textModelId,
          liveEnabled: studioRuntime.textLiveEnabled,
          offlineLabel: "本地规则兜底",
        });
    const plannerRuntimeTone: TaskStatusHintItem["tone"] = !studioRuntime
      ? "progress"
      : studioRuntime.textLiveEnabled
        ? "success"
        : "neutral";

    return [
      {
        label: "流水线位置",
        value: getVideoTaskStatusMeta(selectedTask.status).label,
        tone: "neutral",
      },
      {
        label: "镜头计划 / 提示词模型",
        value: plannerRuntimeValue,
        tone: plannerRuntimeTone,
      },
      {
        label: "口播/字幕草稿",
        value: narration ? `已填写 · ${narration.length} 字` : "未填写（部分视频类型可为空）",
        tone: narration ? "success" : "neutral",
      },
      {
        label: "双提示词",
        value: promptsValue,
        tone: bothPrompts ? "success" : "danger",
      },
      {
        label: "镜头规划",
        value: shotCount ? `已生成 · ${shotCount} 镜` : "未生成（依赖上游文本模型）",
        tone: shotCount ? "success" : "progress",
      },
      {
        label: "计划校验",
        value: validationCount ? `${validationCount} 项提醒` : "无阻塞项",
        tone: validationCount ? "danger" : "success",
      },
      {
        label: "草稿保存",
        value: savingKey ? `保存中 · ${savingKey}` : "空闲",
        tone: savingKey ? "progress" : "success",
      },
    ];
  }, [savingKey, selectedTask, studioRuntime]);

  const subtitleAudioHintItems = useMemo((): TaskStatusHintItem[] => {
    const voiceTone: TaskStatusHintItem["tone"] =
      audioVoiceOptionLoadStatus === "error"
        ? "danger"
        : audioVoiceOptionLoadStatus === "success"
          ? "success"
          : audioVoiceOptionLoadStatus === "loading"
            ? "progress"
            : "neutral";
    const voiceValue =
      audioVoiceOptionLoadStatus === "loading"
        ? "拉取中"
        : audioVoiceOptionLoadStatus === "success"
          ? `成功 · ${audioVoiceOptions.length} 项`
          : audioVoiceOptionLoadStatus === "error"
            ? "失败"
            : "未开始";

    const dataTone: TaskStatusHintItem["tone"] =
      subtitleAudioLoadStatus === "error"
        ? "danger"
        : subtitleAudioLoadStatus === "success"
          ? "success"
          : subtitleAudioLoadStatus === "loading"
            ? "progress"
            : "neutral";
    const dataValue =
      subtitleAudioLoadStatus === "loading"
        ? "拉取中"
        : subtitleAudioLoadStatus === "success"
          ? "已拉到历史结果"
          : subtitleAudioLoadStatus === "empty"
            ? "暂无缓存"
            : subtitleAudioLoadStatus === "error"
              ? "失败"
              : "未开始";

    const genTone: TaskStatusHintItem["tone"] =
      subtitleAudioGenerateStatus === "error"
        ? "danger"
        : subtitleAudioGenerateStatus === "success"
          ? "success"
          : subtitleAudioGenerateStatus === "running"
            ? "progress"
            : "neutral";
    const genValue =
      subtitleAudioGenerateStatus === "running"
        ? "执行中"
        : subtitleAudioGenerateStatus === "success"
          ? "最近一次成功"
          : subtitleAudioGenerateStatus === "error"
            ? "失败（请看顶部报错）"
            : "待触发";

    const clipTotal = subtitleAudioResult?.clips.length ?? 0;
    const audioReady = subtitleAudioResult?.clips.filter((c) => c.audioUrl).length ?? 0;
    const overtimeCount =
      subtitleAudioResult?.clips.filter(
        (clip) => getReadingCheckMeta(clip.narrationText, clip.durationSeconds).isOvertime,
      ).length ?? 0;
    const ttsRuntimeValue = !subtitleAudioRuntime
      ? "待加载"
      : formatRuntimeDisplay({
          providerLabel: subtitleAudioRuntime.ttsProviderLabel,
          modelId: subtitleAudioRuntime.ttsResourceId,
          liveEnabled: subtitleAudioRuntime.ttsLiveEnabled,
          offlineLabel: "离线/不可用",
        });
    const repairRuntimeValue = !subtitleAudioRuntime
      ? "待加载"
      : formatRuntimeDisplay({
          providerLabel: subtitleAudioRuntime.repairProviderLabel,
          modelId: subtitleAudioRuntime.repairModelId,
          liveEnabled: subtitleAudioRuntime.repairLiveEnabled,
          offlineLabel: "本地压缩规则",
        });
    const mergeRuntimeValue = !subtitleAudioRuntime
      ? "待加载"
      : formatLocalServiceDisplay({
          serviceLabel: subtitleAudioRuntime.mergeServiceLabel,
          available: subtitleAudioRuntime.mergeServiceAvailable,
          unavailableLabel: subtitleAudioRuntime.mergeServiceStatus,
        });

    return [
      {
        label: "音频生成服务",
        value: ttsRuntimeValue,
        tone: subtitleAudioRuntime?.ttsLiveEnabled ? "success" : subtitleAudioRuntime ? "danger" : "neutral",
      },
      {
        label: "超时修复模型",
        value: repairRuntimeValue,
        tone: subtitleAudioRuntime?.repairLiveEnabled ? "success" : subtitleAudioRuntime ? "neutral" : "neutral",
      },
      {
        label: "本地混流服务",
        value: mergeRuntimeValue,
        tone: subtitleAudioRuntime?.mergeServiceAvailable ? "success" : subtitleAudioRuntime ? "danger" : "neutral",
      },
      {
        label: "音色接口",
        value: voiceValue,
        tone: voiceTone,
      },
      {
        label: "字幕数据拉取",
        value: dataValue,
        tone: dataTone,
      },
      {
        label: "TTS 生成请求",
        value: genValue,
        tone: genTone,
      },
      {
        label: "分镜音频就绪",
        value: clipTotal ? `${audioReady}/${clipTotal} 镜` : "尚无分镜数据",
        tone: clipTotal && audioReady === clipTotal ? "success" : clipTotal ? "progress" : "neutral",
      },
      {
        label: "台词超时风险",
        value: !clipTotal ? "—" : overtimeCount ? `${overtimeCount} 镜明显超时` : "均在容忍范围",
        tone: !clipTotal ? "neutral" : overtimeCount ? "danger" : "success",
      },
      {
        label: "字幕文件",
        value: subtitleAudioResult?.subtitleSrtUrl ? "已生成可下载" : clipTotal ? "待生成或缺失" : "—",
        tone: subtitleAudioResult?.subtitleSrtUrl ? "success" : clipTotal ? "danger" : "neutral",
      },
    ];
  }, [
    audioVoiceOptionLoadStatus,
    audioVoiceOptions.length,
    subtitleAudioGenerateStatus,
    subtitleAudioLoadStatus,
    subtitleAudioResult,
    subtitleAudioRuntime,
  ]);

  const planningSummaryItems = useMemo(() => {
    if (!selectedTask) {
      return [];
    }

    const renderSegmentCount =
      selectedTask.directorPlan?.renderSegments.length ?? selectedTask.parameters.video.segmentCount;
    const storyShotCount = selectedTask.directorPlan?.storyShots.length ?? selectedTask.parameters.video.storyShotCount;
    const estimatedTotalDuration =
      selectedTask.directorPlan?.totalDurationSeconds ??
      getEstimatedVideoTotalDurationSeconds(selectedTask.parameters.video);

    return [
      {
        label: "期望视频时长",
        value: getVideoExpectedDurationLabel(selectedTask.parameters.video.expectedDurationRange),
      },
      {
        label: "预估总时长",
        value: formatDurationMmSs(estimatedTotalDuration) ?? `${estimatedTotalDuration} 秒`,
      },
      {
        label: "输出片段数",
        value: `${renderSegmentCount} 个`,
      },
      {
        label: "规划镜头数",
        value: `${storyShotCount} 个`,
      },
      {
        label: "单片段时长",
        value: getVideoDurationSummary(selectedTask.parameters.video),
      },
      {
        label: "片段策略",
        value: getVideoSegmentModeLabel(selectedTask.parameters.video.segmentMode),
      },
      {
        label: "多镜头生成",
        value: selectedTask.parameters.video.multiShot ? "自动开启" : "单镜头优先",
      },
      {
        label: "分镜方式",
        value: selectedTask.parameters.video.multiShot
          ? getShotTypeLabel(selectedTask.parameters.video.shotType)
          : "系统按单镜头自动处理",
      },
    ];
  }, [selectedTask]);

  useEffect(() => {
    let isActive = true;

    const loadSubtitleAudioResult = async () => {
      if (!selectedTaskId) {
        setSubtitleAudioResult(null);
        setSubtitleAudioRuntime(null);
        setSubtitleAudioLoadStatus("idle");
        return;
      }

      setSubtitleAudioLoadStatus("loading");
      try {
        const response = await fetch(`/api/video-tasks/${selectedTaskId}/subtitle-audio-run`, { cache: "no-store" });
        const data = (await response.json()) as {
          result?: TaskSubtitleAudioResult | null;
          runtime?: TaskSubtitleAudioRuntime;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "字幕音频结果加载失败");
        }

        if (!isActive) {
          return;
        }

        setSubtitleAudioResult(data.result ?? null);
        setSubtitleAudioRuntime(data.runtime ?? null);
        setSubtitleAudioLoadStatus(data.result ? "success" : "empty");
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        setSubtitleAudioResult(null);
        setSubtitleAudioRuntime(null);
        setSubtitleAudioLoadStatus("error");
        setError((current) => current ?? (loadError instanceof Error ? loadError.message : "字幕音频结果加载失败"));
      }
    };

    void loadSubtitleAudioResult();

    return () => {
      isActive = false;
    };
  }, [selectedTaskId]);

  const handleSaveDraftBundle = useCallback(
    async (key: "textToImagePrompt" | "imageToVideoPrompt" | "narrationScript", value: string) => {
      if (!selectedTask) {
        return;
      }

      const normalizedValue = value.trim();
      const currentValue = selectedTask.draftBundle[key];
      const saveSignature = `${selectedTask.taskId}:${key}:${normalizedValue}`;
      if (
        value === currentValue ||
        saveSignature === lastSavedDraftBundleRef.current ||
        saveSignature === draftBundleSaveInFlightRef.current
      ) {
        return;
      }

      setSavingKey(key);
      setError(null);
      draftBundleSaveInFlightRef.current = saveSignature;
      setTasks((current) =>
        current.map((task) =>
          task.taskId === selectedTask.taskId
            ? {
                ...task,
                draftBundle: {
                  ...task.draftBundle,
                  [key]: value,
                },
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      );

      try {
        const response = await fetch(`/api/video-tasks/${selectedTask.taskId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draftBundle: {
              [key]: value,
            },
          }),
        });
        const data = (await response.json()) as { task?: VideoTaskRecord; error?: string };
        if (!response.ok || !data.task) {
          throw new Error(data.error ?? "保存任务内容失败");
        }

        lastSavedDraftBundleRef.current = saveSignature;
        setTasks((current) =>
          sortTasksByCreatedAtDesc(current.map((task) => (task.taskId === data.task?.taskId ? data.task : task))),
        );
      } catch (saveError) {
        setTasks((current) =>
          current.map((task) =>
            task.taskId === selectedTask.taskId
              ? {
                  ...task,
                  draftBundle: {
                    ...task.draftBundle,
                    [key]: currentValue,
                  },
                }
              : task,
          ),
        );
        setError(saveError instanceof Error ? saveError.message : "保存任务内容失败");
      } finally {
        if (draftBundleSaveInFlightRef.current === saveSignature) {
          draftBundleSaveInFlightRef.current = "";
        }
        setSavingKey(null);
      }
    },
    [selectedTask],
  );

  async function handleCreateTask() {
    if (
      !createTaskTitle.trim() &&
      !createUserPrompt.trim() &&
      !createSelectedProductId &&
      !selectedReferenceVideoMaterialOption?.materialId
    ) {
      resetTaskCreationDraft();
      scrollToFirstStepSection();
      return;
    }

    const templatePrompt = currentTaskSourcePayload.videoTemplatePrompt.trim();
    if (!createTaskTitle.trim() || !createUserPrompt.trim()) {
      setError("请先填写任务名称和输出提示词，再开始构建内容");
      scrollToFirstStepSection();
      return;
    }

    if (!selectedProductOption?.snapshot?.trim() && !createUserPrompt.trim() && !templatePrompt) {
      setError("请至少补充输出提示词、商品信息或参考视频素材后再开始构建内容");
      scrollToFirstStepSection();
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: createTaskTitle,
          productInfoId: selectedProductOption?.id ?? null,
          productInfoTitle: selectedProductOption?.title ?? null,
          productInfoSnapshot: selectedProductOption?.snapshot ?? "",
          userPrompt: createUserPrompt,
          videoMaterialId: createVideoMaterialId || null,
          videoMaterialName: currentTaskSourcePayload.videoMaterialName,
          videoTemplatePrompt: currentTaskSourcePayload.videoTemplatePrompt,
          parameters: {
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
            constraintPreset,
            constraintCustomRules,
          },
        }),
      });
      const data = (await response.json()) as { task?: VideoTaskRecord; error?: string };

      if (!response.ok || !data.task) {
        throw new Error(data.error ?? "创建视频任务失败");
      }

      setTasks((current) =>
        sortTasksByCreatedAtDesc([data.task!, ...current.filter((task) => task.taskId !== data.task!.taskId)]),
      );
      setIsNewTaskDraftMode(false);
      setSelectedTaskId(data.task.taskId);
      setHighlightedTaskId(data.task.taskId);
      if (highlightTaskTimerRef.current) {
        window.clearTimeout(highlightTaskTimerRef.current);
      }
      highlightTaskTimerRef.current = window.setTimeout(() => {
        setHighlightedTaskId((current) => (current === data.task!.taskId ? "" : current));
        highlightTaskTimerRef.current = null;
      }, 2600);
      setMergeTaskSourceFromSelectedTask(true);
      setLastCreatedDraftKey(currentDraftKey);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建视频任务失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleGenerateSubtitleAudio() {
    if (!selectedTask) {
      return;
    }

    setIsGeneratingSubtitleAudio(true);
    setSubtitleAudioGenerateStatus("running");
    setError(null);

    try {
      const response = await fetch(`/api/video-tasks/${selectedTask.taskId}/subtitle-audio-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
      });
      const data = (await response.json()) as {
        task?: VideoTaskRecord | null;
        result?: TaskSubtitleAudioResult | null;
        runtime?: TaskSubtitleAudioRuntime;
        error?: string;
      };

      // 422 表示生成完成但校验有误差，仍写入部分结果方便用户查看，再抛错提示
      if (data.task) {
        setTasks((current) =>
          sortTasksByCreatedAtDesc(current.map((task) => (task.taskId === data.task?.taskId ? data.task : task))),
        );
      }
      if (data.result) {
        setSubtitleAudioResult(data.result);
        setSubtitleAudioLoadStatus("success");
      }
      if (data.runtime) {
        setSubtitleAudioRuntime(data.runtime);
      }

      if (!response.ok || !data.task || !data.result) {
        throw new Error(data.error ?? "生成字幕音频失败");
      }

      setSubtitleAudioGenerateStatus("success");
    } catch (generateError) {
      setSubtitleAudioGenerateStatus("error");
      setError(generateError instanceof Error ? generateError.message : "生成字幕音频失败");
    } finally {
      setIsGeneratingSubtitleAudio(false);
    }
  }

  const handleReplaceTask = useCallback((updatedTask: VideoTaskRecord) => {
    setTasks((current) =>
      sortTasksByCreatedAtDesc(current.map((task) => (task.taskId === updatedTask.taskId ? updatedTask : task))),
    );
  }, []);

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <div className="topbar-title brand-inline">
                <div className="brand-mark">AI</div>
                <div className="brand-name-row">
                  <h2>Hospitality AI Studio</h2>
                </div>
              </div>
              <div className="topbar-actions compact">
                <button className="toolbar-button" type="button">
                  查看 API Key
                </button>
                <button className="toolbar-button" type="button">
                  使用说明
                </button>
              </div>
            </div>
          </header>
          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>工作台说明</strong>
              <span>统一完成提示词增强、任务调用、状态追踪与结果回传。</span>
            </div>
            <button
              className="task-workbench-create-btn"
              type="button"
              disabled={isCreating}
              onClick={() => {
                resetTaskCreationDraft();
                scrollToFirstStepSection();
              }}
            >
              <span className="task-workbench-create-btn-text">{isCreating ? "创建中…" : "创建新的任务"}</span>
            </button>
          </section>
        </section>

        <section className="voice-page-stack">
          {error ? <div className="error-box">{error}</div> : null}

          <GenerationTasksPanel
            tasks={tasks}
            generatedVideos={generatedVideos}
            highlightedTaskId={highlightedTaskId}
            draftMode={isNewTaskDraftMode}
            selectedTaskId={selectedTaskId}
            onSelectTask={(taskId) => {
              setIsNewTaskDraftMode(false);
              setSelectedTaskId(taskId);
            }}
            onDeleteTask={(taskId) => {
              setTasks((current) => current.filter((task) => task.taskId !== taskId));
              setGeneratedVideos((current) => current.filter((item) => item.taskId !== taskId));
              setHighlightedTaskId((current) => (current === taskId ? "" : current));
            }}
          />

          <PipelineFlow task={selectedTask} lipSyncReady={lipSyncReady} />

          <section className="composer-card voice-section-card">
            <ModuleTitle title="视频任务详情" eyebrow="任务详情" inner level="primary" />
            <div className="task-detail-stack">
              <section ref={firstStepSectionRef} className="composer-card voice-section-card inner-card">
                <ModuleTitle
                  title="第一步：输入信息"
                  inner
                  level="secondary"
                  action={<ModuleStatusBadge label={taskCreateStatusMeta.label} tone={taskCreateStatusMeta.tone} />}
                />

                <TaskStatusHintPanel
                  description="点击“创建新的任务”会先生成空白草稿并回到第一步，不会立即调用模型。镜头规划使用的「用户侧上下文」由任务名称、商品信息、视频类型、期望时长、主动提示词、画面比例、可选参考视频素材，以及服务端注入的系统提示词与负向提示词共同组成。"
                  items={directorModeHintItems}
                />

                <div className="task-create-layout single-column">
                  <div className="task-create-main">
                    <div className="composer-settings-grid task-create-grid">
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
                        <span>选择商品信息</span>
                        <select
                          className="setting-select"
                          value={createSelectedProductId}
                          onChange={(event) => setCreateSelectedProductId(event.target.value)}
                        >
                          <option value="">请选择商品信息</option>
                          {productOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="setting-field task-product-field">
                        <span>视频类型</span>
                        <select
                          className="setting-select"
                          value={videoType}
                          onChange={(event) =>
                            applyVideoTypePreset(event.target.value as (typeof videoTypeOptions)[number]["value"])
                          }
                        >
                          {videoTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="setting-field task-product-field">
                        <span id="task-create-video-material-label">选择参考视频素材（可选）</span>
                        <select
                          id="task-create-video-material"
                          className="setting-select"
                          aria-labelledby="task-create-video-material-label"
                          value={createVideoMaterialId}
                          onChange={(event) => setCreateVideoMaterialId(event.target.value)}
                        >
                          <option value="">不使用参考视频素材</option>
                          {referenceVideoMaterialOptions.map((item) => (
                            <option key={item.materialId} value={item.materialId}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="setting-field wide">
                        <span>输入提示词</span>
                        <textarea
                          className="prompt-box compact task-editor-textarea"
                          value={createUserPrompt}
                          onChange={(event) => setCreateUserPrompt(event.target.value)}
                          placeholder="输入你希望额外强调的卖点、风格、场景或视频方向。"
                        />
                      </label>
                    </div>
                    <div className="task-create-parameter-stack">
                      <section className="task-inline-parameter-group">
                        <div className="task-inline-parameter-label">需要确认的参数</div>
                        <div className="task-inline-parameter-row">
                          <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-core-grid">
                            <label className="setting-field">
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
                            <label className="setting-field">
                              <span>画面比例</span>
                              <select
                                className="setting-select"
                                value={videoAspectRatio}
                                onChange={(event) => {
                                  const nextAspectRatio = event.target
                                    .value as (typeof videoAspectRatioOptions)[number];
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
                            <label className="setting-field">
                              <span>自动画幅尺寸</span>
                              <input className="setting-select" type="text" value={imageSize} readOnly />
                            </label>
                          </div>
                          <div className="notice-bar compact inline">
                            <strong>自动规划说明</strong>
                            <span>
                              片段策略、输出片段数、规划镜头数、分镜方式、单片段时长等参数会在第二步根据视频类型与期望时长自动生成并展示。
                            </span>
                          </div>
                        </div>
                      </section>

                      <details className="task-advanced-details">
                        <summary>
                          <span className="task-advanced-details-summary-inner">
                            <svg
                              className="task-advanced-details-chevron"
                              width={14}
                              height={14}
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden={true}
                            >
                              <path
                                d="M6 9l6 6 6-6"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span>高级参数（可选）</span>
                          </span>
                        </summary>
                        <div className="task-advanced-details-body">
                          <section className="task-inline-parameter-group">
                            <div className="task-inline-parameter-label">图片高级参数</div>
                            <div className="task-inline-parameter-row">
                              <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-advanced-grid">
                                <label className="setting-field">
                                  <span>细节引导</span>
                                  <select
                                    className="setting-select"
                                    value={imageGuidanceScale}
                                    onChange={(event) =>
                                      setImageGuidanceScale(
                                        Number(event.target.value) as (typeof imageGuidanceOptions)[number]["value"],
                                      )
                                    }
                                  >
                                    {imageGuidanceOptions.map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="setting-field">
                                  <span>随机种子</span>
                                  <select
                                    className="setting-select"
                                    value={imageSeedMode}
                                    onChange={(event) => setImageSeedMode(event.target.value as "random" | "fixed")}
                                  >
                                    <option value="random">系统随机</option>
                                    <option value="fixed">固定种子（预留）</option>
                                  </select>
                                </label>
                              </div>
                              {imageSeedMode === "fixed" ? (
                                <div className="image-seed-row task-inline-seed-row">
                                  <input
                                    className="image-seed-input"
                                    value={imageSeedValue}
                                    onChange={(event) => setImageSeedValue(event.target.value.replace(/[^\d-]/g, ""))}
                                    placeholder="输入整数种子"
                                  />
                                  <span className="table-meta">
                                    Doubao-Seedream-4.5 当前官方未开放 seed 控制，先保留为接入预留位
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </section>

                          <section className="task-inline-parameter-group">
                            <div className="task-inline-parameter-label">视频高级参数</div>
                            <div className="task-inline-parameter-row">
                              <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-advanced-grid">
                                <label className="setting-field">
                                  <span>输出画质</span>
                                  <select
                                    className="setting-select"
                                    value={videoMode}
                                    onChange={(event) =>
                                      setVideoMode(event.target.value as (typeof videoModeOptions)[number]["value"])
                                    }
                                  >
                                    {videoModeOptions.map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="setting-field">
                                  <span>提示词相关性</span>
                                  <select
                                    className="setting-select"
                                    value={videoCfgScale}
                                    onChange={(event) =>
                                      setVideoCfgScale(
                                        Number(event.target.value) as (typeof videoCfgScaleOptions)[number],
                                      )
                                    }
                                  >
                                    {videoCfgScaleOptions.map((item) => (
                                      <option key={item} value={item}>
                                        {item}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="setting-field">
                                  <span>预设运镜</span>
                                  <select
                                    className="setting-select"
                                    value={videoCameraControl}
                                    onChange={(event) =>
                                      setVideoCameraControl(
                                        event.target.value as (typeof videoCameraControlOptions)[number]["value"],
                                      )
                                    }
                                  >
                                    {videoCameraControlOptions.map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="setting-field">
                                  <span>负向约束</span>
                                  <button
                                    className={`setting-select negative-toggle task-inline-negative-toggle ${showVideoNegativePrompt ? "active" : ""}`}
                                    type="button"
                                    onClick={() => setShowVideoNegativePrompt((current) => !current)}
                                  >
                                    {showVideoNegativePrompt
                                      ? "收起详情"
                                      : videoNegativePrompt.trim()
                                        ? "已添加"
                                        : "点击配置"}
                                  </button>
                                </div>
                              </div>
                              {showVideoNegativePrompt ? (
                                <div className="setting-advanced-panel task-inline-negative-panel">
                                  <textarea
                                    className="setting-textarea"
                                    rows={4}
                                    value={videoNegativePrompt}
                                    onChange={(event) => setVideoNegativePrompt(event.target.value)}
                                    placeholder="例如：watermark, blurry, low resolution"
                                  />
                                </div>
                              ) : null}
                            </div>
                          </section>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>

                <div className="task-create-next-step task-next-step-sticky-bar">
                  <button
                    className="btn-primary task-next-step-button"
                    type="button"
                    disabled={isCreating || (!isNewTaskDraftMode && taskCreateStatus === "created")}
                    onClick={() => void handleCreateTask()}
                  >
                    {isCreating ? (
                      "生成中..."
                    ) : (
                      <>
                        <span>开始生成镜头规划</span>
                      </>
                    )}
                  </button>
                </div>
              </section>

              <section className="composer-card voice-section-card inner-card">
                <ModuleTitle
                  title="第二步：镜头计划生成"
                  inner
                  level="secondary"
                  action={<ModuleStatusBadge label={contentBuildStatusMeta.label} tone={contentBuildStatusMeta.tone} />}
                />

                <TaskStatusHintPanel
                  description="关注镜头规划、输出片段规划、音频 Cue 是否齐全，以及兼容导出草稿是否正在保存；这些直接影响后续图片、口播和片段生成。"
                  items={contentBuildHintItems}
                />

                {selectedTask ? (
                  <>
                    <div className="task-plan-summary">
                      {planningSummaryItems.map((item) => (
                        <div key={item.label} className="task-plan-summary-item">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                    {selectedTask.directorPlan ? (
                      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
                        <details className="task-shot-plan-details">
                          <summary
                            style={{
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--accent)",
                              padding: "8px 0",
                            }}
                          >
                            {`${getVideoTaskTypeProfile(selectedTask.parameters.video.videoType).label} · ${selectedTask.directorPlan.storyShots.length} 个规划镜头 / ${selectedTask.directorPlan.renderSegments.length} 个输出片段 / ${selectedTask.directorPlan.audioCues.length} 个音频Cue`}
                          </summary>
                          <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
                            {selectedTask.directorPlan.renderSegments.map((segment) => (
                              <div
                                key={segment.segmentId}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "auto 1fr",
                                  gap: "4px 12px",
                                  padding: "10px 14px",
                                  background: "var(--panel-soft)",
                                  borderRadius: 8,
                                  fontSize: 13,
                                }}
                              >
                                <span style={{ fontWeight: 600, color: "var(--accent)" }}>{segment.title}</span>
                                <span style={{ color: "var(--muted)" }}>
                                  {segment.segmentMode} · {segment.durationSeconds}s ·{" "}
                                  {segment.multiShot
                                    ? `${segment.multiPrompt.length || segment.shotIds.length} 镜头`
                                    : "单镜头"}
                                </span>
                                <span style={{ color: "var(--muted)", fontSize: 12 }}>画面</span>
                                <span>{segment.videoPrompt || "—"}</span>
                                <span style={{ color: "var(--muted)", fontSize: 12 }}>音频</span>
                                <span>
                                  {segment.hasVoice
                                    ? segment.requiresLipSync
                                      ? "有口播 + 对口型"
                                      : "有口播 / 旁白"
                                    : segment.hasSubtitle
                                      ? "无口播，仅字幕"
                                      : "无口播无字幕"}
                                </span>
                                <span style={{ color: "var(--muted)", fontSize: 12 }}>包含镜头</span>
                                <span>{segment.shotIndexes.map((index) => `镜头${index}`).join("、")}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                        {selectedTask.directorPlan.audioCues.length ? (
                          <details className="task-shot-plan-details">
                            <summary
                              style={{
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--accent)",
                                padding: "8px 0",
                              }}
                            >
                              {`音频 Cue（${selectedTask.directorPlan.audioCues.length} 个）`}
                            </summary>
                            <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
                              {selectedTask.directorPlan.audioCues.map((cue) => (
                                <div
                                  key={cue.cueId}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "auto 1fr",
                                    gap: "4px 12px",
                                    padding: "10px 14px",
                                    background: "var(--panel-soft)",
                                    borderRadius: 8,
                                    fontSize: 13,
                                  }}
                                >
                                  <span
                                    style={{ fontWeight: 600, color: "var(--accent)" }}
                                  >{`Cue ${cue.cueIndex}`}</span>
                                  <span
                                    style={{ color: "var(--muted)" }}
                                  >{`绑定片段 ${cue.targetSegmentIndex} · ${cue.startAtSeconds.toFixed(1)}s 开始`}</span>
                                  <span style={{ color: "var(--muted)", fontSize: 12 }}>口播</span>
                                  <span>{cue.hasVoice ? "有口播" : "无口播"}</span>
                                  <span style={{ color: "var(--muted)", fontSize: 12 }}>字幕</span>
                                  <span>{cue.hasSubtitle ? cue.subtitleText || "文案字幕" : "无字幕"}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedTask.shotPlan?.shots?.length ? (
                      <details className="task-shot-plan-details" style={{ marginBottom: 12 }}>
                        <summary
                          style={{
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--accent)",
                            padding: "8px 0",
                          }}
                        >
                          镜头规划明细（{selectedTask.shotPlan.shots.length} 个镜头 ·{" "}
                          {selectedTask.shotPlan.globalStyle || "默认风格"}）
                          {selectedTask.shotPlan.validationErrors?.length ? (
                            <span style={{ color: "var(--danger)", marginLeft: 8, fontWeight: 400 }}>
                              {selectedTask.shotPlan.validationErrors.length} 项校验提醒
                            </span>
                          ) : null}
                        </summary>
                        <div style={{ display: "grid", gap: 8, padding: "8px 0" }}>
                          {selectedTask.shotPlan.shots.map((shot) => (
                            <div
                              key={shot.shotIndex}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "auto 1fr",
                                gap: "4px 12px",
                                padding: "10px 14px",
                                background: "var(--panel-soft)",
                                borderRadius: 8,
                                fontSize: 13,
                              }}
                            >
                              <span style={{ fontWeight: 600, color: "var(--accent)" }}>镜头 {shot.shotIndex}</span>
                              <span style={{ color: "var(--muted)" }}>
                                {shot.purpose} · {shot.location || "未指定地点"}
                              </span>
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>画面</span>
                              <span>{shot.sceneDescription || "—"}</span>
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>动作</span>
                              <span>
                                {shot.action || "—"}
                                {shot.hasCharacters && shot.characters.length > 0
                                  ? ` · 人物：${shot.characters.join("、")}`
                                  : " · 无人物"}
                              </span>
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>口播/字幕</span>
                              <span>
                                {shot.hasVoice || shot.hasSubtitle
                                  ? `${shot.hasVoice ? "有口播" : "无口播"} · ${shot.hasSubtitle ? "有字幕" : "无字幕"}`
                                  : "留白镜头"}
                              </span>
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>旁白</span>
                              <span>{shot.narrationHint || "—"}</span>
                            </div>
                          ))}
                          {selectedTask.shotPlan.validationErrors?.length ? (
                            <div
                              style={{
                                padding: "8px 14px",
                                background: "#fff5f5",
                                borderRadius: 8,
                                fontSize: 12,
                                color: "var(--danger)",
                              }}
                            >
                              <strong>校验提醒：</strong>
                              {selectedTask.shotPlan.validationErrors.map((err, i) => (
                                <div key={i}>· {err}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                    <TaskDraftEditors
                      key={selectedTask.taskId}
                      draftBundle={selectedTask.draftBundle}
                      onSave={handleSaveDraftBundle}
                      savingKey={savingKey}
                      variant="tabs"
                    />
                    <div className="task-create-parameter-stack" style={{ marginTop: 16 }}>
                      <section className="task-inline-parameter-group">
                        <div className="task-inline-parameter-label">音频参数</div>
                        <div className="task-inline-parameter-row">
                          <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-audio-primary-grid">
                            <label className="setting-field">
                              <span>全片时长（自动对齐）</span>
                              <input
                                className="setting-select"
                                value={formatDurationMmSs(videoTotalDurationSeconds) ?? "00:00"}
                                type="text"
                                readOnly
                              />
                            </label>
                            {videoTypeProfile.hasVoice ? (
                              <>
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
                              </>
                            ) : (
                              <label className="setting-field">
                                <span>口播模式</span>
                                <input className="setting-select" value="当前视频类型不生成口播" type="text" readOnly />
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
                          {videoTypeProfile.hasVoice ? (
                            <>
                              <div className="composer-settings-grid image-settings-grid task-inline-parameter-grid task-inline-secondary-grid">
                                <div className="setting-field wide">
                                  <span>豆包语音 API 参数</span>
                                  <div className="notice-bar compact inline" style={{ marginTop: 2 }}>
                                    <strong>当前已接通</strong>
                                    <span>
                                      format、sample_rate、speech_rate、loudness_rate、enable_subtitle
                                      已接入任务参数；其余像 model、emotion、ssml、bit_rate
                                      这类高级字段暂时仍由后端统一控制。
                                    </span>
                                  </div>
                                </div>
                                <div className="setting-field wide">
                                  <span>输出格式（format）</span>
                                  <div className="image-chip-row">
                                    {audioFormatOptions.map((item) => (
                                      <button
                                        key={`audio-format-${item.value}`}
                                        className={`image-option ${audioFormat === item.value ? "active" : ""}`}
                                        type="button"
                                        onClick={() => setAudioFormat(item.value)}
                                        title={item.description}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="setting-field wide">
                                  <span>采样率（sample_rate）</span>
                                  <div className="image-chip-row">
                                    {audioSampleRateOptions.map((item) => (
                                      <button
                                        key={`audio-sample-rate-${item.value}`}
                                        className={`image-option ${audioSampleRate === item.value ? "active" : ""}`}
                                        type="button"
                                        onClick={() => setAudioSampleRate(item.value)}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="setting-field wide">
                                  <span>语速（speech_rate）</span>
                                  <div className="image-chip-row">
                                    {audioSpeechRateOptions.map((item) => (
                                      <button
                                        key={`audio-speech-rate-${item.value}`}
                                        className={`image-option ${audioSpeechRate === item.value ? "active" : ""}`}
                                        type="button"
                                        onClick={() => setAudioSpeechRate(item.value)}
                                        title={item.description}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="setting-field wide">
                                  <span>音量（loudness_rate）</span>
                                  <div className="image-chip-row">
                                    {audioLoudnessRateOptions.map((item) => (
                                      <button
                                        key={`audio-loudness-rate-${item.value}`}
                                        className={`image-option ${audioLoudnessRate === item.value ? "active" : ""}`}
                                        type="button"
                                        onClick={() => setAudioLoudnessRate(item.value)}
                                        title={item.description}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="setting-field wide">
                                  <span>字幕时间戳（enable_subtitle）</span>
                                  <div className="image-chip-row">
                                    {audioSubtitleOptions.map((item) => (
                                      <button
                                        key={`audio-enable-subtitle-${String(item.value)}`}
                                        className={`image-option ${audioEnableSubtitle === item.value ? "active" : ""}`}
                                        type="button"
                                        onClick={() => setAudioEnableSubtitle(item.value)}
                                        title={item.description}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              <div className="notice-bar compact inline">
                                <strong>参数说明</strong>
                                <span>
                                  当前图片、字幕和合成链路更推荐使用 MP3 + 24 kHz + 标准语速 + 标准音量 +
                                  返回字幕时间戳；关闭字幕时间戳后，字幕文件会按片段时长回推时间轴。
                                </span>
                              </div>
                            </>
                          ) : null}
                          <div className="notice-bar compact inline">
                            <strong>时长规则</strong>
                            <span>
                              音频时长自动跟随当前视频总时长，计算方式为片段时长 ×
                              片段数量，避免后续解说长度和成片时长不一致。
                            </span>
                          </div>
                        </div>
                      </section>
                    </div>
                    <div className="task-module-next-step task-next-step-sticky-bar">
                      <button
                        className="btn-primary task-next-step-button"
                        type="button"
                        disabled={
                          isGeneratingSubtitleAudio ||
                          Boolean(
                            selectedTask.directorPlan?.audioCues.some(
                              (cue) =>
                                (cue.hasVoice || cue.hasSubtitle) && !(cue.narrationText || cue.subtitleText).trim(),
                            ),
                          )
                        }
                        onClick={() => void handleGenerateSubtitleAudio()}
                      >
                        {isGeneratingSubtitleAudio ? (
                          "生成中..."
                        ) : (
                          <>
                            <span>
                              {getVideoTaskTypeProfile(selectedTask.parameters.video.videoType).hasVoice ||
                              getVideoTaskTypeProfile(selectedTask.parameters.video.videoType).hasSubtitle
                                ? "点击进行下三步 生成音频/字幕"
                                : "点击进行下三步 同步静音混剪状态"}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="task-module-empty">
                    创建任务后，这里会生成并展示文生图提示词、图生视频提示词和解说稿。
                  </div>
                )}
              </section>

              {taskDetailModules.map((module) => {
                const moduleStatusMeta = getVideoTaskModuleStatusMeta(selectedTask?.status, module.targetStatus);

                return (
                  <section key={module.title} className="composer-card voice-section-card inner-card task-module-shell">
                    <ModuleTitle
                      title={module.title}
                      inner
                      level="secondary"
                      action={<ModuleStatusBadge label={moduleStatusMeta.label} tone={moduleStatusMeta.tone} />}
                    />
                    {module.targetStatus === "SUBTITLE_AUDIO_READY" ? (
                      <TaskStatusHintPanel
                        description="关注音色接口、字幕缓存拉取、TTS 请求、分镜音频与台词时长；任一异常都会导致听感或时间轴对不齐。"
                        items={subtitleAudioHintItems}
                      />
                    ) : null}
                    {module.targetStatus === "SUBTITLE_AUDIO_READY" ? (
                      <div className="task-subtitle-audio-stack">
                        {subtitleAudioResult ? (
                          <>
                            <div className="task-subtitle-audio-summary">
                              <div className="task-subtitle-audio-summary-item">
                                <span>字幕条数</span>
                                <strong>{subtitleAudioResult.clips.length}</strong>
                              </div>
                              <div className="task-subtitle-audio-summary-item">
                                <span>音色模式</span>
                                <strong>{subtitleAudioVoiceModeLabel}</strong>
                              </div>
                              <div className="task-subtitle-audio-summary-item">
                                <span>更新时间</span>
                                <strong>{new Date(subtitleAudioResult.updatedAt).toLocaleString("zh-CN")}</strong>
                              </div>
                              <div className="task-subtitle-audio-summary-item">
                                <span>字幕文件</span>
                                {subtitleAudioResult.subtitleSrtUrl ? (
                                  <a
                                    className="task-subtitle-audio-link"
                                    href={subtitleAudioResult.subtitleSrtUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    下载 SRT
                                  </a>
                                ) : (
                                  <strong>待生成</strong>
                                )}
                              </div>
                            </div>
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
                            <div className="task-subtitle-audio-list">
                              {subtitleAudioResult.clips.map((clip) => {
                                const readingCheckMeta = getReadingCheckMeta(clip.narrationText, clip.durationSeconds);

                                return (
                                  <article key={clip.id} className="task-subtitle-audio-item">
                                    <div className="task-subtitle-audio-item-head">
                                      <span className="task-subtitle-audio-shot-title">{`镜头 ${clip.shotIndex}`}</span>
                                      <div className="task-subtitle-audio-chips">
                                        <span className="modal-chip status-chip primary">{`${formatDurationMmSs(clip.startAtSeconds) ?? "00:00"}起读`}</span>
                                        <span
                                          className={`task-reading-check-chip ${readingCheckMeta.isOvertime ? "danger" : "safe"}`}
                                        >
                                          {readingCheckMeta.isOvertime ? "明显超时" : "时长正常"}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="task-subtitle-audio-meta">
                                      <span>{`台词：${clip.narrationText}`}</span>
                                      <span>{`配音：${clip.voiceId ?? "默认音色"}`}</span>
                                      <span>{`镜头时长：${formatDurationMmSs(clip.durationSeconds) ?? "00:00"} · 预计朗读：${formatDurationMmSs(readingCheckMeta.estimatedSeconds) ?? "00:00"}`}</span>
                                      {readingCheckMeta.isOvertime ? (
                                        <span className="task-subtitle-audio-warning">{`预计超时 ${readingCheckMeta.overflowSeconds.toFixed(1)} 秒，建议压缩台词。`}</span>
                                      ) : null}
                                    </div>
                                    {clip.audioUrl ? (
                                      <audio
                                        className="task-subtitle-audio-player"
                                        src={clip.audioUrl}
                                        controls
                                        preload="metadata"
                                      />
                                    ) : null}
                                  </article>
                                );
                              })}
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {module.targetStatus === "SUBTITLE_AUDIO_READY" && visualPrimaryAction ? (
                      <div className="task-module-next-step task-next-step-sticky-bar">
                        <button
                          className="btn-primary task-next-step-button"
                          type="button"
                          disabled={visualPrimaryAction.disabled}
                          onClick={visualPrimaryAction.onAction}
                        >
                          <span>{visualPrimaryAction.label}</span>
                        </button>
                      </div>
                    ) : module.targetStatus === "IMAGES_READY" ? (
                      <>
                        <VisualImageModule
                          key={`visual-${selectedTask?.taskId ?? "empty"}`}
                          task={selectedTask}
                          onTaskUpdate={handleReplaceTask}
                          onPrimaryActionChange={setVisualPrimaryAction}
                        />
                        {clipPrimaryAction ? (
                          <div className="task-module-next-step task-next-step-sticky-bar">
                            <button
                              className="btn-primary task-next-step-button"
                              type="button"
                              disabled={clipPrimaryAction.disabled}
                              onClick={clipPrimaryAction.onAction}
                            >
                              <span>{clipPrimaryAction.label}</span>
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : module.targetStatus === "CLIPS_READY" ? (
                      <>
                        <ClipGenerationModule
                          key={`clip-${selectedTask?.taskId ?? "empty"}`}
                          task={selectedTask}
                          onTaskUpdate={handleReplaceTask}
                          onPrimaryActionChange={setClipPrimaryAction}
                          onLipSyncStatusChange={setLipSyncReady}
                        />
                        {compositionPrimaryAction ? (
                          <div className="task-module-next-step task-next-step-sticky-bar">
                            <button
                              className="btn-primary task-next-step-button"
                              type="button"
                              disabled={compositionPrimaryAction.disabled}
                              onClick={compositionPrimaryAction.onAction}
                            >
                              <span>{compositionPrimaryAction.label}</span>
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : module.targetStatus === "COMPOSITION_READY" ? (
                      <CompositionModule
                        key={`composition-${selectedTask?.taskId ?? "empty"}`}
                        task={selectedTask}
                        onTaskUpdate={handleReplaceTask}
                        onPrimaryActionChange={setCompositionPrimaryAction}
                      />
                    ) : module.placeholder ? (
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
