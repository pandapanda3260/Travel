import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { dbGetAll, dbUpsert, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import type { NarrationDraftClip } from "./narration";
import { listNarrationResults, type NarrationResultRecord } from "./narration-result-store";
import { ensureRuntimeDataDir, joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { getTaskDirectorPlan } from "./video-task-director";
import {
  ensureLocalVideoForJob,
  ensureResolvedDurationForJob,
  getVideoJob,
  listVideoJobs,
  type VideoJobRecord,
} from "./video-job-store";
import type { VideoTaskRecord } from "./video-task-schema";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");
const COLLECTION = "task-clip-shots";
const legacyJsonPath = joinRuntimeDataPath("task-clip-shots.json");

function clipKey(taskId: string, shotIndex: number) {
  return `${taskId}:${shotIndex}`;
}

export type TaskClipShotRecord = {
  taskId: string;
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  shotTitle: string;
  segmentMode?: string;
  videoPrompt: string;
  multiPrompt?: Array<{
    index: number;
    prompt: string;
    duration: number;
  }>;
  subtitleText: string;
  narrationText: string;
  wordTimeline: Array<{
    word: string;
    startTime: number;
    endTime: number;
  }>;
  visualImageSessionId: string;
  visualImageUrl: string;
  durationSeconds: number;
  videoJobId: string;
  lipSyncJobId: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string;
};

export type TaskClipShotPayload = {
  segmentId: string;
  segmentIndex: number;
  shotIndex: number;
  shotTitle: string;
  segmentMode?: string;
  requiresLipSync?: boolean;
  videoPrompt: string;
  multiPrompt?: Array<{
    index: number;
    prompt: string;
    duration: number;
  }>;
  subtitleText: string;
  narrationText: string;
  durationSeconds: number;
  visualImageSessionId: string | null;
  visualImageUrl: string | null;
  wordTimeline: Array<{
    word: string;
    startTime: number;
    endTime: number;
  }>;
  clipRecord: TaskClipShotRecord | null;
  job: VideoJobRecord | null;
  lipSyncJob: VideoJobRecord | null;
  thumbnailUrl: string | null;
};

function getTaskClipThumbnailDir(taskId: string) {
  return joinRuntimePublicStoragePath("generated-videos", taskId.trim() || "_unassigned", "thumbnails");
}

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => {
      const r = item as Partial<TaskClipShotRecord>;
      return clipKey(r.taskId ?? "", r.shotIndex ?? 0);
    });
    migrated = true;
  }
}

function readStore() {
  ensureStore();
  try {
    return dbGetAll<Partial<TaskClipShotRecord>>(COLLECTION).map((record) => ({
      taskId: record.taskId ?? "",
      segmentId: record.segmentId ?? `segment-${record.segmentIndex ?? record.shotIndex ?? 1}`,
      segmentIndex: record.segmentIndex ?? record.shotIndex ?? 1,
      shotIndex: record.shotIndex ?? 1,
      shotTitle: record.shotTitle ?? `片段 ${record.segmentIndex ?? record.shotIndex ?? 1}`,
      segmentMode: record.segmentMode ?? "single_speaking",
      videoPrompt: record.videoPrompt ?? "",
      multiPrompt: record.multiPrompt ?? [],
      subtitleText: record.subtitleText ?? "",
      narrationText: record.narrationText ?? "",
      wordTimeline: record.wordTimeline ?? [],
      visualImageSessionId: record.visualImageSessionId ?? "",
      visualImageUrl: record.visualImageUrl ?? "",
      durationSeconds: record.durationSeconds ?? 5,
      videoJobId: record.videoJobId ?? "",
      lipSyncJobId: record.lipSyncJobId ?? null,
      thumbnailUrl: record.thumbnailUrl ?? null,
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
      generatedAt: record.generatedAt ?? record.createdAt ?? new Date().toISOString(),
    }));
  } catch {
    return [] as TaskClipShotRecord[];
  }
}

function writeStore(records: TaskClipShotRecord[]) {
  ensureStore();
  dbReplaceAll(COLLECTION, records.map((r) => ({ key: clipKey(r.taskId, r.shotIndex), data: r })));
}

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;
  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }
  return runtimePath;
}

function buildWordTimelineText(words: NarrationDraftClip["words"]) {
  return (words ?? [])
    .map((word) => `${word.startTime.toFixed(2)}-${word.endTime.toFixed(2)}秒：${word.word}`)
    .join("；");
}

export function buildTaskClipGenerationPrompt(input: {
  segmentId: string;
  segmentMode: string;
  shotIndex: number;
  shotPrompt: string;
  multiPrompt?: Array<{
    index: number;
    prompt: string;
    duration: number;
  }>;
  narrationClip: NarrationDraftClip;
  task: VideoTaskRecord;
}) {
  const timelineText = buildWordTimelineText(input.narrationClip.words);

  const clipConstraint = getEffectiveConstraintPrompt("clip_generation");
  const multiPromptSummary = (input.multiPrompt ?? [])
    .map((item) => `子镜头${item.index}（${item.duration}s）：${item.prompt}`)
    .join("\n");

  return [
    `片段 ${input.shotIndex}（${input.segmentId}）生成要求：`,
    input.shotPrompt.trim(),
    `口播台词：${input.narrationClip.narrationText}`,
    `字幕文案：${input.narrationClip.subtitleText}`,
    `片段总时长：${input.narrationClip.durationSeconds} 秒。`,
    `片段模式：${input.segmentMode}。`,
    multiPromptSummary ? `片段内镜头分解：\n${multiPromptSummary}` : "",
    clipConstraint,
    timelineText ? `解说节奏参考：${timelineText}` : "解说节奏参考：按自然发声节奏均匀分配动作。",
    `画面比例：${input.task.parameters.video.aspectRatio}。`,
    `输出画质：${input.task.parameters.video.mode}。`,
    `提示词相关性：${input.task.parameters.video.cfgScale}。`,
    `运镜策略：${input.task.parameters.video.cameraControl}。`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getTaskClipNarrationResult(taskId: string) {
  return listNarrationResults()
    .filter((item) => item.taskId === taskId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
}

export function parseTaskClipShots(task: VideoTaskRecord, narrationResult?: NarrationResultRecord | null) {
  const directorPlan = getTaskDirectorPlan(task);
  return directorPlan.renderSegments.map((segment) => {
    const narrationClip =
      narrationResult?.clips.find((clip) => clip.segmentId === segment.segmentId || clip.bindToSegmentId === segment.segmentId)
      ?? narrationResult?.clips.find((clip) => clip.segmentIndex === segment.segmentIndex || clip.shotIndex === segment.segmentIndex)
      ?? {
        id: `cue-${segment.segmentIndex}`,
        cueId: `cue-${segment.segmentIndex}`,
        shotIndex: segment.segmentIndex,
        segmentId: segment.segmentId,
        segmentIndex: segment.segmentIndex,
        bindToSegmentId: segment.segmentId,
        startAtSeconds: 0,
        durationSeconds: segment.durationSeconds,
        audioDurationSeconds: null,
        characterFocus: segment.hasTalent ? "主角" : "场景",
        visualFocus: segment.videoPrompt,
        narrationText: segment.narrationText,
        subtitleText: segment.subtitleText,
        note: segment.title,
        hasVoice: segment.hasVoice,
        hasSubtitle: segment.hasSubtitle,
        requiresLipSync: segment.requiresLipSync,
        audioUrl: null,
        words: [],
      };

    return {
      segmentId: segment.segmentId,
      segmentIndex: segment.segmentIndex,
      shotIndex: segment.segmentIndex,
      shotTitle: segment.title,
      segmentMode: segment.segmentMode,
      multiPrompt: segment.multiPrompt,
      requiresLipSync: segment.requiresLipSync,
      videoPrompt: segment.videoPrompt,
      narrationClip,
    };
  });
}

export function listTaskClipShots(taskId?: string) {
  const records = taskId ? readStore().filter((record) => record.taskId === taskId) : readStore();
  return records.sort((left, right) => left.segmentIndex - right.segmentIndex);
}

export function getTaskClipShot(taskId: string, shotIndex: number) {
  return readStore().find((record) => record.taskId === taskId && record.shotIndex === shotIndex) ?? null;
}

export function upsertTaskClipShot(record: TaskClipShotRecord) {
  ensureStore();
  dbUpsert(COLLECTION, clipKey(record.taskId, record.shotIndex), record);
  return record;
}

export async function ensureTaskClipThumbnail(taskId: string, videoJobId: string) {
  const job = await ensureLocalVideoForJob(videoJobId);
  const latestJob = (await ensureResolvedDurationForJob(videoJobId)) ?? job ?? getVideoJob(videoJobId);

  if (!latestJob?.videoUrl?.startsWith("/")) {
    return null;
  }

  const inputPath = resolveRuntimeAssetUrlToPath(latestJob.videoUrl);
  if (!existsSync(inputPath)) {
    return null;
  }

  const thumbnailDir = getTaskClipThumbnailDir(taskId);
  mkdirSync(thumbnailDir, { recursive: true });
  const thumbnailPath = join(thumbnailDir, `${videoJobId}.jpg`);
  const publicUrl = `/generated-videos/${taskId.trim() || "_unassigned"}/thumbnails/${videoJobId}.jpg`;

  if (existsSync(thumbnailPath)) {
    return publicUrl;
  }

  const ffmpegPath = resolveFfmpegPath();
  await execFileAsync(ffmpegPath, ["-y", "-i", inputPath, "-vf", "select=eq(n\\,0)", "-frames:v", "1", thumbnailPath]);
  return publicUrl;
}

export async function buildTaskClipShotPayloads(task: VideoTaskRecord, options?: { readOnly?: boolean }) {
  const narrationResult = getTaskClipNarrationResult(task.taskId);
  const shotDefinitions = parseTaskClipShots(task, narrationResult);
  const clipRecords = listTaskClipShots(task.taskId);
  const jobMap = new Map(listVideoJobs().map((job) => [job.jobId, job]));
  const skipSideEffects = options?.readOnly === true;

  return Promise.all(
    shotDefinitions.map(async (definition) => {
      const clipRecord = clipRecords.find((item) => item.shotIndex === definition.shotIndex) ?? null;
      const resolvedRecord = clipRecord ?? clipRecords.find((item) => item.segmentId === definition.segmentId) ?? null;
      const job = resolvedRecord?.videoJobId ? jobMap.get(resolvedRecord.videoJobId) ?? null : null;
      const ensuredJob =
        !skipSideEffects && job?.status === "COMPLETED" && resolvedRecord
          ? ((await ensureResolvedDurationForJob(job.jobId)) ?? (await ensureLocalVideoForJob(job.jobId)) ?? getVideoJob(job.jobId))
          : job;
      const lipSyncJob = resolvedRecord?.lipSyncJobId ? jobMap.get(resolvedRecord.lipSyncJobId) ?? getVideoJob(resolvedRecord.lipSyncJobId) : null;
      const ensuredLipSyncJob =
        !skipSideEffects && lipSyncJob?.status === "COMPLETED"
          ? ((await ensureLocalVideoForJob(lipSyncJob.jobId)) ?? getVideoJob(lipSyncJob.jobId))
          : lipSyncJob;
      const thumbnailUrl =
        !skipSideEffects && ensuredJob?.status === "COMPLETED" && resolvedRecord
          ? (await ensureTaskClipThumbnail(task.taskId, ensuredJob.jobId).catch(() => resolvedRecord.thumbnailUrl)) ?? resolvedRecord.thumbnailUrl
          : resolvedRecord?.thumbnailUrl ?? null;

      return {
        segmentId: definition.segmentId,
        segmentIndex: definition.segmentIndex,
        shotIndex: definition.shotIndex,
        shotTitle: definition.shotTitle,
        segmentMode: definition.segmentMode,
        requiresLipSync: definition.requiresLipSync,
        multiPrompt: definition.multiPrompt,
        videoPrompt: resolvedRecord?.videoPrompt ?? definition.videoPrompt,
        subtitleText: resolvedRecord?.subtitleText ?? definition.narrationClip?.subtitleText ?? "",
        narrationText: resolvedRecord?.narrationText ?? definition.narrationClip?.narrationText ?? "",
        durationSeconds: resolvedRecord?.durationSeconds ?? definition.narrationClip?.durationSeconds ?? task.parameters.video.durationSeconds,
        visualImageSessionId: resolvedRecord?.visualImageSessionId ?? null,
        visualImageUrl: resolvedRecord?.visualImageUrl ?? null,
        wordTimeline: resolvedRecord?.wordTimeline ?? definition.narrationClip?.words ?? [],
        clipRecord: resolvedRecord ? { ...resolvedRecord, thumbnailUrl } : null,
        job: ensuredJob ?? null,
        lipSyncJob: ensuredLipSyncJob ?? null,
        thumbnailUrl,
      } satisfies TaskClipShotPayload;
    }),
  );
}

export function deleteTaskClipShotsByTaskId(taskId: string) {
  const records = readStore().filter((record) => record.taskId !== taskId);
  writeStore(records);
  rmSync(joinRuntimePublicStoragePath("generated-videos", taskId.trim() || "_unassigned", "thumbnails"), {
    recursive: true,
    force: true,
  });
}
