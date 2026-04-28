import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { dbDelete, dbGet, dbGetAll, dbUpsert } from "./db";
import { normalizeDirectorVideoGenerationStoredError } from "./director-video-generation-errors";
import type { ImageGenerationResult } from "./image-provider";
import {
  ensureRuntimeDataDir,
  joinRuntimeDataPath,
  joinRuntimePublicStoragePath,
  resolveRuntimeAssetUrlToPath,
} from "./runtime-storage";

export type DirectorVideoGenerationStepStatus = "idle" | "running" | "success" | "failed";

export type DirectorVideoGenerationImageCandidate = {
  candidateId: string;
  imageUrl: string;
  originalUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  source: "generated" | "uploaded";
  createdAt: string;
};

export type DirectorVideoGenerationSession = {
  sessionId: string;
  ownerUserId: string;
  title: string;
  originalPrompt: string;
  modificationInstruction: string;
  optimizedPrompt: string;
  videoOriginalPrompt: string;
  videoModificationInstruction: string;
  videoOptimizedPrompt: string;
  imagePrompt: string;
  videoPrompt: string;
  promptStatus: DirectorVideoGenerationStepStatus;
  videoPromptStatus: DirectorVideoGenerationStepStatus;
  imageStatus: DirectorVideoGenerationStepStatus;
  videoStatus: DirectorVideoGenerationStepStatus;
  promptError: string | null;
  videoPromptError: string | null;
  imageError: string | null;
  videoError: string | null;
  imageSettings: {
    size: string;
    guidanceScale: number;
    watermark: boolean;
    seed: number | null;
    outputCount: number;
  };
  videoSettings: {
    durationSeconds: number;
    ratio: "16:9" | "9:16" | "1:1";
    resolution: string;
    generateAudio: boolean;
    watermark: boolean;
  };
  imageCandidates: DirectorVideoGenerationImageCandidate[];
  selectedImageCandidateId: string | null;
  videoJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DirectorVideoGenerationSessionPatch = Partial<
  Pick<
    DirectorVideoGenerationSession,
    | "title"
    | "originalPrompt"
    | "modificationInstruction"
    | "optimizedPrompt"
    | "videoOriginalPrompt"
    | "videoModificationInstruction"
    | "videoOptimizedPrompt"
    | "imagePrompt"
    | "videoPrompt"
    | "promptStatus"
    | "videoPromptStatus"
    | "imageStatus"
    | "videoStatus"
    | "promptError"
    | "videoPromptError"
    | "imageError"
    | "videoError"
    | "selectedImageCandidateId"
    | "videoJobId"
  >
> & {
  imageSettings?: Partial<DirectorVideoGenerationSession["imageSettings"]>;
  videoSettings?: Partial<DirectorVideoGenerationSession["videoSettings"]>;
};

const COLLECTION = "director-video-generations";
const legacyJsonPath = joinRuntimeDataPath("director-video-generations.json");
const DEFAULT_SESSION_TITLE = "快速生成";
const MISSING_IMAGE_ASSET_MESSAGE = "图片文件已丢失，请重新生成图片。";

function nowIso() {
  return new Date().toISOString();
}

function getSessionKey(sessionId: string) {
  return sessionId.trim();
}

function getSessionImageDir(sessionId: string) {
  return joinRuntimePublicStoragePath("generated-images", sessionId, "video-generation");
}

function getSessionImageParentDir(sessionId: string) {
  return joinRuntimePublicStoragePath("generated-images", sessionId);
}

function getSessionImageUrl(sessionId: string, fileName: string) {
  return `/generated-images/${sessionId}/video-generation/${fileName}`;
}

function candidateImageFileExists(candidate: DirectorVideoGenerationImageCandidate) {
  if (!candidate.imageUrl?.startsWith("/")) {
    return false;
  }

  return existsSync(resolveRuntimeAssetUrlToPath(candidate.imageUrl));
}

function getDefaultImageSettings(): DirectorVideoGenerationSession["imageSettings"] {
  return {
    size: "1664x2496",
    guidanceScale: 7.5,
    watermark: false,
    seed: null,
    outputCount: 10,
  };
}

function getDefaultVideoSettings(): DirectorVideoGenerationSession["videoSettings"] {
  return {
    durationSeconds: 5,
    ratio: "9:16",
    resolution: "1080p",
    generateAudio: false,
    watermark: false,
  };
}

function normalizeSession(record: Partial<DirectorVideoGenerationSession>): DirectorVideoGenerationSession {
  const timestamp = nowIso();
  const normalizedImageCandidates = (record.imageCandidates ?? []).map((candidate) => ({
    candidateId: candidate.candidateId ?? randomUUID(),
    imageUrl: candidate.imageUrl ?? "",
    originalUrl: candidate.originalUrl ?? null,
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    byteSize: Number(candidate.byteSize ?? 0),
    source: candidate.source === "uploaded" ? ("uploaded" as const) : ("generated" as const),
    createdAt: candidate.createdAt ?? timestamp,
  }));
  const availableImageCandidates = normalizedImageCandidates.filter(candidateImageFileExists);
  const hasMissingImageCandidate = availableImageCandidates.length < normalizedImageCandidates.length;
  const selectedImageCandidateId = availableImageCandidates.some(
    (candidate) => candidate.candidateId === record.selectedImageCandidateId,
  )
    ? (record.selectedImageCandidateId ?? null)
    : (availableImageCandidates[0]?.candidateId ?? null);
  const normalizedImageError = normalizeDirectorVideoGenerationStoredError(record.imageError, "图片生成失败");
  const imageAssetsMissing = normalizedImageCandidates.length > 0 && availableImageCandidates.length === 0;
  const repairedImageStatus =
    (record.imageStatus === "success" || record.imageStatus === "running") && imageAssetsMissing
      ? "failed"
      : (record.imageStatus ?? "idle");

  return {
    sessionId: record.sessionId ?? "",
    ownerUserId: record.ownerUserId ?? "",
    title: !record.title || record.title === "视频生成" ? DEFAULT_SESSION_TITLE : record.title,
    originalPrompt: record.originalPrompt ?? "",
    modificationInstruction: record.modificationInstruction ?? "",
    optimizedPrompt: record.optimizedPrompt ?? "",
    videoOriginalPrompt: record.videoOriginalPrompt ?? record.videoPrompt ?? record.originalPrompt ?? "",
    videoModificationInstruction: record.videoModificationInstruction ?? "",
    videoOptimizedPrompt: record.videoOptimizedPrompt ?? record.videoPrompt ?? "",
    imagePrompt: record.imagePrompt ?? record.optimizedPrompt ?? record.originalPrompt ?? "",
    videoPrompt: record.videoPrompt ?? record.videoOptimizedPrompt ?? record.optimizedPrompt ?? record.originalPrompt ?? "",
    promptStatus: record.promptStatus ?? "idle",
    videoPromptStatus: record.videoPromptStatus ?? "idle",
    imageStatus: repairedImageStatus,
    videoStatus: record.videoStatus ?? "idle",
    promptError: normalizeDirectorVideoGenerationStoredError(record.promptError, "提示词优化失败"),
    videoPromptError: normalizeDirectorVideoGenerationStoredError(record.videoPromptError, "提示词优化失败"),
    imageError:
      imageAssetsMissing || hasMissingImageCandidate
        ? (normalizedImageError ?? MISSING_IMAGE_ASSET_MESSAGE)
        : normalizedImageError,
    videoError: normalizeDirectorVideoGenerationStoredError(record.videoError, "视频生成失败"),
    imageSettings: {
      ...getDefaultImageSettings(),
      ...(record.imageSettings ?? {}),
      outputCount: Math.max(1, Math.min(10, Number(record.imageSettings?.outputCount ?? 10))),
    },
    videoSettings: {
      ...getDefaultVideoSettings(),
      ...(record.videoSettings ?? {}),
      durationSeconds: Math.max(4, Math.min(10, Number(record.videoSettings?.durationSeconds ?? 5))),
      ratio: ["16:9", "9:16", "1:1"].includes(record.videoSettings?.ratio ?? "")
        ? (record.videoSettings?.ratio as "16:9" | "9:16" | "1:1")
        : "9:16",
    },
    imageCandidates: availableImageCandidates,
    selectedImageCandidateId,
    videoJobId: record.videoJobId ?? null,
    createdAt: record.createdAt ?? timestamp,
    updatedAt: record.updatedAt ?? record.createdAt ?? timestamp,
  };
}

function ensureStore() {
  ensureRuntimeDataDir();
  if (!existsSync(legacyJsonPath)) {
    return;
  }
}

function readAllSessions() {
  ensureStore();
  return dbGetAll<Partial<DirectorVideoGenerationSession>>(COLLECTION).map(normalizeSession);
}

export function listDirectorVideoGenerationSessions(ownerUserId: string) {
  return readAllSessions()
    .filter((session) => session.ownerUserId === ownerUserId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function getDirectorVideoGenerationSession(sessionId: string) {
  const record = dbGet<Partial<DirectorVideoGenerationSession>>(COLLECTION, getSessionKey(sessionId));
  return record ? normalizeSession(record) : null;
}

export function createDirectorVideoGenerationSession(input: {
  ownerUserId: string;
  title?: string;
  originalPrompt?: string;
  modificationInstruction?: string;
}) {
  const timestamp = nowIso();
  const session: DirectorVideoGenerationSession = {
    sessionId: randomUUID(),
    ownerUserId: input.ownerUserId,
    title: input.title?.trim() || DEFAULT_SESSION_TITLE,
    originalPrompt: input.originalPrompt?.trim() ?? "",
    modificationInstruction: input.modificationInstruction?.trim() ?? "",
    optimizedPrompt: "",
    videoOriginalPrompt: input.originalPrompt?.trim() ?? "",
    videoModificationInstruction: "",
    videoOptimizedPrompt: "",
    imagePrompt: input.originalPrompt?.trim() ?? "",
    videoPrompt: input.originalPrompt?.trim() ?? "",
    promptStatus: "idle",
    videoPromptStatus: "idle",
    imageStatus: "idle",
    videoStatus: "idle",
    promptError: null,
    videoPromptError: null,
    imageError: null,
    videoError: null,
    imageSettings: getDefaultImageSettings(),
    videoSettings: getDefaultVideoSettings(),
    imageCandidates: [],
    selectedImageCandidateId: null,
    videoJobId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  dbUpsert(COLLECTION, session.sessionId, session);
  return session;
}

export function patchDirectorVideoGenerationSession(
  sessionId: string,
  patch: DirectorVideoGenerationSessionPatch,
) {
  const current = getDirectorVideoGenerationSession(sessionId);
  if (!current) {
    return null;
  }

  const next: DirectorVideoGenerationSession = {
    ...current,
    ...patch,
    imageSettings: {
      ...current.imageSettings,
      ...(patch.imageSettings ?? {}),
      outputCount: Math.max(
        1,
        Math.min(10, Number(patch.imageSettings?.outputCount ?? current.imageSettings.outputCount)),
      ),
    },
    videoSettings: {
      ...current.videoSettings,
      ...(patch.videoSettings ?? {}),
      durationSeconds: Math.max(
        4,
        Math.min(10, Number(patch.videoSettings?.durationSeconds ?? current.videoSettings.durationSeconds)),
      ),
      ratio: ["16:9", "9:16", "1:1"].includes(patch.videoSettings?.ratio ?? current.videoSettings.ratio)
        ? ((patch.videoSettings?.ratio ?? current.videoSettings.ratio) as "16:9" | "9:16" | "1:1")
        : current.videoSettings.ratio,
    },
    updatedAt: nowIso(),
  };

  dbUpsert(COLLECTION, sessionId, next);
  return next;
}

export function deleteDirectorVideoGenerationSession(sessionId: string) {
  dbDelete(COLLECTION, sessionId);
  rmSync(getSessionImageDir(sessionId), { recursive: true, force: true });
}

function createNextSessionWithImageCandidates(
  session: DirectorVideoGenerationSession,
  imageCandidates: DirectorVideoGenerationImageCandidate[],
  selectedImageCandidateId: string | null,
) {
  const timestamp = nowIso();
  const next: DirectorVideoGenerationSession = {
    ...session,
    imageCandidates,
    selectedImageCandidateId,
    imageStatus: imageCandidates.length ? "success" : "idle",
    imageError: null,
    videoStatus: "idle",
    videoError: null,
    videoJobId: null,
    updatedAt: timestamp,
  };

  dbUpsert(COLLECTION, session.sessionId, next);
  return next;
}

async function fetchImageAssetBytes(asset: ImageGenerationResult) {
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

function detectImageExtension(bytes: Buffer, contentType?: string | null) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "jpg";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
    return "jpg";
  }
  if (contentType?.includes("webp")) {
    return "webp";
  }
  if (contentType?.includes("png")) {
    return "png";
  }
  return "png";
}

async function getImageDimensions(bytes: Buffer) {
  try {
    const metadata = await sharp(bytes).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  } catch {
    throw new Error("图片文件无效或格式不支持");
  }
}

async function buildImageCandidateFromBytes(input: {
  bytes: Buffer;
  contentType?: string | null;
  originalUrl?: string | null;
  sessionId: string;
  outputDir: string;
  candidateId?: string;
  source: DirectorVideoGenerationImageCandidate["source"];
}) {
  const candidateId = input.candidateId ?? randomUUID();
  const extension = detectImageExtension(input.bytes, input.contentType);
  const fileName = input.candidateId ? `${candidateId}-${randomUUID().slice(0, 8)}.${extension}` : `${candidateId}.${extension}`;
  const dimensions = await getImageDimensions(input.bytes);
  writeFileSync(join(input.outputDir, fileName), input.bytes);

  return {
    candidateId,
    imageUrl: getSessionImageUrl(input.sessionId, fileName),
    originalUrl: input.originalUrl ?? null,
    width: dimensions.width,
    height: dimensions.height,
    byteSize: input.bytes.byteLength,
    source: input.source,
    createdAt: nowIso(),
  } satisfies DirectorVideoGenerationImageCandidate;
}

async function buildImageCandidateFromAsset(input: {
  asset: ImageGenerationResult;
  sessionId: string;
  outputDir: string;
  candidateId?: string;
}) {
  const { bytes, contentType, originalUrl } = await fetchImageAssetBytes(input.asset);
  return buildImageCandidateFromBytes({
    bytes,
    contentType,
    originalUrl,
    sessionId: input.sessionId,
    outputDir: input.outputDir,
    candidateId: input.candidateId,
    source: "generated",
  });
}

export async function setDirectorVideoGenerationImageCandidates(input: {
  session: DirectorVideoGenerationSession;
  assets: ImageGenerationResult[];
}) {
  const imageDir = getSessionImageDir(input.session.sessionId);
  const imageParentDir = getSessionImageParentDir(input.session.sessionId);
  const tempImageDir = join(imageParentDir, `.video-generation-${randomUUID()}.tmp`);
  mkdirSync(tempImageDir, { recursive: true });

  const timestamp = nowIso();
  let imageCandidates: DirectorVideoGenerationImageCandidate[] = [];

  try {
    imageCandidates = await Promise.all(
      input.assets.map((asset) =>
        buildImageCandidateFromAsset({
          asset,
          sessionId: input.session.sessionId,
          outputDir: tempImageDir,
        }),
      ),
    );

    if (!imageCandidates.length) {
      throw new Error("图片生成结果为空");
    }

    mkdirSync(imageDir, { recursive: true });
    for (const candidate of input.session.imageCandidates) {
      if (candidate.source !== "uploaded") {
        rmSync(resolveRuntimeAssetUrlToPath(candidate.imageUrl), { force: true });
      }
    }
    for (const candidate of imageCandidates) {
      const fileName = candidate.imageUrl.split("/").pop();
      if (!fileName) {
        throw new Error("图片文件名无效");
      }
      renameSync(join(tempImageDir, fileName), resolveRuntimeAssetUrlToPath(candidate.imageUrl));
    }
    rmSync(tempImageDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(tempImageDir, { recursive: true, force: true });
    throw error;
  }

  const uploadedCandidates = input.session.imageCandidates.filter((candidate) => candidate.source === "uploaded");
  const nextImageCandidates = [...uploadedCandidates, ...imageCandidates];
  const selectedImageCandidateId =
    input.session.selectedImageCandidateId &&
    uploadedCandidates.some((candidate) => candidate.candidateId === input.session.selectedImageCandidateId)
      ? input.session.selectedImageCandidateId
      : (nextImageCandidates[0]?.candidateId ?? null);
  const next: DirectorVideoGenerationSession = {
    ...input.session,
    imageCandidates: nextImageCandidates,
    selectedImageCandidateId,
    imageStatus: nextImageCandidates.length ? "success" : "failed",
    imageError: nextImageCandidates.length ? null : "图片生成结果为空",
    videoStatus: "idle",
    videoError: null,
    videoJobId: null,
    updatedAt: timestamp,
  };

  dbUpsert(COLLECTION, input.session.sessionId, next);
  return next;
}

export async function insertUploadedDirectorVideoGenerationImageCandidate(input: {
  session: DirectorVideoGenerationSession;
  bytes: Buffer;
  contentType?: string | null;
}) {
  const imageDir = getSessionImageDir(input.session.sessionId);
  mkdirSync(imageDir, { recursive: true });

  const candidate = await buildImageCandidateFromBytes({
    bytes: input.bytes,
    contentType: input.contentType,
    sessionId: input.session.sessionId,
    outputDir: imageDir,
    source: "uploaded",
  });
  const imageCandidates = [candidate, ...input.session.imageCandidates];
  return createNextSessionWithImageCandidates(input.session, imageCandidates, candidate.candidateId);
}

export function deleteDirectorVideoGenerationImageCandidate(sessionId: string, candidateId: string) {
  const session = getDirectorVideoGenerationSession(sessionId);
  if (!session) {
    return null;
  }
  const candidate = session.imageCandidates.find((item) => item.candidateId === candidateId);
  if (!candidate) {
    return null;
  }

  rmSync(resolveRuntimeAssetUrlToPath(candidate.imageUrl), { force: true });

  const imageCandidates = session.imageCandidates.filter((item) => item.candidateId !== candidateId);
  const selectedImageCandidateId =
    session.selectedImageCandidateId === candidateId
      ? (imageCandidates[0]?.candidateId ?? null)
      : session.selectedImageCandidateId;

  return createNextSessionWithImageCandidates(session, imageCandidates, selectedImageCandidateId);
}

export async function replaceDirectorVideoGenerationImageCandidate(input: {
  session: DirectorVideoGenerationSession;
  candidateId: string;
  asset: ImageGenerationResult;
}) {
  const existingCandidate = input.session.imageCandidates.find((item) => item.candidateId === input.candidateId);
  if (!existingCandidate) {
    return null;
  }

  const imageDir = getSessionImageDir(input.session.sessionId);
  const imageParentDir = getSessionImageParentDir(input.session.sessionId);
  const tempImageDir = join(imageParentDir, `.video-generation-single-${randomUUID()}.tmp`);
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(tempImageDir, { recursive: true });

  let nextCandidate: DirectorVideoGenerationImageCandidate;
  try {
    nextCandidate = await buildImageCandidateFromAsset({
      asset: input.asset,
      sessionId: input.session.sessionId,
      outputDir: tempImageDir,
      candidateId: input.candidateId,
    });

    const fileName = nextCandidate.imageUrl.split("/").pop();
    if (!fileName) {
      throw new Error("图片文件名无效");
    }
    const nextImagePath = resolveRuntimeAssetUrlToPath(nextCandidate.imageUrl);
    renameSync(join(tempImageDir, fileName), nextImagePath);

    const previousImagePath = resolveRuntimeAssetUrlToPath(existingCandidate.imageUrl);
    if (previousImagePath !== nextImagePath) {
      rmSync(previousImagePath, { force: true });
    }
  } catch (error) {
    rmSync(tempImageDir, { recursive: true, force: true });
    throw error;
  }
  rmSync(tempImageDir, { recursive: true, force: true });

  const imageCandidates = input.session.imageCandidates.map((candidate) =>
    candidate.candidateId === input.candidateId ? nextCandidate : candidate,
  );
  const selectedImageCandidateId =
    input.session.selectedImageCandidateId && imageCandidates.some((item) => item.candidateId === input.session.selectedImageCandidateId)
      ? input.session.selectedImageCandidateId
      : (imageCandidates[0]?.candidateId ?? null);

  return createNextSessionWithImageCandidates(input.session, imageCandidates, selectedImageCandidateId);
}

export async function replaceUploadedDirectorVideoGenerationImageCandidate(input: {
  session: DirectorVideoGenerationSession;
  candidateId: string;
  bytes: Buffer;
  contentType?: string | null;
}) {
  const existingCandidate = input.session.imageCandidates.find((item) => item.candidateId === input.candidateId);
  if (!existingCandidate) {
    return null;
  }

  const imageDir = getSessionImageDir(input.session.sessionId);
  const imageParentDir = getSessionImageParentDir(input.session.sessionId);
  const tempImageDir = join(imageParentDir, `.video-generation-upload-${randomUUID()}.tmp`);
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(tempImageDir, { recursive: true });

  let nextCandidate: DirectorVideoGenerationImageCandidate;
  try {
    nextCandidate = await buildImageCandidateFromBytes({
      bytes: input.bytes,
      contentType: input.contentType,
      sessionId: input.session.sessionId,
      outputDir: tempImageDir,
      candidateId: input.candidateId,
      source: "uploaded",
    });

    const fileName = nextCandidate.imageUrl.split("/").pop();
    if (!fileName) {
      throw new Error("图片文件名无效");
    }
    const nextImagePath = resolveRuntimeAssetUrlToPath(nextCandidate.imageUrl);
    renameSync(join(tempImageDir, fileName), nextImagePath);

    const previousImagePath = resolveRuntimeAssetUrlToPath(existingCandidate.imageUrl);
    if (previousImagePath !== nextImagePath) {
      rmSync(previousImagePath, { force: true });
    }
  } catch (error) {
    rmSync(tempImageDir, { recursive: true, force: true });
    throw error;
  }
  rmSync(tempImageDir, { recursive: true, force: true });

  const imageCandidates = input.session.imageCandidates.map((candidate) =>
    candidate.candidateId === input.candidateId ? nextCandidate : candidate,
  );
  const selectedImageCandidateId =
    input.session.selectedImageCandidateId && imageCandidates.some((item) => item.candidateId === input.session.selectedImageCandidateId)
      ? input.session.selectedImageCandidateId
      : (imageCandidates[0]?.candidateId ?? null);

  return createNextSessionWithImageCandidates(input.session, imageCandidates, selectedImageCandidateId);
}

export function selectDirectorVideoGenerationImage(sessionId: string, candidateId: string) {
  const session = getDirectorVideoGenerationSession(sessionId);
  if (!session) {
    return null;
  }
  if (!session.imageCandidates.some((candidate) => candidate.candidateId === candidateId)) {
    return null;
  }
  return patchDirectorVideoGenerationSession(sessionId, {
    selectedImageCandidateId: candidateId,
    videoStatus: "idle",
    videoError: null,
    videoJobId: null,
  });
}

export function getSelectedDirectorVideoGenerationImage(session: DirectorVideoGenerationSession) {
  return (
    session.imageCandidates.find((candidate) => candidate.candidateId === session.selectedImageCandidateId) ??
    session.imageCandidates[0] ??
    null
  );
}

export function getDirectorVideoGenerationImageDataUrl(candidate: DirectorVideoGenerationImageCandidate) {
  const absolutePath = resolveRuntimeAssetUrlToPath(candidate.imageUrl);
  if (!existsSync(absolutePath)) {
    return null;
  }

  const bytes = readFileSync(absolutePath);
  const extension = candidate.imageUrl.split(".").pop()?.toLowerCase();
  const mimeType =
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
