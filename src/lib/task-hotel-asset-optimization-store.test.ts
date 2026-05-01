import assert from "node:assert/strict";
import test from "node:test";

import { USER_SESSION_COOKIE } from "./auth-route-config";
import { sha256 } from "./auth-security";
import { upsertAuthUser, upsertUserSession } from "./auth-store";
import { hydrateTaskCreationParameterState } from "./task-creation-parameters";
import {
  deleteTaskHotelAssetOptimizationHistoryForRoot,
  deleteTaskHotelAssetOptimizationStatesByTaskId,
  getTaskHotelAssetOptimizationState,
  listDisposableEnhancedCandidateAssetIds,
  listEffectiveTaskHotelAssets,
  prepareNextTaskHotelAssetOptimizationRound,
  replaceTaskHotelAssetOptimizationRoundCandidates,
  removeTaskHotelAssetFromOptimizationStates,
  selectTaskHotelAssetOptimizationVariant,
} from "./task-hotel-asset-optimization-store";
import {
  createTaskHotelAsset,
  deleteTaskHotelAssetsByTaskId,
  getTaskHotelAsset,
  type HotelAssetSourceType,
  type TaskHotelAssetRecord,
} from "./task-hotel-asset-store";
import { createVideoTask, deleteVideoTask, getVideoTask, patchVideoTask } from "./video-task-store";
import { normalizeVideoTaskSource, taskConstraintPresets, type VideoTaskParameterBundle } from "./video-task-schema";
import { PATCH as patchHotelAssetsRoute } from "../app/api/video-tasks/[taskId]/hotel-assets/route";

function createTaskId() {
  return `task-hotel-asset-optimizations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAuthenticatedPatchRequest(taskId: string, token: string, body: Record<string, unknown>) {
  const headers = new Headers({
    "content-type": "application/json",
    cookie: `${USER_SESSION_COOKIE}=${token}`,
  });
  const nextUrl = new URL(`http://127.0.0.1:3000/api/video-tasks/${taskId}/hotel-assets`) as URL & {
    clone(): URL;
  };
  nextUrl.clone = () => new URL(nextUrl.toString());

  return {
    cookies: {
      get(name: string) {
        return name === USER_SESSION_COOKIE ? { name, value: token } : undefined;
      },
    },
    headers,
    json: async () => body,
    method: "PATCH",
    nextUrl,
  };
}

function createAuthenticatedUser(suffix: string) {
  const timestamp = new Date().toISOString();
  const userId = `hotel-asset-test-user-${suffix}`;
  const sessionId = `hotel-asset-test-session-${suffix}`;
  const token = `hotel-asset-test-token-${suffix}`;

  upsertAuthUser({
    avatar: null,
    certificationLabel: null,
    createdAt: timestamp,
    lastLoginAt: timestamp,
    lastLoginIp: "127.0.0.1",
    mergedIntoUserId: null,
    nickname: `酒店素材测试用户${suffix}`,
    planLevel: null,
    quotaScope: "limited",
    status: "normal",
    updatedAt: timestamp,
    userId,
  });
  upsertUserSession({
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ip: "127.0.0.1",
    lastSeenAt: timestamp,
    loginType: "password",
    revokedAt: null,
    revokedReason: null,
    sessionId,
    tokenHash: sha256(token),
    userAgent: "node:test",
    userId,
  });

  return { token, userId };
}

function buildRouteTestParameterBundle(): VideoTaskParameterBundle {
  const state = hydrateTaskCreationParameterState({
    videoType: "hotel_explore_voiceover",
    videoExpectedDurationRange: "35_60",
    videoSegmentCount: 3,
    videoDurationSeconds: 45,
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
      storyShotCount: 9,
      storyShotsPerSegment: 2,
      introSegmentDurationSeconds: null,
      mode: state.videoMode,
      multiShot: state.videoMultiShot,
      shotType: state.videoShotType,
      enableTailFrame: state.videoEnableTailFrame,
      segmentCount: state.videoSegmentCount,
      durationSeconds: state.videoDurationSeconds,
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
      ...taskConstraintPresets[state.constraintPreset].constraints,
      customRules: state.constraintCustomRules.trim()
        ? [...taskConstraintPresets[state.constraintPreset].constraints.customRules, state.constraintCustomRules.trim()]
        : taskConstraintPresets[state.constraintPreset].constraints.customRules,
    },
  };
}

function createAsset(
  taskId: string,
  input: Pick<TaskHotelAssetRecord, "assetId" | "displayName" | "fileUrl" | "sortOrder"> & {
    sourceType?: HotelAssetSourceType;
    enhancedFromAssetId?: string | null;
  },
) {
  return createTaskHotelAsset({
    assetId: input.assetId,
    taskId,
    ownerUserId: "user-1",
    fileUrl: input.fileUrl,
    fileName: `${input.displayName}.jpg`,
    displayName: input.displayName,
    sourceType: input.sourceType ?? "user_upload",
    enhancedFromAssetId: input.enhancedFromAssetId ?? null,
    sceneType: "exterior",
    subjectSummary: input.displayName,
    tags: [],
    compositionType: "纵向稳定构图",
    recommendedShotScale: "medium",
    isHeroCandidate: false,
    isCloseupCandidate: false,
    canDirectI2V: true,
    needEnhancement: false,
    qualityScore: 88,
    commercialScore: 86,
    width: 900,
    height: 1600,
    userNote: "",
    reviewStatus: "passed",
    analyzedAt: new Date().toISOString(),
    sortOrder: input.sortOrder,
  });
}

test("listEffectiveTaskHotelAssets 只返回每个原图槽位当前选中的图片", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      assetId: "root-2",
      displayName: "图片2",
      fileUrl: "/video-tasks/demo/hotel-assets/root-2.jpg",
      sortOrder: 1,
    });
    createAsset(taskId, {
      assetId: "opt-1",
      displayName: "优化图1",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-1.jpg",
      sortOrder: 2,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });
    createAsset(taskId, {
      assetId: "opt-2",
      displayName: "优化图2",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-2.jpg",
      sortOrder: 3,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });

    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-2",
    });

    assert.deepEqual(
      listEffectiveTaskHotelAssets(taskId).map((asset) => asset.assetId),
      ["opt-2", "root-2"],
    );
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("prepareNextTaskHotelAssetOptimizationRound 会保留历史并返回未选中候选图", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    for (const [index, assetId] of ["opt-1", "opt-2", "opt-3", "opt-4"].entries()) {
      createAsset(taskId, {
        assetId,
        displayName: `优化图${index + 1}`,
        fileUrl: `/video-tasks/demo/hotel-assets/${assetId}.jpg`,
        sortOrder: index + 1,
        sourceType: "enhanced",
        enhancedFromAssetId: "root-1",
      });
    }

    replaceTaskHotelAssetOptimizationRoundCandidates({
      taskId,
      rootAssetId: "root-1",
      candidateIds: ["opt-1", "opt-2", "opt-3", "opt-4"],
    });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-2",
    });

    const prepared = prepareNextTaskHotelAssetOptimizationRound({
      taskId,
      rootAssetId: "root-1",
    });

    assert.deepEqual(prepared.staleCandidateIds, ["opt-1", "opt-3", "opt-4"]);
    assert.deepEqual(prepared.state.historyAssetIds, ["root-1", "opt-2"]);
    assert.deepEqual(prepared.state.currentRoundCandidateIds, []);
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("历史图去重，重复选择同一张图不会重复追加", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      assetId: "opt-1",
      displayName: "优化图1",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-1.jpg",
      sortOrder: 1,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });

    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-1",
    });
    prepareNextTaskHotelAssetOptimizationRound({ taskId, rootAssetId: "root-1" });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "root-1",
    });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-1",
    });
    const preparedAgain = prepareNextTaskHotelAssetOptimizationRound({ taskId, rootAssetId: "root-1" });

    assert.deepEqual(preparedAgain.state.historyAssetIds, ["root-1", "opt-1"]);
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("重新优化同一来源时不会把历史图当成旧候选图删除", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      assetId: "history-1",
      displayName: "原图2",
      fileUrl: "/video-tasks/demo/hotel-assets/history-1.jpg",
      sortOrder: 1,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });
    createAsset(taskId, {
      assetId: "orphan-candidate",
      displayName: "旧候选",
      fileUrl: "/video-tasks/demo/hotel-assets/orphan-candidate.jpg",
      sortOrder: 2,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });

    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "history-1",
    });
    prepareNextTaskHotelAssetOptimizationRound({
      taskId,
      rootAssetId: "root-1",
    });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "root-1",
    });
    const state = getTaskHotelAssetOptimizationState(taskId, "root-1");

    assert.deepEqual(
      listDisposableEnhancedCandidateAssetIds({
        assets: [getTaskHotelAsset("history-1"), getTaskHotelAsset("orphan-candidate")].filter(
          (asset): asset is NonNullable<typeof asset> => Boolean(asset),
        ),
        sourceAssetId: "root-1",
        preserveAssetIds: state?.historyAssetIds,
      }),
      ["orphan-candidate"],
    );
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("删除当前使用的优化图时会回退到原图并清理历史引用", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      assetId: "opt-1",
      displayName: "优化图1",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-1.jpg",
      sortOrder: 1,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });

    replaceTaskHotelAssetOptimizationRoundCandidates({
      taskId,
      rootAssetId: "root-1",
      candidateIds: ["opt-1"],
    });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-1",
    });
    prepareNextTaskHotelAssetOptimizationRound({ taskId, rootAssetId: "root-1" });

    const affected = removeTaskHotelAssetFromOptimizationStates(taskId, "opt-1");

    assert.equal(affected[0]?.currentAssetId, "root-1");
    assert.deepEqual(affected[0]?.currentRoundCandidateIds, []);
    assert.deepEqual(affected[0]?.historyAssetIds, ["root-1"]);
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("选择优化图不会立即清空下游已生成状态和任务产物引用", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = createAuthenticatedUser(suffix);
  const task = createVideoTask({
    ownerUserId: owner.userId,
    title: "素材选择保留下游状态",
    source: normalizeVideoTaskSource({
      productInfoSnapshot: "测试酒店",
      userPrompt: "测试素材变更后保留下游结果",
      videoTemplatePrompt: "",
    }),
    draftBundle: {
      textToImagePrompt: "保留图文提示词",
      imageToVideoPrompt: "保留视频提示词",
      narrationScript: "保留已经生成的口播字幕",
    },
    parameters: buildRouteTestParameterBundle(),
  });

  try {
    patchVideoTask(task.taskId, {
      status: "COMPOSITION_READY",
      stageTimestamps: {
        SUBTITLE_AUDIO_READY: "2026-01-01T00:00:00.000Z",
        IMAGES_READY: "2026-01-01T00:01:00.000Z",
        CLIPS_READY: "2026-01-01T00:02:00.000Z",
        COMPOSITION_READY: "2026-01-01T00:03:00.000Z",
      },
    });
    createAsset(task.taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(task.taskId, {
      assetId: "opt-1",
      displayName: "优化图1",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-1.jpg",
      sortOrder: 1,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });
    replaceTaskHotelAssetOptimizationRoundCandidates({
      taskId: task.taskId,
      rootAssetId: "root-1",
      candidateIds: ["opt-1"],
    });

    const response = await patchHotelAssetsRoute(
      createAuthenticatedPatchRequest(task.taskId, owner.token, {
        action: "select_asset_variant",
        assetId: "opt-1",
        rootAssetId: "root-1",
      }) as never,
      { params: Promise.resolve({ taskId: task.taskId }) },
    );
    assert.ok(response);
    const body = await response.json();
    const taskAfterSelection = getVideoTask(task.taskId);

    assert.equal(response.status, 200);
    assert.equal(body.task.status, "COMPOSITION_READY");
    assert.equal(taskAfterSelection?.status, "COMPOSITION_READY");
    assert.equal(taskAfterSelection?.draftBundle.narrationScript, "保留已经生成的口播字幕");
    assert.equal(taskAfterSelection?.stageTimestamps.COMPOSITION_READY, "2026-01-01T00:03:00.000Z");
    assert.equal(getTaskHotelAssetOptimizationState(task.taskId, "root-1")?.currentAssetId, "opt-1");
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(task.taskId);
    deleteTaskHotelAssetsByTaskId(task.taskId);
    deleteVideoTask(task.taskId);
  }
});

test("清理原图槽位优化历史时会删除候选优化图并保留原图", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      assetId: "root-1",
      displayName: "图片1",
      fileUrl: "/video-tasks/demo/hotel-assets/root-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      assetId: "opt-1",
      displayName: "优化图1",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-1.jpg",
      sortOrder: 1,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });
    createAsset(taskId, {
      assetId: "opt-2",
      displayName: "优化图2",
      fileUrl: "/video-tasks/demo/hotel-assets/opt-2.jpg",
      sortOrder: 2,
      sourceType: "enhanced",
      enhancedFromAssetId: "root-1",
    });
    replaceTaskHotelAssetOptimizationRoundCandidates({
      taskId,
      rootAssetId: "root-1",
      candidateIds: ["opt-1", "opt-2"],
    });
    selectTaskHotelAssetOptimizationVariant({
      taskId,
      rootAssetId: "root-1",
      assetId: "opt-1",
    });

    const deletedIds = deleteTaskHotelAssetOptimizationHistoryForRoot(taskId, "root-1");

    assert.deepEqual(deletedIds, ["opt-1", "opt-2"]);
    assert.equal(getTaskHotelAsset("root-1")?.assetId, "root-1");
    assert.equal(getTaskHotelAsset("opt-1"), null);
    assert.equal(getTaskHotelAsset("opt-2"), null);
    assert.equal(getTaskHotelAssetOptimizationState(taskId, "root-1"), null);
    assert.deepEqual(
      listEffectiveTaskHotelAssets(taskId).map((asset) => asset.assetId),
      ["root-1"],
    );
  } finally {
    deleteTaskHotelAssetOptimizationStatesByTaskId(taskId);
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});
