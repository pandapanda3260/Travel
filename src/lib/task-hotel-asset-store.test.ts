import assert from "node:assert/strict";
import test from "node:test";

import { getHotelAssetDisplayOrder } from "./hotel-asset-ordering";
import {
  autoGroupTaskHotelAssetByScene,
  createTaskHotelAsset,
  deleteTaskHotelAssetsByTaskId,
  listTaskHotelAssets,
  type TaskHotelAssetRecord,
} from "./task-hotel-asset-store";

function createTaskId() {
  return `task-hotel-assets-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAsset(
  taskId: string,
  input: Pick<TaskHotelAssetRecord, "displayName" | "sceneType" | "fileUrl" | "sortOrder">,
) {
  return createTaskHotelAsset({
    taskId,
    ownerUserId: "user-1",
    fileUrl: input.fileUrl,
    fileName: `${input.displayName}.jpg`,
    displayName: input.displayName,
    sourceType: "user_upload",
    sceneType: input.sceneType,
    subjectSummary: input.displayName,
    tags: [],
    compositionType: "横向稳定构图",
    recommendedShotScale: "wide",
    isHeroCandidate: false,
    isCloseupCandidate: false,
    canDirectI2V: true,
    needEnhancement: false,
    qualityScore: 80,
    commercialScore: 82,
    width: 1600,
    height: 900,
    userNote: "",
    reviewStatus: "passed",
    analyzedAt: new Date().toISOString(),
    sortOrder: input.sortOrder,
  });
}

test("autoGroupTaskHotelAssetByScene 会把新识别出的同场景素材归到已有分组后面", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      displayName: "外观1",
      sceneType: "exterior",
      fileUrl: "/video-tasks/demo/hotel-assets/exterior-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      displayName: "客房1",
      sceneType: "room",
      fileUrl: "/video-tasks/demo/hotel-assets/room-1.jpg",
      sortOrder: 1,
    });
    createAsset(taskId, {
      displayName: "早餐1",
      sceneType: "food",
      fileUrl: "/video-tasks/demo/hotel-assets/food-1.jpg",
      sortOrder: 2,
    });
    const newRoom = createAsset(taskId, {
      displayName: "客房2",
      sceneType: "room",
      fileUrl: "/video-tasks/demo/hotel-assets/room-2.jpg",
      sortOrder: 3,
    });

    const grouped = autoGroupTaskHotelAssetByScene(taskId, newRoom.assetId);

    assert.deepEqual(
      grouped.map((asset) => [asset.displayName, asset.sortOrder]),
      [
        ["外观1", 0],
        ["客房1", 1],
        ["客房2", 2],
        ["早餐1", 3],
      ],
    );
  } finally {
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("autoGroupTaskHotelAssetByScene 在没有同场景素材时会插入到对应场景组位置", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      displayName: "外观1",
      sceneType: "exterior",
      fileUrl: "/video-tasks/demo/hotel-assets/exterior-1.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      displayName: "早餐1",
      sceneType: "food",
      fileUrl: "/video-tasks/demo/hotel-assets/food-1.jpg",
      sortOrder: 1,
    });
    const bathroom = createAsset(taskId, {
      displayName: "卫浴1",
      sceneType: "bathroom",
      fileUrl: "/video-tasks/demo/hotel-assets/bathroom-1.jpg",
      sortOrder: 2,
    });

    autoGroupTaskHotelAssetByScene(taskId, bathroom.assetId);

    assert.deepEqual(
      listTaskHotelAssets(taskId).map((asset) => [asset.displayName, asset.sortOrder]),
      [
        ["外观1", 0],
        ["卫浴1", 1],
        ["早餐1", 2],
      ],
    );
  } finally {
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});

test("getHotelAssetDisplayOrder 会优先按用户排序展示", () => {
  const taskId = createTaskId();

  try {
    createAsset(taskId, {
      displayName: "图片3",
      sceneType: "exterior",
      fileUrl: "/video-tasks/demo/hotel-assets/3.jpg",
      sortOrder: 0,
    });
    createAsset(taskId, {
      displayName: "图片1",
      sceneType: "room",
      fileUrl: "/video-tasks/demo/hotel-assets/1.jpg",
      sortOrder: 1,
    });
    createAsset(taskId, {
      displayName: "图片2",
      sceneType: "facility",
      fileUrl: "/video-tasks/demo/hotel-assets/2.jpg",
      sortOrder: 2,
    });

    assert.deepEqual(
      getHotelAssetDisplayOrder(listTaskHotelAssets(taskId)).map((asset) => asset.displayName),
      ["图片3", "图片1", "图片2"],
    );
  } finally {
    deleteTaskHotelAssetsByTaskId(taskId);
  }
});
