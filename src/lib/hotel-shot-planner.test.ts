import assert from "node:assert/strict";
import test from "node:test";

import { applyHotelAssetPlanning } from "./hotel-shot-planner";
import type { ShotPlan } from "./video-task-schema";
import type { TaskHotelAssetRecord } from "./task-hotel-asset-store";
import type { VideoMaterialRecord } from "./video-material-store";

function buildBaseShotPlan(): ShotPlan {
  return {
    shots: [
      {
        shotId: "shot-1",
        shotIndex: 1,
        segmentId: "segment-1",
        segmentIndex: 1,
        purpose: "hook",
        location: "",
        hasCharacters: false,
        characters: [],
        action: "开场",
        emotion: "轻松",
        cameraMovement: "auto",
        durationSeconds: 4,
        sceneDescription: "默认开场镜头",
        narrationHint: "默认旁白",
      },
      {
        shotId: "shot-2",
        shotIndex: 2,
        segmentId: "segment-2",
        segmentIndex: 2,
        purpose: "experience",
        location: "",
        hasCharacters: false,
        characters: [],
        action: "展示客房",
        emotion: "舒适",
        cameraMovement: "auto",
        durationSeconds: 4,
        sceneDescription: "默认客房镜头",
        narrationHint: "默认客房旁白",
      },
      {
        shotId: "shot-3",
        shotIndex: 3,
        segmentId: "segment-3",
        segmentIndex: 3,
        purpose: "closing",
        location: "",
        hasCharacters: false,
        characters: [],
        action: "收尾",
        emotion: "松弛",
        cameraMovement: "auto",
        durationSeconds: 4,
        sceneDescription: "默认收尾镜头",
        narrationHint: "默认收尾旁白",
      },
    ],
    globalStyle: "真实酒店探店",
    totalDurationSeconds: 12,
    validationErrors: [],
  };
}

function buildAsset(
  input: Partial<TaskHotelAssetRecord> & Pick<TaskHotelAssetRecord, "assetId" | "sceneType" | "fileUrl">,
): TaskHotelAssetRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    assetId: input.assetId,
    taskId: "task-hotel",
    ownerUserId: "user-1",
    fileUrl: input.fileUrl,
    fileName: input.fileName ?? `${input.assetId}.jpg`,
    displayName: input.displayName ?? input.assetId,
    sourceType: input.sourceType ?? "user_upload",
    sceneType: input.sceneType,
    subjectSummary: input.subjectSummary ?? sceneLabel(input.sceneType),
    tags: input.tags ?? [],
    compositionType: input.compositionType ?? "横向稳定构图",
    recommendedShotScale: input.recommendedShotScale ?? "wide",
    isHeroCandidate: input.isHeroCandidate ?? false,
    isCloseupCandidate: input.isCloseupCandidate ?? false,
    canDirectI2V: input.canDirectI2V ?? true,
    needEnhancement: input.needEnhancement ?? false,
    qualityScore: input.qualityScore ?? 82,
    commercialScore: input.commercialScore ?? 84,
    compositionScore: input.compositionScore ?? 80,
    recommendedPosition: input.recommendedPosition ?? null,
    sellingPoints: input.sellingPoints ?? [],
    durationSuggestion: input.durationSuggestion ?? null,
    mustUse: input.mustUse ?? false,
    forbidden: input.forbidden ?? false,
    width: input.width ?? 1600,
    height: input.height ?? 900,
    orientation: input.orientation ?? "landscape",
    userNote: input.userNote ?? "",
    reviewStatus: input.reviewStatus ?? "passed",
    analyzedAt: now,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

function sceneLabel(sceneType: TaskHotelAssetRecord["sceneType"]) {
  return sceneType === "exterior" ? "酒店外观" : sceneType === "room" ? "客房" : "其他";
}

function buildVideoMaterialRecord(): VideoMaterialRecord {
  const now = "2026-04-23T00:00:00.000Z";
  return {
    materialId: "vm-demo",
    ownerUserId: "user-1",
    name: "酒店漫游实拍",
    status: "ready",
    statusMessage: "已就绪",
    processingMode: "auto_all",
    videoFileName: "demo.mp4",
    videoFileUrl: "/video-materials/demo.mp4",
    videoUploadedAt: now,
    audioFileName: null,
    audioFileUrl: null,
    audioConvertedAt: null,
    framesExtracted: 3,
    extractedFrames: [
      {
        imageId: "frame-1",
        imageUrl: "/video-materials/vm-demo/frames/frame_0001.jpg",
        fileName: "frame_0001.jpg",
        width: 1080,
        height: 1920,
        byteSize: 1,
        timestampSeconds: 1,
        label: "抽帧1",
        sourceImageId: null,
        createdAt: now,
      },
      {
        imageId: "frame-2",
        imageUrl: "/video-materials/vm-demo/frames/frame_0002.jpg",
        fileName: "frame_0002.jpg",
        width: 1080,
        height: 1920,
        byteSize: 1,
        timestampSeconds: 5,
        label: "抽帧2",
        sourceImageId: null,
        createdAt: now,
      },
      {
        imageId: "frame-3",
        imageUrl: "/video-materials/vm-demo/frames/frame_0003.jpg",
        fileName: "frame_0003.jpg",
        width: 1080,
        height: 1920,
        byteSize: 1,
        timestampSeconds: 9,
        label: "抽帧3",
        sourceImageId: null,
        createdAt: now,
      },
    ],
    cleanedFrames: [],
    imageCleaningJob: {
      status: "idle",
      requestedImageIds: [],
      totalCount: 0,
      processedCount: 0,
      cleanedCount: 0,
      failedImageIds: [],
      currentImageId: null,
      message: "",
      startedAt: null,
      finishedAt: null,
      updatedAt: null,
    },
    videoAnalysis: JSON.stringify({
      视频级信息: { 视频类型: "酒店探店" },
      镜头序列: [
        {
          镜头id: 1,
          时间段: "0-2秒",
          镜头目的: "开场吸引注意",
          视觉内容: "酒店门头和到达区夜景",
          主体: "酒店外观",
          场景: "酒店外观",
          镜头运动: "缓慢推进",
          构图: "对称居中",
          景别: "wide",
        },
        {
          镜头id: 2,
          时间段: "4-6秒",
          镜头目的: "展示客房核心体验",
          视觉内容: "大床房全景和落地窗",
          主体: "客房",
          场景: "客房",
          镜头运动: "稳定前移",
          构图: "纵深构图",
          景别: "wide",
        },
      ],
    }),
    videoAnalysisCompletedAt: now,
    rawTranscript: "",
    visualSubtitleText: "",
    visualSubtitleLines: [],
    contentScript: "先看外观再看客房",
    videoTemplatePrompt: "酒店探店结构模板",
    reversePrompt: "",
    subtitle: "",
    createdAt: now,
    updatedAt: now,
  };
}

test("applyHotelAssetPlanning 会优先把酒店实拍图绑定到镜头计划", () => {
  const planned = applyHotelAssetPlanning({
    shotPlan: buildBaseShotPlan(),
    hotelAssets: [
      buildAsset({
        assetId: "asset-exterior",
        sceneType: "exterior",
        fileUrl: "/video-tasks/task-hotel/hotel-assets/exterior.jpg",
        subjectSummary: "酒店正门与门头夜景",
        isHeroCandidate: true,
      }),
      buildAsset({
        assetId: "asset-room",
        sceneType: "room",
        fileUrl: "/video-tasks/task-hotel/hotel-assets/room.jpg",
        subjectSummary: "大床房全景与窗边休息区",
      }),
    ],
  });

  assert.equal(planned.shots[0]?.assetId, "asset-exterior");
  assert.equal(planned.shots[0]?.sceneType, "exterior");
  assert.equal(planned.shots[0]?.generationMode, "photo_direct_i2v");
  assert.match(planned.shots[0]?.sceneDescription ?? "", /酒店外观|酒店正门/u);

  assert.equal(planned.shots[2]?.assetId, "asset-room");
  assert.equal(planned.shots[2]?.sceneType, "room");
  assert.equal(planned.shots[2]?.referenceImageUrl, "/video-tasks/task-hotel/hotel-assets/room.jpg");
});

test("applyHotelAssetPlanning 会区分直驱、增强和 AI 补镜头模式", () => {
  const planned = applyHotelAssetPlanning({
    shotPlan: buildBaseShotPlan(),
    hotelAssets: [
      buildAsset({
        assetId: "asset-exterior",
        sceneType: "exterior",
        fileUrl: "/video-tasks/task-hotel/hotel-assets/exterior.jpg",
        canDirectI2V: true,
        needEnhancement: false,
      }),
      buildAsset({
        assetId: "asset-lobby-warning",
        sceneType: "lobby",
        fileUrl: "/video-tasks/task-hotel/hotel-assets/lobby.jpg",
        canDirectI2V: false,
        needEnhancement: true,
        reviewStatus: "warning",
      }),
    ],
  });

  assert.equal(planned.shots[0]?.generationMode, "photo_direct_i2v");
  assert.equal(planned.shots[1]?.generationMode, "photo_enhanced_i2v");
  assert.equal(planned.shots[1]?.needImageEnhancement, true);
  assert.equal(planned.shots[2]?.generationMode, "ai_generated_broll");
  assert.equal(planned.shots[2]?.assetId, null);
});

test("captured_material_first 会优先绑定参考视频分析出的酒店实拍镜头", () => {
  const planned = applyHotelAssetPlanning({
    shotPlan: buildBaseShotPlan(),
    hotelAssets: [
      buildAsset({
        assetId: "asset-room-photo",
        sceneType: "room",
        fileUrl: "/video-tasks/task-hotel/hotel-assets/room.jpg",
        subjectSummary: "备选客房图",
      }),
    ],
    referenceVideoMaterial: buildVideoMaterialRecord(),
    workflowKind: "captured_material_first",
  });

  assert.equal(planned.shots[0]?.assetSourceType, "video_material");
  assert.equal(planned.shots[0]?.sourceTrace, "reference_video_keyframe");
  assert.equal(planned.shots[0]?.referenceImageUrl, "/video-materials/vm-demo/frames/frame_0001.jpg");
  assert.match(planned.shots[0]?.sceneDescription ?? "", /酒店外观/u);

  assert.equal(planned.shots[2]?.assetSourceType, "video_material");
  assert.equal(planned.shots[2]?.referenceImageUrl, "/video-materials/vm-demo/frames/frame_0002.jpg");
  assert.match(planned.shots[2]?.sceneDescription ?? "", /客房/u);
});
