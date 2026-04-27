import type { VideoTaskStatus } from "./video-task-schema";

export const directorPrimaryStepActionKeys = {
  buildShotPlan: "build_shot_plan",
  buildSubtitleAudio: "build_subtitle_audio",
  buildVisualReferences: "build_visual_references",
  buildVideoClips: "build_video_clips",
  composeStoryVideo: "compose_story_video",
} as const;

export type DirectorPrimaryStepActionKey =
  (typeof directorPrimaryStepActionKeys)[keyof typeof directorPrimaryStepActionKeys];

export const directorSecondaryStepActionKeys = {
  regenerateShotImages: "regenerate_shot_images",
  selectVisualCandidate: "select_visual_candidate",
  clearVisualSelection: "clear_visual_selection",
  regenerateClipShot: "regenerate_clip_shot",
  autoComposeStoryVideo: "auto_compose_story_video",
} as const;

export type DirectorSecondaryStepActionKey =
  (typeof directorSecondaryStepActionKeys)[keyof typeof directorSecondaryStepActionKeys];

type DirectorPrimaryStepMeta = {
  key: DirectorPrimaryStepActionKey;
  targetStatus: VideoTaskStatus;
  label: string;
  rerunLabel: string;
  runningLabel: string;
  silentLabel?: string;
  silentRerunLabel?: string;
  silentRunningLabel?: string;
};

export const directorPrimaryStepMetaMap: Record<DirectorPrimaryStepActionKey, DirectorPrimaryStepMeta> = {
  [directorPrimaryStepActionKeys.buildShotPlan]: {
    key: directorPrimaryStepActionKeys.buildShotPlan,
    targetStatus: "CREATED",
    label: "生成镜头规划",
    rerunLabel: "重做镜头规划",
    runningLabel: "规划中...",
  },
  [directorPrimaryStepActionKeys.buildSubtitleAudio]: {
    key: directorPrimaryStepActionKeys.buildSubtitleAudio,
    targetStatus: "SUBTITLE_AUDIO_READY",
    label: "生成字幕音频",
    rerunLabel: "重做字幕音频",
    runningLabel: "配音中...",
    silentLabel: "同步静音阶段",
    silentRerunLabel: "重同步静音",
    silentRunningLabel: "同步中...",
  },
  [directorPrimaryStepActionKeys.buildVisualReferences]: {
    key: directorPrimaryStepActionKeys.buildVisualReferences,
    targetStatus: "IMAGES_READY",
    label: "生成参考图",
    rerunLabel: "重做参考图",
    runningLabel: "出图中...",
  },
  [directorPrimaryStepActionKeys.buildVideoClips]: {
    key: directorPrimaryStepActionKeys.buildVideoClips,
    targetStatus: "CLIPS_READY",
    label: "生成视频片段",
    rerunLabel: "重做视频片段",
    runningLabel: "生成中...",
  },
  [directorPrimaryStepActionKeys.composeStoryVideo]: {
    key: directorPrimaryStepActionKeys.composeStoryVideo,
    targetStatus: "COMPOSITION_READY",
    label: "合成成片",
    rerunLabel: "重新合成",
    runningLabel: "合成中...",
  },
};

export function getDirectorPrimaryStepButtonLabel(
  key: DirectorPrimaryStepActionKey,
  options?: {
    rerun?: boolean;
    running?: boolean;
    silent?: boolean;
  },
) {
  const meta = directorPrimaryStepMetaMap[key];
  if (!meta) {
    return "";
  }

  if (options?.running) {
    if (options.silent && meta.silentRunningLabel) {
      return meta.silentRunningLabel;
    }
    return meta.runningLabel;
  }

  if (options?.rerun) {
    if (options.silent && meta.silentRerunLabel) {
      return meta.silentRerunLabel;
    }
    return meta.rerunLabel;
  }

  if (options?.silent && meta.silentLabel) {
    return meta.silentLabel;
  }

  return meta.label;
}
