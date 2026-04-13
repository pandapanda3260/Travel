import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";

export type VideoMaterialStatus =
  | "uploading"
  | "converting"
  | "transcribing"
  | "analyzing"
  | "generating"
  | "ready"
  | "error";

export type ProcessingMode = "auto_all" | "audio_only";

export type VideoMaterialRecord = {
  materialId: string;
  name: string;
  status: VideoMaterialStatus;
  statusMessage: string;
  processingMode: ProcessingMode;

  videoFileName: string | null;
  videoFileUrl: string | null;
  videoUploadedAt: string | null;

  audioFileName: string | null;
  audioFileUrl: string | null;
  audioConvertedAt: string | null;

  framesExtracted: number;
  videoAnalysis: string;
  videoAnalysisCompletedAt: string | null;

  rawTranscript: string;
  contentScript: string;
  /** 无具体文案/商品信息的表达框架，供后续新视频参考结构 */
  videoTemplatePrompt: string;
  reversePrompt: string;
  subtitle: string;

  createdAt: string;
  updatedAt: string;
};

export type VideoTaskReferenceMaterialOption = {
  materialId: string;
  name: string;
  videoTemplatePrompt: string;
};

const dataDir = join(process.cwd(), "data");
const COLLECTION = "video-materials";
const legacyJsonPath = join(dataDir, "video-materials.json");
const uploadsDir = join(process.cwd(), "public", "video-materials");

let migrated = false;
function ensureStore() {
  mkdirSync(dataDir, { recursive: true });
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as { materialId: string }).materialId);
    migrated = true;
  }
}

export function ensureUploadsDir() {
  mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function normalizeMaterial(record: VideoMaterialRecord): VideoMaterialRecord {
  return {
    ...record,
    videoTemplatePrompt: record.videoTemplatePrompt ?? "",
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

function writeStore(items: VideoMaterialRecord[]) {
  ensureStore();
  dbReplaceAll(
    COLLECTION,
    items.map((item) => ({ key: item.materialId, data: item })),
  );
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

export function listVideoTaskReferenceMaterials(): VideoTaskReferenceMaterialOption[] {
  return listVideoMaterials()
    .filter((item) => item.status === "ready")
    .filter((item) => item.videoTemplatePrompt.trim())
    .map((item) => ({
      materialId: item.materialId,
      name: getMaterialDisplayName(item),
      videoTemplatePrompt: item.videoTemplatePrompt.trim(),
    }));
}

export function getVideoTaskReferenceMaterialById(
  materialId: string | null | undefined,
): VideoTaskReferenceMaterialOption | null {
  if (!materialId?.trim()) {
    return null;
  }

  const material = getVideoMaterial(materialId.trim());
  if (!material || !material.videoTemplatePrompt.trim()) {
    return null;
  }

  return {
    materialId: material.materialId,
    name: getMaterialDisplayName(material),
    videoTemplatePrompt: material.videoTemplatePrompt.trim(),
  };
}

export function listVideoMaterials(): VideoMaterialRecord[] {
  return readStore().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getVideoMaterial(materialId: string): VideoMaterialRecord | null {
  return readStore().find((item) => item.materialId === materialId) ?? null;
}

export function createVideoMaterial(videoFileName: string): VideoMaterialRecord {
  const items = readStore();
  const now = new Date().toISOString();
  const record: VideoMaterialRecord = {
    materialId: generateId(),
    name: "",
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
    videoAnalysis: "",
    videoAnalysisCompletedAt: null,
    rawTranscript: "",
    contentScript: "",
    videoTemplatePrompt: "",
    reversePrompt: "",
    subtitle: "",
    createdAt: now,
    updatedAt: now,
  };
  items.push(record);
  writeStore(items);
  return record;
}

export function updateVideoMaterial(
  materialId: string,
  patch: Partial<Omit<VideoMaterialRecord, "materialId" | "createdAt">>,
): VideoMaterialRecord | null {
  const items = readStore();
  const index = items.findIndex((item) => item.materialId === materialId);
  if (index === -1) return null;

  const updated = {
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  items[index] = updated;
  writeStore(items);
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

  writeStore(items.filter((item) => item.materialId !== materialId));
  return true;
}
