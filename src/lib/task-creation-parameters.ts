import { defaultVideoNegativePrompt } from "./prompt";
import { normalizeMediaSourceInput } from "./media-source-input";
import {
  clampSeedanceSegmentDurationSeconds,
  seedanceSegmentDurationOptions,
} from "./video-duration-constraints";
import {
  computeVideoTaskStoryShotCount,
  DEFAULT_VIDEO_TASK_VIDEO_TYPE,
  getVideoTaskTypeProfile,
  taskConstraintPresets,
  type VideoTaskExpectedDurationRange,
  videoTaskTypeProfiles,
  type TaskConstraintPresetKey,
  type VideoTaskVideoType,
} from "./video-task-schema";
import { getDefaultSubtitleConfig, hydrateSubtitleConfig, type SubtitleConfig } from "./subtitle-style-config";

export const imageSizeOptions = [
  { label: "1:1 方图", value: "2048x2048" },
  { label: "2:3 竖图", value: "1664x2496" },
  { label: "3:2 横图", value: "2496x1664" },
  { label: "9:16 竖版", value: "1600x2848" },
  { label: "16:9 横版", value: "2848x1600" },
] as const;

export const imageGuidanceOptions = [
  { label: "自然写实", value: 6.5 },
  { label: "平衡细节", value: 7.5 },
  { label: "质感强化", value: 8.5 },
] as const;

export const watermarkOptions = [
  { label: "关闭水印", value: false },
  { label: "开启水印", value: true },
] as const;

export const videoModeOptions = [
  { label: "标准模式 720P", value: "std" },
  { label: "专业模式 1080P", value: "pro" },
] as const;

export const videoTypeOptions = (
  Object.values(videoTaskTypeProfiles) as Array<(typeof videoTaskTypeProfiles)[VideoTaskVideoType]>
).map((profile) => ({
  label: profile.label,
  description: profile.description,
  value: profile.key,
}));

const visibleTaskCreationVideoTypes = new Set<VideoTaskVideoType>([
  "hotel_explore_roaming_voiceover",
  "agency_guide_voiceover",
  "retail_explore_presenter_narration",
]);

export const taskCreationVisibleVideoTypeOptions = videoTypeOptions.filter((option) =>
  visibleTaskCreationVideoTypes.has(option.value),
);

export const videoShotTypeOptions = [
  { label: "自定义分镜", value: "customize" },
  { label: "智能分镜", value: "intelligence" },
] as const;

export const videoExpectedDurationOptions = [
  { label: "15～25 秒", value: "15_25", minSeconds: 15, maxSeconds: 25, segmentCount: 5, durationSeconds: 4 },
  { label: "25～35 秒", value: "25_35", minSeconds: 25, maxSeconds: 35, segmentCount: 6, durationSeconds: 5 },
  { label: "35～60 秒", value: "35_60", minSeconds: 35, maxSeconds: 60, segmentCount: 9, durationSeconds: 6 },
] as const;

export const videoSegmentCountOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const videoDurationOptions = seedanceSegmentDurationOptions;
export const videoAspectRatioOptions = ["16:9", "9:16", "1:1"] as const;
export const videoCfgScaleOptions = [0.3, 0.5, 0.7, 1] as const;

export const videoCameraControlOptions = [
  { label: "自动匹配", value: "auto" },
  { label: "下移拉远", value: "down_back" },
  { label: "推进上移", value: "forward_up" },
  { label: "右旋推进", value: "right_turn_forward" },
  { label: "左旋推进", value: "left_turn_forward" },
] as const;

export const audioVoiceOptions = [
  { label: "Vivi 2.0", value: "zh_female_vv_uranus_bigtts" },
  { label: "小何 2.0", value: "zh_female_xiaohe_uranus_bigtts" },
  { label: "阳光青年", value: "zh_male_yangguangqingnian_mars_bigtts" },
  { label: "M191", value: "zh_male_m191_uranus_bigtts" },
] as const;

export const defaultTaskCreationAudioVoiceId = "S_IrhcVlzY1";

export const audioFormatOptions = [
  { label: "MP3", value: "mp3", description: "兼容性最好，适合预览与成片链路。" },
  { label: "OGG Opus", value: "ogg_opus", description: "体积更小，适合流式传输。" },
] as const;

export const audioSampleRateOptions = [
  { label: "8 kHz", value: 8000 },
  { label: "16 kHz", value: 16000 },
  { label: "22.05 kHz", value: 22050 },
  { label: "24 kHz", value: 24000 },
  { label: "32 kHz", value: 32000 },
  { label: "44.1 kHz", value: 44100 },
  { label: "48 kHz", value: 48000 },
] as const;

export const audioSpeechRateOptions = [
  { label: "偏慢", value: -10, description: "更稳但整体更舒缓。" },
  { label: "标准", value: 0, description: "推荐默认值。" },
  { label: "稍快", value: 10, description: "更利落，适合短视频讲解。" },
  { label: "更快", value: 20, description: "适合信息密度更高的口播。" },
] as const;

export const audioLoudnessRateOptions = [
  { label: "柔和", value: -10, description: "更克制，减少炸音感。" },
  { label: "标准", value: 0, description: "推荐默认值。" },
  { label: "增强", value: 10, description: "更饱满，更适合外放。" },
] as const;

export const audioSubtitleOptions = [
  { label: "返回字幕时间戳", value: true, description: "更利于字幕时间轴对齐。" },
  { label: "关闭时间戳", value: false, description: "仅生成音频，字幕按片段时长回推。" },
] as const;

export const compositionBackgroundMusicVolumeOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const defaultCompositionBackgroundMusicVolume = 6;

export type CompositionBackgroundMusicVolumeLevel = (typeof compositionBackgroundMusicVolumeOptions)[number];

export function normalizeCompositionBackgroundMusicVolume(value: unknown): CompositionBackgroundMusicVolumeLevel {
  if (value == null || value === "") {
    return defaultCompositionBackgroundMusicVolume;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  const roundedValue = Math.round(
    Number.isFinite(numericValue) ? numericValue : defaultCompositionBackgroundMusicVolume,
  );
  const clampedValue = Math.min(10, Math.max(1, roundedValue));
  return clampedValue as CompositionBackgroundMusicVolumeLevel;
}

export function getCompositionBackgroundMusicVolumeGain(value: unknown) {
  const volumeLevel = normalizeCompositionBackgroundMusicVolume(value);
  return Number((volumeLevel / 8).toFixed(2));
}

export type TaskCreationParameterState = {
  taskTitle: string;
  selectedProductId: string;
  userPrompt: string;
  optimizedUserPrompt: string;
  /** 与参考素材预设或素材库 `materialId` 对应；空字符串表示未选 */
  videoMaterialId: string;
  imageSize: (typeof imageSizeOptions)[number]["value"];
  imageGuidanceScale: (typeof imageGuidanceOptions)[number]["value"];
  imageWatermark: boolean;
  imageSeedMode: "random" | "fixed";
  imageSeedValue: string;
  videoType: VideoTaskVideoType;
  videoMode: (typeof videoModeOptions)[number]["value"];
  videoMultiShot: boolean;
  videoShotType: (typeof videoShotTypeOptions)[number]["value"];
  videoEnableTailFrame: boolean;
  videoExpectedDurationRange: VideoTaskExpectedDurationRange;
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
  compositionBackgroundMusicVolume: CompositionBackgroundMusicVolumeLevel;
  compositionSubtitleConfig: SubtitleConfig;
  constraintPreset: TaskConstraintPresetKey;
  constraintCustomRules: string;
  lastCreatedDraftKey: string;
  lastSelectedTaskId: string;
};

const defaultExpectedDurationDefaults: Record<
  VideoTaskExpectedDurationRange,
  {
    segmentCount: (typeof videoSegmentCountOptions)[number];
    durationSeconds: (typeof videoDurationOptions)[number];
  }
> = {
  "15_25": { segmentCount: 5, durationSeconds: 5 },
  "25_35": { segmentCount: 6, durationSeconds: 5 },
  "35_60": { segmentCount: 9, durationSeconds: 5 },
};

const agencyGuideVoiceoverExpectedDurationDefaults: typeof defaultExpectedDurationDefaults = {
  "15_25": { segmentCount: 5, durationSeconds: 4 },
  "25_35": { segmentCount: 6, durationSeconds: 5 },
  "35_60": { segmentCount: 9, durationSeconds: 6 },
};

function getTaskCreationExpectedDurationPresetMap(videoType: VideoTaskVideoType) {
  if (videoType === "agency_guide_voiceover" || videoType === "agency_guide_roaming_voiceover") {
    return agencyGuideVoiceoverExpectedDurationDefaults;
  }

  return defaultExpectedDurationDefaults;
}

export function getTaskCreationVideoTypeDefaults(videoType: VideoTaskVideoType) {
  const profile = getVideoTaskTypeProfile(videoType);
  const multiShot =
    profile.defaultSegmentMode === "multi_shot_montage" || profile.defaultSegmentMode === "hybrid_intro_plus_montage";

  return {
    videoType,
    videoMultiShot: multiShot,
    videoShotType: multiShot ? ("customize" as const) : ("customize" as const),
    videoEnableTailFrame: false,
    videoGenerateAudio: false,
    constraintPreset: profile.preferredConstraintPreset,
  };
}

export function getTaskCreationExpectedDurationDefaults(
  range: VideoTaskExpectedDurationRange,
  videoType: VideoTaskVideoType = DEFAULT_VIDEO_TASK_VIDEO_TYPE,
) {
  const matched = videoExpectedDurationOptions.find((item) => item.value === range) ?? videoExpectedDurationOptions[0];
  const presetMap = getTaskCreationExpectedDurationPresetMap(videoType);
  const preset = presetMap[matched.value];

  return {
    videoExpectedDurationRange: matched.value,
    videoSegmentCount: preset.segmentCount,
    videoDurationSeconds: preset.durationSeconds,
  };
}

export function getTaskCreationImageSizeForAspectRatio(aspectRatio: (typeof videoAspectRatioOptions)[number]) {
  switch (aspectRatio) {
    case "16:9":
      return "2848x1600" as const;
    case "1:1":
      return "2048x2048" as const;
    case "9:16":
    default:
      return "1600x2848" as const;
  }
}

function getEstimatedTotalDurationSeconds(input: {
  videoType: VideoTaskVideoType;
  videoSegmentCount: number;
  videoDurationSeconds: number;
}) {
  const profile = getVideoTaskTypeProfile(input.videoType);
  if (profile.defaultSegmentMode === "hybrid_intro_plus_montage") {
    const introDuration = Math.max(1, profile.introSegmentDurationSeconds ?? Math.min(3, input.videoDurationSeconds));
    if (input.videoSegmentCount <= 1) {
      return introDuration;
    }

    return introDuration + Math.max(0, input.videoSegmentCount - 1) * input.videoDurationSeconds;
  }

  return input.videoSegmentCount * input.videoDurationSeconds;
}

export function inferTaskCreationExpectedDurationRange(input: {
  videoType: VideoTaskVideoType;
  videoSegmentCount: number;
  videoDurationSeconds: number;
}) {
  const totalDurationSeconds = getEstimatedTotalDurationSeconds(input);

  if (totalDurationSeconds <= 25) {
    return "15_25" as const;
  }

  if (totalDurationSeconds <= 35) {
    return "25_35" as const;
  }

  return "35_60" as const;
}

export function getTaskCreationStoryShotCount(
  input: Pick<TaskCreationParameterState, "videoType" | "videoSegmentCount">,
) {
  return computeVideoTaskStoryShotCount({
    videoType: input.videoType,
    segmentCount: input.videoSegmentCount,
    storyShotsPerSegment: getVideoTaskTypeProfile(input.videoType).recommendedShotsPerSegment,
  });
}

export function getDefaultTaskCreationParameterState(): TaskCreationParameterState {
  const videoTypeDefaults = getTaskCreationVideoTypeDefaults(DEFAULT_VIDEO_TASK_VIDEO_TYPE);
  const expectedDurationDefaults = getTaskCreationExpectedDurationDefaults("15_25", videoTypeDefaults.videoType);
  const aspectRatio = "9:16" as const;

  return {
    taskTitle: "",
    selectedProductId: "",
    userPrompt: "",
    optimizedUserPrompt: "",
    videoMaterialId: "",
    imageSize: getTaskCreationImageSizeForAspectRatio(aspectRatio),
    imageGuidanceScale: 7.5,
    imageWatermark: false,
    imageSeedMode: "random",
    imageSeedValue: "42",
    videoType: DEFAULT_VIDEO_TASK_VIDEO_TYPE,
    videoMode: "std",
    videoMultiShot: videoTypeDefaults.videoMultiShot,
    videoShotType: videoTypeDefaults.videoShotType,
    videoEnableTailFrame: videoTypeDefaults.videoEnableTailFrame,
    videoExpectedDurationRange: expectedDurationDefaults.videoExpectedDurationRange,
    videoSegmentCount: expectedDurationDefaults.videoSegmentCount,
    videoDurationSeconds: expectedDurationDefaults.videoDurationSeconds,
    videoAspectRatio: aspectRatio,
    videoCfgScale: 0.5,
    videoCameraControl: "auto",
    videoGenerateAudio: videoTypeDefaults.videoGenerateAudio,
    videoWatermark: false,
    videoNegativePrompt: defaultVideoNegativePrompt,
    audioStoryboardEnabled: false,
    audioVoiceId: defaultTaskCreationAudioVoiceId,
    audioStoryboardVoiceIds: [],
    audioFormat: "mp3",
    audioSampleRate: 24000,
    audioSpeechRate: 0,
    audioLoudnessRate: 0,
    audioEnableSubtitle: true,
    compositionIncludeBackgroundMusic: false,
    compositionBackgroundMusicUrl: "",
    compositionBackgroundMusicVolume: defaultCompositionBackgroundMusicVolume,
    compositionSubtitleConfig: getDefaultSubtitleConfig(),
    constraintPreset: videoTypeDefaults.constraintPreset as TaskConstraintPresetKey,
    constraintCustomRules: "",
    lastCreatedDraftKey: "",
    lastSelectedTaskId: "",
  };
}

export function hydrateTaskCreationParameterState(rawDraft: unknown): TaskCreationParameterState {
  const defaults = getDefaultTaskCreationParameterState();
  const draft = typeof rawDraft === "object" && rawDraft ? (rawDraft as Partial<TaskCreationParameterState>) : {};
  const videoType = videoTypeOptions.some((item) => item.value === draft.videoType)
    ? (draft.videoType as VideoTaskVideoType)
    : defaults.videoType;
  const videoTypeDefaults = getTaskCreationVideoTypeDefaults(videoType);
  const requestedDurationRange = videoExpectedDurationOptions.some(
    (item) => item.value === draft.videoExpectedDurationRange,
  )
    ? (draft.videoExpectedDurationRange as VideoTaskExpectedDurationRange)
    : defaults.videoExpectedDurationRange;
  const typeDurationDefaults = getTaskCreationExpectedDurationDefaults(requestedDurationRange, videoType);
  const videoAspectRatio = videoAspectRatioOptions.includes(
    draft.videoAspectRatio as (typeof videoAspectRatioOptions)[number],
  )
    ? (draft.videoAspectRatio as (typeof videoAspectRatioOptions)[number])
    : defaults.videoAspectRatio;
  const videoSegmentCount = videoSegmentCountOptions.includes(
    draft.videoSegmentCount as (typeof videoSegmentCountOptions)[number],
  )
    ? (draft.videoSegmentCount as (typeof videoSegmentCountOptions)[number])
    : typeDurationDefaults.videoSegmentCount;
  const videoDurationSeconds = clampSeedanceSegmentDurationSeconds(
    draft.videoDurationSeconds,
    typeDurationDefaults.videoDurationSeconds,
  );
  const inferredDurationRange = inferTaskCreationExpectedDurationRange({
    videoType,
    videoSegmentCount,
    videoDurationSeconds,
  });
  const videoExpectedDurationRange = videoExpectedDurationOptions.some(
    (item) => item.value === draft.videoExpectedDurationRange,
  )
    ? requestedDurationRange
    : inferredDurationRange;
  const defaultImageSizeForAspectRatio = getTaskCreationImageSizeForAspectRatio(videoAspectRatio);

  return {
    taskTitle: draft.taskTitle?.trim() ?? defaults.taskTitle,
    selectedProductId: draft.selectedProductId?.trim() ?? defaults.selectedProductId,
    userPrompt: draft.userPrompt ?? defaults.userPrompt,
    optimizedUserPrompt: draft.optimizedUserPrompt ?? defaults.optimizedUserPrompt,
    videoMaterialId: (() => {
      if (typeof draft.videoMaterialId === "string" && draft.videoMaterialId.trim()) {
        return draft.videoMaterialId.trim();
      }

      if (typeof (draft as { videoTemplateId?: string }).videoTemplateId === "string") {
        return (draft as { videoTemplateId: string }).videoTemplateId.trim();
      }

      return defaults.videoMaterialId;
    })(),
    imageSize: imageSizeOptions.some((item) => item.value === draft.imageSize)
      ? (draft.imageSize as (typeof imageSizeOptions)[number]["value"])
      : defaultImageSizeForAspectRatio,
    imageGuidanceScale: imageGuidanceOptions.some((item) => item.value === draft.imageGuidanceScale)
      ? (draft.imageGuidanceScale as (typeof imageGuidanceOptions)[number]["value"])
      : defaults.imageGuidanceScale,
    imageWatermark: Boolean(draft.imageWatermark),
    imageSeedMode: draft.imageSeedMode === "fixed" ? "fixed" : defaults.imageSeedMode,
    imageSeedValue: draft.imageSeedValue ?? defaults.imageSeedValue,
    videoType,
    videoMode: videoModeOptions.some((item) => item.value === draft.videoMode)
      ? (draft.videoMode as (typeof videoModeOptions)[number]["value"])
      : defaults.videoMode,
    videoMultiShot: typeof draft.videoMultiShot === "boolean" ? draft.videoMultiShot : videoTypeDefaults.videoMultiShot,
    videoShotType: videoShotTypeOptions.some((item) => item.value === draft.videoShotType)
      ? (draft.videoShotType as (typeof videoShotTypeOptions)[number]["value"])
      : videoTypeDefaults.videoShotType,
    videoEnableTailFrame:
      typeof draft.videoEnableTailFrame === "boolean"
        ? draft.videoEnableTailFrame
        : videoTypeDefaults.videoEnableTailFrame,
    videoExpectedDurationRange,
    videoSegmentCount,
    videoDurationSeconds,
    videoAspectRatio,
    videoCfgScale: videoCfgScaleOptions.includes(draft.videoCfgScale as (typeof videoCfgScaleOptions)[number])
      ? (draft.videoCfgScale as (typeof videoCfgScaleOptions)[number])
      : defaults.videoCfgScale,
    videoCameraControl: videoCameraControlOptions.some((item) => item.value === draft.videoCameraControl)
      ? (draft.videoCameraControl as (typeof videoCameraControlOptions)[number]["value"])
      : defaults.videoCameraControl,
    videoGenerateAudio:
      typeof draft.videoGenerateAudio === "boolean" ? draft.videoGenerateAudio : videoTypeDefaults.videoGenerateAudio,
    videoWatermark: Boolean(draft.videoWatermark),
    videoNegativePrompt: draft.videoNegativePrompt ?? defaults.videoNegativePrompt,
    audioStoryboardEnabled: Boolean(draft.audioStoryboardEnabled),
    audioVoiceId: draft.audioVoiceId?.trim() || defaults.audioVoiceId,
    audioStoryboardVoiceIds: Array.isArray(draft.audioStoryboardVoiceIds)
      ? draft.audioStoryboardVoiceIds.map((item) => String(item).trim()).filter(Boolean)
      : defaults.audioStoryboardVoiceIds,
    audioFormat: audioFormatOptions.some((item) => item.value === draft.audioFormat)
      ? (draft.audioFormat as (typeof audioFormatOptions)[number]["value"])
      : defaults.audioFormat,
    audioSampleRate: audioSampleRateOptions.some((item) => item.value === draft.audioSampleRate)
      ? (draft.audioSampleRate as (typeof audioSampleRateOptions)[number]["value"])
      : defaults.audioSampleRate,
    audioSpeechRate: audioSpeechRateOptions.some((item) => item.value === draft.audioSpeechRate)
      ? (draft.audioSpeechRate as (typeof audioSpeechRateOptions)[number]["value"])
      : defaults.audioSpeechRate,
    audioLoudnessRate: audioLoudnessRateOptions.some((item) => item.value === draft.audioLoudnessRate)
      ? (draft.audioLoudnessRate as (typeof audioLoudnessRateOptions)[number]["value"])
      : defaults.audioLoudnessRate,
    audioEnableSubtitle:
      typeof draft.audioEnableSubtitle === "boolean" ? draft.audioEnableSubtitle : defaults.audioEnableSubtitle,
    compositionIncludeBackgroundMusic:
      typeof draft.compositionIncludeBackgroundMusic === "boolean"
        ? draft.compositionIncludeBackgroundMusic
        : defaults.compositionIncludeBackgroundMusic,
    compositionBackgroundMusicUrl:
      typeof draft.compositionBackgroundMusicUrl === "string"
        ? normalizeMediaSourceInput(draft.compositionBackgroundMusicUrl)
        : defaults.compositionBackgroundMusicUrl,
    compositionBackgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(draft.compositionBackgroundMusicVolume),
    compositionSubtitleConfig: hydrateSubtitleConfig(
      draft.compositionSubtitleConfig,
      defaults.compositionSubtitleConfig,
    ),
    constraintPreset:
      draft.constraintPreset && draft.constraintPreset in taskConstraintPresets
        ? (draft.constraintPreset as TaskConstraintPresetKey)
        : videoTypeDefaults.constraintPreset,
    constraintCustomRules: draft.constraintCustomRules ?? defaults.constraintCustomRules,
    lastCreatedDraftKey: draft.lastCreatedDraftKey ?? defaults.lastCreatedDraftKey,
    lastSelectedTaskId: draft.lastSelectedTaskId?.trim() ?? defaults.lastSelectedTaskId,
  };
}

export function serializeTaskCreationParameterState(state: TaskCreationParameterState) {
  return JSON.stringify(state);
}

export function buildTaskCreationDraftKey(state: TaskCreationParameterState) {
  return JSON.stringify({
    taskTitle: state.taskTitle.trim(),
    selectedProductId: state.selectedProductId,
    userPrompt: state.userPrompt.trim(),
    optimizedUserPrompt: state.optimizedUserPrompt.trim(),
    videoMaterialId: state.videoMaterialId.trim(),
    imageSize: state.imageSize,
    imageGuidanceScale: state.imageGuidanceScale,
    imageWatermark: state.imageWatermark,
    imageSeedMode: state.imageSeedMode,
    imageSeedValue: state.imageSeedMode === "fixed" ? state.imageSeedValue.trim() : "",
    videoType: state.videoType,
    videoMode: state.videoMode,
    videoMultiShot: state.videoMultiShot,
    videoShotType: state.videoShotType,
    videoEnableTailFrame: state.videoEnableTailFrame,
    videoExpectedDurationRange: state.videoExpectedDurationRange,
    videoSegmentCount: state.videoSegmentCount,
    videoDurationSeconds: state.videoDurationSeconds,
    videoAspectRatio: state.videoAspectRatio,
    videoCfgScale: state.videoCfgScale,
    videoCameraControl: state.videoCameraControl,
    videoGenerateAudio: state.videoGenerateAudio,
    videoWatermark: state.videoWatermark,
    videoNegativePrompt: state.videoNegativePrompt.trim(),
    audioStoryboardEnabled: state.audioStoryboardEnabled,
    audioVoiceId: state.audioVoiceId,
    audioStoryboardVoiceIds: state.audioStoryboardEnabled
      ? state.audioStoryboardVoiceIds.map((item) => item.trim()).filter(Boolean)
      : [],
    audioFormat: state.audioFormat,
    audioSampleRate: state.audioSampleRate,
    audioSpeechRate: state.audioSpeechRate,
    audioLoudnessRate: state.audioLoudnessRate,
    audioEnableSubtitle: state.audioEnableSubtitle,
    compositionIncludeBackgroundMusic: state.compositionIncludeBackgroundMusic,
    compositionBackgroundMusicUrl: state.compositionIncludeBackgroundMusic
      ? normalizeMediaSourceInput(state.compositionBackgroundMusicUrl)
      : "",
    compositionBackgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(state.compositionBackgroundMusicVolume),
    compositionSubtitleConfig: state.compositionSubtitleConfig,
    constraintPreset: state.constraintPreset,
    constraintCustomRules: state.constraintCustomRules.trim(),
  });
}
