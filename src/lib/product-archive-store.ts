import { existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { importLegacyProductArchivesIfNeeded } from "./legacy-local-data-import";
import { joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";

export type ProductArchiveKeyInfo = {
  productName: string;
  originalPrice: string;
  redeemPrice: string;
  packagePersonCount: string;
};

export type ProductArchiveParsedData = {
  rawText: string;
  summaryTitle: string;
  packagePersonCount: string;
  tags: string[];
  sellingPoints: string[];
};

export type ProductArchiveRecord = {
  archiveId: string;
  title: string;
  sourceImageUrl: string | null;
  sourceImageFileName: string | null;
  sourceImageUploadedAt: string | null;
  parsedText: string;
  parsedData: ProductArchiveParsedData;
  keyInfo: ProductArchiveKeyInfo;
  createdAt: string;
  updatedAt: string;
};

const COLLECTION = "product-archives";
const legacyJsonPath = joinRuntimeDataPath("product-archives.json");

let migrated = false;
function ensureStore() {
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as ProductArchiveRecord).archiveId);
    importLegacyProductArchivesIfNeeded();
    migrated = true;
  }
}

function getDefaultParsedData(): ProductArchiveParsedData {
  return {
    rawText: "",
    summaryTitle: "",
    packagePersonCount: "",
    tags: [],
    sellingPoints: [],
  };
}

function getDefaultKeyInfo(): ProductArchiveKeyInfo {
  return {
    productName: "",
    originalPrice: "",
    redeemPrice: "",
    packagePersonCount: "",
  };
}

function normalizeRecord(record: Partial<ProductArchiveRecord>): ProductArchiveRecord {
  const parsedData = {
    ...getDefaultParsedData(),
    ...record.parsedData,
    tags: record.parsedData?.tags ?? [],
    sellingPoints: record.parsedData?.sellingPoints ?? [],
  };
  const keyInfo = {
    ...getDefaultKeyInfo(),
    ...record.keyInfo,
  };
  const createdAt = record.createdAt ?? new Date().toISOString();

  return {
    archiveId: record.archiveId ?? crypto.randomUUID(),
    title: record.title ?? parsedData.summaryTitle ?? "未命名商品档案",
    sourceImageUrl: record.sourceImageUrl ?? null,
    sourceImageFileName: record.sourceImageFileName ?? null,
    sourceImageUploadedAt: record.sourceImageUploadedAt ?? null,
    parsedText: record.parsedText ?? parsedData.rawText ?? "",
    parsedData,
    keyInfo,
    createdAt,
    updatedAt: record.updatedAt ?? createdAt,
  };
}

function readStore() {
  ensureStore();
  try {
    return dbGetAll<Partial<ProductArchiveRecord>>(COLLECTION).map(normalizeRecord);
  } catch {
    return [] as ProductArchiveRecord[];
  }
}

function writeStore(records: ProductArchiveRecord[]) {
  ensureStore();
  dbReplaceAll(COLLECTION, records.map((r) => ({ key: r.archiveId, data: r })));
}

function getArchivePublicDir(archiveId: string) {
  return joinRuntimePublicStoragePath("product-archives", archiveId);
}

function deleteLocalFile(publicUrl: string | null | undefined) {
  if (!publicUrl?.startsWith("/")) {
    return;
  }

  const absolutePath = resolveRuntimeAssetUrlToPath(publicUrl);
  if (existsSync(absolutePath)) {
    unlinkSync(absolutePath);
  }
}

export function listProductArchives() {
  return readStore().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getProductArchive(archiveId: string) {
  return readStore().find((item) => item.archiveId === archiveId) ?? null;
}

export function createProductArchive() {
  const records = readStore();
  const now = new Date().toISOString();
  const record: ProductArchiveRecord = {
    archiveId: crypto.randomUUID(),
    title: "未命名商品档案",
    sourceImageUrl: null,
    sourceImageFileName: null,
    sourceImageUploadedAt: null,
    parsedText: "",
    parsedData: getDefaultParsedData(),
    keyInfo: getDefaultKeyInfo(),
    createdAt: now,
    updatedAt: now,
  };
  ensureStore();
  dbUpsert(COLLECTION, record.archiveId, record);
  return record;
}

export function patchProductArchive(
  archiveId: string,
  updates: Partial<Pick<ProductArchiveRecord, "title" | "parsedText">> & {
    parsedData?: Partial<ProductArchiveParsedData>;
    keyInfo?: Partial<ProductArchiveKeyInfo>;
    sourceImageUrl?: string | null;
    sourceImageFileName?: string | null;
    sourceImageUploadedAt?: string | null;
  },
) {
  const records = readStore();
  const index = records.findIndex((item) => item.archiveId === archiveId);
  if (index < 0) {
    return null;
  }

  const current = records[index];
  if (updates.sourceImageUrl !== undefined && current.sourceImageUrl && current.sourceImageUrl !== updates.sourceImageUrl) {
    deleteLocalFile(current.sourceImageUrl);
  }

  const nextParsedData = {
    ...current.parsedData,
    ...updates.parsedData,
    tags: updates.parsedData?.tags ?? current.parsedData.tags,
    sellingPoints: updates.parsedData?.sellingPoints ?? current.parsedData.sellingPoints,
  };
  const nextKeyInfo = {
    ...current.keyInfo,
    ...updates.keyInfo,
  };
  const nextTitle = updates.title ?? current.title;

  const nextRecord: ProductArchiveRecord = {
    ...current,
    title: nextTitle,
    parsedText: updates.parsedText ?? current.parsedText,
    parsedData: nextParsedData,
    keyInfo: nextKeyInfo,
    sourceImageUrl: updates.sourceImageUrl !== undefined ? updates.sourceImageUrl : current.sourceImageUrl,
    sourceImageFileName: updates.sourceImageFileName !== undefined ? updates.sourceImageFileName : current.sourceImageFileName,
    sourceImageUploadedAt: updates.sourceImageUploadedAt !== undefined ? updates.sourceImageUploadedAt : current.sourceImageUploadedAt,
    updatedAt: new Date().toISOString(),
  };

  ensureStore();
  dbUpsert(COLLECTION, archiveId, nextRecord);
  return nextRecord;
}

export function deleteProductArchive(archiveId: string) {
  ensureStore();
  const current = readStore().find((item) => item.archiveId === archiveId);
  if (!current) return null;

  if (current.sourceImageUrl) {
    deleteLocalFile(current.sourceImageUrl);
  }
  const archiveDir = getArchivePublicDir(archiveId);
  if (existsSync(archiveDir)) {
    rmSync(archiveDir, { recursive: true, force: true });
  }
  dbDelete(COLLECTION, archiveId);
  return current;
}
