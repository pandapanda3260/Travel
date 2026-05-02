import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { getVideoTypeCategoryPrompt, getVideoTypeAddonPrompt } from "./video-type-prompts";
import { dbGetAll, dbUpsert, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { formatSecondValue } from "./duration-format";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import type { NarrationDraftClip } from "./narration";
import { listNarrationResults, type NarrationResultRecord } from "./narration-result-store";
import { isRealPhotoStructuralNarrationText } from "./real-photo-narration-source";
import { ensureRuntimeDataDir, joinRuntimeDataPath, joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { recoverNarrationResultTextFromTask } from "./task-narration-result-recovery";
import { getTaskDirectorPlan } from "./video-task-director";
import { listTaskVisualSelectedImages } from "./task-visual-image-store";
import {
  ensureLocalVideoForJob,
  ensureResolvedDurationForJob,
  getVideoJob,
  listVideoJobs,
  type VideoJobRecord,
} from "./video-job-store";
import type { TaskArtifactDeletionOptions } from "./task-artifact-cleanup";
import type {
  HotelAssetSceneType,
  ShotGenerationMode,
  ShotSourceTrace,
  VideoTaskAssetSourceType,
  VideoTaskRecord,
} from "./video-task-schema";

const execFileAsync = promisify(execFile);
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
  sourceShots: TaskClipSourceShot[];
};

export type TaskClipSourceShot = {
  shotId: string;
  shotIndex: number;
  title: string;
  sceneType?: HotelAssetSceneType;
  contentDescription?: string | null;
  assetId?: string | null;
  assetSourceType?: VideoTaskAssetSourceType | null;
  assetSubjectSummary?: string | null;
  sourceMaterialId?: string | null;
  sourceStartAtSeconds?: number | null;
  sourceEndAtSeconds?: number | null;
  sourceTimeRangeLabel?: string | null;
  generationMode?: ShotGenerationMode;
  sourceTrace?: ShotSourceTrace | null;
  referenceImageUrl?: string | null;
  selectedVisualImageUrl?: string | null;
  selectedVisualImageSessionId?: string | null;
  needImageEnhancement?: boolean;
  isAtmosphereInsert?: boolean;
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
  return getFfmpegBinaryPath();
}

function buildWordTimelineText(words: NarrationDraftClip["words"]) {
  return (words ?? [])
    .map((word) => {
      const start = formatSecondValue(word.startTime, { maximumFractionDigits: 2 }) ?? "0";
      const end = formatSecondValue(word.endTime, { maximumFractionDigits: 2 }) ?? "0";
      return `${start}-${end}秒：${word.word}`;
    })
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
  task?: VideoTaskRecord | null;
}) {
  const timelineText = buildWordTimelineText(input.narrationClip.words);
  const videoParameters = input.task?.parameters.video;
  const unifiedText =
    input.narrationClip.fullSemanticSentence?.trim() ||
    input.narrationClip.spokenText?.trim() ||
    input.narrationClip.narrationText.trim() ||
    input.narrationClip.subtitleText.trim();

  const clipConstraint = getEffectiveConstraintPrompt("clip_generation");
  const multiPromptSummary = (input.multiPrompt ?? [])
    .map((item) => `子镜头${item.index}（${item.duration}s）：${item.prompt}`)
    .join("\n");

  return [
    `片段 ${input.shotIndex}（${input.segmentId}）生成要求：`,
    input.shotPrompt.trim(),
    `配音与字幕唯一文本源：${unifiedText}`,
    `片段总时长：${input.narrationClip.durationSeconds} 秒。`,
    `片段模式：${input.segmentMode}。`,
    multiPromptSummary ? `片段内镜头分解：\n${multiPromptSummary}` : "",
    clipConstraint,
    timelineText ? `解说节奏参考：${timelineText}` : "解说节奏参考：按自然发声节奏均匀分配动作。",
    `画面比例：${videoParameters?.aspectRatio ?? "9:16"}。`,
    `输出画质：${videoParameters?.mode ?? "std"}。`,
    `提示词相关性：${videoParameters?.cfgScale ?? 0.5}。`,
    `运镜策略：${videoParameters?.cameraControl ?? "auto"}。`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSeedanceSegmentPrompt(input: {
  segmentId: string;
  segmentIndex: number;
  shotDescriptions: Array<{ shotIndex: number; prompt: string; durationSeconds?: number; startAtSeconds?: number; endAtSeconds?: number }>;
  narrationText: string;
  durationSeconds: number;
  task: VideoTaskRecord;
}) {
  const clipConstraint = getEffectiveConstraintPrompt("clip_generation");
  const typeCategory = getVideoTypeCategoryPrompt(input.task.parameters.video.videoType, "clip_generation");
  const typeAddon = getVideoTypeAddonPrompt(input.task.parameters.video.videoType, "clip_generation");

  const totalShots = input.shotDescriptions.length;

  const shotLines = input.shotDescriptions.map((shot, i) => {
    const imageRef = `@image${i + 1}`;
    const dur = shot.durationSeconds ? Math.round(shot.durationSeconds * 10) / 10 : null;
    const durPrefix = dur != null ? `（${dur}秒）：` : "";
    return `${durPrefix}${imageRef} ${shot.prompt}`;
  });

  const rhythmGuide = totalShots > 1
    ? `本片段共 ${totalShots} 个画面，总时长 ${input.durationSeconds} 秒，画面之间自然过渡。`
    : `本片段总时长 ${input.durationSeconds} 秒。`;

  return [
    `片段 ${input.segmentIndex}（${input.segmentId}）视频生成要求：`,
    ...shotLines,
    "",
    rhythmGuide,
    `画面比例：${input.task.parameters.video.aspectRatio}。`,
    clipConstraint,
    typeCategory,
    typeAddon,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getTaskClipNarrationResult(taskId: string, task?: VideoTaskRecord | null) {
  const result =
    listNarrationResults()
    .filter((item) => item.taskId === taskId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
  return task ? recoverNarrationResultTextFromTask(task, result) : result;
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

    const matchingStoryShot =
      directorPlan.storyShots.find((s) => s.segmentId === segment.segmentId) ??
      directorPlan.storyShots.find((s) => s.shotIndex === segment.segmentIndex);

    return {
      segmentId: segment.segmentId,
      segmentIndex: segment.segmentIndex,
      shotIndex: segment.segmentIndex,
      shotTitle: segment.title,
      segmentMode: segment.segmentMode,
      durationSeconds: segment.durationSeconds,
      multiPrompt: segment.multiPrompt,
      requiresLipSync: segment.requiresLipSync,
      videoPrompt: segment.videoPrompt,
      narrationClip,
      preRollSeconds: matchingStoryShot?.preRollSeconds ?? 0,
      postRollSeconds: matchingStoryShot?.postRollSeconds ?? 0,
    };
  });
}

function normalizePositiveDuration(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTaskClipPayloadDurationSeconds(input: {
  recordDurationSeconds?: number | null;
  audioDurationSeconds?: number | null;
  plannedDurationSeconds?: number | null;
  fallbackDurationSeconds: number;
}) {
  return (
    normalizePositiveDuration(input.recordDurationSeconds) ??
    normalizePositiveDuration(input.audioDurationSeconds) ??
    normalizePositiveDuration(input.plannedDurationSeconds) ??
    Math.max(1, input.fallbackDurationSeconds)
  );
}

export function resolveTaskClipPayloadText(input: {
  recordText?: string | null;
  recoveredText?: string | null;
  structuralRecordText?: boolean;
}) {
  const recordText = input.recordText?.trim() ?? "";
  const recoveredText = input.recoveredText?.trim() ?? "";

  if (!recordText) {
    return recoveredText;
  }

  if (recoveredText && input.structuralRecordText) {
    return recoveredText;
  }

  return recordText;
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
  const narrationResult = getTaskClipNarrationResult(task.taskId, task);
  const shotDefinitions = parseTaskClipShots(task, narrationResult);
  const clipRecords = listTaskClipShots(task.taskId);
  const jobMap = new Map(listVideoJobs().map((job) => [job.jobId, job]));
  const skipSideEffects = options?.readOnly === true;
  const directorPlan = getTaskDirectorPlan(task);
  const selectedVisualImageMap = new Map(
    listTaskVisualSelectedImages(task.taskId).map((item) => [item.shotIndex, item]),
  );
  const sourceShotMap = new Map<string, TaskClipSourceShot[]>(
    directorPlan.storyShots.reduce<Array<[string, TaskClipSourceShot[]]>>((entries, shot) => {
      const current = entries.find(([segmentId]) => segmentId === shot.segmentId)?.[1];
      const selectedVisualImage = selectedVisualImageMap.get(shot.shotIndex) ?? null;
      const nextShot = {
        shotId: shot.shotId,
        shotIndex: shot.shotIndex,
        title: shot.title,
        sceneType: shot.sceneType,
        contentDescription: shot.contentDescription ?? shot.sceneDescription ?? null,
        assetId: shot.assetId ?? null,
        assetSourceType: shot.assetSourceType ?? null,
        assetSubjectSummary: shot.assetSubjectSummary ?? null,
        sourceMaterialId: shot.sourceMaterialId ?? null,
        sourceStartAtSeconds: shot.sourceStartAtSeconds ?? null,
        sourceEndAtSeconds: shot.sourceEndAtSeconds ?? null,
        sourceTimeRangeLabel: shot.sourceTimeRangeLabel ?? null,
        generationMode: shot.generationMode,
        sourceTrace: shot.sourceTrace ?? null,
        referenceImageUrl: shot.referenceImageUrl ?? null,
        selectedVisualImageUrl: selectedVisualImage?.imageUrl ?? null,
        selectedVisualImageSessionId: selectedVisualImage?.sessionId ?? null,
        needImageEnhancement: shot.needImageEnhancement ?? false,
        isAtmosphereInsert: shot.isAtmosphereInsert ?? false,
      } satisfies TaskClipSourceShot;

      if (current) {
        current.push(nextShot);
        return entries;
      }

      entries.push([shot.segmentId, [nextShot]]);
      return entries;
    }, []),
  );

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
      const sourceShots =
        [...(sourceShotMap.get(definition.segmentId) ?? [])].sort((left, right) => left.shotIndex - right.shotIndex);
      const payloadSubtitleText = resolveTaskClipPayloadText({
        recordText: resolvedRecord?.subtitleText,
        recoveredText: definition.narrationClip?.subtitleText || definition.narrationClip?.narrationText || "",
        structuralRecordText: isRealPhotoStructuralNarrationText(
          resolvedRecord?.subtitleText,
          directorPlan.storyShots,
          task.shotPlan,
        ),
      });
      const payloadNarrationText = resolveTaskClipPayloadText({
        recordText: resolvedRecord?.narrationText,
        recoveredText: definition.narrationClip?.narrationText || definition.narrationClip?.subtitleText || "",
        structuralRecordText: isRealPhotoStructuralNarrationText(
          resolvedRecord?.narrationText,
          directorPlan.storyShots,
          task.shotPlan,
        ),
      });
      const shouldUseRecoveredWordTimeline =
        Boolean(definition.narrationClip?.words?.length) &&
        (!resolvedRecord?.wordTimeline?.length ||
          payloadSubtitleText !== (resolvedRecord?.subtitleText ?? "") ||
          payloadNarrationText !== (resolvedRecord?.narrationText ?? ""));

      return {
        segmentId: definition.segmentId,
        segmentIndex: definition.segmentIndex,
        shotIndex: definition.shotIndex,
        shotTitle: definition.shotTitle,
        segmentMode: definition.segmentMode,
        requiresLipSync: definition.requiresLipSync,
        multiPrompt: definition.multiPrompt,
        videoPrompt: resolvedRecord?.videoPrompt ?? definition.videoPrompt,
        subtitleText: payloadSubtitleText,
        narrationText: payloadNarrationText,
        durationSeconds: resolveTaskClipPayloadDurationSeconds({
          recordDurationSeconds: resolvedRecord?.durationSeconds,
          audioDurationSeconds: definition.narrationClip?.audioDurationSeconds,
          plannedDurationSeconds: definition.narrationClip?.durationSeconds,
          fallbackDurationSeconds: task.parameters.video.durationSeconds,
        }),
        visualImageSessionId: resolvedRecord?.visualImageSessionId ?? null,
        visualImageUrl: resolvedRecord?.visualImageUrl ?? null,
        wordTimeline: shouldUseRecoveredWordTimeline
          ? definition.narrationClip?.words ?? []
          : resolvedRecord?.wordTimeline ?? definition.narrationClip?.words ?? [],
        clipRecord: resolvedRecord ? { ...resolvedRecord, thumbnailUrl } : null,
        job: ensuredJob ?? null,
        lipSyncJob: ensuredLipSyncJob ?? null,
        thumbnailUrl,
        sourceShots,
      } satisfies TaskClipShotPayload;
    }),
  );
}

export function deleteTaskClipShotsByTaskId(taskId: string, options: TaskArtifactDeletionOptions) {
  if (options.reason !== "user_manual_delete" && options.reason !== "successful_replacement") {
    throw new Error("删除片段生成记录需要明确的手动删除或成功替换原因");
  }

  const records = readStore().filter((record) => record.taskId !== taskId);
  writeStore(records);
  rmSync(joinRuntimePublicStoragePath("generated-videos", taskId.trim() || "_unassigned", "thumbnails"), {
    recursive: true,
    force: true,
  });
}

export function deleteTaskClipShotsByTaskIdAndShotIndexes(taskId: string, shotIndexes: number[]) {
  const normalizedTaskId = taskId.trim();
  const targetShotIndexes = new Set(
    shotIndexes.map((shotIndex) => Number(shotIndex)).filter((shotIndex) => Number.isFinite(shotIndex) && shotIndex > 0),
  );

  if (!normalizedTaskId || targetShotIndexes.size === 0) {
    return [] as TaskClipShotRecord[];
  }

  const records = readStore();
  const deletedRecords = records.filter(
    (record) => record.taskId === normalizedTaskId && targetShotIndexes.has(record.shotIndex),
  );

  if (deletedRecords.length === 0) {
    return [];
  }

  writeStore(
    records.filter((record) => !(record.taskId === normalizedTaskId && targetShotIndexes.has(record.shotIndex))),
  );

  return deletedRecords;
}
