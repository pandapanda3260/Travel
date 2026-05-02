import { existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbDelete, dbGet, dbGetAll, dbUpsert } from "./db";
import { joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import type { HotelAssetRecommendedPosition, HotelAssetSceneType } from "./video-task-schema";

export type HotelAssetSourceType = "user_upload" | "enhanced" | "ai_generated";
export type HotelAssetOrientation = "portrait" | "landscape" | "square";
export type HotelAssetShotScale = "wide" | "medium" | "close" | "detail";
export type HotelAssetReviewStatus = "pending" | "passed" | "warning" | "rejected";

export type TaskHotelAssetRecord = {
  assetId: string;
  taskId: string;
  ownerUserId: string | null;
  fileUrl: string;
  fileName: string;
  displayName: string;
  sourceType: HotelAssetSourceType;
  enhancedFromAssetId?: string | null;
  sceneType: HotelAssetSceneType;
  subjectSummary: string;
  tags: string[];
  compositionType: string;
  recommendedShotScale: HotelAssetShotScale;
  isHeroCandidate: boolean;
  isCloseupCandidate: boolean;
  canDirectI2V: boolean;
  needEnhancement: boolean;
  qualityScore: number;
  commercialScore: number;
  compositionScore: number;
  recommendedPosition: HotelAssetRecommendedPosition;
  sellingPoints: string[];
  durationSuggestion: number | null;
  mustUse: boolean;
  forbidden: boolean;
  width: number;
  height: number;
  orientation: HotelAssetOrientation;
  userNote: string;
  reviewStatus: HotelAssetReviewStatus;
  analyzedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type TaskHotelAssetCreateInput = Omit<
  TaskHotelAssetRecord,
  | "assetId"
  | "createdAt"
  | "updatedAt"
  | "orientation"
  | "compositionScore"
  | "recommendedPosition"
  | "sellingPoints"
  | "durationSuggestion"
  | "mustUse"
  | "forbidden"
> &
  Partial<
    Pick<
      TaskHotelAssetRecord,
      | "compositionScore"
      | "recommendedPosition"
      | "sellingPoints"
      | "durationSuggestion"
      | "mustUse"
      | "forbidden"
    >
  > & {
    assetId?: string;
    orientation?: HotelAssetOrientation;
  };

const COLLECTION = "task-hotel-assets";
const hotelAssetSceneSortOrder: HotelAssetSceneType[] = [
  "exterior",
  "lobby",
  "room",
  "bathroom",
  "dining",
  "food",
  "facility",
  "neighborhood",
  "service_detail",
  "atmosphere",
  "other",
];

function normalizeOrientation(width: number, height: number): HotelAssetOrientation {
  if (width === height) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
}

function normalizeSceneType(value: string | null | undefined): HotelAssetSceneType {
  switch (value) {
    case "exterior":
    case "lobby":
    case "room":
    case "bathroom":
    case "dining":
    case "food":
    case "facility":
    case "neighborhood":
    case "service_detail":
    case "atmosphere":
      return value;
    default:
      return "other";
  }
}

function normalizeShotScale(value: string | null | undefined): HotelAssetShotScale {
  switch (value) {
    case "wide":
    case "medium":
    case "close":
    case "detail":
      return value;
    default:
      return "medium";
  }
}

function normalizeReviewStatus(value: string | null | undefined): HotelAssetReviewStatus {
  switch (value) {
    case "passed":
    case "warning":
    case "rejected":
      return value;
    default:
      return "pending";
  }
}

function normalizeRecommendedPosition(value: string | null | undefined): HotelAssetRecommendedPosition {
  switch (value) {
    case "opening":
    case "selling_point":
    case "transition":
    case "ending":
    case "atmosphere":
      return value;
    default:
      return null;
  }
}

function normalizeSellingPoints(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

function normalizeDurationSuggestion(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(Math.min(30, Math.max(0, numeric)).toFixed(1));
}

function normalizeRecord(record: Partial<TaskHotelAssetRecord>): TaskHotelAssetRecord {
  const width = Math.max(0, Math.round(record.width ?? 0));
  const height = Math.max(0, Math.round(record.height ?? 0));
  const createdAt = record.createdAt ?? new Date().toISOString();
  const forbidden = Boolean(record.forbidden);
  const mustUse = Boolean(record.mustUse) && !forbidden;

  return {
    assetId: record.assetId ?? crypto.randomUUID(),
    taskId: record.taskId ?? "",
    ownerUserId: record.ownerUserId ?? null,
    fileUrl: record.fileUrl ?? "",
    fileName: record.fileName ?? "",
    displayName: record.displayName?.trim() ?? "",
    sourceType: record.sourceType ?? "user_upload",
    enhancedFromAssetId: record.enhancedFromAssetId?.trim() || null,
    sceneType: normalizeSceneType(record.sceneType),
    subjectSummary: record.subjectSummary?.trim() ?? "",
    tags: Array.isArray(record.tags)
      ? record.tags
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    compositionType: record.compositionType?.trim() ?? "",
    recommendedShotScale: normalizeShotScale(record.recommendedShotScale),
    isHeroCandidate: Boolean(record.isHeroCandidate),
    isCloseupCandidate: Boolean(record.isCloseupCandidate),
    canDirectI2V: Boolean(record.canDirectI2V),
    needEnhancement: Boolean(record.needEnhancement),
    qualityScore: Math.max(0, Math.min(100, Math.round(Number(record.qualityScore ?? 0)))),
    commercialScore: Math.max(0, Math.min(100, Math.round(Number(record.commercialScore ?? 0)))),
    compositionScore: Math.max(0, Math.min(100, Math.round(Number(record.compositionScore ?? 0)))),
    recommendedPosition: normalizeRecommendedPosition(record.recommendedPosition),
    sellingPoints: normalizeSellingPoints(record.sellingPoints),
    durationSuggestion: normalizeDurationSuggestion(record.durationSuggestion),
    mustUse,
    forbidden,
    width,
    height,
    orientation:
      record.orientation === "portrait" || record.orientation === "landscape" || record.orientation === "square"
        ? record.orientation
        : normalizeOrientation(width, height),
    userNote: record.userNote?.trim() ?? "",
    reviewStatus: normalizeReviewStatus(record.reviewStatus),
    analyzedAt: record.analyzedAt ?? null,
    sortOrder: Math.max(0, Math.round(Number(record.sortOrder ?? 0))),
    createdAt,
    updatedAt: record.updatedAt ?? createdAt,
  };
}

function getHotelAssetSceneRank(sceneType: HotelAssetSceneType) {
  const index = hotelAssetSceneSortOrder.indexOf(sceneType);
  return index >= 0 ? index : hotelAssetSceneSortOrder.length;
}

export function deleteTaskHotelAssetFileByUrl(publicUrl: string | null | undefined) {
  if (!publicUrl?.startsWith("/")) {
    return;
  }

  const absolutePath = resolveRuntimeAssetUrlToPath(publicUrl);
  if (existsSync(absolutePath)) {
    unlinkSync(absolutePath);
  }
}

function getTaskAssetPublicDir(taskId: string) {
  return joinRuntimePublicStoragePath("video-tasks", taskId, "hotel-assets");
}

export function listTaskHotelAssets(taskId?: string) {
  const records = dbGetAll<Partial<TaskHotelAssetRecord>>(COLLECTION).map(normalizeRecord);
  const filtered = taskId ? records.filter((item) => item.taskId === taskId) : records;
  return filtered.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

export function getTaskHotelAsset(assetId: string) {
  const record = dbGet<Partial<TaskHotelAssetRecord>>(COLLECTION, assetId);
  return record ? normalizeRecord(record) : null;
}

export function createTaskHotelAsset(input: TaskHotelAssetCreateInput) {
  const now = new Date().toISOString();
  const record = normalizeRecord({
    ...input,
    assetId: input.assetId ?? crypto.randomUUID(),
    orientation: input.orientation ?? normalizeOrientation(input.width, input.height),
    createdAt: now,
    updatedAt: now,
  });

  dbUpsert(COLLECTION, record.assetId, record);
  return record;
}

export function patchTaskHotelAsset(
  assetId: string,
  updates: Partial<Omit<TaskHotelAssetRecord, "assetId" | "taskId" | "ownerUserId" | "createdAt">>,
) {
  const current = getTaskHotelAsset(assetId);
  if (!current) {
    return null;
  }

  const nextRecord = normalizeRecord({
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  dbUpsert(COLLECTION, assetId, nextRecord);
  return nextRecord;
}

export function deleteTaskHotelAsset(assetId: string) {
  const current = getTaskHotelAsset(assetId);
  if (!current) {
    return null;
  }

  deleteTaskHotelAssetFileByUrl(current.fileUrl);
  dbDelete(COLLECTION, assetId);
  return current;
}

export function deleteTaskHotelAssetsByTaskId(taskId: string) {
  const records = listTaskHotelAssets(taskId);
  for (const record of records) {
    deleteTaskHotelAsset(record.assetId);
  }

  const assetDir = getTaskAssetPublicDir(taskId);
  if (existsSync(assetDir)) {
    rmSync(assetDir, { recursive: true, force: true });
  }

  return records;
}

export function getTaskHotelAssetPublicPath(taskId: string, fileName: string) {
  return join(getTaskAssetPublicDir(taskId), fileName);
}

export function autoGroupTaskHotelAssetByScene(taskId: string, assetId: string) {
  const assets = listTaskHotelAssets(taskId);
  const target = assets.find((asset) => asset.assetId === assetId);
  if (!target) {
    return assets;
  }

  const remaining = assets.filter((asset) => asset.assetId !== assetId);
  const sameSceneLastIndex = remaining.reduce((lastIndex, asset, index) => {
    return asset.sceneType === target.sceneType ? index : lastIndex;
  }, -1);

  const insertionIndex =
    sameSceneLastIndex >= 0
      ? sameSceneLastIndex + 1
      : (() => {
          const targetRank = getHotelAssetSceneRank(target.sceneType);
          const firstLaterGroupIndex = remaining.findIndex(
            (asset) => getHotelAssetSceneRank(asset.sceneType) > targetRank,
          );
          return firstLaterGroupIndex >= 0 ? firstLaterGroupIndex : remaining.length;
        })();

  const reordered = [...remaining];
  reordered.splice(insertionIndex, 0, target);

  reordered.forEach((asset, index) => {
    if (asset.sortOrder !== index) {
      patchTaskHotelAsset(asset.assetId, { sortOrder: index });
    }
  });

  return listTaskHotelAssets(taskId);
}
