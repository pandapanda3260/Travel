import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

import { applyImagePromptHardRequirements, type ImageGenerationResult } from "./image-provider";
import {
  buildAgencyGuideVoiceoverVisualPrompt,
  resolveAgencyGuideVoiceoverAllowedCharacterShotIndexes,
} from "./agency-guide-voiceover-policy";
import { dbGetAll, dbUpsert, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { appendMainCharacterAppearancePrompt } from "./main-character-appearance-policy";
import type { TaskVisualImageQualityCheck, TaskVisualImageQualityStatus } from "./task-visual-image-quality-check";
import {
  buildTaskVisualSelectedImageSessionId,
  parseTaskVisualSelectedImageSessionIdValue,
} from "./task-visual-image-session";
import { getTaskDirectorPlan } from "./video-task-director";
import {
  ensureRuntimeDataDir,
  joinRuntimeDataPath,
  joinRuntimePublicStoragePath,
  resolveRuntimeAssetUrlToPath,
} from "./runtime-storage";
import type { TaskArtifactDeletionOptions } from "./task-artifact-cleanup";
import type { HotelAssetSceneType, ShotGenerationMode, VideoTaskRecord } from "./video-task-schema";

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
  source: "generated" | "uploaded";
  qualityStatus: TaskVisualImageQualityStatus;
  qualityIssues: string[];
  qualitySummary: string | null;
  qualityCheckedAt: string | null;
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

export type TaskVisualImageShotDraft = {
  taskId: string;
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  shotTitle: string;
  prompt: string;
  sceneType?: HotelAssetSceneType;
  generationMode?: ShotGenerationMode;
  assetId?: string | null;
  assetSubjectSummary?: string | null;
  referenceImageUrl?: string | null;
  img2imgPrompt?: string | null;
  i2vPrompt?: string | null;
  hasMainCharacter: boolean;
  sceneContextText: string;
  size: string;
  guidanceScale: number;
  watermark: boolean;
};

type PersistedImageAsset = ImageGenerationResult & {
  qualityCheck?: TaskVisualImageQualityCheck;
};

const COLLECTION = "task-visual-image-shots";
const legacyJsonPath = joinRuntimeDataPath("task-visual-image-shots.json");

function shotKey(taskId: string, shotIndex: number) {
  return `${taskId}:${shotIndex}`;
}

function normalizeSegmentIndex(segmentId: string, fallbackIndex: number) {
  const parsedSegmentIndex = Number(segmentId.replace(/^segment-/, ""));
  return Number.isFinite(parsedSegmentIndex) && parsedSegmentIndex > 0 ? parsedSegmentIndex : fallbackIndex;
}

function findTaskVisualImageShotRecord(
  records: TaskVisualImageShotRecord[],
  input: {
    taskId: string;
    shotIndex: number;
    segmentId?: string;
  },
) {
  const directRecord = records.find((record) => record.taskId === input.taskId && record.shotIndex === input.shotIndex);
  if (directRecord) {
    return directRecord;
  }

  if (!input.segmentId) {
    return null;
  }

  const segmentMatches = records.filter(
    (record) => record.taskId === input.taskId && record.segmentId === input.segmentId,
  );
  return segmentMatches.length === 1 ? segmentMatches[0] : null;
}

function getTaskVisualImageShotDir(taskId: string, segmentId: string, shotIndex?: number) {
  const dirName = shotIndex != null ? `${segmentId}-shot${shotIndex}` : segmentId;
  return joinRuntimePublicStoragePath("generated-images", taskId.trim() || "_unassigned", "task-visual-shots", dirName);
}

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
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
      candidates: (record.candidates ?? []).map((candidate) => ({
        ...candidate,
        source: candidate.source ?? (candidate.scoreLabel?.startsWith("用户上传") ? "uploaded" : "generated"),
        qualityStatus: candidate.qualityStatus ?? "unchecked",
        qualityIssues: candidate.qualityIssues ?? [],
        qualitySummary: candidate.qualitySummary ?? null,
        qualityCheckedAt: candidate.qualityCheckedAt ?? null,
      })),
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
  dbReplaceAll(
    COLLECTION,
    records.map((r) => ({ key: shotKey(r.taskId, r.shotIndex), data: r })),
  );
}

function isManualUploadedVisualCandidate(candidate: Pick<TaskVisualImageCandidate, "source" | "scoreLabel">) {
  return candidate.source === "uploaded" || candidate.scoreLabel.startsWith("用户上传");
}

function isUploadManagedVisualCandidate(candidate: Pick<TaskVisualImageCandidate, "source" | "scoreLabel">) {
  return isManualUploadedVisualCandidate(candidate) || candidate.scoreLabel === "AI 增强";
}

function removeCandidateAsset(candidate: Pick<TaskVisualImageCandidate, "imageUrl">) {
  try {
    const filePath = resolveRuntimeAssetUrlToPath(candidate.imageUrl);
    rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
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

function buildVisualPromptForStoryShot(
  task: VideoTaskRecord,
  shot: ReturnType<typeof getTaskDirectorPlan>["storyShots"][number],
  totalShots: number,
  allowedCharacterShotIndexes?: Set<number>,
) {
  const basePrompt = shot.imagePrompt || shot.sceneDescription || shot.videoPrompt;
  const hasMainCharacter =
    Boolean(shot.hasCharacters) ||
    Boolean(shot.hasTalent) ||
    (shot.subject?.mainCharacterCount ?? 0) > 0 ||
    (shot.characters?.length ?? 0) > 0;
  if (task.parameters.video.videoType === "agency_guide_voiceover") {
    const hasCharacterSubject =
      Boolean(shot.hasCharacters) || (shot.subject?.mainCharacterCount ?? 0) > 0 || (shot.characters?.length ?? 0) > 0;
    return appendMainCharacterAppearancePrompt(
      buildAgencyGuideVoiceoverVisualPrompt({
        basePrompt,
        allowCharacter: Boolean(allowedCharacterShotIndexes?.has(shot.shotIndex)) && hasCharacterSubject,
        totalShots,
      }),
      {
        hasMainCharacter,
        source: task.source,
        sceneContextText: [
          shot.location,
          shot.action,
          shot.sceneDescription,
          shot.narrationHint,
          shot.subject?.relationship,
          shot.subject?.clothing,
        ]
          .filter(Boolean)
          .join("，"),
      },
    );
  }
  return appendMainCharacterAppearancePrompt(basePrompt, {
    hasMainCharacter,
    source: task.source,
    sceneContextText: [
      shot.location,
      shot.action,
      shot.sceneDescription,
      shot.narrationHint,
      shot.subject?.relationship,
      shot.subject?.clothing,
    ]
      .filter(Boolean)
      .join("，"),
  });
}

function getNarrativeInteractionScore(bytesPerPixel: number) {
  return Math.max(0, 12 - Math.abs(bytesPerPixel - 0.21) * 160);
}

function compareRecommendedCandidateScore<T extends Pick<TaskVisualImageCandidate, "candidateId" | "score">>(
  left: T,
  right: T,
) {
  return right.score !== left.score ? right.score - left.score : left.candidateId.localeCompare(right.candidateId);
}

export function pickRecommendedTaskVisualImageCandidate<
  T extends Pick<TaskVisualImageCandidate, "candidateId" | "score" | "qualityStatus">,
>(candidates: readonly T[]) {
  const eligibleCandidates = candidates.filter((candidate) => candidate.qualityStatus !== "failed");
  if (!eligibleCandidates.length) {
    return null;
  }
  return [...eligibleCandidates].sort(compareRecommendedCandidateScore)[0] ?? null;
}

function scoreCandidate(
  prompt: string,
  size: string,
  candidate: Omit<TaskVisualImageCandidate, "score" | "scoreLabel" | "scoreReasons">,
  qualityCheck?: TaskVisualImageQualityCheck,
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
  const qualityPenalty = Math.max(0, qualityCheck?.scorePenalty ?? 0);
  const rawScore = aspectScore + resolutionScore + detailScore + realismScore + preferenceScore;
  const score = Math.max(0, Math.round((rawScore - qualityPenalty) * 10) / 10);
  const qualityStatus = qualityCheck?.status ?? "unchecked";
  const qualityLabel =
    qualityStatus === "failed" ? "建议重生" : score >= 80 ? "优先保留" : score >= 68 ? "推荐保留" : "可备选";
  const qualityReasons =
    qualityStatus === "unchecked"
      ? []
      : [
          `视觉自检 ${
            qualityStatus === "passed" ? "通过" : qualityStatus === "warning" ? "轻微偏差" : "未通过"
          }${qualityPenalty > 0 ? `（-${qualityPenalty}）` : ""}`,
          ...(qualityCheck?.summary?.trim() ? [qualityCheck.summary.trim()] : []),
          ...(qualityCheck?.issues ?? []).slice(0, 3).map((issue) => `问题：${issue}`),
        ];
  return {
    score,
    scoreLabel: qualityLabel,
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
      ...qualityReasons,
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

export function parseTaskVisualImageShots(task: VideoTaskRecord): TaskVisualImageShotDraft[] {
  const directorPlan = getTaskDirectorPlan(task);
  const allowedCharacterShotIndexes =
    task.parameters.video.videoType === "agency_guide_voiceover"
      ? resolveAgencyGuideVoiceoverAllowedCharacterShotIndexes(directorPlan.storyShots)
      : undefined;
  return directorPlan.storyShots.map((shot) => ({
    taskId: task.taskId,
    segmentId: shot.segmentId,
    segmentIndex: shot.segmentIndex,
    shotIndex: shot.shotIndex,
    shotTitle: `镜头 ${shot.shotIndex}`,
    prompt: applyImagePromptHardRequirements(
      shot.img2imgPrompt ||
        buildVisualPromptForStoryShot(task, shot, directorPlan.storyShots.length, allowedCharacterShotIndexes),
      task.parameters.image.size,
    ),
    sceneType: shot.sceneType,
    generationMode: shot.generationMode,
    assetId: shot.assetId ?? null,
    assetSubjectSummary: shot.assetSubjectSummary ?? null,
    referenceImageUrl: shot.referenceImageUrl ?? null,
    img2imgPrompt: shot.img2imgPrompt ?? null,
    i2vPrompt: shot.i2vPrompt ?? null,
    hasMainCharacter:
      Boolean(shot.hasCharacters) ||
      Boolean(shot.hasTalent) ||
      (shot.subject?.mainCharacterCount ?? 0) > 0 ||
      (shot.characters?.length ?? 0) > 0,
    sceneContextText: [
      shot.location,
      shot.action,
      shot.sceneDescription,
      shot.narrationHint,
      shot.subject?.relationship,
      shot.subject?.clothing,
    ]
      .filter(Boolean)
      .join("，"),
    size: task.parameters.image.size,
    guidanceScale: task.parameters.image.guidanceScale,
    watermark: task.parameters.image.watermark,
  }));
}

export function listTaskVisualImageShots(taskId?: string) {
  const records = taskId ? readStore().filter((record) => record.taskId === taskId) : readStore();
  return records.sort(
    (left, right) =>
      left.segmentIndex - right.segmentIndex ||
      left.shotIndex - right.shotIndex ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function listTaskVisualSelectedImages(taskId?: string) {
  return listTaskVisualImageShots(taskId)
    .filter((record) => Boolean(record.selectedCandidateId))
    .map((record) => {
      const selectedCandidate = record.candidates.find(
        (candidate) => candidate.candidateId === record.selectedCandidateId,
      );
      if (!selectedCandidate) {
        return null;
      }

      return {
        sessionId: buildTaskVisualSelectedImageSessionId(record.taskId, record.segmentId, record.shotIndex),
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
  return findTaskVisualImageShotRecord(readStore(), { taskId, shotIndex });
}

export function parseTaskVisualSelectedImageSessionId(sessionId: string) {
  return parseTaskVisualSelectedImageSessionIdValue(sessionId);
}

export async function generateTaskVisualImageShot(input: {
  task: VideoTaskRecord;
  segmentId?: string;
  segmentIndex?: number;
  shotIndex: number;
  prompt: string;
  assets: PersistedImageAsset[];
}) {
  const now = new Date().toISOString();
  const segmentId = input.segmentId ?? `segment-${input.shotIndex}`;
  const shotDirName = `${segmentId}-shot${input.shotIndex}`;
  const shotDir = getTaskVisualImageShotDir(input.task.taskId, segmentId, input.shotIndex);
  mkdirSync(shotDir, { recursive: true });
  const records = readStore();
  const current = records.findIndex(
    (record) => record.taskId === input.task.taskId && record.shotIndex === input.shotIndex,
  );
  const currentRecord = current >= 0 ? records[current] : null;
  const preservedCandidates = currentRecord?.candidates ?? [];

  const generatedCandidates = await Promise.all(
    input.assets.map(async (asset) => {
      const candidateId = randomUUID();
      const { bytes, contentType, originalUrl } = await fetchAssetBytes(asset);
      const extension = detectImageExtension(bytes, contentType);
      const filePath = join(shotDir, `${candidateId}.${extension}`);
      writeFileSync(filePath, bytes);
      const dimensions = getImageDimensions(bytes);
      const byteSize = bytes.byteLength;
      const pixels =
        dimensions.width != null && dimensions.height != null ? dimensions.width * dimensions.height : null;
      const bytesPerPixel = pixels ? Math.round((byteSize / pixels) * 1000) / 1000 : null;
      const baseCandidate = {
        candidateId,
        imageUrl: `/generated-images/${input.task.taskId}/task-visual-shots/${shotDirName}/${candidateId}.${extension}`,
        originalUrl,
        width: dimensions.width,
        height: dimensions.height,
        byteSize,
        bytesPerPixel,
        source: "generated" as const,
        qualityStatus: asset.qualityCheck?.status ?? "unchecked",
        qualityIssues: asset.qualityCheck?.issues ?? [],
        qualitySummary: asset.qualityCheck?.summary ?? null,
        qualityCheckedAt: asset.qualityCheck?.checkedAt ?? null,
      };

      return {
        ...baseCandidate,
        ...scoreCandidate(input.prompt, input.task.parameters.image.size, baseCandidate, asset.qualityCheck),
      } satisfies TaskVisualImageCandidate;
    }),
  );

  const candidates = [...preservedCandidates, ...generatedCandidates];

  const recommendedCandidate = pickRecommendedTaskVisualImageCandidate(candidates);
  const preservedSelectedCandidateId =
    currentRecord?.selectedCandidateId &&
    candidates.some((candidate) => candidate.candidateId === currentRecord.selectedCandidateId)
      ? currentRecord.selectedCandidateId
      : null;
  const nextRecord: TaskVisualImageShotRecord = {
    taskId: input.task.taskId,
    segmentId,
    segmentIndex: input.segmentIndex ?? normalizeSegmentIndex(segmentId, input.shotIndex),
    shotIndex: input.shotIndex,
    shotTitle: `镜头 ${input.shotIndex}`,
    prompt: input.prompt,
    size: input.task.parameters.image.size,
    guidanceScale: input.task.parameters.image.guidanceScale,
    watermark: input.task.parameters.image.watermark,
    createdAt: current >= 0 ? records[current].createdAt : now,
    updatedAt: now,
    generatedAt: now,
    candidates,
    recommendedCandidateId: recommendedCandidate?.candidateId ?? null,
    selectedCandidateId: preservedSelectedCandidateId,
    selectionMode: preservedSelectedCandidateId ? (currentRecord?.selectionMode ?? "manual") : null,
    selectedAt: preservedSelectedCandidateId ? (currentRecord?.selectedAt ?? now) : null,
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
  const index = records.findIndex((record) => record.taskId === taskId && record.shotIndex === shotIndex);
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
  const index = records.findIndex((record) => record.taskId === taskId && record.shotIndex === shotIndex);
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

  const record =
    findTaskVisualImageShotRecord(readStore(), parsed) ?? getTaskVisualImageShot(parsed.taskId, parsed.shotIndex);
  const selectedCandidate = record?.candidates.find(
    (candidate) => candidate.candidateId === record.selectedCandidateId,
  );
  if (!selectedCandidate) {
    return null;
  }

  const absolutePath = resolveRuntimeAssetUrlToPath(selectedCandidate.imageUrl);
  if (!existsSync(absolutePath)) {
    return null;
  }

  const bytes = readFileSync(absolutePath);
  const extension = selectedCandidate.imageUrl.split(".").pop()?.toLowerCase();
  const mimeType =
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";

  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

/**
 * 对指定任务的所有镜头，将已有候选图但尚未选定的记录自动选上推荐候选图。
 * 自动推荐会跳过质量检查失败的候选图。
 * 用于兼容早期生成的存量数据，返回实际被回填的镜头数量。
 */
export function autoSelectRecommendedCandidates(taskId: string) {
  const records = readStore();
  const now = new Date().toISOString();
  let patchedCount = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.taskId !== taskId) continue;
    if (record.selectedCandidateId) continue;
    if (!record.candidates.length) continue;

    const preservedRecommendedCandidate =
      record.recommendedCandidateId != null
        ? (record.candidates.find(
            (candidate) =>
              candidate.candidateId === record.recommendedCandidateId && candidate.qualityStatus !== "failed",
          ) ?? null)
        : null;
    const targetId =
      preservedRecommendedCandidate?.candidateId ??
      pickRecommendedTaskVisualImageCandidate(record.candidates)?.candidateId ??
      null;
    if (!targetId) continue;

    records[i] = {
      ...record,
      recommendedCandidateId: targetId,
      selectedCandidateId: targetId,
      selectionMode: "manual",
      selectedAt: now,
      updatedAt: now,
    };
    patchedCount += 1;
  }

  if (patchedCount > 0) {
    writeStore(records);
  }

  return patchedCount;
}

const MAX_IMAGE_PIXELS = 30_000_000;

async function resizeIfNeeded(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w * h <= MAX_IMAGE_PIXELS || w === 0 || h === 0) {
      return imageBuffer;
    }
    const scale = Math.sqrt(MAX_IMAGE_PIXELS / (w * h));
    const newW = Math.round(w * scale);
    const newH = Math.round(h * scale);
    return await sharp(imageBuffer).resize(newW, newH, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return imageBuffer;
  }
}

export async function uploadTaskVisualImage(input: {
  task: VideoTaskRecord;
  segmentId: string;
  segmentIndex?: number;
  shotIndex: number;
  prompt: string;
  imageBuffer: Buffer;
  contentType: string;
}): Promise<TaskVisualImageShotRecord> {
  const now = new Date().toISOString();
  const segmentId = input.segmentId || `segment-${input.shotIndex}`;
  const shotDirName = `${segmentId}-shot${input.shotIndex}`;
  const shotDir = getTaskVisualImageShotDir(input.task.taskId, segmentId, input.shotIndex);
  mkdirSync(shotDir, { recursive: true });
  const records = readStore();
  const current = records.findIndex(
    (record) => record.taskId === input.task.taskId && record.shotIndex === input.shotIndex,
  );
  const currentRecord = current >= 0 ? records[current] : null;
  const preservedGeneratedCandidates = (currentRecord?.candidates ?? []).filter(
    (candidate) => !isUploadManagedVisualCandidate(candidate),
  );

  for (const candidate of (currentRecord?.candidates ?? []).filter(isUploadManagedVisualCandidate)) {
    removeCandidateAsset(candidate);
  }

  const resizedBuffer = await resizeIfNeeded(input.imageBuffer);
  const originalId = randomUUID();
  const originalExt =
    resizedBuffer !== input.imageBuffer ? "jpg" : detectImageExtension(input.imageBuffer, input.contentType);
  writeFileSync(join(shotDir, `${originalId}.${originalExt}`), resizedBuffer);
  const originalDim = getImageDimensions(resizedBuffer);
  const originalSize = resizedBuffer.byteLength;
  const originalPixels =
    originalDim.width != null && originalDim.height != null ? originalDim.width * originalDim.height : null;
  const uploadedCandidate: TaskVisualImageCandidate = {
    candidateId: originalId,
    imageUrl: `/generated-images/${input.task.taskId}/task-visual-shots/${shotDirName}/${originalId}.${originalExt}`,
    originalUrl: null,
    width: originalDim.width,
    height: originalDim.height,
    byteSize: originalSize,
    bytesPerPixel: originalPixels ? Math.round((originalSize / originalPixels) * 1000) / 1000 : null,
    score: 90,
    scoreLabel: "用户上传（原图）",
    scoreReasons: ["用户手动上传的参考图片"],
    source: "uploaded",
    qualityStatus: "unchecked",
    qualityIssues: [],
    qualitySummary: null,
    qualityCheckedAt: null,
  };
  const candidates: TaskVisualImageCandidate[] = [uploadedCandidate, ...preservedGeneratedCandidates];
  const recommendedCandidateId =
    currentRecord?.recommendedCandidateId &&
    preservedGeneratedCandidates.some((candidate) => candidate.candidateId === currentRecord.recommendedCandidateId)
      ? currentRecord.recommendedCandidateId
      : uploadedCandidate.candidateId;

  const nextRecord: TaskVisualImageShotRecord = {
    taskId: input.task.taskId,
    segmentId,
    segmentIndex: input.segmentIndex ?? normalizeSegmentIndex(segmentId, input.shotIndex),
    shotIndex: input.shotIndex,
    shotTitle: `镜头 ${input.shotIndex}`,
    prompt: input.prompt,
    size: input.task.parameters.image.size,
    guidanceScale: input.task.parameters.image.guidanceScale,
    watermark: input.task.parameters.image.watermark,
    createdAt: current >= 0 ? records[current].createdAt : now,
    updatedAt: now,
    generatedAt: now,
    candidates,
    recommendedCandidateId,
    selectedCandidateId: uploadedCandidate.candidateId,
    selectionMode: "manual",
    selectedAt: now,
  };

  if (current >= 0) {
    records[current] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeStore(records);
  return nextRecord;
}

export function deleteTaskVisualImageShotsByTaskId(taskId: string, options: TaskArtifactDeletionOptions) {
  if (options.reason !== "user_manual_delete" && options.reason !== "successful_replacement") {
    throw new Error("删除视觉图片记录需要明确的手动删除或成功替换原因");
  }

  const remaining = readStore().filter((record) => record.taskId !== taskId);
  writeStore(remaining);
  rmSync(joinRuntimePublicStoragePath("generated-images", taskId.trim() || "_unassigned", "task-visual-shots"), {
    recursive: true,
    force: true,
  });
}
