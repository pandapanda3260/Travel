import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultTaskCreationParameterState } from "./task-creation-parameters";
import { applyShotPlanEditorSave } from "./video-task-plan-edit";
import type {
  DirectorStoryShot,
  ShotPlan,
  ShotPlanItem,
  VideoTaskDirectorPlan,
  VideoTaskParameterBundle,
} from "./video-task-schema";

function buildParameters(): VideoTaskParameterBundle {
  const state = getDefaultTaskCreationParameterState();

  return {
    image: {
      size: state.imageSize,
      guidanceScale: state.imageGuidanceScale,
      watermark: state.imageWatermark,
      seed: null,
    },
    video: {
      videoType: "hotel_explore_roaming_voiceover",
      segmentMode: "multi_shot_montage",
      expectedDurationRange: state.videoExpectedDurationRange,
      storyShotCount: 2,
      storyShotsPerSegment: 2,
      introSegmentDurationSeconds: null,
      mode: state.videoMode,
      multiShot: true,
      shotType: "customize",
      enableTailFrame: false,
      segmentCount: 1,
      durationSeconds: 4,
      aspectRatio: state.videoAspectRatio,
      cfgScale: state.videoCfgScale,
      cameraControl: state.videoCameraControl,
      generateAudio: state.videoGenerateAudio,
      watermark: state.videoWatermark,
      negativePrompt: state.videoNegativePrompt,
    },
    audio: {
      voiceId: state.audioVoiceId,
      storyboardEnabled: state.audioStoryboardEnabled,
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
      characterConsistency: "medium",
      sceneConsistency: "high",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  };
}

function buildShot(input: {
  shotIndex: number;
  title: string;
  commercialPhase: ShotPlanItem["commercialPhase"];
  commercialIntent: string;
}): ShotPlanItem {
  return {
    shotId: `shot-${input.shotIndex}`,
    shotIndex: input.shotIndex,
    segmentId: "segment-1",
    segmentIndex: 1,
    purpose: input.title,
    location: "测试酒店",
    hasCharacters: false,
    characters: [],
    hasTalent: false,
    talentCaptureMode: "none",
    hasVoice: true,
    hasSubtitle: true,
    requiresLipSync: false,
    action: input.title,
    emotion: "自然",
    cameraMovement: "auto",
    durationSeconds: 4,
    sceneDescription: input.title,
    narrationHint: `${input.title}讲解`,
    img2imgPrompt: `${input.title}图片提示词`,
    i2vPrompt: `${input.title}视频提示词`,
    commercialPhase: input.commercialPhase,
    commercialIntent: input.commercialIntent,
    evidenceTarget: `${input.title}证明点`,
    conversionRole: `${input.title}转化任务`,
  };
}

function buildStoryShot(shot: ShotPlanItem): DirectorStoryShot {
  return {
    shotId: shot.shotId ?? `shot-${shot.shotIndex}`,
    shotIndex: shot.shotIndex,
    segmentId: shot.segmentId ?? "segment-1",
    segmentIndex: shot.segmentIndex ?? 1,
    title: shot.purpose,
    purpose: shot.purpose,
    location: shot.location,
    hasCharacters: shot.hasCharacters,
    characters: shot.characters,
    hasTalent: Boolean(shot.hasTalent),
    talentCaptureMode: shot.talentCaptureMode ?? "none",
    hasVoice: Boolean(shot.hasVoice),
    hasSubtitle: Boolean(shot.hasSubtitle),
    requiresLipSync: Boolean(shot.requiresLipSync),
    action: shot.action,
    emotion: shot.emotion,
    cameraMovement: shot.cameraMovement,
    durationSeconds: shot.durationSeconds,
    sceneDescription: shot.sceneDescription,
    narrationHint: shot.narrationHint,
    imagePrompt: shot.img2imgPrompt ?? "",
    videoPrompt: shot.i2vPrompt ?? "",
    narrationText: shot.narrationHint,
    subtitleText: shot.narrationHint,
    commercialPhase: shot.commercialPhase,
    commercialIntent: shot.commercialIntent,
    evidenceTarget: shot.evidenceTarget,
    conversionRole: shot.conversionRole,
  };
}

test("镜头拖拽重排会保留商业阶段与成交意图", () => {
  const hookShot = buildShot({
    shotIndex: 1,
    title: "停留钩子",
    commercialPhase: "attention_hook",
    commercialIntent: "先让用户停下来",
  });
  const offerShot = buildShot({
    shotIndex: 2,
    title: "机会抛出",
    commercialPhase: "opportunity_offer",
    commercialIntent: "把优惠机会讲清楚",
  });
  const shotPlan: ShotPlan = {
    shots: [hookShot, offerShot],
    globalStyle: "真实商业短视频",
    totalDurationSeconds: 8,
    validationErrors: [],
  };
  const directorPlan: VideoTaskDirectorPlan = {
    videoType: "hotel_explore_roaming_voiceover",
    segmentMode: "multi_shot_montage",
    totalDurationSeconds: 8,
    storyShots: [buildStoryShot(hookShot), buildStoryShot(offerShot)],
    renderSegments: [
      {
        segmentId: "segment-1",
        segmentIndex: 1,
        title: "测试片段",
        segmentMode: "multi_shot_montage",
        shotIds: ["shot-1", "shot-2"],
        shotIndexes: [1, 2],
        durationSeconds: 8,
        hasTalent: false,
        talentCaptureMode: "none",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        multiShot: true,
        shotType: "customize",
        imagePrompt: "图片提示词",
        videoPrompt: "视频提示词",
        multiPrompt: [],
        narrationText: "测试口播",
        subtitleText: "测试字幕",
      },
    ],
    audioCues: [],
    legacyMirrored: false,
  };

  const applied = applyShotPlanEditorSave(
    {
      draftBundle: {
        textToImagePrompt: "",
        imageToVideoPrompt: "",
        narrationScript: "",
      },
      shotPlan,
      directorPlan,
      parameters: buildParameters(),
    },
    {
      segments: [
        {
          segmentId: "segment-1",
          segmentIndex: 1,
          narrationText: "测试口播",
          shots: [
            {
              sourceShotIndex: 2,
              shotIndex: 1,
              purpose: offerShot.purpose,
              location: offerShot.location,
              sceneDescription: offerShot.sceneDescription,
              action: offerShot.action,
              emotion: offerShot.emotion,
              cameraMovement: offerShot.cameraMovement,
              durationSeconds: offerShot.durationSeconds,
              hasVoice: offerShot.hasVoice,
              hasSubtitle: offerShot.hasSubtitle,
              requiresLipSync: offerShot.requiresLipSync,
              imagePrompt: offerShot.img2imgPrompt ?? "",
              videoPrompt: offerShot.i2vPrompt ?? "",
              narrationHint: offerShot.narrationHint,
            },
            {
              sourceShotIndex: 1,
              shotIndex: 2,
              purpose: hookShot.purpose,
              location: hookShot.location,
              sceneDescription: hookShot.sceneDescription,
              action: hookShot.action,
              emotion: hookShot.emotion,
              cameraMovement: hookShot.cameraMovement,
              durationSeconds: hookShot.durationSeconds,
              hasVoice: hookShot.hasVoice,
              hasSubtitle: hookShot.hasSubtitle,
              requiresLipSync: hookShot.requiresLipSync,
              imagePrompt: hookShot.img2imgPrompt ?? "",
              videoPrompt: hookShot.i2vPrompt ?? "",
              narrationHint: hookShot.narrationHint,
            },
          ],
        },
      ],
    },
  );

  assert.equal(applied.shotPlan.shots[0]?.shotIndex, 1);
  assert.equal(applied.shotPlan.shots[0]?.commercialPhase, "opportunity_offer");
  assert.equal(applied.shotPlan.shots[0]?.commercialIntent, "把优惠机会讲清楚");
  assert.equal(applied.shotPlan.shots[1]?.commercialPhase, "attention_hook");
  assert.equal(applied.directorPlan?.storyShots[0]?.commercialPhase, "opportunity_offer");
  assert.equal(applied.directorPlan?.storyShots[0]?.conversionRole, "机会抛出转化任务");
});
