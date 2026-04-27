import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { dbDelete, dbGetAll, dbUpsert, migrateJsonArrayIfNeeded } from "./db";
import { importLegacyVideoMaterialsIfNeeded } from "./legacy-local-data-import";
import {
  ensureRuntimeDataDir,
  joinRuntimeDataPath,
  joinRuntimePublicStoragePath,
  resolveRuntimeAssetUrlToPath,
} from "./runtime-storage";
import { extractVisualSubtitleLinesFromAnalysis } from "./video-material-subtitles";
import { sortVideoMaterialsByUploadTimeDesc } from "./video-material-sort";
import type {
  ProcessingMode,
  VideoMaterialImageAsset,
  VideoMaterialImageCleaningJob,
  VideoMaterialRecord,
  VideoMaterialStatus,
  VideoMaterialSummary,
} from "./video-material-types";

export type {
  ProcessingMode,
  VideoMaterialImageAsset,
  VideoMaterialImageCleaningJob,
  VideoMaterialRecord,
  VideoMaterialStatus,
  VideoMaterialSummary,
};

export type VideoTaskReferenceMaterialOption = {
  materialId: string;
  name: string;
  videoTemplatePrompt: string;
};

const COLLECTION = "video-materials";
const legacyJsonPath = joinRuntimeDataPath("video-materials.json");
const uploadsDir = joinRuntimePublicStoragePath("video-materials");

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as { materialId: string }).materialId);
    importLegacyVideoMaterialsIfNeeded();
    migrated = true;
  }
}

export function ensureUploadsDir() {
  mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function getVideoMaterialAssetDir(materialId: string) {
  return join(ensureUploadsDir(), materialId);
}

function getVideoMaterialExtractedFramesDir(materialId: string) {
  return join(getVideoMaterialAssetDir(materialId), "frames");
}

function getVideoMaterialCleanedFramesDir(materialId: string) {
  return join(getVideoMaterialAssetDir(materialId), "cleaned");
}

export function clearVideoMaterialDerivedAssets(materialId: string) {
  try {
    rmSync(getVideoMaterialAssetDir(materialId), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function getImageMetadata(bytes: Buffer) {
  try {
    const metadata = await sharp(bytes).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    };
  } catch {
    return {
      width: null,
      height: null,
      format: null,
    };
  }
}

function sortCleanedFramesBySource(
  extractedFrames: VideoMaterialImageAsset[],
  cleanedFrames: VideoMaterialImageAsset[],
) {
  const sourceOrder = new Map(extractedFrames.map((frame, index) => [frame.imageId, index]));
  return [...cleanedFrames].sort((left, right) => {
    const leftIndex = left.sourceImageId
      ? (sourceOrder.get(left.sourceImageId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const rightIndex = right.sourceImageId
      ? (sourceOrder.get(right.sourceImageId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

export function createIdleVideoMaterialImageCleaningJob(): VideoMaterialImageCleaningJob {
  return {
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
  };
}

export async function persistVideoMaterialExtractedFrames(
  materialId: string,
  frames: Array<{ base64: string; timestamp: number; index: number }>,
) {
  const framesDir = getVideoMaterialExtractedFramesDir(materialId);
  mkdirSync(framesDir, { recursive: true });

  return Promise.all(
    frames.map(async (frame, index) => {
      const fileName = `frame_${String(index + 1).padStart(4, "0")}.jpg`;
      const bytes = Buffer.from(frame.base64, "base64");
      const filePath = join(framesDir, fileName);
      writeFileSync(filePath, bytes);
      const metadata = await getImageMetadata(bytes);

      return {
        imageId: `frame-${String(index + 1).padStart(4, "0")}`,
        imageUrl: `/video-materials/${materialId}/frames/${fileName}`,
        fileName,
        width: metadata.width,
        height: metadata.height,
        byteSize: bytes.byteLength,
        timestampSeconds: Number.isFinite(frame.timestamp) ? Math.max(0, frame.timestamp) : null,
        label: `抽帧${index + 1}`,
        sourceImageId: null,
        createdAt: new Date().toISOString(),
      } satisfies VideoMaterialImageAsset;
    }),
  );
}

export function persistVideoMaterialCleanedFrameDirectory(materialId: string) {
  const cleanedDir = getVideoMaterialCleanedFramesDir(materialId);
  mkdirSync(cleanedDir, { recursive: true });
  return cleanedDir;
}

export function removeVideoMaterialImageAsset(asset: Pick<VideoMaterialImageAsset, "imageUrl">) {
  try {
    const filePath = resolveRuntimeAssetUrlToPath(asset.imageUrl);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // best-effort cleanup
  }
}

export function upsertVideoMaterialCleanedFrames(materialId: string, nextFrames: VideoMaterialImageAsset[]) {
  const material = getVideoMaterial(materialId);
  if (!material) {
    return null;
  }

  const replacedSourceIds = new Set(
    nextFrames.map((frame) => frame.sourceImageId).filter((value): value is string => Boolean(value)),
  );
  const preservedFrames = material.cleanedFrames.filter((frame) => {
    if (!frame.sourceImageId || !replacedSourceIds.has(frame.sourceImageId)) {
      return true;
    }
    removeVideoMaterialImageAsset(frame);
    return false;
  });

  return updateVideoMaterial(materialId, {
    cleanedFrames: sortCleanedFramesBySource(material.extractedFrames, [...preservedFrames, ...nextFrames]),
  });
}

export function deleteVideoMaterialCleanedFrames(materialId: string, imageIds: string[]) {
  const material = getVideoMaterial(materialId);
  if (!material) {
    return null;
  }

  const targetIds = new Set(imageIds);
  if (!targetIds.size) {
    return material;
  }

  const nextCleanedFrames = material.cleanedFrames.filter((frame) => {
    if (!targetIds.has(frame.imageId)) {
      return true;
    }
    removeVideoMaterialImageAsset(frame);
    return false;
  });

  return updateVideoMaterial(materialId, {
    cleanedFrames: nextCleanedFrames,
    imageCleaningJob: {
      ...material.imageCleaningJob,
      cleanedCount: nextCleanedFrames.filter((frame) =>
        material.imageCleaningJob.requestedImageIds.includes(frame.sourceImageId ?? ""),
      ).length,
    },
  });
}

function normalizeMaterial(record: VideoMaterialRecord): VideoMaterialRecord {
  const visualSubtitleLines = Array.isArray(record.visualSubtitleLines)
    ? record.visualSubtitleLines
    : extractVisualSubtitleLinesFromAnalysis(record.videoAnalysis);

  return {
    ...record,
    ownerUserId: record.ownerUserId ?? null,
    videoTemplatePrompt: record.videoTemplatePrompt ?? "",
    transcriptLines: Array.isArray(record.transcriptLines) ? record.transcriptLines : [],
    visualSubtitleLines,
    visualSubtitleText: record.visualSubtitleText ?? visualSubtitleLines.join("\n"),
    extractedFrames: Array.isArray(record.extractedFrames) ? record.extractedFrames : [],
    cleanedFrames: Array.isArray(record.cleanedFrames) ? record.cleanedFrames : [],
    imageCleaningJob: record.imageCleaningJob ?? createIdleVideoMaterialImageCleaningJob(),
  };
}

function readStore(): VideoMaterialRecord[] {
  ensureStore();
  try {
    return dbGetAll<VideoMaterialRecord>(COLLECTION).map(normalizeMaterial);
  } catch {
    return [];
  }
}

function generateId() {
  return `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getStatusLabel(status: VideoMaterialStatus): string {
  switch (status) {
    case "uploading":
      return "上传中";
    case "converting":
      return "音频转换中";
    case "transcribing":
      return "语音识别中";
    case "analyzing":
      return "视频分析中";
    case "generating":
      return "内容生成中";
    case "ready":
      return "已就绪";
    case "error":
      return "处理失败";
    default:
      return "未知";
  }
}

export function getMaterialStatusMeta(status: VideoMaterialStatus) {
  return {
    label: getStatusLabel(status),
    className:
      status === "ready"
        ? "task-module-status created"
        : status === "error"
          ? "task-module-status idle"
          : status === "analyzing"
            ? "task-module-status editing"
            : "task-module-status editing",
  };
}

export function getMaterialDisplayName(record: VideoMaterialRecord): string {
  if (record.name && record.name.trim()) return record.name;
  if (record.subtitle && record.subtitle.trim()) {
    const chars = Array.from(record.subtitle.trim());
    return chars.length <= 8 ? chars.join("") : `${chars.slice(0, 8).join("")}…`;
  }
  if (record.videoFileName) return record.videoFileName;
  return "未命名素材";
}

export function listVideoTaskReferenceMaterials(ownerUserId?: string | null): VideoTaskReferenceMaterialOption[] {
  return listVideoMaterials()
    .filter((item) => !ownerUserId || item.ownerUserId === null || item.ownerUserId === ownerUserId)
    .filter((item) => item.status === "ready")
    .filter((item) => item.videoTemplatePrompt.trim())
    .map((item) => ({
      materialId: item.materialId,
      name: getMaterialDisplayName(item),
      videoTemplatePrompt: item.videoTemplatePrompt.trim(),
    }));
}

export function listAccessibleVideoMaterials(userId: string) {
  return listVideoMaterials().filter((item) => item.ownerUserId === null || item.ownerUserId === userId);
}

export function toVideoMaterialSummary(record: VideoMaterialRecord): VideoMaterialSummary {
  const {
    videoAnalysis,
    rawTranscript,
    visualSubtitleText,
    visualSubtitleLines,
    contentScript,
    videoTemplatePrompt,
    reversePrompt,
    transcriptLines,
    extractedFrames,
    cleanedFrames,
    ...summary
  } = record;
  void videoAnalysis;
  void rawTranscript;
  void visualSubtitleText;
  void visualSubtitleLines;
  void contentScript;
  void videoTemplatePrompt;
  void reversePrompt;
  void transcriptLines;
  void extractedFrames;
  void cleanedFrames;
  return summary;
}

export function listAccessibleVideoMaterialSummaries(userId: string) {
  return listAccessibleVideoMaterials(userId).map(toVideoMaterialSummary);
}

export function countOwnedVideoMaterials(userId: string) {
  return listVideoMaterials().filter((item) => item.ownerUserId === userId).length;
}

export function getVideoTaskReferenceMaterialById(
  materialId: string | null | undefined,
  ownerUserId?: string | null,
): VideoTaskReferenceMaterialOption | null {
  if (!materialId?.trim()) {
    return null;
  }

  const material = getVideoMaterial(materialId.trim());
  if (!material || !material.videoTemplatePrompt.trim()) {
    return null;
  }
  if (ownerUserId && material.ownerUserId && material.ownerUserId !== ownerUserId) {
    return null;
  }

  return {
    materialId: material.materialId,
    name: getMaterialDisplayName(material),
    videoTemplatePrompt: material.videoTemplatePrompt.trim(),
  };
}

export function listVideoMaterials(): VideoMaterialRecord[] {
  return sortVideoMaterialsByUploadTimeDesc(readStore());
}

export function getVideoMaterial(materialId: string): VideoMaterialRecord | null {
  return readStore().find((item) => item.materialId === materialId) ?? null;
}

export function createVideoMaterial(
  videoFileName: string,
  input?: { ownerUserId?: string | null },
): VideoMaterialRecord {
  const now = new Date().toISOString();
  const record: VideoMaterialRecord = {
    materialId: generateId(),
    ownerUserId: input?.ownerUserId ?? null,
    name: "",
    nameEditedAt: null,
    status: "uploading",
    statusMessage: "视频文件已接收，等待处理",
    processingMode: "auto_all",
    videoFileName,
    videoFileUrl: null,
    videoUploadedAt: now,
    audioFileName: null,
    audioFileUrl: null,
    audioConvertedAt: null,
    framesExtracted: 0,
    extractedFrames: [],
    cleanedFrames: [],
    imageCleaningJob: createIdleVideoMaterialImageCleaningJob(),
    videoAnalysis: "",
    videoAnalysisCompletedAt: null,
    rawTranscript: "",
    transcriptLines: [],
    visualSubtitleText: "",
    visualSubtitleLines: [],
    contentScript: "",
    videoTemplatePrompt: "",
    reversePrompt: "",
    subtitle: "",
    createdAt: now,
    updatedAt: now,
  };
  ensureStore();
  dbUpsert(COLLECTION, record.materialId, record);
  return record;
}

export function updateVideoMaterial(
  materialId: string,
  patch: Partial<Omit<VideoMaterialRecord, "materialId" | "createdAt">>,
): VideoMaterialRecord | null {
  const current = getVideoMaterial(materialId);
  if (!current) return null;

  const updated: VideoMaterialRecord = {
    ...current,
    ...patch,
    cleanedFrames: patch.cleanedFrames
      ? sortCleanedFramesBySource(patch.extractedFrames ?? current.extractedFrames, patch.cleanedFrames)
      : current.cleanedFrames,
    updatedAt: new Date().toISOString(),
  };
  ensureStore();
  dbUpsert(COLLECTION, materialId, updated);
  return updated;
}

export function deleteVideoMaterial(materialId: string): boolean {
  const items = readStore();
  const target = items.find((item) => item.materialId === materialId);
  if (!target) return false;

  const dir = ensureUploadsDir();
  for (const fileName of [target.videoFileName, target.audioFileName]) {
    if (fileName) {
      const filePath = join(dir, fileName);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  clearVideoMaterialDerivedAssets(materialId);

  ensureStore();
  dbDelete(COLLECTION, materialId);
  return true;
}
