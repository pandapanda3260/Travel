import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackRealPhotoNarrationBlueprint,
  buildRealPhotoMaterialBrief,
  buildShotPlanFromRealPhotoNarrationBlueprint,
  normalizeRealPhotoNarrationBlueprintCandidate,
} from "./real-photo-narration-workflow";
import { validateNarrationResult } from "./generation-validator";
import type { NarrationResultRecord } from "./narration-result-store";
import { normalizeSubtitlePlanSource } from "./subtitle-plan-source";
import { resolveTaskClipPayloadDurationSeconds, resolveTaskClipPayloadText } from "./task-clip-store";
import { recoverNarrationResultTextFromTask } from "./task-narration-result-recovery";
import { buildDirectorPlanFromTaskData, buildShotPlanFromDirectorPlan } from "./video-task-director";
import { validateShotPlan } from "./video-task-planner";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { HotelAssetSceneType, VideoTaskParameterBundle, VideoTaskRecord, VideoTaskSource } from "./video-task-schema";

const now = "2026-04-29T08:00:00.000Z";

function buildSource(): VideoTaskSource {
  return {
    productInfoId: "clubmed-1",
    productInfoTitle: "Club Med 北戴河黄金海岸",
    productInfoSnapshot:
      "4天3晚亲子套餐，五一/暑期可用，含一价全包餐饮、儿童托管、海边活动，适合北京周边亲子度假。",
    userPrompt: "不要一上来就硬讲卖点，像真实探店博主一样，先把用户带进场景，再自然讲套餐值在哪里。",
    optimizedUserPrompt: "开头要有停留感，中段讲清楚为什么适合亲子，结尾给明确购买建议。",
    videoMaterialId: "vm-1776871292823-a1w9x1",
    videoMaterialName: "Club Med 参考拆解视频",
    videoTemplatePrompt: "参考视频节奏：先用问题抓住用户，再展示场景和体验，最后落到套餐价值与行动建议。",
  };
}

function buildParameters(): VideoTaskParameterBundle {
  return {
    image: {
      size: "1080x1920",
      guidanceScale: 7,
      watermark: false,
      seed: null,
    },
    video: {
      videoType: "hotel_explore_roaming_voiceover",
      segmentMode: "multi_shot_montage",
      expectedDurationRange: "25_35",
      storyShotCount: 5,
      storyShotsPerSegment: 1,
      introSegmentDurationSeconds: null,
      mode: "std",
      multiShot: true,
      shotType: "customize",
      enableTailFrame: false,
      segmentCount: 5,
      durationSeconds: 5,
      aspectRatio: "9:16",
      cfgScale: 0.5,
      cameraControl: "auto",
      generateAudio: true,
      watermark: false,
      negativePrompt: "",
    },
    audio: {
      voiceId: "zh_female",
      storyboardEnabled: true,
      storyboardVoiceIds: [],
      format: "mp3",
      sampleRate: 24000,
      speechRate: 0,
      loudnessRate: 0,
      enableSubtitle: true,
    },
    composition: {
      includeBackgroundMusic: true,
      backgroundMusicUrl: null,
      backgroundMusicVolume: 0.35,
      subtitleConfig: {
        enabled: true,
        stylePreset: "bold",
        fontFamily: "pingfang_sc",
        fontSizeRatio: 0.026,
        position: "bottom",
        positionOffsetRatio: 0.82,
        horizontalPositionRatio: 0.5,
        maxCharsPerLine: 14,
        displayMode: "full_sentence",
        textColor: "#FFFFFF",
        outlineColor: "#000000",
        outlineWidth: 1.8,
      },
    },
    constraints: {
      peopleStructure: null,
      adultGenderRule: null,
      characterConsistency: "low",
      sceneConsistency: "medium",
      forbidEmptyShots: false,
      requirePeopleInEveryShot: false,
      customRules: [],
    },
  };
}

function asset(
  assetId: string,
  sceneType: HotelAssetSceneType,
  subjectSummary: string,
  userNote: string,
  sortOrder: number,
  extra?: Partial<TaskHotelAssetRecord>,
): TaskHotelAssetRecord {
  return {
    assetId,
    taskId: "task-real-photo",
    ownerUserId: "user-1",
    fileUrl: `/uploads/${assetId}.jpg`,
    fileName: `${assetId}.jpg`,
    displayName: subjectSummary,
    sourceType: "user_upload",
    enhancedFromAssetId: null,
    sceneType,
    subjectSummary,
    tags: [sceneType, "亲子", "度假"],
    compositionType: "竖图",
    recommendedShotScale: "medium",
    isHeroCandidate: sortOrder === 0,
    isCloseupCandidate: sceneType === "food" || sceneType === "service_detail",
    canDirectI2V: true,
    needEnhancement: false,
    qualityScore: 86 - sortOrder,
    commercialScore: 90 - sortOrder,
    width: 1080,
    height: 1920,
    orientation: "portrait",
    userNote,
    reviewStatus: "passed",
    analyzedAt: now,
    sortOrder,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function buildAssets() {
  return [
    asset("img-opening", "exterior", "海边度假村外观和门头", "用户想把这张作为开篇第一眼", 0),
    asset("img-lobby", "lobby", "明亮大堂和入住动线", "用来承接到达感", 1),
    asset("img-room", "room", "亲子房和儿童床", "重点展示亲子住宿", 2),
    asset("img-dining", "dining", "自助餐厅和儿童餐区", "说明一价全包餐饮", 3),
    asset("img-facility", "facility", "儿童活动区和海边项目", "证明孩子有地方玩", 4),
    asset("img-close", "food", "套餐包含的餐食细节", "做价值补充，不要硬塞", 5),
  ];
}

test("fallback narration blueprint 先生成真人表达骨架，并保持 60 分左右的结构作用力", () => {
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });

  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters: buildParameters(),
    materialBrief,
    now,
  });

  assert.deepEqual(
    blueprint.beats.map((beat) => beat.phase),
    ["opening_hook", "context_setup", "material_evidence", "offer_value", "action_close"],
  );
  assert.ok(blueprint.structureInfluenceScore >= 55 && blueprint.structureInfluenceScore <= 65);
  assert.match(blueprint.beats[0].spokenText, /先别急|别一上来|如果你|有没有/);
  assert.ok(!blueprint.beats[0].spokenText.includes("核心卖点"));
  assert.ok(blueprint.beats.every((beat) => beat.spokenText.trim().length >= 8));
  assert.ok(blueprint.beats.every((beat) => beat.subtitleText.trim().length >= 4));
  assert.ok(blueprint.beats.every((beat) => beat.subtitleText === beat.spokenText));
});

test("shot plan 从台词蓝图反推，镜头数不超过素材数，并保留图片原始意愿", () => {
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters: buildParameters(),
    materialBrief,
    now,
  });

  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters: buildParameters(),
  });

  assert.ok(shotPlan.shots.length <= materialBrief.items.length);
  assert.equal(shotPlan.shots.length, blueprint.beats.length);
  assert.equal(shotPlan.shots[0]?.assetId, "img-opening");
  assert.match(shotPlan.shots[0]?.narrationIntent ?? "", /开篇|停留|第一眼/);

  for (const shot of shotPlan.shots) {
    const beat = blueprint.beats.find((item) => item.beatId === shot.narrationBeatId);
    assert.ok(beat, `shot ${shot.shotIndex} should keep narration beat id`);
    assert.equal(shot.sourceSpokenText, beat.spokenText);
    assert.equal(shot.sourceSubtitleText, beat.subtitleText);
    assert.equal(shot.sourceSubtitleText, shot.sourceSpokenText);
    assert.equal(shot.durationSeconds, beat.estimatedDurationSeconds);
    assert.equal(shot.assetId, beat.targetMaterialIds[0]);
  }

  const summedDuration = shotPlan.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  assert.equal(shotPlan.totalDurationSeconds, summedDuration);
});

test("normalize blueprint candidate 会保留 LLM 台词，但过滤不存在的素材 id", () => {
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const fallback = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters: buildParameters(),
    materialBrief,
    now,
  });

  const normalized = normalizeRealPhotoNarrationBlueprintCandidate({
    candidate: {
      structureInfluenceScore: 99,
      beats: [
        {
          phase: "opening_hook",
          spokenText: "如果只看价格，你可能会错过这家更适合带娃的原因。",
          subtitleText: "先看适不适合带娃",
          targetMaterialIds: ["img-opening", "missing-id"],
        },
      ],
    },
    fallback,
    materialBrief,
    now,
  });

  assert.equal(normalized.structureInfluenceScore, 60);
  assert.equal(normalized.beats[0]?.spokenText, "如果只看价格，你可能会错过这家更适合带娃的原因");
  assert.equal(normalized.beats[0]?.subtitleText, normalized.beats[0]?.spokenText);
  assert.deepEqual(normalized.beats[0]?.targetMaterialIds, ["img-opening"]);
  assert.equal(normalized.beats[1]?.spokenText, fallback.beats[1]?.spokenText);
});

test("叙事优先实拍计划允许每个镜头服务口播，不触发旧混剪稀疏口播规则", () => {
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters: buildParameters(),
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters: buildParameters(),
  });

  const errors = validateShotPlan(shotPlan, buildSource(), buildParameters());

  assert.ok(!errors.some((error) => error.includes("旁白分布过密")));
  assert.ok(!errors.some((error) => error.includes("narrationHint 必须小于等于")));
});

test("director plan 使用叙事蓝图 spokenText 作为口播源，而不是短 narrationHint", () => {
  const parameters = buildParameters();
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters,
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters,
  });
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: shotPlan.shots.map((shot) => `镜头${shot.shotIndex}：${shot.narrationHint}`).join("\n"),
    },
    shotPlan,
    parameters,
  });

  assert.equal(directorPlan.storyShots[0]?.narrationText, shotPlan.shots[0]?.sourceSpokenText);
  assert.equal(directorPlan.storyShots[0]?.subtitleText, shotPlan.shots[0]?.sourceSpokenText);
  assert.equal(directorPlan.audioCues[0]?.narrationText, shotPlan.shots[0]?.sourceSpokenText);
  assert.equal(directorPlan.audioCues[0]?.subtitleText, directorPlan.audioCues[0]?.narrationText);
  assert.equal(directorPlan.audioCues[0]?.sourceSpokenText, shotPlan.shots[0]?.sourceSpokenText);
});

test("实拍计划回建 shotPlan 时保留真人台词源和叙事蓝图", () => {
  const parameters = buildParameters();
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters,
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters,
  });
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: shotPlan.shots.map((shot) => `镜头${shot.shotIndex}：${shot.narrationHint}`).join("\n"),
    },
    shotPlan,
    parameters,
  });

  const rebuiltShotPlan = buildShotPlanFromDirectorPlan(directorPlan, shotPlan);

  assert.equal(rebuiltShotPlan.realPhotoNarrationBlueprint?.beats[0]?.spokenText, blueprint.beats[0]?.spokenText);
  assert.equal(rebuiltShotPlan.realPhotoMaterialBrief?.items[0]?.assetId, materialBrief.items[0]?.assetId);
  assert.equal(rebuiltShotPlan.shots[0]?.sourceSpokenText, blueprint.beats[0]?.spokenText);
  assert.equal(rebuiltShotPlan.shots[0]?.sourceSubtitleText, blueprint.beats[0]?.subtitleText);
  assert.equal(rebuiltShotPlan.shots[0]?.narrationBeatId, blueprint.beats[0]?.beatId);
});

test("实拍片段字幕源优先使用真人台词，不把 narrationHint 当台词", () => {
  const parameters = buildParameters();
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters,
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters,
  });

  const normalized = normalizeSubtitlePlanSource(shotPlan, parameters.video.videoType);

  assert.equal(normalized.subtitlePlan?.[0]?.subtitles[0]?.text, blueprint.beats[0]?.spokenText);
  assert.notEqual(normalized.subtitlePlan?.[0]?.subtitles[0]?.text, shotPlan.shots[0]?.narrationHint);
});

test("实拍任务存在旧 directorPlan 时也会从蓝图恢复真人台词源", () => {
  const parameters = buildParameters();
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters,
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters,
  });
  const validDirectorPlan = buildDirectorPlanFromTaskData({
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: shotPlan.shots.map((shot) => `镜头${shot.shotIndex}：${shot.narrationHint}`).join("\n"),
    },
    shotPlan,
    parameters,
  });
  const staleDirectorPlan = {
    ...validDirectorPlan,
    storyShots: validDirectorPlan.storyShots.map((shot) => ({
      ...shot,
      narrationText: shot.narrationHint,
      subtitleText: shot.narrationHint,
      sourceSpokenText: null,
      sourceSubtitleText: null,
    })),
    audioCues: validDirectorPlan.audioCues.map((cue) => ({
      ...cue,
      narrationText: shotPlan.shots[cue.shotIndex ? cue.shotIndex - 1 : 0]?.narrationHint ?? cue.narrationText,
      subtitleText: shotPlan.shots[cue.shotIndex ? cue.shotIndex - 1 : 0]?.narrationHint ?? cue.subtitleText,
      sourceSpokenText: null,
      sourceSubtitleText: null,
    })),
  };

  const recovered = buildDirectorPlanFromTaskData({
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: staleDirectorPlan.storyShots.map((shot) => `镜头${shot.shotIndex}：${shot.narrationHint}`).join("\n"),
    },
    shotPlan,
    directorPlan: staleDirectorPlan,
    parameters,
  });

  assert.equal(recovered.storyShots[0]?.narrationText, blueprint.beats[0]?.spokenText);
  assert.equal(recovered.audioCues[0]?.narrationText, blueprint.beats[0]?.spokenText);
});

test("实拍旧字幕音频结果中的阶段标题会被识别并按蓝图恢复", () => {
  const parameters = buildParameters();
  const materialBrief = buildRealPhotoMaterialBrief({ source: buildSource(), hotelAssets: buildAssets(), now });
  const blueprint = buildFallbackRealPhotoNarrationBlueprint({
    source: buildSource(),
    parameters,
    materialBrief,
    now,
  });
  const shotPlan = buildShotPlanFromRealPhotoNarrationBlueprint({
    blueprint,
    materialBrief,
    parameters,
  });
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: shotPlan.shots.map((shot) => `镜头${shot.shotIndex}：${shot.narrationHint}`).join("\n"),
    },
    shotPlan,
    parameters,
  });
  const task = {
    taskId: "task-real-photo",
    ownerUserId: "user-1",
    title: "实拍任务",
    status: "SUBTITLE_AUDIO_READY",
    source: buildSource(),
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: "片段1：先制造停留理由",
    },
    shotPlan,
    directorPlan,
    parameters,
    createdAt: now,
    updatedAt: now,
    stageTimestamps: {
      CREATED: now,
      SUBTITLE_AUDIO_READY: now,
    },
  } satisfies VideoTaskRecord;
  const staleResult = {
    resultId: "result-real-photo",
    taskId: task.taskId,
    title: "字幕音频",
    sourcePrompt: "片段1：先制造停留理由",
    totalDurationSeconds: 7.7,
    strategySummary: "",
    compositionId: null,
    compositionTitle: null,
    voiceId: null,
    subtitleSrtUrl: null,
    mergedAudioUrl: null,
    clips: [
      {
        id: "sub-1",
        cueId: "sub-1",
        shotIndex: 1,
        segmentId: "segment-1",
        segmentIndex: 1,
        bindToSegmentId: "segment-1",
        startAtSeconds: 0,
        durationSeconds: 7.7,
        audioDurationSeconds: null,
        characterFocus: "旁白",
        visualFocus: "开场",
        fullSemanticSentence: "先制造停留理由",
        narrationText: "",
        subtitleText: "先制造停留理由",
        spokenText: "",
        note: "",
        hasVoice: false,
        hasSubtitle: true,
        requiresLipSync: false,
        voiceId: null,
        audioUrl: "/generated-audio/stale.mp3",
        words: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  } satisfies NarrationResultRecord;

  const staleValidation = validateNarrationResult(staleResult, task);
  assert.equal(staleValidation.passed, false);

  const recovered = recoverNarrationResultTextFromTask(task, staleResult);
  assert.ok(recovered);
  assert.equal(recovered.clips[0]?.fullSemanticSentence, blueprint.beats[0]?.spokenText);
  assert.equal(recovered.clips[0]?.subtitleText, blueprint.beats[0]?.spokenText);
  assert.equal(recovered.clips[0]?.audioUrl, null);
});

test("片段展示时长优先采用实际音频时长，其次才是计划镜头时长", () => {
  assert.equal(
    resolveTaskClipPayloadDurationSeconds({
      recordDurationSeconds: null,
      audioDurationSeconds: 8.4,
      plannedDurationSeconds: 5,
      fallbackDurationSeconds: 4,
    }),
    8.4,
  );
  assert.equal(
    resolveTaskClipPayloadDurationSeconds({
      recordDurationSeconds: 6.2,
      audioDurationSeconds: 8.4,
      plannedDurationSeconds: 5,
      fallbackDurationSeconds: 4,
    }),
    6.2,
  );
});

test("片段详情展示会用恢复后的真人台词覆盖旧结构标题", () => {
  assert.equal(
    resolveTaskClipPayloadText({
      recordText: "先制造停留理由",
      recoveredText: "先别急着看价格，真正适不适合亲子度假，先看孩子能不能玩得住",
      structuralRecordText: true,
    }),
    "先别急着看价格，真正适不适合亲子度假，先看孩子能不能玩得住",
  );

  assert.equal(
    resolveTaskClipPayloadText({
      recordText: "这是一句用户手动修改过的片段台词",
      recoveredText: "先别急着看价格，真正适不适合亲子度假，先看孩子能不能玩得住",
    }),
    "这是一句用户手动修改过的片段台词",
  );
});
