import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { ensureRuntimeDataDir, joinRuntimeDataPath } from "./runtime-storage";

export type MaterialAssetType = "image" | "video";
export type MaterialSourceType = "image-generation-archive" | "video-generation-job" | "video-composition-output";

export type MaterialLibraryItem = {
  materialId: string;
  type: MaterialAssetType;
  source: MaterialSourceType;
  sourceLabel: string;
  title: string;
  previewUrl: string;
  assetUrl: string;
  prompt: string;
  tags: string[];
  width: number | null;
  height: number | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  addedAt: string;
  sourceSessionId: string;
};

const COLLECTION = "material-library";
const legacyJsonPath = joinRuntimeDataPath("material-library.json");

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as MaterialLibraryItem).materialId);
    migrated = true;
  }
}

function readStore() {
  ensureStore();

  try {
    return dbGetAll<MaterialLibraryItem>(COLLECTION).map(normalizeMaterialItem);
  } catch {
    return [];
  }
}

function writeStore(items: MaterialLibraryItem[]) {
  ensureStore();
  dbReplaceAll(COLLECTION, items.map((item) => ({ key: item.materialId, data: item })));
}

function getSourceLabel(source: MaterialSourceType) {
  switch (source) {
    case "image-generation-archive":
      return "文生图归档";
    case "video-generation-job":
      return "任务片段素材";
    case "video-composition-output":
      return "任务合成成片";
    default:
      return "素材归档";
  }
}

function normalizeMaterialItem(item: MaterialLibraryItem) {
  return {
    ...item,
    type: item.type === "video" ? "video" : "image",
    source:
      item.source === "video-generation-job" || item.source === "video-composition-output"
        ? item.source
        : "image-generation-archive",
    sourceLabel: item.sourceLabel ?? getSourceLabel(item.source as MaterialSourceType),
  } satisfies MaterialLibraryItem;
}

export function listMaterialLibraryItems() {
  return readStore().sort((left, right) => new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime());
}

export function getMaterialLibraryItemBySource(source: MaterialSourceType, sourceEntityId: string) {
  return readStore().find((item) => item.source === source && item.sourceSessionId === sourceEntityId) ?? null;
}

export function removeMaterialLibraryItemsBySource(source: MaterialSourceType, sourceEntityId: string) {
  const items = readStore();
  const nextItems = items.filter((item) => !(item.source === source && item.sourceSessionId === sourceEntityId));

  if (nextItems.length === items.length) {
    return false;
  }

  writeStore(nextItems);
  return true;
}
