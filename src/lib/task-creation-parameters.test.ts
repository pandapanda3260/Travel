import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseNarrationScriptLines, formatNarrationScriptLines } from "./narration-script";
import { buildDirectorPlanFromTaskData } from "./video-task-director";
import { deleteOrphanedTaskArtifactDirectories, deleteTaskArtifactDirectories } from "./task-artifact-cleanup";
import { extractBestJsonObject } from "./llm-json";
import { shouldResetTaskGeneratedOutputs } from "./video-task-output-reset";
import { estimateNarrationReadingSeconds, getNarrationLengthGuidance, sanitizeNarrationText } from "./narration";
import {
  buildNarrationPolishSystemPrompt,
  buildNarrationRepairSystemPrompt,
  buildSubtitleAudioRepairSystemPrompt,
} from "./narration-prompt-library";
import { defaultVideoNegativePrompt } from "./prompt";
import {
  getSpeakerDisplayNameOverride,
  isGenericCloneDisplayName,
  resolveClonedVoiceDisplayName,
  resolveTaskVoiceOptionLabel,
} from "./speaker-display-overrides";
import { listConstraintPrompts } from "./constraint-prompt-store";
import {
  buildSubtitleDisplayUnits,
  normalizeSubtitleCueTiming,
  splitSegmentWordTimelineBySubtitleEntries,
} from "./subtitle-display";
import { countSubtitleDisplayCharacters, splitTextIntoPhrases, wrapSubtitleText } from "./subtitle-text-utils";
import { buildUnifiedSubtitleAndNarrationText } from "./text-provider";
import { deriveVideoTaskStructure } from "./video-task-structure";
import { buildVideoTypePromptBlock, getVideoTypeCategoryPrompt } from "./video-type-prompts";
import { validateVisualImages } from "./generation-validator";
import { isSeedanceSensitivePromptError, sanitizeSeedancePromptForModeration } from "./video-provider";
import { appendMainCharacterAppearancePrompt } from "./main-character-appearance-policy";
import { buildTaskClipShotPayloads } from "./task-clip-store";
import { resolveTaskClipCompletionState } from "./task-clip-completion";
import { resolveDirectMaterialClipPlan } from "./video-material-direct-clip";
import { normalizeMediaSourceInput } from "./media-source-input";
import { resolveLocalMediaSource } from "./media-source-resolver";
import {
  getVideoAnalysisFrameBudget,
  getVideoAnalysisSamplingIntervalSeconds,
  parseFfmpegDurationSeconds,
} from "./video-analyzer";
import { getExpectedVisualReferenceShotCount } from "./video-task-stage-counts";
import {
  buildTaskCreationDraftKey,
  getCompositionBackgroundMusicVolumeGain,
  getDefaultTaskCreationParameterState,
  getTaskCreationExpectedDurationDefaults,
  getTaskCreationStoryShotCount,
  hydrateTaskCreationParameterState,
  inferTaskCreationExpectedDurationRange,
  normalizeCompositionBackgroundMusicVolume,
  serializeTaskCreationParameterState,
  type TaskCreationParameterState,
} from "./task-creation-parameters";
import {
  getDefaultVideoTypeForTaskCreationWorkflowMode,
  getTaskCreationWorkflowModeConfig,
  getTaskCreationWorkflowModeForVideoType,
  isTaskCreationWorkflowMode,
  taskMatchesCreationWorkflowMode,
} from "./task-creation-workflow-mode";
import { isSeedanceProvider } from "./video-provider-config";
import {
  DEFAULT_VIDEO_TASK_VIDEO_TYPE,
  capVideoTaskStatus,
  getVideoTaskWorkflowKind,
  getVideoTaskTypeProfile,
  hasVideoTaskSourceContent,
  isVideoTaskStatus,
  promoteVideoTaskStatus,
  usesCapturedMaterialFirstWorkflow,
  type ShotPlan,
  type VideoTaskDraftBundle,
  type VideoTaskParameterBundle,
  type VideoTaskRecord,
} from "./video-task-schema";

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("normalizeMediaSourceInput 会去掉误粘贴的成对包裹引号", () => {
  assert.equal(
    normalizeMediaSourceInput("'/Users/bytedance/Desktop/Travel 相关文件/BGM/BGM.mp3'"),
    "/Users/bytedance/Desktop/Travel 相关文件/BGM/BGM.mp3",
  );
  assert.equal(normalizeMediaSourceInput(' "https://example.com/bgm.mp3" '), "https://example.com/bgm.mp3");
});

test("resolveLocalMediaSource 支持带空格和中文路径的本机背景音乐", () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), "travel-bgm-"));
  const bgmPath = join(sandboxDir, "Travel 相关 BGM.mp3");
  writeFileSync(bgmPath, "fake audio");

  try {
    const resolved = resolveLocalMediaSource(`'${bgmPath}'`);

    assert.equal(resolved?.kind, "local_file");
    assert.equal(resolved?.localPath, bgmPath);
    assert.equal(resolved?.shouldCopyToTemp, true);
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

function buildTestParameterBundle(): VideoTaskParameterBundle {
  const state = hydrateTaskCreationParameterState({
    videoType: "agency_guide_voiceover",
    videoExpectedDurationRange: "15_25",
    videoSegmentCount: 2,
    videoDurationSeconds: 5,
  });

  return {
    image: {
      size: state.imageSize,
      guidanceScale: state.imageGuidanceScale,
      watermark: state.imageWatermark,
      seed: null,
    },
    video: {
      videoType: state.videoType,
      segmentMode: "multi_shot_montage",
      expectedDurationRange: state.videoExpectedDurationRange,
      storyShotCount: 4,
      storyShotsPerSegment: 2,
      introSegmentDurationSeconds: null,
      mode: state.videoMode,
      multiShot: true,
      shotType: "customize",
      enableTailFrame: false,
      segmentCount: 2,
      durationSeconds: 5,
      aspectRatio: state.videoAspectRatio,
      cfgScale: state.videoCfgScale,
      cameraControl: state.videoCameraControl,
      generateAudio: state.videoGenerateAudio,
      watermark: state.videoWatermark,
      negativePrompt: state.videoNegativePrompt,
    },
    audio: {
      storyboardEnabled: state.audioStoryboardEnabled,
      voiceId: state.audioVoiceId,
      storyboardVoiceIds: state.audioStoryboardVoiceIds,
      format: state.audioFormat,
      sampleRate: state.audioSampleRate,
      speechRate: state.audioSpeechRate,
      loudnessRate: state.audioLoudnessRate,
      enableSubtitle: state.audioEnableSubtitle,
    },
    composition: {
      includeBackgroundMusic: state.compositionIncludeBackgroundMusic,
      backgroundMusicUrl: state.compositionBackgroundMusicUrl || null,
      backgroundMusicVolume: state.compositionBackgroundMusicVolume,
      subtitleConfig: state.compositionSubtitleConfig,
    },
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "low",
      sceneConsistency: "low",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  };
}

function buildTestShotPlan(): ShotPlan {
  return {
    globalStyle: "真实旅行记录感",
    totalDurationSeconds: 10,
    validationErrors: [],
    shots: [
      {
        shotIndex: 1,
        segmentIndex: 1,
        segmentId: "segment-1",
        purpose: "hook",
        location: "开场",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        action: "全景开场",
        emotion: "兴奋",
        cameraMovement: "auto",
        durationSeconds: 2,
        sceneDescription: "城市开场全景",
        narrationHint: "先抛出钩子",
      },
      {
        shotIndex: 2,
        segmentIndex: 1,
        segmentId: "segment-1",
        purpose: "detail",
        location: "景点A",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: false,
        hasSubtitle: false,
        requiresLipSync: false,
        action: "切入细节",
        emotion: "轻松",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "景点A特写",
        narrationHint: "",
      },
      {
        shotIndex: 3,
        segmentIndex: 2,
        segmentId: "segment-2",
        purpose: "experience",
        location: "景点B",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        action: "切入行程亮点",
        emotion: "自然",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "景点B中景",
        narrationHint: "把当天亮点讲清楚",
      },
      {
        shotIndex: 4,
        segmentIndex: 2,
        segmentId: "segment-2",
        purpose: "closing",
        location: "收尾",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: false,
        hasSubtitle: false,
        requiresLipSync: false,
        action: "收尾定格",
        emotion: "收束",
        cameraMovement: "auto",
        durationSeconds: 2,
        sceneDescription: "收尾全景",
        narrationHint: "",
      },
    ],
  };
}

function buildTestVideoTaskRecord(): VideoTaskRecord {
  const source = {
    productInfoId: null,
    productInfoTitle: null,
    productInfoSnapshot: "海景酒店套餐亮点",
    userPrompt: "强调松弛感与度假氛围",
    videoMaterialId: null,
    videoMaterialName: null,
    videoTemplatePrompt: "",
  };
  const draftBundle: VideoTaskDraftBundle = {
    textToImagePrompt: "统一海边度假视觉氛围",
    imageToVideoPrompt: "镜头运动自然轻盈，突出海风与人物互动",
    narrationScript: "第一段旁白\n第二段旁白",
  };
  const parameters = buildTestParameterBundle();
  const shotPlan = buildTestShotPlan();

  return {
    taskId: "task-stability-check",
    ownerUserId: "user-stability",
    title: "稳定性测试任务",
    status: "COMPOSITION_READY",
    source,
    draftBundle,
    shotPlan,
    directorPlan: buildDirectorPlanFromTaskData({
      draftBundle,
      shotPlan,
      directorPlan: null,
      parameters,
    }),
    parameters,
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:10:00.000Z",
    stageTimestamps: {
      CREATED: "2026-04-18T00:00:00.000Z",
      SUBTITLE_AUDIO_READY: "2026-04-18T00:02:00.000Z",
      IMAGES_READY: "2026-04-18T00:04:00.000Z",
      CLIPS_READY: "2026-04-18T00:06:00.000Z",
      COMPOSITION_READY: "2026-04-18T00:08:00.000Z",
    },
  };
}

test("hydrateTaskCreationParameterState 为图片、视频、音频参数补齐默认值", () => {
  const hydrated = hydrateTaskCreationParameterState({
    taskTitle: "  酒店度假视频  ",
    selectedProductId: " product-1 ",
    userPrompt: "强调松弛感",
  });

  assert.equal(hydrated.taskTitle, "酒店度假视频");
  assert.equal(hydrated.selectedProductId, "product-1");
  assert.equal(hydrated.userPrompt, "强调松弛感");
  assert.equal(hydrated.videoMaterialId, "");
  assert.equal(hydrated.imageSize, "1600x2848");
  assert.equal(hydrated.imageGuidanceScale, 7.5);
  assert.equal(hydrated.videoType, DEFAULT_VIDEO_TASK_VIDEO_TYPE);
  assert.equal(hydrated.videoMode, "std");
  assert.equal(hydrated.videoMultiShot, true);
  assert.equal(hydrated.videoShotType, "customize");
  assert.equal(hydrated.videoEnableTailFrame, false);
  assert.equal(hydrated.videoExpectedDurationRange, "15_25");
  assert.equal(hydrated.videoSegmentCount, 5);
  assert.equal(hydrated.videoDurationSeconds, 4);
  assert.equal(hydrated.videoAspectRatio, "9:16");
  assert.equal(hydrated.videoCameraControl, "auto");
  assert.equal(hydrated.videoNegativePrompt, defaultVideoNegativePrompt);
  assert.equal(hydrated.audioStoryboardEnabled, false);
  assert.equal(hydrated.audioVoiceId, "zh_female_vv_uranus_bigtts");
  assert.deepEqual(hydrated.audioStoryboardVoiceIds, []);
  assert.equal(hydrated.audioFormat, "mp3");
  assert.equal(hydrated.audioSampleRate, 24000);
  assert.equal(hydrated.audioSpeechRate, 0);
  assert.equal(hydrated.audioLoudnessRate, 0);
  assert.equal(hydrated.audioEnableSubtitle, true);
  assert.equal(hydrated.compositionIncludeBackgroundMusic, false);
  assert.equal(hydrated.compositionBackgroundMusicUrl, "");
  assert.equal(hydrated.compositionBackgroundMusicVolume, 6);
  assert.equal(hydrated.compositionSubtitleConfig.enabled, true);
  assert.equal(hydrated.constraintPreset, "travel_guide");
});

test("BGM 音量参数默认 6 并会限制在 1 到 10", () => {
  assert.equal(normalizeCompositionBackgroundMusicVolume(undefined), 6);
  assert.equal(normalizeCompositionBackgroundMusicVolume(null), 6);
  assert.equal(normalizeCompositionBackgroundMusicVolume(0), 1);
  assert.equal(normalizeCompositionBackgroundMusicVolume(11), 10);
  assert.equal(normalizeCompositionBackgroundMusicVolume("7"), 7);
  assert.equal(getCompositionBackgroundMusicVolumeGain(6), 0.75);
});

test("buildTaskClipShotPayloads 会透传酒店镜头来源与生成方式", async () => {
  const baseTask = buildTestVideoTaskRecord();
  const taskId = `task-hotel-clip-payload-${Date.now()}`;
  const baseShotPlan = baseTask.shotPlan ?? buildTestShotPlan();
  const hotelShotPlan: ShotPlan = {
    ...baseShotPlan,
    shots: baseShotPlan.shots.map((shot, index) => {
      if (index === 0) {
        return {
          ...shot,
          sceneType: "exterior",
          generationMode: "photo_direct_i2v",
          assetId: "asset-exterior",
          assetSourceType: "user_upload",
          assetSubjectSummary: "酒店门头夜景",
          referenceImageUrl: "/video-tasks/demo/hotel-assets/exterior.jpg",
        };
      }

      if (index === 1) {
        return {
          ...shot,
          sceneType: "lobby",
          generationMode: "photo_direct_i2v",
          assetId: "video:vm-demo:2",
          assetSourceType: "video_material",
          assetSubjectSummary: "大堂接待区",
          sourceMaterialId: "vm-demo",
          sourceStartAtSeconds: 3,
          sourceEndAtSeconds: 5.2,
          sourceTimeRangeLabel: "3秒-5.2秒",
          referenceImageUrl: "/video-materials/vm-demo/frames/frame_0002.jpg",
          sourceTrace: "reference_video_keyframe",
        };
      }

      return {
        ...shot,
        sceneType: "room",
        generationMode: "ai_generated_broll",
        assetId: null,
        assetSubjectSummary: null,
        referenceImageUrl: null,
      };
    }),
  };

  const task: VideoTaskRecord = {
    ...baseTask,
    taskId,
    source: baseTask.source,
    shotPlan: hotelShotPlan,
    directorPlan: buildDirectorPlanFromTaskData({
      draftBundle: baseTask.draftBundle,
      shotPlan: hotelShotPlan,
      directorPlan: null,
      parameters: baseTask.parameters,
      forceRebuild: true,
    }),
  };

  const payloads = await buildTaskClipShotPayloads(task, { readOnly: true });

  assert.equal(payloads.length > 0, true);
  assert.equal(payloads[0]?.sourceShots.length, 2);
  assert.equal(payloads[0]?.sourceShots[0]?.generationMode, "photo_direct_i2v");
  assert.equal(payloads[0]?.sourceShots[0]?.assetId, "asset-exterior");
  assert.equal(payloads[0]?.sourceShots[1]?.generationMode, "photo_direct_i2v");
  assert.equal(payloads[0]?.sourceShots[1]?.assetSourceType, "video_material");
  assert.equal(payloads[0]?.sourceShots[1]?.sourceMaterialId, "vm-demo");
  assert.equal(payloads[0]?.sourceShots[1]?.sourceStartAtSeconds, 3);
  assert.equal(payloads[0]?.sourceShots[1]?.sourceEndAtSeconds, 5.2);
  assert.equal(payloads[0]?.sourceShots[1]?.sourceTimeRangeLabel, "3秒-5.2秒");
  assert.equal(payloads[0]?.sourceShots[1]?.sourceTrace, "reference_video_keyframe");
  assert.equal(payloads[1]?.sourceShots[0]?.generationMode, "ai_generated_broll");
});

test("resolveDirectMaterialClipPlan 只在同一实拍视频且时间范围完整时启用直裁", () => {
  const directPlan = resolveDirectMaterialClipPlan(
    [
      {
        shotId: "shot-1",
        shotIndex: 1,
        title: "镜头1",
        assetSourceType: "video_material",
        sourceMaterialId: "vm-1",
        sourceStartAtSeconds: 1.2,
        sourceEndAtSeconds: 3.4,
        sourceTimeRangeLabel: "1.2秒-3.4秒",
      },
      {
        shotId: "shot-2",
        shotIndex: 2,
        title: "镜头2",
        assetSourceType: "video_material",
        sourceMaterialId: "vm-1",
        sourceStartAtSeconds: 3.5,
        sourceEndAtSeconds: 5.1,
        sourceTimeRangeLabel: "3.5秒-5.1秒",
      },
    ],
    4.8,
  );

  assert.notEqual(directPlan, null);
  assert.equal(directPlan?.materialId, "vm-1");
  assert.equal(directPlan?.requestedStartAtSeconds, 1.2);
  assert.equal(directPlan?.requestedEndAtSeconds, 5.1);

  assert.equal(
    resolveDirectMaterialClipPlan(
      [
        {
          shotId: "shot-a",
          shotIndex: 1,
          title: "镜头A",
          assetSourceType: "video_material",
          sourceMaterialId: "vm-1",
          sourceStartAtSeconds: 0.5,
          sourceEndAtSeconds: 2.4,
        },
        {
          shotId: "shot-b",
          shotIndex: 2,
          title: "镜头B",
          assetSourceType: "video_material",
          sourceMaterialId: "vm-2",
          sourceStartAtSeconds: 2.4,
          sourceEndAtSeconds: 4.4,
        },
      ],
      4,
    ),
    null,
  );

  assert.equal(
    resolveDirectMaterialClipPlan(
      [
        {
          shotId: "shot-c",
          shotIndex: 1,
          title: "镜头C",
          assetSourceType: "video_material",
          sourceMaterialId: "vm-1",
          sourceStartAtSeconds: 1,
          sourceEndAtSeconds: 4.2,
        },
        {
          shotId: "shot-d",
          shotIndex: 2,
          title: "镜头D",
          assetSourceType: "video_material",
          sourceMaterialId: "vm-1",
          sourceStartAtSeconds: 4.2,
          sourceEndAtSeconds: 7.8,
        },
      ],
      3.5,
    ),
    null,
  );
});

test("hydrateTaskCreationParameterState 保留有效的图片、视频、音频参数选择", () => {
  const hydrated = hydrateTaskCreationParameterState({
    imageSize: "2848x1600",
    imageGuidanceScale: 8.5,
    imageWatermark: true,
    imageSeedMode: "fixed",
    imageSeedValue: "123",
    videoType: "agency_montage_scenery",
    videoMode: "pro",
    videoMultiShot: true,
    videoShotType: "intelligence",
    videoEnableTailFrame: false,
    videoExpectedDurationRange: "35_60",
    videoSegmentCount: 8,
    videoDurationSeconds: 10,
    videoAspectRatio: "16:9",
    videoCfgScale: 0.7,
    videoCameraControl: "forward_up",
    videoGenerateAudio: true,
    videoWatermark: true,
    videoNegativePrompt: "模糊、闪烁",
    audioStoryboardEnabled: true,
    audioVoiceId: "zh_male_yangguangqingnian_mars_bigtts",
    audioStoryboardVoiceIds: ["voice-1", "voice-2"],
    audioFormat: "ogg_opus",
    audioSampleRate: 22050,
    audioSpeechRate: 10,
    audioLoudnessRate: -10,
    audioEnableSubtitle: false,
    compositionIncludeBackgroundMusic: true,
    compositionBackgroundMusicUrl: "https://example.com/bgm.mp3",
    compositionBackgroundMusicVolume: 8,
    compositionSubtitleConfig: {
      enabled: false,
      stylePreset: "shadow",
      fontFamily: "songti_sc",
      fontSizeRatio: 0.015,
      position: "bottom",
      positionOffsetRatio: 0.22,
      horizontalPositionRatio: 0.48,
      maxCharsPerLine: 12,
      displayMode: "word_by_word",
      textColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 1.2,
    },
  });

  assert.equal(hydrated.imageSize, "2848x1600");
  assert.equal(hydrated.imageGuidanceScale, 8.5);
  assert.equal(hydrated.imageWatermark, true);
  assert.equal(hydrated.imageSeedMode, "fixed");
  assert.equal(hydrated.imageSeedValue, "123");
  assert.equal(hydrated.videoType, "agency_montage_scenery");
  assert.equal(hydrated.videoMode, "pro");
  assert.equal(hydrated.videoMultiShot, true);
  assert.equal(hydrated.videoShotType, "intelligence");
  assert.equal(hydrated.videoEnableTailFrame, false);
  assert.equal(hydrated.videoExpectedDurationRange, "35_60");
  assert.equal(hydrated.videoSegmentCount, 8);
  assert.equal(hydrated.videoDurationSeconds, 10);
  assert.equal(hydrated.videoAspectRatio, "16:9");
  assert.equal(hydrated.videoCfgScale, 0.7);
  assert.equal(hydrated.videoCameraControl, "forward_up");
  assert.equal(hydrated.videoGenerateAudio, true);
  assert.equal(hydrated.videoWatermark, true);
  assert.equal(hydrated.videoNegativePrompt, "模糊、闪烁");
  assert.equal(hydrated.audioStoryboardEnabled, true);
  assert.equal(hydrated.audioVoiceId, "zh_male_yangguangqingnian_mars_bigtts");
  assert.deepEqual(hydrated.audioStoryboardVoiceIds, ["voice-1", "voice-2"]);
  assert.equal(hydrated.audioFormat, "ogg_opus");
  assert.equal(hydrated.audioSampleRate, 22050);
  assert.equal(hydrated.audioSpeechRate, 10);
  assert.equal(hydrated.audioLoudnessRate, -10);
  assert.equal(hydrated.audioEnableSubtitle, false);
  assert.equal(hydrated.compositionIncludeBackgroundMusic, true);
  assert.equal(hydrated.compositionBackgroundMusicUrl, "https://example.com/bgm.mp3");
  assert.equal(hydrated.compositionBackgroundMusicVolume, 8);
  assert.equal(hydrated.compositionSubtitleConfig.enabled, false);
  assert.equal(hydrated.compositionSubtitleConfig.stylePreset, "shadow");
});

test("hydrateTaskCreationParameterState 保留参考素材 materialId 原始值", () => {
  const hydrated = hydrateTaskCreationParameterState({
    videoMaterialId: "vm-001",
  });
  assert.equal(hydrated.videoMaterialId, "vm-001");

  const cleared = hydrateTaskCreationParameterState({});
  assert.equal(cleared.videoMaterialId, "");
});

test("hydrateTaskCreationParameterState 兼容旧草稿字段 videoTemplateId", () => {
  const hydrated = hydrateTaskCreationParameterState({
    videoTemplateId: "vm-legacy",
  } as unknown as Partial<TaskCreationParameterState>);
  assert.equal(hydrated.videoMaterialId, "vm-legacy");
});

test("serializeTaskCreationParameterState 与 buildTaskCreationDraftKey 包含新增三类参数", () => {
  const state: TaskCreationParameterState = {
    ...getDefaultTaskCreationParameterState(),
    taskTitle: "任务 A",
    userPrompt: "生成海边酒店短视频",
    imageWatermark: true,
    videoType: "agency_creative_beat_mix",
    videoMultiShot: true,
    videoShotType: "intelligence",
    videoEnableTailFrame: false,
    videoExpectedDurationRange: "35_60",
    videoSegmentCount: 6,
    videoGenerateAudio: true,
    videoNegativePrompt: "  模糊、闪烁  ",
    audioStoryboardEnabled: true,
    audioVoiceId: "zh_female_xiaohe_uranus_bigtts",
    audioStoryboardVoiceIds: ["voice-a", "voice-b", "voice-c"],
    audioFormat: "ogg_opus",
    audioSampleRate: 32000,
    audioSpeechRate: 20,
    audioLoudnessRate: 10,
    audioEnableSubtitle: false,
    compositionIncludeBackgroundMusic: true,
    compositionBackgroundMusicUrl: "  https://example.com/bgm.mp3  ",
    compositionBackgroundMusicVolume: 9,
    compositionSubtitleConfig: {
      ...getDefaultTaskCreationParameterState().compositionSubtitleConfig,
      enabled: false,
      stylePreset: "outline",
      maxCharsPerLine: 12,
    },
    imageSeedMode: "fixed" as const,
    imageSeedValue: "  77  ",
  };

  const serialized = JSON.parse(serializeTaskCreationParameterState(state)) as Record<string, unknown>;
  const draftKey = JSON.parse(buildTaskCreationDraftKey(state)) as Record<string, unknown>;

  assert.equal(serialized.imageWatermark, true);
  assert.equal(serialized.videoType, "agency_creative_beat_mix");
  assert.equal(serialized.videoMultiShot, true);
  assert.equal(serialized.videoShotType, "intelligence");
  assert.equal(serialized.videoEnableTailFrame, false);
  assert.equal(serialized.videoExpectedDurationRange, "35_60");
  assert.equal(serialized.videoSegmentCount, 6);
  assert.equal(serialized.videoGenerateAudio, true);
  assert.equal(serialized.audioStoryboardEnabled, true);
  assert.equal(serialized.audioVoiceId, "zh_female_xiaohe_uranus_bigtts");
  assert.deepEqual(serialized.audioStoryboardVoiceIds, ["voice-a", "voice-b", "voice-c"]);
  assert.equal(serialized.audioFormat, "ogg_opus");
  assert.equal(serialized.audioSampleRate, 32000);
  assert.equal(serialized.audioSpeechRate, 20);
  assert.equal(serialized.audioLoudnessRate, 10);
  assert.equal(serialized.audioEnableSubtitle, false);
  assert.equal(serialized.compositionIncludeBackgroundMusic, true);
  assert.equal(serialized.compositionBackgroundMusicUrl, "  https://example.com/bgm.mp3  ");
  assert.equal(serialized.compositionBackgroundMusicVolume, 9);
  assert.equal((serialized.compositionSubtitleConfig as { stylePreset: string }).stylePreset, "outline");
  assert.equal(draftKey.imageSeedMode, "fixed");
  assert.equal(draftKey.imageSeedValue, "77");
  assert.equal(draftKey.videoNegativePrompt, "模糊、闪烁");
  assert.equal(draftKey.audioFormat, "ogg_opus");
  assert.equal(draftKey.audioSampleRate, 32000);
  assert.equal(draftKey.audioSpeechRate, 20);
  assert.equal(draftKey.audioLoudnessRate, 10);
  assert.equal(draftKey.audioEnableSubtitle, false);
  assert.equal(draftKey.compositionIncludeBackgroundMusic, true);
  assert.equal(draftKey.compositionBackgroundMusicUrl, "https://example.com/bgm.mp3");
  assert.equal(draftKey.compositionBackgroundMusicVolume, 9);
  assert.equal((draftKey.compositionSubtitleConfig as { stylePreset: string }).stylePreset, "outline");
});

test("hydrateTaskCreationParameterState 遇到非法多镜头与尾帧参数时回退到默认值", () => {
  const hydrated = hydrateTaskCreationParameterState({
    videoType: "agency_guide_selfie_narration",
    videoMultiShot: true,
    videoShotType: "unsupported-shot-type",
    videoEnableTailFrame: true,
    videoSegmentCount: 99,
  });

  assert.equal(hydrated.videoMultiShot, true);
  assert.equal(hydrated.videoShotType, "customize");
  assert.equal(hydrated.videoEnableTailFrame, true);
  assert.equal(hydrated.videoExpectedDurationRange, "15_25");
  assert.equal(hydrated.videoSegmentCount, 5);
  assert.equal(hydrated.videoNegativePrompt, defaultVideoNegativePrompt);
});

test("inferTaskCreationExpectedDurationRange 会按预估总时长回推期望时长档位", () => {
  assert.equal(
    inferTaskCreationExpectedDurationRange({
      videoType: "agency_guide_selfie_narration",
      videoSegmentCount: 5,
      videoDurationSeconds: 5,
    }),
    "15_25",
  );
  assert.equal(
    inferTaskCreationExpectedDurationRange({
      videoType: "agency_guide_voiceover",
      videoSegmentCount: 6,
      videoDurationSeconds: 5,
    }),
    "25_35",
  );
  assert.equal(
    inferTaskCreationExpectedDurationRange({
      videoType: "agency_montage_scenery",
      videoSegmentCount: 9,
      videoDurationSeconds: 5,
    }),
    "35_60",
  );
});

test("getTaskCreationExpectedDurationDefaults 会按视频类型返回更贴近真实结构的默认片段时长", () => {
  assert.deepEqual(getTaskCreationExpectedDurationDefaults("15_25", "agency_guide_voiceover"), {
    videoExpectedDurationRange: "15_25",
    videoSegmentCount: 5,
    videoDurationSeconds: 4,
  });
  assert.deepEqual(getTaskCreationExpectedDurationDefaults("35_60", "agency_guide_voiceover"), {
    videoExpectedDurationRange: "35_60",
    videoSegmentCount: 9,
    videoDurationSeconds: 6,
  });
  assert.deepEqual(getTaskCreationExpectedDurationDefaults("15_25", "agency_guide_selfie_narration"), {
    videoExpectedDurationRange: "15_25",
    videoSegmentCount: 5,
    videoDurationSeconds: 5,
  });
});

test("getTaskCreationStoryShotCount 会根据视频类型推导规划镜头数", () => {
  assert.equal(
    getTaskCreationStoryShotCount({
      videoType: "agency_guide_selfie_narration",
      videoSegmentCount: 5,
    }),
    5,
  );
  assert.equal(
    getTaskCreationStoryShotCount({
      videoType: "agency_montage_scenery",
      videoSegmentCount: 4,
    }),
    8,
  );
  assert.equal(
    getTaskCreationStoryShotCount({
      videoType: "agency_creative_beat_mix",
      videoSegmentCount: 4,
    }),
    7,
  );
});

test("getNarrationLengthGuidance 会根据片段时长给出口播字数预算", () => {
  const shortClipGuidance = getNarrationLengthGuidance(5);
  const longClipGuidance = getNarrationLengthGuidance(10);

  assert.deepEqual(shortClipGuidance, {
    minCharacters: 6,
    maxCharacters: 28,
    suggestedCharacters: 17,
  });
  assert.equal(longClipGuidance.minCharacters > shortClipGuidance.minCharacters, true);
  assert.equal(longClipGuidance.maxCharacters > shortClipGuidance.maxCharacters, true);
});

test("sanitizeNarrationText 会去掉句尾哦、机械 Day 前缀和句尾标点", () => {
  assert.equal(sanitizeNarrationText("Day2：第一天先去看海哦！", { stripLeadingDayPrefix: true }), "第一天先去看海");
  assert.equal(sanitizeNarrationText("这段体验真的很值哦"), "这段体验真的很值");
});

test("estimateNarrationReadingSeconds 会给出更保守的朗读时长估算", () => {
  const shorter = estimateNarrationReadingSeconds("先把最想去的理由说清楚");
  const longer = estimateNarrationReadingSeconds("先把最想去的理由说清楚，再把当天最值得打卡的体验讲出来");

  assert.equal(shorter > 0, true);
  assert.equal(longer > shorter, true);
});

test("parseNarrationScriptLines 会保留片段级 narrationScript 的标签和锚点镜头", () => {
  const shotPlan = buildTestShotPlan();
  const lines = parseNarrationScriptLines("片段1：先把旅行亮点抛出来\n片段2：再把当天重点顺下来", shotPlan);

  assert.deepEqual(
    lines.map((line) => ({
      label: line.label,
      index: line.index,
      scope: line.scope,
      shotIndex: line.shotIndex,
      segmentIndex: line.segmentIndex,
      text: line.text,
    })),
    [
      {
        label: "片段",
        index: 1,
        scope: "segment",
        shotIndex: 1,
        segmentIndex: 1,
        text: "先把旅行亮点抛出来",
      },
      {
        label: "片段",
        index: 2,
        scope: "segment",
        shotIndex: 3,
        segmentIndex: 2,
        text: "再把当天重点顺下来",
      },
    ],
  );
  assert.equal(formatNarrationScriptLines(lines), "片段1：先把旅行亮点抛出来\n片段2：再把当天重点顺下来");
});

test("prompt_generation 提示词会按输出维度分别约束数量和时长继承", () => {
  const prompt = listConstraintPrompts().find((stage) => stage.key === "prompt_generation")?.promptText ?? "";

  assert.match(prompt, /textToImagePrompt 和 imageToVideoPrompt 必须与 shot plan 中的 shots 一一对应/u);
  assert.match(prompt, /narrationScript 若按片段输出/u);
  assert.doesNotMatch(prompt, /三份内容的镜头数量必须和 shot plan 中的 shots 数量完全一致/u);
  assert.doesNotMatch(prompt, /imageToVideoPrompt 每行必须标注时长/u);
});

test("旁白运行链路会拼接视频类型 narration stage 提示词", () => {
  const typePrompt = buildVideoTypePromptBlock("agency_guide_voiceover", "narration");
  const promptPattern = new RegExp(escapeRegex(typePrompt));

  assert.ok(typePrompt.length > 0);
  assert.match(buildNarrationPolishSystemPrompt("agency_guide_voiceover"), promptPattern);
  assert.match(buildNarrationRepairSystemPrompt("agency_guide_voiceover"), promptPattern);
  assert.match(buildSubtitleAudioRepairSystemPrompt("agency_guide_voiceover"), promptPattern);
});

test("分视频类型提示词为视觉/人物/字幕子步骤提供独立 stage 配置", () => {
  assert.match(getVideoTypeCategoryPrompt("agency_guide_voiceover", "shot_plan_visual"), /视觉设计规则/u);
  assert.match(getVideoTypeCategoryPrompt("agency_guide_voiceover", "shot_plan_subject"), /人物与主体规则/u);
  assert.match(getVideoTypeCategoryPrompt("agency_guide_voiceover", "shot_plan_subtitle"), /字幕规划规则/u);
});

test("攻略类片段归属与时长规则只保留在视频分类 shot_plan 提示词中", () => {
  const genericShotPlanPrompt = listConstraintPrompts().find((stage) => stage.key === "shot_plan")?.promptText ?? "";
  const guideShotPlanPrompt = getVideoTypeCategoryPrompt("agency_guide_voiceover", "shot_plan");

  assert.doesNotMatch(
    genericShotPlanPrompt,
    /旅行社-攻略类镜头必须通过 segmentIndex\/segmentId 归属到开篇片段、行程片段或收尾片段/u,
  );
  assert.doesNotMatch(
    genericShotPlanPrompt,
    /旅行社-攻略类的片段时长 = 该片段所含镜头 durationSeconds 之和，限制 4~7 秒/u,
  );
  assert.doesNotMatch(genericShotPlanPrompt, /旅行社-攻略类镜头时长按信息量弹性设计/u);
  assert.match(
    guideShotPlanPrompt,
    /旅行社-攻略-空镜旁白 的每个镜头都必须通过 segmentIndex\/segmentId 归属到开篇片段、行程片段或收尾片段/u,
  );
  assert.match(
    guideShotPlanPrompt,
    /旅行社-攻略-空镜旁白 的片段时长 = 该片段所含镜头 durationSeconds 之和，限制 4~7 秒/u,
  );
  assert.match(guideShotPlanPrompt, /旅行社-攻略-空镜旁白 的单个镜头时长按信息量弹性设计/u);
});

test("视频类型配置会暴露更新后的名称和新增类型", () => {
  assert.equal(getVideoTaskTypeProfile("agency_guide_voiceover").label, "旅行社-攻略-空镜旁白");
  assert.equal(getVideoTaskTypeProfile("agency_guide_selfie_narration").label, "旅行社-攻略-自拍口播");
  assert.equal(getVideoTaskTypeProfile("agency_guide_presenter_narration").label, "旅行社-攻略-他拍口播");
  assert.equal(getVideoTaskTypeProfile("agency_guide_scenery_voiceover").label, "旅行社-混剪-空镜旁白");
  assert.equal(getVideoTaskTypeProfile("agency_montage_scenery").label, "旅行社-混剪-空镜无声");
  assert.equal(getVideoTaskTypeProfile("agency_montage_presenter_checkin").label, "旅行社-混剪-漫游无声");
  assert.equal(getVideoTaskTypeProfile("agency_guide_roaming_voiceover").label, "旅行社-攻略-漫游旁白");
  assert.equal(getVideoTaskTypeProfile("agency_montage_roaming_voiceover").label, "旅行社-混剪-漫游旁白");
  assert.equal(getVideoTaskTypeProfile("hotel_explore_voiceover").label, "酒店-探店-空镜旁白");
  assert.equal(getVideoTaskTypeProfile("hotel_explore_selfie_narration").label, "酒店-探店-自拍口播");
  assert.equal(getVideoTaskTypeProfile("hotel_explore_presenter_narration").label, "酒店-探店-他拍口播");
  assert.equal(getVideoTaskTypeProfile("hotel_explore_roaming_voiceover").label, "酒店-探店-漫游旁白");
  assert.equal(getVideoTaskTypeProfile("hotel_explore_roaming_silent").label, "酒店-探店-漫游无声");
  assert.equal(getVideoTaskTypeProfile("hotel_montage_voiceover").label, "酒店-混剪-空镜旁白");
  assert.equal(getVideoTaskTypeProfile("retail_explore_presenter_narration").label, "超市卖场-探店-他拍口播");
});

test("酒店漫游类型会切换到实拍素材优先工作流", () => {
  assert.equal(getVideoTaskWorkflowKind("agency_guide_voiceover"), "visual_reference_first");
  assert.equal(getVideoTaskWorkflowKind("hotel_explore_roaming_voiceover"), "captured_material_first");
  assert.equal(getVideoTaskWorkflowKind("hotel_explore_roaming_silent"), "captured_material_first");
  assert.equal(usesCapturedMaterialFirstWorkflow("hotel_explore_roaming_voiceover"), true);
  assert.equal(usesCapturedMaterialFirstWorkflow("hotel_explore_voiceover"), false);
});

test("任务创建工作流模式会映射为 AI 素材成片和实拍素材成片", () => {
  assert.equal(getTaskCreationWorkflowModeConfig("ai_image_to_video").label, "AI 素材成片");
  assert.equal(getTaskCreationWorkflowModeConfig("real_photo_to_video").label, "实拍素材成片");
  assert.equal(isTaskCreationWorkflowMode("ai_image_to_video"), true);
  assert.equal(isTaskCreationWorkflowMode("real_photo_to_video"), true);
  assert.equal(isTaskCreationWorkflowMode("legacy"), false);
  assert.equal(getDefaultVideoTypeForTaskCreationWorkflowMode("ai_image_to_video"), "agency_guide_voiceover");
  assert.equal(getDefaultVideoTypeForTaskCreationWorkflowMode("real_photo_to_video"), "hotel_explore_roaming_voiceover");
  assert.equal(getTaskCreationWorkflowModeForVideoType("agency_guide_voiceover"), "ai_image_to_video");
  assert.equal(getTaskCreationWorkflowModeForVideoType("hotel_explore_roaming_voiceover"), "real_photo_to_video");
});

test("任务创建工作流模式匹配沿用视频类型 workflowKind 判断", () => {
  const baseTask = buildTestVideoTaskRecord();
  const realPhotoTask = {
    ...baseTask,
    taskId: "mode-task-real",
    parameters: {
      ...baseTask.parameters,
      video: {
        ...baseTask.parameters.video,
        videoType: "hotel_explore_roaming_voiceover",
      },
    },
  } satisfies VideoTaskRecord;

  assert.equal(taskMatchesCreationWorkflowMode(baseTask, "ai_image_to_video"), true);
  assert.equal(taskMatchesCreationWorkflowMode(baseTask, "real_photo_to_video"), false);
  assert.equal(taskMatchesCreationWorkflowMode(realPhotoTask, "real_photo_to_video"), true);
  assert.equal(taskMatchesCreationWorkflowMode(realPhotoTask, "ai_image_to_video"), false);
  assert.equal(taskMatchesCreationWorkflowMode(realPhotoTask, null), true);
});

test("新增酒店和漫游类视频类型会输出对应的专属分类提示词", () => {
  assert.match(getVideoTypeCategoryPrompt("hotel_explore_voiceover", "shot_plan"), /酒店-探店-空镜旁白/u);
  assert.match(getVideoTypeCategoryPrompt("hotel_explore_voiceover", "shot_plan"), /房型亮点|设施体验|服务细节/u);

  assert.match(
    getVideoTypeCategoryPrompt("hotel_explore_selfie_narration", "prompt_generation"),
    /酒店-探店-自拍口播/u,
  );
  assert.match(getVideoTypeCategoryPrompt("hotel_explore_selfie_narration", "prompt_generation"), /适合后续 lip sync/u);

  assert.match(getVideoTypeCategoryPrompt("hotel_explore_roaming_silent", "prompt_generation"), /酒店-探店-漫游无声/u);
  assert.match(
    getVideoTypeCategoryPrompt("hotel_explore_roaming_silent", "prompt_generation"),
    /narrationScript 保持为空字符串或仅空行/u,
  );

  assert.match(getVideoTypeCategoryPrompt("agency_guide_roaming_voiceover", "shot_plan"), /旅行社-攻略-漫游旁白/u);
  assert.match(getVideoTypeCategoryPrompt("agency_guide_roaming_voiceover", "shot_plan"), /漫游体验片段/u);

  assert.match(
    getVideoTypeCategoryPrompt("retail_explore_presenter_narration", "shot_plan"),
    /超市卖场-探店-他拍口播/u,
  );
  assert.match(
    getVideoTypeCategoryPrompt("retail_explore_presenter_narration", "shot_plan"),
    /动线、货盘、陈列、试吃、优惠/u,
  );
});

test("出租车相关文生图约束会明确中国道路规则与中国常见出租车样式", () => {
  const source = {
    productInfoId: "product-1",
    productInfoTitle: "海边酒店接送服务",
    productInfoSnapshot: "提供机场接站、出租车接送和酒店礼宾协助",
    userPrompt: "做成真实的中国城市接站场景",
    videoMaterialId: null,
    videoMaterialName: null,
    videoTemplatePrompt: "",
  };

  const visualPrompt = appendMainCharacterAppearancePrompt("海边道路旁的出租车接站场景，司机迎接家庭上车", {
    hasMainCharacter: true,
    source,
    sceneContextText: "机场接站，出租车接送，酒店门口上车",
  });
  const promptGenerationPrompt =
    listConstraintPrompts().find((stage) => stage.key === "prompt_generation")?.promptText ?? "";
  const imageEnhancementPrompt =
    listConstraintPrompts().find((stage) => stage.key === "image_enhancement")?.promptText ?? "";

  assert.match(visualPrompt, /驾驶员位于车辆左侧驾驶位|左舵/u);
  assert.match(visualPrompt, /中国大陆道路规则|道路右侧通行/u);
  assert.match(visualPrompt, /大众朗逸|桑塔纳|丰田卡罗拉|比亚迪秦PLUS|红旗E-QM5/u);
  assert.match(promptGenerationPrompt, /驾驶员位于车辆左侧驾驶位|左舵/u);
  assert.match(promptGenerationPrompt, /JPN Taxi|Crown Comfort|中国大陆/u);
  assert.match(imageEnhancementPrompt, /右侧通行/u);
  assert.match(imageEnhancementPrompt, /左舵/u);
});

test("长城和路边接人场景会补充现代设施与停车位白线约束", () => {
  const source = {
    productInfoId: "product-2",
    productInfoTitle: "北京景点与接送",
    productInfoSnapshot: "含长城行程和酒店门口接送场景",
    userPrompt: "强调真实场景，不要出现不合常识的设施",
    videoMaterialId: null,
    videoMaterialName: null,
    videoTemplatePrompt: "",
  };

  const greatWallPrompt = appendMainCharacterAppearancePrompt("长城城墙步道上的游客远景，突出古迹空间与山势", {
    hasMainCharacter: false,
    source,
    sceneContextText: "北京长城，城墙步道，敌楼外景",
  });
  const roadsidePickupPrompt = appendMainCharacterAppearancePrompt("酒店门口普通道路路边的出租车接人场景", {
    hasMainCharacter: true,
    source,
    sceneContextText: "出租车接送，普通道路路边停靠，不是停车场",
  });
  const parkingLotPickupPrompt = appendMainCharacterAppearancePrompt("酒店停车场上客区的出租车接人场景", {
    hasMainCharacter: true,
    source,
    sceneContextText: "停车场上客区，出租车接送",
  });
  const promptGenerationPrompt =
    listConstraintPrompts().find((stage) => stage.key === "prompt_generation")?.promptText ?? "";
  const imageEnhancementPrompt =
    listConstraintPrompts().find((stage) => stage.key === "image_enhancement")?.promptText ?? "";

  assert.match(greatWallPrompt, /长城上出现出租车|观光车|固定座椅|停车位白线/u);
  assert.match(roadsidePickupPrompt, /不要在车旁地面画停车位白线|停车格|停车场线框/u);
  assert.doesNotMatch(parkingLotPickupPrompt, /不要在车旁地面画停车位白线|停车格|停车场线框/u);
  assert.match(promptGenerationPrompt, /长城城墙|敌楼|墙顶步道/u);
  assert.match(promptGenerationPrompt, /停车位白线|停车格|停车场线框/u);
  assert.match(imageEnhancementPrompt, /长城城墙|敌楼|墙顶步道/u);
  assert.match(imageEnhancementPrompt, /不是停车场|上客区/u);
});

test("buildDirectorPlanFromTaskData 会正确聚合片段内子镜头提示词", () => {
  const parameters = buildTestParameterBundle();
  const shotPlan = buildTestShotPlan();
  const draftBundle: VideoTaskDraftBundle = {
    textToImagePrompt: [
      "片段1-镜头1：开场城市全景",
      "片段1-镜头2：景点A细节特写",
      "片段2-镜头1：景点B中景推进",
      "片段2-镜头2：收尾全景定格",
    ].join("\n"),
    imageToVideoPrompt: [
      "片段1-镜头1：镜头先从城市天际线推进",
      "片段1-镜头2：再切到景点A细节特写",
      "片段2-镜头1：跟着人物视角推进景点B",
      "片段2-镜头2：最后用远景把情绪收住",
    ].join("\n"),
    narrationScript: "片段1：先把旅行亮点抛出来\n片段2：再把当天重点顺下来",
  };

  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan,
    parameters,
  });

  assert.equal(directorPlan.renderSegments.length, 2);
  assert.match(directorPlan.storyShots[0]!.imagePrompt, /开场城市全景/u);
  assert.match(directorPlan.storyShots[1]!.imagePrompt, /景点A细节特写/u);
  assert.match(directorPlan.renderSegments[0]!.imagePrompt, /开场城市全景/);
  assert.match(directorPlan.renderSegments[0]!.imagePrompt, /景点A细节特写/);
  assert.doesNotMatch(directorPlan.renderSegments[0]!.imagePrompt, /景点B中景推进/);
  assert.match(directorPlan.renderSegments[1]!.imagePrompt, /景点B中景推进/);
  assert.match(directorPlan.renderSegments[1]!.imagePrompt, /收尾全景定格/);
  assert.doesNotMatch(directorPlan.renderSegments[1]!.imagePrompt, /景点A细节特写/);
});

test("buildDirectorPlanFromTaskData 会自动拆分单镜头里的多场景画面并重分配时长", () => {
  const parameters = buildTestParameterBundle();
  parameters.video.segmentCount = 1;
  parameters.video.storyShotCount = 2;
  parameters.video.storyShotsPerSegment = 2;
  parameters.video.segmentMode = "multi_shot_montage";

  const shotPlan: ShotPlan = {
    globalStyle: "真实旅行记录感",
    totalDurationSeconds: 5,
    validationErrors: [],
    shots: [
      {
        shotIndex: 1,
        segmentIndex: 1,
        segmentId: "segment-1",
        purpose: "hook",
        location: "酒店外观",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        action: "全景建立酒店品质感",
        emotion: "松弛",
        cameraMovement: "auto",
        durationSeconds: 1,
        sceneDescription: "酒店外立面与入口环境",
        narrationHint: "先把住宿品质亮出来",
      },
      {
        shotIndex: 2,
        segmentIndex: 1,
        segmentId: "segment-1",
        purpose: "detail",
        location: "客房与夜宵区",
        hasCharacters: false,
        characters: [],
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: false,
        hasSubtitle: false,
        requiresLipSync: false,
        action: "从客房细节自然切到夜宵补给",
        emotion: "安心",
        cameraMovement: "auto",
        durationSeconds: 4,
        sceneDescription: "展示品牌酒店客房整洁度、床品质感与夜宵服务区",
        narrationHint: "",
      },
    ],
  };
  const draftBundle: VideoTaskDraftBundle = {
    textToImagePrompt:
      "片段1：竖构图9:16，暖色柔和灯光，对称构图，若有路人也只作远景点缀，no text, no collage, single continuous image",
    imageToVideoPrompt: "片段1：镜头切换自然平稳，节奏克制，保持酒店空间真实感",
    narrationScript: "片段1：先把住宿品质亮出来再自然过渡到补给体验",
  };

  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan,
    parameters,
  });

  assert.equal(directorPlan.renderSegments.length, 1);
  assert.deepEqual(
    directorPlan.storyShots.map((shot) => shot.shotIndex),
    [1, 2, 2.1],
  );
  assert.equal(directorPlan.renderSegments[0]!.multiPrompt.length, 3);
  assert.equal(
    Number(
      directorPlan.storyShots
        .filter((shot) => shot.segmentIndex === 1)
        .reduce((sum, shot) => sum + shot.durationSeconds, 0)
        .toFixed(2),
    ),
    5,
  );
  assert.equal(directorPlan.storyShots[1]!.sceneDescription, "酒店客房空间，床品与休息区细节");
  assert.equal(directorPlan.storyShots[2]!.sceneDescription, "酒店早餐或夜宵餐区，取餐台与餐食细节");
  assert.match(directorPlan.storyShots[1]!.imagePrompt, /只聚焦酒店客房空间/u);
  assert.match(directorPlan.storyShots[2]!.imagePrompt, /只聚焦酒店早餐或夜宵餐区/u);
});

test("deriveVideoTaskStructure 会优先按行程天数推导攻略类片段骨架", () => {
  const structured = deriveVideoTaskStructure({
    source: {
      productInfoId: "product-1",
      productInfoTitle: "北京亲子四天三晚",
      productInfoSnapshot: "行程天数：4天3晚\nDay1：抵达\nDay2：故宫\nDay3：长城\nDay4：返程",
      userPrompt: "做成更自然的旅行攻略旁白",
      videoMaterialId: null,
      videoMaterialName: null,
      videoTemplatePrompt: "",
    },
    videoType: "agency_guide_voiceover",
    expectedDurationRange: "25_35",
    requestedSegmentCount: 6,
    requestedDurationSeconds: 5,
    requestedStoryShotsPerSegment: 2,
  });

  assert.equal(structured.usedTravelGuideAutoStructure, true);
  assert.equal(structured.segmentMode, isSeedanceProvider() ? "multi_shot_montage" : "hybrid_intro_plus_montage");
  assert.equal(structured.segmentCount, 6);
  assert.equal(structured.durationSeconds, 5);
  assert.equal(structured.introSegmentDurationSeconds, 5);
  assert.equal(structured.storyShotCount, 11);
  assert.deepEqual(
    structured.segmentBlueprint.map((item) => item.label),
    ["开场钩子", "Day 1", "Day 2", "Day 3", "Day 4", "收尾转化"],
  );
});

test("deriveVideoTaskStructure 会把长时长攻略类片段默认拉回 4~7 秒区间", () => {
  const structured = deriveVideoTaskStructure({
    source: {
      productInfoId: "product-1",
      productInfoTitle: "西北大环线六天五晚",
      productInfoSnapshot: "行程天数：6天5晚\nDay1：西宁\nDay2：青海湖\nDay3：茶卡\nDay4：敦煌\nDay5：张掖\nDay6：返程",
      userPrompt: "旅行社攻略旁白，按真实节奏拆段",
      videoMaterialId: null,
      videoMaterialName: null,
      videoTemplatePrompt: "",
    },
    videoType: "agency_guide_voiceover",
    expectedDurationRange: "35_60",
    requestedSegmentCount: 9,
    requestedDurationSeconds: 10,
    requestedStoryShotsPerSegment: 2,
  });

  assert.equal(structured.usedTravelGuideAutoStructure, true);
  assert.equal(structured.durationSeconds, 6);
  assert.equal(structured.introSegmentDurationSeconds, 5);
  assert.equal(structured.segmentCount >= 6, true);
});

test("buildUnifiedSubtitleAndNarrationText 会让字幕与配音共用同一份裁剪后文本", () => {
  const unifiedText = buildUnifiedSubtitleAndNarrationText(
    "家人们刚救出我师父，大伙都平安着呢！接下来继续赶路，别担心。",
    5,
    "家人们刚救出我师父，大伙都平安着呢！",
  );

  assert.equal(unifiedText.length > 0, true);
  assert.equal(unifiedText.replace(/\s+/g, "").length <= getNarrationLengthGuidance(5).maxCharacters + 2, true);
});

test("buildSubtitleDisplayUnits 会在无词级时间时按文本权重切分且不超出片段窗口", () => {
  const units = buildSubtitleDisplayUnits({
    text: "先看城墙，再逛回民街，最后去钟楼夜景",
    durationSeconds: 0.9,
    maxCharsPerLine: 6,
    displayMode: "word_by_word",
  });

  assert.equal(units.length > 1, true);
  assert.equal(units[0]!.startOffsetSeconds, 0);
  assert.equal(Math.abs(units[units.length - 1]!.endOffsetSeconds - 0.9) < 0.001, true);
  assert.equal(
    units.every((item, index) => index === 0 || item.startOffsetSeconds >= units[index - 1]!.endOffsetSeconds),
    true,
  );
});

test("buildSubtitleDisplayUnits 会把超长整句拆成单行字幕且不丢字", () => {
  const sourceText = "北京玩五天，有接送住得也舒服，省心不少";
  const units = buildSubtitleDisplayUnits({
    text: sourceText,
    durationSeconds: 3.4,
    maxCharsPerLine: 8,
    displayMode: "full_sentence",
  });

  assert.deepEqual(
    units.map((item) => item.text),
    ["北京玩五天", "有接送住得也舒服", "省心不少"],
  );
  assert.equal(units.every((item) => !item.text.includes("\n")), true);
  assert.equal(units.every((item) => countSubtitleDisplayCharacters(item.text) <= 8), true);
  assert.equal(countSubtitleDisplayCharacters(units.map((item) => item.text).join("")), 17);
  assert.equal(countSubtitleDisplayCharacters(units.map((item) => item.text).join("")), countSubtitleDisplayCharacters(sourceText));
  assert.equal(units[0]!.startOffsetSeconds, 0);
  assert.equal(Math.abs(units[units.length - 1]!.endOffsetSeconds - 3.4) < 0.001, true);
  assert.equal(
    units.every((item, index) => index === 0 || item.startOffsetSeconds >= units[index - 1]!.endOffsetSeconds),
    true,
  );
});

test("splitTextIntoPhrases 会优先按中文语义边界拆分避免孤立尾巴", () => {
  assert.deepEqual(splitTextIntoPhrases("再串圆明园和名校外观", 8), ["再串圆明园", "和名校外观"]);
});

test("buildSubtitleDisplayUnits 会按词级时间把单行字幕对齐到音频窗口", () => {
  const units = buildSubtitleDisplayUnits({
    text: "北京玩五天，有接送住得也舒服，省心不少",
    durationSeconds: 3,
    maxCharsPerLine: 8,
    displayMode: "full_sentence",
    words: [
      { word: "北京", startTime: 0, endTime: 0.3 },
      { word: "玩", startTime: 0.3, endTime: 0.48 },
      { word: "五天", startTime: 0.48, endTime: 0.8 },
      { word: "有接送", startTime: 0.8, endTime: 1.25 },
      { word: "住得", startTime: 1.25, endTime: 1.55 },
      { word: "也", startTime: 1.55, endTime: 1.72 },
      { word: "舒服", startTime: 1.72, endTime: 2.08 },
      { word: "省心", startTime: 2.08, endTime: 2.42 },
      { word: "不少", startTime: 2.42, endTime: 2.82 },
    ],
  });

  assert.deepEqual(
    units.map((item) => [item.text, Number(item.startOffsetSeconds.toFixed(2)), Number(item.endOffsetSeconds.toFixed(2))]),
    [
      ["北京玩五天", 0, 0.8],
      ["有接送住得也舒服", 0.8, 2.08],
      ["省心不少", 2.08, 2.82],
    ],
  );
});

test("buildSubtitleDisplayUnits 会把短句起点对齐到词块内部字符时间", () => {
  const units = buildSubtitleDisplayUnits({
    text: "带家人照着这条走更省心",
    durationSeconds: 2.4,
    maxCharsPerLine: 8,
    displayMode: "full_sentence",
    words: [
      { word: "带家人照着这条走更", startTime: 0, endTime: 2 },
      { word: "省心", startTime: 2, endTime: 2.4 },
    ],
  });

  assert.deepEqual(
    units.map((item) => [item.text, Number(item.startOffsetSeconds.toFixed(2)), Number(item.endOffsetSeconds.toFixed(2))]),
    [
      ["带家人照着这条走", 0, 1.78],
      ["更省心", 1.78, 2.4],
    ],
  );
});

test("buildSubtitleDisplayUnits 会按真实词块时间避免短句字幕延迟", () => {
  const units = buildSubtitleDisplayUnits({
    text: "节奏正合适带家人照着这条走更省心",
    durationSeconds: 3.6,
    maxCharsPerLine: 8,
    displayMode: "full_sentence",
    words: [
      { word: "节奏正合适", startTime: 0.2, endTime: 1.05 },
      { word: "带家人照着这条走更", startTime: 1.1, endTime: 3.1 },
      { word: "省心", startTime: 3.1, endTime: 3.5 },
    ],
  });

  assert.deepEqual(units.map((item) => item.text), ["节奏正合适", "带家人照着这条走", "更省心"]);
  assert.equal(Number(units[0]!.startOffsetSeconds.toFixed(2)), 0.2);
  assert.equal(Number(units[1]!.startOffsetSeconds.toFixed(2)), 1.1);
  assert.equal(Number(units[2]!.startOffsetSeconds.toFixed(2)), 2.88);
  assert.equal(Number(units[2]!.endOffsetSeconds.toFixed(2)), 3.5);
  assert.equal(
    units.every((item, index) => index === 0 || item.startOffsetSeconds >= units[index - 1]!.endOffsetSeconds),
    true,
  );
});

test("buildSubtitleDisplayUnits 无词级时间时会按真实音频时长切分避免后半句延迟", () => {
  const units = buildSubtitleDisplayUnits({
    text: "天安门故宫逛下来，再去什刹海放松，节奏正合适",
    durationSeconds: 5.02,
    maxCharsPerLine: 8,
    displayMode: "full_sentence",
  });

  assert.deepEqual(
    units.map((item) => [item.text, Number(item.startOffsetSeconds.toFixed(2)), Number(item.endOffsetSeconds.toFixed(2))]),
    [
      ["天安门故宫逛下来", 0, 1.94],
      ["再去什刹海放松", 1.94, 3.68],
      ["节奏正合适", 3.68, 5.02],
    ],
  );
});

test("normalizeSubtitleCueTiming 会按词级结束时间收口避免字幕拖尾", () => {
  const units = normalizeSubtitleCueTiming(
    [
      {
        text: "读完就收",
        startOffsetSeconds: 0,
        endOffsetSeconds: 2.8,
      },
    ],
    {
      totalDurationSeconds: 2.8,
      words: [
        { word: "读完", startTime: 0, endTime: 0.6 },
        { word: "就收", startTime: 0.6, endTime: 1.4 },
      ],
    },
  );

  assert.deepEqual(
    units.map((item) => [item.text, Number(item.startOffsetSeconds.toFixed(2)), Number(item.endOffsetSeconds.toFixed(2))]),
    [["读完就收", 0, 1.52]],
  );
});

test("buildSubtitleDisplayUnits 会为估算时间轴保留轻微间隔并收短尾部", () => {
  const units = buildSubtitleDisplayUnits({
    text: "第一句读完了，第二句接上来",
    durationSeconds: 3,
    maxCharsPerLine: 6,
    displayMode: "full_sentence",
    trimEstimatedTail: true,
  });

  assert.equal(units.length > 1, true);
  assert.equal(
    units.every((item, index) => index === units.length - 1 || item.endOffsetSeconds <= units[index + 1]!.startOffsetSeconds - 0.039),
    true,
  );
  assert.equal(Number(units[units.length - 1]!.endOffsetSeconds.toFixed(2)), 2.85);
});

test("wrapSubtitleText 兼容旧调用但不再静默截断字幕内容", () => {
  const wrapped = wrapSubtitleText("北京玩五天，有接送住得也舒服，省心不少，再晚也不慌", 8, 2);

  assert.equal(countSubtitleDisplayCharacters(wrapped), 22);
  assert.equal(wrapped.includes("再晚也不慌"), true);
});

test("buildSubtitleDisplayUnits 会优先复用词级时间而不是重新平均分配", () => {
  const units = buildSubtitleDisplayUnits({
    text: "故宫真的值得慢慢逛",
    durationSeconds: 2.4,
    maxCharsPerLine: 8,
    displayMode: "word_by_word",
    words: [
      { word: "故宫", startTime: 0, endTime: 0.45 },
      { word: "真的", startTime: 0.45, endTime: 0.9 },
      { word: "值得", startTime: 0.9, endTime: 1.4 },
      { word: "慢慢逛", startTime: 1.4, endTime: 2.2 },
    ],
  });

  assert.deepEqual(
    units.map((item) => [
      item.text,
      Number(item.startOffsetSeconds.toFixed(2)),
      Number(item.endOffsetSeconds.toFixed(2)),
    ]),
    [
      ["故宫", 0, 0.45],
      ["真的", 0.45, 0.9],
      ["值得", 0.9, 1.4],
      ["慢慢逛", 1.4, 2.2],
    ],
  );
});

test("splitSegmentWordTimelineBySubtitleEntries 会按字幕窗口切开整段词级时间", () => {
  const groups = splitSegmentWordTimelineBySubtitleEntries(
    [
      { text: "先看故宫", startAtSeconds: 0, durationSeconds: 1.2 },
      { text: "再去钟楼夜景", startAtSeconds: 1.2, durationSeconds: 1.8 },
    ],
    [
      { word: "先看", startTime: 0, endTime: 0.45 },
      { word: "故宫", startTime: 0.45, endTime: 1.1 },
      { word: "再去", startTime: 1.2, endTime: 1.55 },
      { word: "钟楼", startTime: 1.55, endTime: 2.1 },
      { word: "夜景", startTime: 2.1, endTime: 2.8 },
    ],
  );

  assert.deepEqual(
    groups.map((group) =>
      group.map((word) => [word.word, Number(word.startTime.toFixed(2)), Number(word.endTime.toFixed(2))]),
    ),
    [
      [
        ["先看", 0, 0.45],
        ["故宫", 0.45, 1.1],
      ],
      [
        ["再去", 0, 0.35],
        ["钟楼", 0.35, 0.9],
        ["夜景", 0.9, 1.6],
      ],
    ],
  );
});

test("splitSegmentWordTimelineBySubtitleEntries 在超出窗口边界时会收敛到最近字幕条目", () => {
  const groups = splitSegmentWordTimelineBySubtitleEntries(
    [
      { text: "开场", startAtSeconds: 0.2, durationSeconds: 0.8 },
      { text: "收尾", startAtSeconds: 1.0, durationSeconds: 0.8 },
    ],
    [
      { word: "提前词", startTime: 0, endTime: 0.15 },
      { word: "开场", startTime: 0.2, endTime: 0.6 },
      { word: "收尾", startTime: 1.05, endTime: 1.55 },
      { word: "尾词", startTime: 1.7, endTime: 2.0 },
    ],
  );

  assert.equal(groups[0]!.length >= 1, true);
  assert.equal(groups[1]!.length >= 1, true);
  assert.equal(groups[0]![0]!.startTime >= 0, true);
  assert.equal(groups[1]![groups[1]!.length - 1]!.endTime <= 0.8, true);
});

test("deleteTaskArtifactDirectories 只清理指定 taskId 目录", () => {
  const originalCwd = process.cwd();
  const sandboxDir = mkdtempSync(join(tmpdir(), "travel-task-cleanup-"));
  process.chdir(sandboxDir);

  try {
    const targetTaskId = "task-a";
    const otherTaskId = "task-b";
    const targetPaths = [
      join(sandboxDir, "public", "generated-images", targetTaskId),
      join(sandboxDir, "public", "generated-audio", targetTaskId),
      join(sandboxDir, "public", "generated-subtitles", targetTaskId),
      join(sandboxDir, "public", "generated-videos", targetTaskId),
      join(sandboxDir, "public", "generated-compositions", targetTaskId),
      join(sandboxDir, "public", "generated-final-videos", targetTaskId),
    ];
    const otherPath = join(sandboxDir, "public", "generated-images", otherTaskId);

    for (const targetPath of targetPaths) {
      mkdirSync(targetPath, { recursive: true });
    }
    mkdirSync(otherPath, { recursive: true });

    assert.throws(() => deleteTaskArtifactDirectories(targetTaskId, undefined as never), /需要明确/u);

    deleteTaskArtifactDirectories(targetTaskId, { reason: "user_manual_delete" });

    for (const targetPath of targetPaths) {
      assert.equal(existsSync(targetPath), false);
    }
    assert.equal(existsSync(otherPath), true);
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("deleteOrphanedTaskArtifactDirectories 会保留有效任务目录并清理孤儿目录", () => {
  const originalCwd = process.cwd();
  const sandboxDir = mkdtempSync(join(tmpdir(), "travel-task-orphan-cleanup-"));
  process.chdir(sandboxDir);

  try {
    const activeTaskId = "task-active";
    const orphanTaskId = "task-orphan";
    const preservedPaths = [
      join(sandboxDir, "public", "generated-images", activeTaskId),
      join(sandboxDir, "public", "generated-images", "archive"),
      join(sandboxDir, "public", "generated-audio", "_unassigned"),
    ];
    const orphanPaths = [
      join(sandboxDir, "public", "generated-images", orphanTaskId),
      join(sandboxDir, "public", "generated-audio", orphanTaskId),
      join(sandboxDir, "public", "generated-videos", orphanTaskId),
    ];

    for (const targetPath of [...preservedPaths, ...orphanPaths]) {
      mkdirSync(targetPath, { recursive: true });
    }

    assert.throws(() => deleteOrphanedTaskArtifactDirectories([activeTaskId], undefined as never), /需要明确/u);

    deleteOrphanedTaskArtifactDirectories([activeTaskId], { reason: "user_manual_delete" });

    for (const targetPath of preservedPaths) {
      assert.equal(existsSync(targetPath), true);
    }

    for (const targetPath of orphanPaths) {
      assert.equal(existsSync(targetPath), false);
    }
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test("hasVideoTaskSourceContent 只要三类来源之一有内容就视为有效任务源", () => {
  assert.equal(
    hasVideoTaskSourceContent({
      productInfoSnapshot: "  ",
      userPrompt: "",
      videoTemplatePrompt: "\n",
    }),
    false,
  );
  assert.equal(
    hasVideoTaskSourceContent({
      productInfoSnapshot: "酒店套餐亮点",
      userPrompt: "",
      videoTemplatePrompt: "",
    }),
    true,
  );
  assert.equal(
    hasVideoTaskSourceContent({
      productInfoSnapshot: "",
      userPrompt: "强调临海松弛感",
      videoTemplatePrompt: "",
    }),
    true,
  );
  assert.equal(
    hasVideoTaskSourceContent({
      productInfoSnapshot: "",
      userPrompt: "",
      videoTemplatePrompt: "镜头节奏参考",
    }),
    true,
  );
});

test("promoteVideoTaskStatus 与 capVideoTaskStatus 会维持稳定的阶段上下界", () => {
  assert.equal(promoteVideoTaskStatus("CREATED", "IMAGES_READY"), "IMAGES_READY");
  assert.equal(promoteVideoTaskStatus("COMPOSITION_READY", "CLIPS_READY"), "COMPOSITION_READY");
  assert.equal(capVideoTaskStatus("COMPOSITION_READY", "IMAGES_READY"), "IMAGES_READY");
  assert.equal(capVideoTaskStatus("SUBTITLE_AUDIO_READY", "IMAGES_READY"), "SUBTITLE_AUDIO_READY");
});

test("shouldResetTaskGeneratedOutputs 只在任务定义实际变化时触发产物失效", () => {
  const task = buildTestVideoTaskRecord();

  assert.equal(
    shouldResetTaskGeneratedOutputs({
      task,
      nextSource: task.source,
      nextDraftBundle: task.draftBundle,
      nextParameters: task.parameters,
    }),
    false,
  );

  assert.equal(
    shouldResetTaskGeneratedOutputs({
      task,
      nextSource: {
        ...task.source,
        userPrompt: `${task.source.userPrompt}，补充海边夜景`,
      },
      nextDraftBundle: task.draftBundle,
      nextParameters: task.parameters,
    }),
    true,
  );

  assert.equal(
    shouldResetTaskGeneratedOutputs({
      task,
      nextSource: task.source,
      nextDraftBundle: {
        ...task.draftBundle,
        narrationScript: "全新旁白结构",
      },
      nextParameters: task.parameters,
    }),
    true,
  );

  assert.equal(
    shouldResetTaskGeneratedOutputs({
      task,
      nextSource: task.source,
      nextDraftBundle: task.draftBundle,
      nextParameters: {
        ...task.parameters,
        audio: {
          ...task.parameters.audio,
          voiceId: "voice-alt",
        },
      },
    }),
    true,
  );

  assert.equal(
    shouldResetTaskGeneratedOutputs({
      task,
      nextSource: task.source,
      nextDraftBundle: task.draftBundle,
      nextParameters: {
        ...task.parameters,
        composition: {
          ...task.parameters.composition,
          subtitleConfig: {
            ...task.parameters.composition.subtitleConfig,
            fontSizeRatio: task.parameters.composition.subtitleConfig.fontSizeRatio + 0.01,
          },
        },
      },
    }),
    false,
  );
});

test("extractBestJsonObject 能从带说明和代码块的模型输出中提取完整 JSON", () => {
  const requiredFields = ["视频级信息", "镜头序列", "Prompt生成指令"];
  const extracted = extractBestJsonObject(
    [
      "下面是结构化结果，请直接使用。",
      "```json",
      JSON.stringify(
        {
          视频级信息: { 时长: "83 秒" },
          镜头序列: [{ 镜头: 1, 画面: "故宫全景" }],
          Prompt生成指令: { 文生图Prompt模板: "真实纪实旅行短片" },
        },
        null,
        2,
      ),
      "```",
      "补充说明：以上字段已经过校验。",
    ].join("\n"),
    requiredFields,
  );

  assert.notEqual(extracted, null);
  assert.deepEqual(JSON.parse(extracted!), {
    视频级信息: { 时长: "83 秒" },
    镜头序列: [{ 镜头: 1, 画面: "故宫全景" }],
    Prompt生成指令: { 文生图Prompt模板: "真实纪实旅行短片" },
  });
});

test("extractBestJsonObject 遇到字符串中的花括号时仍能选出结构最完整的 JSON", () => {
  const extracted = extractBestJsonObject(
    [
      '{"note":"示例 {not-json}"}',
      '{"视频级信息":{"文案":"欢迎来到 {北京}"},"镜头序列":[],"Prompt生成指令":{"负向提示词":[]}}',
    ].join("\n"),
    ["视频级信息", "镜头序列", "Prompt生成指令"],
  );

  assert.notEqual(extracted, null);
  assert.equal(JSON.parse(extracted!).视频级信息.文案, "欢迎来到 {北京}");
});

test("parseFfmpegDurationSeconds 能从 ffmpeg 输出中解析视频时长", () => {
  assert.equal(parseFfmpegDurationSeconds("Duration: 00:01:22.67, start: 0.000000, bitrate: 1214 kb/s"), 82.67);
  assert.equal(parseFfmpegDurationSeconds("no duration"), null);
});

test("getVideoAnalysisSamplingIntervalSeconds 会按片长切换关键帧密度", () => {
  assert.equal(getVideoAnalysisSamplingIntervalSeconds(179), 2);
  assert.equal(getVideoAnalysisSamplingIntervalSeconds(180), 4);
});

test("getVideoAnalysisFrameBudget 会按片长计算视频分析帧上限", () => {
  assert.equal(getVideoAnalysisFrameBudget(82.67), 42);
  assert.equal(getVideoAnalysisFrameBudget(240), 60);
});

test("speaker display overrides 会把 S_LrhcVlzY1 显示为沙僧", () => {
  assert.equal(getSpeakerDisplayNameOverride("S_LrhcVlzY1"), "沙僧");
});

test("resolveTaskVoiceOptionLabel 会把历史遗留的复刻音色原始 ID 替换为沙僧", () => {
  assert.equal(
    resolveTaskVoiceOptionLabel({
      label: "S_LrhcVlzY1（复刻）",
      value: "imported-S_LrhcVlzY1",
    }),
    "沙僧（复刻）",
  );
});

test("resolveClonedVoiceDisplayName 会优先展示沙僧而不是历史遗留的原始 ID", () => {
  assert.equal(resolveClonedVoiceDisplayName("S_LrhcVlzY1", "S_LrhcVlzY1", "S_LrhcVlzY1"), "沙僧");
});

test("视觉图片校验按镜头数而不是片段数验收", () => {
  const task = buildTestVideoTaskRecord();
  const directorPlan = task.directorPlan;
  const expectedShotCount = getExpectedVisualReferenceShotCount(task);

  assert.ok(directorPlan);
  assert.equal(directorPlan.renderSegments.length, 2);
  assert.equal(directorPlan.storyShots.length, 4);
  assert.equal(expectedShotCount, 4);

  const shotLevelValidation = validateVisualImages(4, 4, task);
  assert.equal(shotLevelValidation.passed, true);
  assert.equal(
    shotLevelValidation.issues.find((issue) => issue.category === "count" && issue.message.includes("图片镜头数量")),
    undefined,
  );

  const segmentLevelValidation = validateVisualImages(2, 2, task);
  assert.equal(segmentLevelValidation.passed, false);
  assert.match(segmentLevelValidation.issues.map((issue) => issue.message).join("；"), /图片镜头数量应为 4，实际为 2/u);
});

test("isGenericCloneDisplayName 能识别原始 speakerId 形式的历史名称", () => {
  assert.equal(isGenericCloneDisplayName("S_LrhcVlzY1", "S_LrhcVlzY1"), true);
  assert.equal(isGenericCloneDisplayName("导入音色 S_LrhcVlzY1", "S_LrhcVlzY1"), true);
  assert.equal(isGenericCloneDisplayName("沙僧", "S_LrhcVlzY1"), false);
});

test("sanitizeSeedancePromptForModeration 会把容易触发审核的北京地标改成泛化描述", () => {
  const sanitized = sanitizeSeedancePromptForModeration(
    "清晨天安门广场升旗仪式，镜头掠过故宫角楼，再切到天坛祈年殿与圆明园遗址公园。",
    true,
  );

  assert.match(sanitized, /城市中心开阔广场/);
  assert.match(sanitized, /古典宫殿建筑群/);
  assert.match(sanitized, /古典礼制建筑/);
  assert.match(sanitized, /古典园林遗址/);
  assert.doesNotMatch(sanitized, /天安门|故宫|天坛|圆明园/);
});

test("isSeedanceSensitivePromptError 能识别 Seedance 的敏感内容拦截错误", () => {
  const error = new Error("Seedance 任务提交失败 (400) [InputTextSensitiveContentDetected]: sensitive information");
  (error as Error & { code?: string }).code = "InputTextSensitiveContentDetected";

  assert.equal(isSeedanceSensitivePromptError(error), true);
  assert.equal(isSeedanceSensitivePromptError(new Error("Seedance 任务提交失败 (500): upstream timeout")), false);
});

test("isVideoTaskStatus 会拒绝未知状态值", () => {
  assert.equal(isVideoTaskStatus("CREATED"), true);
  assert.equal(isVideoTaskStatus("COMPOSITION_READY"), true);
  assert.equal(isVideoTaskStatus("VIDEO_BURN_READY"), false);
  assert.equal(isVideoTaskStatus("unknown_status"), false);
});

test("resolveTaskClipCompletionState 只有全部片段拥有可播放完成视频时才视为完成", () => {
  const shotDefinitions = [{ shotIndex: 1 }, { shotIndex: 2 }, { shotIndex: 3 }];
  const clipRecords = [
    { shotIndex: 1, videoJobId: "job-1" },
    { shotIndex: 2, videoJobId: "job-2" },
    { shotIndex: 3, videoJobId: "job-3" },
  ];

  const partialState = resolveTaskClipCompletionState({
    shotDefinitions,
    clipRecords,
    jobs: [
      { jobId: "job-1", status: "COMPLETED", videoUrl: "/clip-1.mp4", remoteVideoUrl: null },
      { jobId: "job-2", status: "COMPLETED", videoUrl: "/clip-2.mp4", remoteVideoUrl: null },
      { jobId: "job-3", status: "IN_PROGRESS", videoUrl: null, remoteVideoUrl: null },
    ],
  });

  assert.equal(partialState.allCompleted, false);
  assert.equal(partialState.completedCount, 2);
  assert.equal(partialState.pendingCount, 1);

  const completedState = resolveTaskClipCompletionState({
    shotDefinitions,
    clipRecords,
    jobs: [
      { jobId: "job-1", status: "COMPLETED", videoUrl: "/clip-1.mp4", remoteVideoUrl: null },
      { jobId: "job-2", status: "COMPLETED", videoUrl: "/clip-2.mp4", remoteVideoUrl: null },
      { jobId: "job-3", status: "COMPLETED", videoUrl: null, remoteVideoUrl: "https://example.com/clip-3.mp4" },
    ],
  });

  assert.equal(completedState.allCompleted, true);
  assert.equal(completedState.completedCount, 3);
});
