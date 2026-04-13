import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import type { KlingGenerationSettings } from "./prompt";
import type { LiveVideoProvider } from "./video-provider-config";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");

export type VideoJobStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

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

const dataDir = join(process.cwd(), "data");
const COLLECTION = "video-jobs";
const legacyJsonPath = join(dataDir, "video-jobs.json");

function getVideoJobOutputDir(taskId?: string | null) {
  return join(process.cwd(), "public", "generated-videos", taskId?.trim() || "_unassigned");
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
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(getVideoJobOutputDir(), { recursive: true });
  // 首次启动：若 SQLite 为空且旧 JSON 文件存在，自动迁移
  migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as VideoJobRecord).jobId);
}

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
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
    provider: (
      job.provider === "kling"
        ? "kling"
        : job.mode === "live"
          ? "kling"
          : null
    ) as LiveVideoProvider | null,
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
  dbReplaceAll(COLLECTION, jobs.map((job) => ({ key: job.jobId, data: job })));
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
  ensureDirectories();
  const currentJob = getVideoJob(jobId);

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("生成视频下载失败");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const outputDir = getVideoJobOutputDir(currentJob?.sourceTaskId);
  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, `${jobId}.mp4`);
  writeFileSync(filePath, bytes);
  return `/generated-videos/${currentJob?.sourceTaskId?.trim() || "_unassigned"}/${jobId}.mp4`;
}

export async function ensureLocalVideoForJob(jobId: string) {
  const currentJob = getVideoJob(jobId);

  if (!currentJob || currentJob.mode === "composition" || currentJob.status !== "COMPLETED") {
    return currentJob;
  }

  const remoteSourceUrl =
    currentJob.remoteVideoUrl ??
    (currentJob.videoUrl?.startsWith("http://") || currentJob.videoUrl?.startsWith("https://") ? currentJob.videoUrl : null);

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

  const localFilePath = join(process.cwd(), "public", latestJob.videoUrl.slice(1));
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
    const customLocalPath = join(process.cwd(), "public", job.videoUrl.replace(/^\//, ""));

    if (existsSync(customLocalPath)) {
      unlinkSync(customLocalPath);
    }
  }

  if (job.sourceTaskId) {
    const taskFolder = job.sourceTaskId.trim() || "_unassigned";
    const clipThumbPath = join(process.cwd(), "public", "generated-videos", taskFolder, "thumbnails", `${jobId}.jpg`);
    if (existsSync(clipThumbPath)) {
      unlinkSync(clipThumbPath);
    }
  }
}

/**
 * 从 video-jobs 存储中移除指定任务下的全部记录（含已软删条目），并清理对应本地文件。
 * 解决反复重生片段导致 JSON 中 deleted 任务无限膨胀、以及任务删除时漏掉软删 job 的问题。
 */
export function purgeVideoJobsBySourceTaskId(taskId: string): string[] {
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

export function deleteVideoJob(jobId: string) {
  ensureDirectories();
  const currentJob = dbGetAll<Partial<VideoJobRecord>>(COLLECTION)
    .map(normalizeJob)
    .find((job) => job.jobId === jobId);

  if (!currentJob) return null;

  removeVideoJobLocalArtifacts(currentJob);
  dbDelete(COLLECTION, jobId);
  return currentJob;
}
