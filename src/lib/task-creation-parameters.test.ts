import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { deleteTaskArtifactDirectories } from "./task-artifact-cleanup";
import { estimateNarrationReadingSeconds, getNarrationLengthGuidance, sanitizeNarrationText } from "./narration";
import { defaultVideoNegativePrompt } from "./prompt";
import { buildUnifiedSubtitleAndNarrationText } from "./text-provider";
import { deriveVideoTaskStructure } from "./video-task-structure";
import {
  buildTaskCreationDraftKey,
  getDefaultTaskCreationParameterState,
  getTaskCreationStoryShotCount,
  hydrateTaskCreationParameterState,
  inferTaskCreationExpectedDurationRange,
  serializeTaskCreationParameterState,
  type TaskCreationParameterState,
} from "./task-creation-parameters";
import { DEFAULT_VIDEO_TASK_VIDEO_TYPE } from "./video-task-schema";

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
  assert.equal(hydrated.videoDurationSeconds, 5);
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
  assert.equal(hydrated.constraintPreset, "travel_guide");
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
  assert.equal(draftKey.imageSeedMode, "fixed");
  assert.equal(draftKey.imageSeedValue, "77");
  assert.equal(draftKey.videoNegativePrompt, "模糊、闪烁");
  assert.equal(draftKey.audioFormat, "ogg_opus");
  assert.equal(draftKey.audioSampleRate, 32000);
  assert.equal(draftKey.audioSpeechRate, 20);
  assert.equal(draftKey.audioLoudnessRate, 10);
  assert.equal(draftKey.audioEnableSubtitle, false);
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
    minCharacters: 9,
    maxCharacters: 15,
    suggestedCharacters: 12,
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
  assert.equal(structured.segmentMode, "hybrid_intro_plus_montage");
  assert.equal(structured.segmentCount, 6);
  assert.equal(structured.introSegmentDurationSeconds, 3);
  assert.equal(structured.storyShotCount, 11);
  assert.deepEqual(
    structured.segmentBlueprint.map((item) => item.label),
    ["开场钩子", "Day 1", "Day 2", "Day 3", "Day 4", "收尾转化"],
  );
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

    deleteTaskArtifactDirectories(targetTaskId);

    for (const targetPath of targetPaths) {
      assert.equal(existsSync(targetPath), false);
    }
    assert.equal(existsSync(otherPath), true);
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
