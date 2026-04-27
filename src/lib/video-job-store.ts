import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { writeFetchResponseToPath } from "./file-stream";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { defaultMediaDownloadTimeoutMs, fetchWithTimeout } from "./timeout";
import { withRetry } from "./retry";
import {
  ensureRuntimeDataDir,
  joinRuntimeDataPath,
  joinRuntimePublicStoragePath,
  resolveRuntimeAssetUrlToPath,
} from "./runtime-storage";
import type { TaskArtifactDeletionOptions } from "./task-artifact-cleanup";
import type { KlingGenerationSettings } from "./prompt";
import type { LiveVideoProvider } from "./video-provider-config";

const execFileAsync = promisify(execFile);

export type VideoJobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type VideoJobMode = "mock" | "live" | "composition";

export type VideoJobRecord = {
  jobId: string;
  sourceTaskId: string | null;
  taskName: string;
  originalPrompt: string;
  optimizedPrompt: string;
  strategy: {
    angle: string;
    hook: string;
    style: string;
  };
  submittedAt: string;
  updatedAt: string;
  status: VideoJobStatus;
  mode: VideoJobMode;
  logs: string[];
  videoUrl: string | null;
  remoteVideoUrl: string | null;
  error: string | null;
  provider: LiveVideoProvider | null;
  modelId: string | null;
  generationSettings: KlingGenerationSettings | null;
  resolvedDurationSeconds: number | null;
  deletedAt: string | null;
};

const MAX_JOB_LOG_ENTRIES = 80;
const activeVideoDownloads = new Map<string, Promise<string>>();

const COLLECTION = "video-jobs";
const legacyJsonPath = joinRuntimeDataPath("video-jobs.json");

function getVideoJobOutputDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-videos", taskId?.trim() || "_unassigned");
}

export function deriveTaskName(prompt: string) {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  const explicitTitle =
    normalizedPrompt.match(/(?:视频标题|标题)[:：]\s*([^\n。；;，,]+)/)?.[1]?.trim() ??
    normalizedPrompt.match(/(?:视频标题|标题)\s+([^\n。；;，,]+)/)?.[1]?.trim() ??
    "";

  const source = explicitTitle || normalizedPrompt;
  return source.slice(0, 10) || "未命名任务";
}

function ensureDirectories() {
  ensureRuntimeDataDir();
  mkdirSync(getVideoJobOutputDir(), { recursive: true });
  // 首次启动：若 SQLite 为空且旧 JSON 文件存在，自动迁移
  migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as VideoJobRecord).jobId);
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
}

async function probeVideoDurationSeconds(inputPath: string) {
  const ffmpegPath = resolveFfmpegPath();

  try {
    const { stderr } = await execFileAsync(ffmpegPath, ["-i", inputPath, "-f", "null", "-"]);
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 100) / 100;
  } catch (error) {
    const text =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : "";
    const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 100) / 100;
  }
}

function normalizeJob(job: Partial<VideoJobRecord>): VideoJobRecord {
  return {
    jobId: job.jobId ?? "",
    sourceTaskId: job.sourceTaskId ?? null,
    taskName: job.taskName ?? deriveTaskName(job.originalPrompt ?? ""),
    originalPrompt: job.originalPrompt ?? "",
    optimizedPrompt: job.optimizedPrompt ?? "",
    strategy: job.strategy ?? {
      angle: "待生成",
      hook: "待生成",
      style: "待生成",
    },
    submittedAt: job.submittedAt ?? new Date().toISOString(),
    updatedAt: job.updatedAt ?? job.submittedAt ?? new Date().toISOString(),
    status: job.status ?? "QUEUED",
    mode: job.mode ?? "mock",
    logs: (job.logs ?? []).slice(-MAX_JOB_LOG_ENTRIES),
    videoUrl: job.videoUrl ?? null,
    remoteVideoUrl: job.remoteVideoUrl ?? null,
    error: job.error ?? null,
    provider: (job.provider === "kling" || job.provider === "seedance"
      ? job.provider
      : job.mode === "live"
        ? "kling"
        : null) as LiveVideoProvider | null,
    modelId: job.modelId ?? null,
    generationSettings: job.generationSettings ?? null,
    resolvedDurationSeconds: job.resolvedDurationSeconds ?? null,
    deletedAt: job.deletedAt ?? null,
  };
}

function readStore(): VideoJobRecord[] {
  ensureDirectories();
  try {
    return dbGetAll<Partial<VideoJobRecord>>(COLLECTION)
      .map(normalizeJob)
      .filter((job) => !job.deletedAt);
  } catch {
    return [];
  }
}

function writeStore(jobs: VideoJobRecord[]): void {
  ensureDirectories();
  dbReplaceAll(
    COLLECTION,
    jobs.map((job) => ({ key: job.jobId, data: job })),
  );
}

export function listVideoJobs() {
  return readStore().sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function getVideoJob(jobId: string) {
  return readStore().find((job) => job.jobId === jobId) ?? null;
}

export function upsertVideoJob(job: VideoJobRecord) {
  ensureDirectories();
  dbUpsert(COLLECTION, job.jobId, job);
  return job;
}

export function patchVideoJob(jobId: string, updates: Partial<VideoJobRecord>) {
  ensureDirectories();
  const current = dbGetAll<Partial<VideoJobRecord>>(COLLECTION)
    .map(normalizeJob)
    .find((job) => job.jobId === jobId);

  if (!current) return null;

  const nextJob: VideoJobRecord = {
    ...current,
    ...updates,
    logs: (updates.logs ?? current.logs).slice(-MAX_JOB_LOG_ENTRIES),
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  dbUpsert(COLLECTION, jobId, nextJob);
  return nextJob;
}

export async function saveVideoFile(jobId: string, sourceUrl: string) {
  const activeDownload = activeVideoDownloads.get(jobId);
  if (activeDownload) {
    return activeDownload;
  }

  const download = saveVideoFileWithRetry(jobId, sourceUrl).finally(() => {
    activeVideoDownloads.delete(jobId);
  });
  activeVideoDownloads.set(jobId, download);
  return download;
}

function buildDownloadError(response: Response) {
  const error = new Error(`生成视频下载失败（HTTP ${response.status}）`) as Error & {
    retryable?: boolean;
  };
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    error.retryable = false;
  }
  return error;
}

async function saveVideoFileWithRetry(jobId: string, sourceUrl: string) {
  ensureDirectories();
  const currentJob = getVideoJob(jobId);
  const outputDir = getVideoJobOutputDir(currentJob?.sourceTaskId);
  const localUrl = `/generated-videos/${currentJob?.sourceTaskId?.trim() || "_unassigned"}/${jobId}.mp4`;

  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, `${jobId}.mp4`);

  return withRetry(
    async () => {
      const response = await fetchWithTimeout(
        sourceUrl,
        {},
        {
          timeoutMs: defaultMediaDownloadTimeoutMs,
          timeoutMessage: "生成视频下载超时，请重新生成该片段",
        },
      );
      if (!response.ok) {
        throw buildDownloadError(response);
      }

      const tempFilePath = join(outputDir, `${jobId}.${randomUUID()}.tmp`);
      try {
        await writeFetchResponseToPath(response, tempFilePath);
        if (statSync(tempFilePath).size <= 0) {
          throw new Error("生成视频下载失败：文件为空");
        }
        renameSync(tempFilePath, filePath);
      } catch (error) {
        if (existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }
        throw error;
      }

      return localUrl;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 800,
    },
  );
}

export async function ensureLocalVideoForJob(jobId: string) {
  const currentJob = getVideoJob(jobId);

  if (!currentJob || currentJob.mode === "composition" || currentJob.status !== "COMPLETED") {
    return currentJob;
  }

  const remoteSourceUrl =
    currentJob.remoteVideoUrl ??
    (currentJob.videoUrl?.startsWith("http://") || currentJob.videoUrl?.startsWith("https://")
      ? currentJob.videoUrl
      : null);

  if (!remoteSourceUrl) {
    return currentJob;
  }

  const localFilePath = join(getVideoJobOutputDir(currentJob.sourceTaskId), `${jobId}.mp4`);
  const localVideoUrl = `/generated-videos/${currentJob.sourceTaskId?.trim() || "_unassigned"}/${jobId}.mp4`;

  if (existsSync(localFilePath)) {
    return patchVideoJob(jobId, {
      videoUrl: localVideoUrl,
      remoteVideoUrl: remoteSourceUrl,
      updatedAt: currentJob.updatedAt,
    });
  }

  const savedVideoUrl = await saveVideoFile(jobId, remoteSourceUrl);

  return patchVideoJob(jobId, {
    videoUrl: savedVideoUrl,
    remoteVideoUrl: remoteSourceUrl,
    updatedAt: currentJob.updatedAt,
  });
}

export async function ensureResolvedDurationForJob(jobId: string) {
  const currentJob = getVideoJob(jobId);

  if (!currentJob || currentJob.status !== "COMPLETED" || !currentJob.videoUrl) {
    return currentJob;
  }

  if (currentJob.resolvedDurationSeconds != null) {
    return currentJob;
  }

  const ensuredLocalJob = await ensureLocalVideoForJob(jobId);
  const latestJob = ensuredLocalJob ?? getVideoJob(jobId);

  if (!latestJob?.videoUrl?.startsWith("/")) {
    return latestJob ?? currentJob;
  }

  const localFilePath = resolveRuntimeAssetUrlToPath(latestJob.videoUrl);
  if (!existsSync(localFilePath)) {
    return latestJob;
  }

  const resolvedDurationSeconds = await probeVideoDurationSeconds(localFilePath);

  if (resolvedDurationSeconds == null) {
    return latestJob;
  }

  return patchVideoJob(jobId, {
    resolvedDurationSeconds,
    updatedAt: latestJob.updatedAt,
  });
}

/** 删除磁盘上与该 job 关联的产物（标准 mp4、自定义 videoUrl、片段条带缩略图）。 */
export function removeVideoJobLocalArtifacts(job: VideoJobRecord) {
  const jobId = job.jobId;
  const localFilePath = join(getVideoJobOutputDir(job.sourceTaskId), `${jobId}.mp4`);

  if (existsSync(localFilePath)) {
    unlinkSync(localFilePath);
  }

  if (job.videoUrl?.startsWith("/")) {
    const customLocalPath = resolveRuntimeAssetUrlToPath(job.videoUrl);

    if (existsSync(customLocalPath)) {
      unlinkSync(customLocalPath);
    }
  }

  if (job.sourceTaskId) {
    const taskFolder = job.sourceTaskId.trim() || "_unassigned";
    const clipThumbPath = joinRuntimePublicStoragePath("generated-videos", taskFolder, "thumbnails", `${jobId}.jpg`);
    if (existsSync(clipThumbPath)) {
      unlinkSync(clipThumbPath);
    }
  }
}

/**
 * 从 video-jobs 存储中移除指定任务下的全部记录（含已软删条目），并清理对应本地文件。
 * 解决反复重生片段导致 JSON 中 deleted 任务无限膨胀、以及任务删除时漏掉软删 job 的问题。
 */
function assertVideoJobDeletionReason(options: TaskArtifactDeletionOptions | undefined) {
  if (options?.reason !== "user_manual_delete" && options?.reason !== "successful_replacement") {
    throw new Error("删除视频任务产物需要明确的手动删除或成功替换原因");
  }
}

export function purgeVideoJobsBySourceTaskId(taskId: string, options: TaskArtifactDeletionOptions): string[] {
  assertVideoJobDeletionReason(options);

  const normalized = taskId.trim();
  if (!normalized) {
    return [];
  }

  ensureDirectories();
  // readStore 只返回未软删记录；这里需要包含软删记录一并清除，直接读 SQLite
  const allJobs = dbGetAll<Partial<VideoJobRecord>>(COLLECTION).map(normalizeJob);
  const removedIds: string[] = [];

  for (const job of allJobs) {
    if (job.sourceTaskId === normalized) {
      removedIds.push(job.jobId);
      removeVideoJobLocalArtifacts(job);
      dbDelete(COLLECTION, job.jobId);
    }
  }

  return removedIds;
}

export function deleteVideoJob(jobId: string, options: TaskArtifactDeletionOptions) {
  assertVideoJobDeletionReason(options);

  ensureDirectories();
  const currentJob = dbGetAll<Partial<VideoJobRecord>>(COLLECTION)
    .map(normalizeJob)
    .find((job) => job.jobId === jobId);

  if (!currentJob) return null;

  removeVideoJobLocalArtifacts(currentJob);
  dbDelete(COLLECTION, jobId);
  return currentJob;
}
