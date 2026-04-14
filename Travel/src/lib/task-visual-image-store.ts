import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ImageGenerationResult } from "./image-provider";
import { dbGetAll, dbUpsert, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { getTaskDirectorPlan } from "./video-task-director";
import type { VideoTaskRecord } from "./video-task-schema";

export type TaskVisualImageCandidate = {
  candidateId: string;
  imageUrl: string;
  originalUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  bytesPerPixel: number | null;
  score: number;
  scoreLabel: string;
  scoreReasons: string[];
};

export type TaskVisualImageShotRecord = {
  taskId: string;
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  shotTitle: string;
  prompt: string;
  size: string;
  guidanceScale: number;
  watermark: boolean;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  candidates: TaskVisualImageCandidate[];
  recommendedCandidateId: string | null;
  selectedCandidateId: string | null;
  selectionMode: "manual" | null;
  selectedAt: string | null;
};

export type TaskVisualSelectedImageItem = {
  sessionId: string;
  taskId: string;
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  imageUrl: string;
  prompt: string;
  createdAt: string;
  selectionMode: "manual" | null;
};

type PersistedImageAsset = ImageGenerationResult;

const dataDir = join(process.cwd(), "data");
const COLLECTION = "task-visual-image-shots";
const legacyJsonPath = join(dataDir, "task-visual-image-shots.json");

function shotKey(taskId: string, shotIndex: number) {
  return `${taskId}:${shotIndex}`;
}

function getTaskVisualImageShotDir(taskId: string, segmentId: string) {
  return join(process.cwd(), "public", "generated-images", taskId.trim() || "_unassigned", "task-visual-shots", segmentId);
}

let migrated = false;
function ensureStore() {
  mkdirSync(dataDir, { recursive: true });
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => {
      const r = item as Partial<TaskVisualImageShotRecord>;
      return shotKey(r.taskId ?? "", r.shotIndex ?? 0);
    });
    migrated = true;
  }
}

function readStore() {
  ensureStore();
  try {
    return dbGetAll<Partial<TaskVisualImageShotRecord>>(COLLECTION).map((record) => ({
      taskId: record.taskId ?? "",
      segmentId: record.segmentId ?? `segment-${record.segmentIndex ?? record.shotIndex ?? 1}`,
      segmentIndex: record.segmentIndex ?? record.shotIndex ?? 1,
      shotIndex: record.shotIndex ?? 1,
      shotTitle: record.shotTitle ?? `片段 ${record.segmentIndex ?? record.shotIndex ?? 1}`,
      prompt: record.prompt ?? "",
      size: record.size ?? "1664x2496",
      guidanceScale: record.guidanceScale ?? 7.5,
      watermark: record.watermark ?? false,
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
      generatedAt: record.generatedAt ?? null,
      candidates: record.candidates ?? [],
      recommendedCandidateId: record.recommendedCandidateId ?? null,
      selectedCandidateId: record.selectedCandidateId ?? null,
      selectionMode: record.selectionMode ?? null,
      selectedAt: record.selectedAt ?? null,
    }));
  } catch {
    return [];
  }
}

function writeStore(records: TaskVisualImageShotRecord[]) {
  ensureStore();
  dbReplaceAll(COLLECTION, records.map((r) => ({ key: shotKey(r.taskId, r.shotIndex), data: r })));
}

function detectImageExtension(bytes: Buffer, contentType?: string | null) {
  if (contentType?.includes("png")) {
    return "png";
  }
  if (contentType?.includes("webp")) {
    return "webp";
  }
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
    return "jpg";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "jpg";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return "png";
}

function getImageDimensions(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const size = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      offset += size + 2;
    }
  }

  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunkType = bytes.subarray(12, 16).toString("ascii");

    if (chunkType === "VP8X") {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return { width, height };
    }

    if (chunkType === "VP8 ") {
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }

    if (chunkType === "VP8L") {
      const value = bytes.readUInt32LE(21);
      return {
        width: (value & 0x3fff) + 1,
        height: ((value >> 14) & 0x3fff) + 1,
      };
    }
  }

  return {
    width: null,
    height: null,
  };
}

function parseRequestedSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { width: 1024, height: 1024 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function getPromptProfile(prompt: string) {
  const normalized = prompt.toLowerCase();
  return {
    realism: /(真实|写实|摄影|real|photoreal|realistic|cinematic|film|纪实)/.test(normalized),
    beauty: /(美观|高级|精致|时尚|唯美|beauty|beautiful|elegant|luxury|editorial)/.test(normalized),
    selfieNarrative:
      /(自拍|第一人称|镜头感|怼脸|特写|肩部|肩膀|肩背|微俯视|举手拍|贴近镜头|近景自拍|selfie|first-person|close-up)/.test(
        normalized,
      ),
  };
}

function getNarrativeInteractionScore(bytesPerPixel: number) {
  return Math.max(0, 12 - Math.abs(bytesPerPixel - 0.21) * 160);
}

function scoreCandidate(
  prompt: string,
  size: string,
  candidate: Omit<TaskVisualImageCandidate, "score" | "scoreLabel" | "scoreReasons">,
) {
  const requestedSize = parseRequestedSize(size);
  const requestedRatio = requestedSize.width / requestedSize.height;
  const width = candidate.width ?? requestedSize.width;
  const height = candidate.height ?? requestedSize.height;
  const ratio = width / Math.max(height, 1);
  const aspectDelta = Math.abs(ratio - requestedRatio);
  const aspectScore = Math.max(0, 24 - aspectDelta * 120);
  const targetPixels = requestedSize.width * requestedSize.height;
  const actualPixels = width * height;
  const resolutionScore = Math.max(0, Math.min(actualPixels / targetPixels, 1.25) * 26);
  const bytesPerPixel = candidate.bytesPerPixel ?? 0;
  const detailScore = Math.max(0, Math.min(bytesPerPixel / 0.75, 1.25) * 24);
  const promptProfile = getPromptProfile(prompt);
  const realismScore = promptProfile.realism ? Math.max(0, Math.min(bytesPerPixel / 0.7, 1.2) * 14) : 8;
  const beautyScore = promptProfile.beauty ? Math.max(0, Math.min(actualPixels / targetPixels, 1.1) * 12) : 8;
  const narrativeInteractionScore = promptProfile.selfieNarrative ? getNarrativeInteractionScore(bytesPerPixel) : 0;
  const preferenceScore = promptProfile.selfieNarrative ? narrativeInteractionScore : beautyScore;
  const score = Math.round((aspectScore + resolutionScore + detailScore + realismScore + preferenceScore) * 10) / 10;
  return {
    score,
    scoreLabel: score >= 80 ? "优先保留" : score >= 68 ? "推荐保留" : "可备选",
    scoreReasons: [
      `构图匹配 ${Math.round(aspectScore)}/24`,
      `清晰细节 ${Math.round(detailScore)}/24`,
      `分辨率完成度 ${Math.round(resolutionScore)}/26`,
      promptProfile.realism ? `真实感代理 ${Math.round(realismScore)}/14` : "默认真实感评估",
      promptProfile.selfieNarrative
        ? `前景互动代理 ${Math.round(narrativeInteractionScore)}/12`
        : promptProfile.beauty
          ? `美观度代理 ${Math.round(beautyScore)}/12`
          : "默认美观度评估",
    ],
  };
}

async function fetchAssetBytes(asset: PersistedImageAsset) {
  if (asset.b64Json) {
    return {
      bytes: Buffer.from(asset.b64Json, "base64"),
      contentType: "image/png",
      originalUrl: null,
    };
  }

  if (!asset.url) {
    throw new Error("图片结果缺少可下载地址");
  }

  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error("下载生成图片失败");
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    originalUrl: asset.url,
  };
}

export function parseTaskVisualImageShots(task: VideoTaskRecord) {
  const directorPlan = getTaskDirectorPlan(task);
  return directorPlan.renderSegments.map((segment) => ({
    taskId: task.taskId,
    segmentId: segment.segmentId,
    segmentIndex: segment.segmentIndex,
    shotIndex: segment.segmentIndex,
    shotTitle: segment.title,
    prompt: segment.imagePrompt || segment.videoPrompt,
    size: task.parameters.image.size,
    guidanceScale: task.parameters.image.guidanceScale,
    watermark: task.parameters.image.watermark,
  }));
}

export function listTaskVisualImageShots(taskId?: string) {
  const records = taskId ? readStore().filter((record) => record.taskId === taskId) : readStore();
  return records.sort((left, right) => left.segmentIndex - right.segmentIndex);
}

export function listTaskVisualSelectedImages(taskId?: string) {
  return listTaskVisualImageShots(taskId)
    .filter((record) => Boolean(record.selectedCandidateId))
    .map((record) => {
      const selectedCandidate = record.candidates.find((candidate) => candidate.candidateId === record.selectedCandidateId);
      if (!selectedCandidate) {
        return null;
      }

      return {
        sessionId: `${record.taskId}:${record.segmentId}`,
        taskId: record.taskId,
        segmentId: record.segmentId,
        segmentIndex: record.segmentIndex,
        shotIndex: record.shotIndex,
        imageUrl: selectedCandidate.imageUrl,
        prompt: record.prompt,
        createdAt: record.createdAt,
        selectionMode: record.selectionMode,
      } satisfies TaskVisualSelectedImageItem;
    })
    .filter((item): item is TaskVisualSelectedImageItem => Boolean(item));
}

export function getTaskVisualImageShot(taskId: string, shotIndex: number) {
  return readStore().find((record) => record.taskId === taskId && (record.shotIndex === shotIndex || record.segmentIndex === shotIndex)) ?? null;
}

export function parseTaskVisualSelectedImageSessionId(sessionId: string) {
  const [taskId, rawSegmentId] = sessionId.split(":");
  if (!taskId?.trim() || !rawSegmentId?.trim()) {
    return null;
  }

  const shotIndex = Number(rawSegmentId.replace(/^segment-/, ""));
  const segmentId = rawSegmentId.trim().startsWith("segment-") ? rawSegmentId.trim() : `segment-${shotIndex}`;
  if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
    return null;
  }

  return {
    taskId: taskId.trim(),
    segmentId,
    shotIndex,
  };
}

export async function generateTaskVisualImageShot(input: {
  task: VideoTaskRecord;
  segmentId?: string;
  shotIndex: number;
  prompt: string;
  assets: PersistedImageAsset[];
}) {
  const now = new Date().toISOString();
  const segmentId = input.segmentId ?? `segment-${input.shotIndex}`;
  const shotDir = getTaskVisualImageShotDir(input.task.taskId, segmentId);
  rmSync(shotDir, { recursive: true, force: true });
  mkdirSync(shotDir, { recursive: true });

  const candidates = await Promise.all(
    input.assets.map(async (asset) => {
      const candidateId = randomUUID();
      const { bytes, contentType, originalUrl } = await fetchAssetBytes(asset);
      const extension = detectImageExtension(bytes, contentType);
      const filePath = join(shotDir, `${candidateId}.${extension}`);
      writeFileSync(filePath, bytes);
      const dimensions = getImageDimensions(bytes);
      const byteSize = bytes.byteLength;
      const pixels = dimensions.width != null && dimensions.height != null ? dimensions.width * dimensions.height : null;
      const bytesPerPixel = pixels ? Math.round((byteSize / pixels) * 1000) / 1000 : null;
      const baseCandidate = {
        candidateId,
        imageUrl: `/generated-images/${input.task.taskId}/task-visual-shots/${segmentId}/${candidateId}.${extension}`,
        originalUrl,
        width: dimensions.width,
        height: dimensions.height,
        byteSize,
        bytesPerPixel,
      };

      return {
        ...baseCandidate,
        ...scoreCandidate(input.prompt, input.task.parameters.image.size, baseCandidate),
      } satisfies TaskVisualImageCandidate;
    }),
  );

  const recommendedCandidate =
    [...candidates].sort((left, right) => (right.score !== left.score ? right.score - left.score : left.candidateId.localeCompare(right.candidateId)))[0] ?? null;

  const records = readStore();
  const current = records.findIndex((record) => record.taskId === input.task.taskId && record.segmentId === segmentId);
  const nextRecord: TaskVisualImageShotRecord = {
    taskId: input.task.taskId,
    segmentId,
    segmentIndex: input.shotIndex,
    shotIndex: input.shotIndex,
    shotTitle: `片段 ${input.shotIndex}`,
    prompt: input.prompt,
    size: input.task.parameters.image.size,
    guidanceScale: input.task.parameters.image.guidanceScale,
    watermark: input.task.parameters.image.watermark,
    createdAt: current >= 0 ? records[current].createdAt : now,
    updatedAt: now,
    generatedAt: now,
    candidates,
    recommendedCandidateId: recommendedCandidate?.candidateId ?? null,
    selectedCandidateId: null,
    selectionMode: null,
    selectedAt: null,
  };

  if (current >= 0) {
    records[current] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeStore(records);
  return nextRecord;
}

export function selectTaskVisualImageCandidate(taskId: string, shotIndex: number, candidateId: string) {
  const records = readStore();
  const index = records.findIndex((record) => record.taskId === taskId && (record.shotIndex === shotIndex || record.segmentIndex === shotIndex));
  if (index < 0) {
    return null;
  }

  if (!records[index].candidates.some((candidate) => candidate.candidateId === candidateId)) {
    return null;
  }

  records[index] = {
    ...records[index],
    selectedCandidateId: candidateId,
    selectionMode: "manual",
    selectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeStore(records);
  return records[index];
}

export function clearTaskVisualImageSelection(taskId: string, shotIndex: number) {
  const records = readStore();
  const index = records.findIndex((record) => record.taskId === taskId && (record.shotIndex === shotIndex || record.segmentIndex === shotIndex));
  if (index < 0) {
    return null;
  }

  records[index] = {
    ...records[index],
    selectedCandidateId: null,
    selectionMode: null,
    selectedAt: null,
    updatedAt: new Date().toISOString(),
  };
  writeStore(records);
  return records[index];
}

export function getTaskVisualSelectedImageDataUrl(sessionId: string) {
  const parsed = parseTaskVisualSelectedImageSessionId(sessionId);
  if (!parsed) {
    return null;
  }

  const record = readStore().find((item) => item.taskId === parsed.taskId && item.segmentId === parsed.segmentId)
    ?? getTaskVisualImageShot(parsed.taskId, parsed.shotIndex);
  const selectedCandidate = record?.candidates.find((candidate) => candidate.candidateId === record.selectedCandidateId);
  if (!selectedCandidate) {
    return null;
  }

  const absolutePath = join(process.cwd(), "public", selectedCandidate.imageUrl.replace(/^\//, ""));
  if (!existsSync(absolutePath)) {
    return null;
  }

  const bytes = readFileSync(absolutePath);
  const extension = selectedCandidate.imageUrl.split(".").pop()?.toLowerCase();
  const mimeType =
    extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp"
        ? "image/webp"
        : "image/png";

  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export function deleteTaskVisualImageShotsByTaskId(taskId: string) {
  const remaining = readStore().filter((record) => record.taskId !== taskId);
  writeStore(remaining);
  rmSync(join(process.cwd(), "public", "generated-images", taskId.trim() || "_unassigned", "task-visual-shots"), {
    recursive: true,
    force: true,
  });
}
