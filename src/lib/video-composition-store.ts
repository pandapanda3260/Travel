import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { getDefaultSubtitleConfig, hydrateSubtitleConfig, type SubtitleConfig } from "./subtitle-style-config";
import {
  defaultCompositionBackgroundMusicVolume,
  getCompositionBackgroundMusicVolumeGain,
  normalizeCompositionBackgroundMusicVolume,
} from "./task-creation-parameters";
import { deleteVideoJob, listVideoJobs } from "./video-job-store";
import { ensureRuntimeDataDir, joinRuntimeDataPath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import type { TaskArtifactDeletionOptions } from "./task-artifact-cleanup";

export type CompositionStatus = "DRAFT" | "PROCESSING" | "COMPLETED" | "FAILED";
export type CompositionAspectRatio = "16:9" | "9:16" | "1:1";
export type CompositionTransition = "cut" | "fade";
export type CompositionAudioMode =
  | "mute"
  | "bgm_only"
  | "source_only"
  | "source_with_bgm"
  | "narration_only"
  | "narration_with_bgm";
export type CompositionAudioTrackKind = "bgm" | "narration" | "sfx";

export type GlobalConsistencyProfile = {
  subjectRule: string;
  sceneRule: string;
  styleRule: string;
  forbiddenRule: string;
};

export type CompositionSegment = {
  id: string;
  sourceJobId: string;
  sourceVideoUrl: string;
  order: number;
  durationSeconds?: number | null;
  transition: CompositionTransition;
  promptSnapshot: string;
  note?: string;
};

export type CompositionAudioClip = {
  id: string;
  sourceUrl: string | null;
  startAtSeconds: number;
  durationSeconds?: number | null;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  volume?: number;
  loop?: boolean;
  bindToSegmentId?: string | null;
  text?: string | null;
  note?: string;
};

export type CompositionAudioTrack = {
  id: string;
  kind: CompositionAudioTrackKind;
  name: string;
  enabled: boolean;
  mute: boolean;
  volume: number;
  clips: CompositionAudioClip[];
};

export type CompositionAudioPlan = {
  mode: CompositionAudioMode | "multi_track";
  tracks: CompositionAudioTrack[];
};

export type VideoCompositionRecord = {
  compositionId: string;
  taskId: string | null;
  title: string;
  aspectRatio: CompositionAspectRatio;
  status: CompositionStatus;
  transitionMode: CompositionTransition;
  transitionDurationSeconds: number;
  audioMode: CompositionAudioMode;
  backgroundMusicUrl: string | null;
  backgroundMusicVolume: number;
  audioPlan: CompositionAudioPlan;
  subtitleSrtUrl: string | null;
  subtitleConfig: SubtitleConfig;
  segments: CompositionSegment[];
  consistencyProfile: GlobalConsistencyProfile;
  outputVideoUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLLECTION = "video-compositions";
const legacyJsonPath = joinRuntimeDataPath("video-compositions.json");

function createDefaultAudioPlan(
  audioMode: CompositionAudioMode,
  backgroundMusicUrl: string | null,
): CompositionAudioPlan {
  const tracks: CompositionAudioTrack[] = [];

  if (backgroundMusicUrl) {
    const bgmVolumeGain = getCompositionBackgroundMusicVolumeGain(defaultCompositionBackgroundMusicVolume);
    tracks.push({
      id: "bgm-track",
      kind: "bgm",
      name: "背景音乐",
      enabled: true,
      mute: false,
      volume: bgmVolumeGain,
      clips: [
        {
          id: "bgm-clip",
          sourceUrl: backgroundMusicUrl,
          startAtSeconds: 0,
          loop: true,
        },
      ],
    });
  }

  return {
    mode:
      backgroundMusicUrl &&
      audioMode !== "mute" &&
      audioMode !== "bgm_only" &&
      audioMode !== "source_only" &&
      audioMode !== "narration_only"
        ? "multi_track"
        : audioMode,
    tracks,
  };
}

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as VideoCompositionRecord).compositionId);
    migrated = true;
  }
}

function readStore() {
  ensureStore();

  try {
    return dbGetAll<Partial<VideoCompositionRecord>>(COLLECTION).map((record) => ({
      compositionId: record.compositionId ?? crypto.randomUUID(),
      taskId: record.taskId ?? null,
      title: record.title ?? "未命名拼接项目",
      aspectRatio: record.aspectRatio ?? "9:16",
      status: record.status ?? "DRAFT",
      transitionMode: record.transitionMode ?? "cut",
      transitionDurationSeconds: record.transitionDurationSeconds ?? 0.6,
      audioMode: record.audioMode ?? "mute",
      backgroundMusicUrl: record.backgroundMusicUrl ?? null,
      backgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(record.backgroundMusicVolume),
      audioPlan:
        record.audioPlan ?? createDefaultAudioPlan(record.audioMode ?? "mute", record.backgroundMusicUrl ?? null),
      subtitleSrtUrl: record.subtitleSrtUrl ?? null,
      subtitleConfig: hydrateSubtitleConfig(record.subtitleConfig, getDefaultSubtitleConfig()),
      segments: record.segments ?? [],
      consistencyProfile: record.consistencyProfile ?? {
        subjectRule: "",
        sceneRule: "",
        styleRule: "",
        forbiddenRule: "",
      },
      outputVideoUrl: record.outputVideoUrl ?? null,
      error: record.error ?? null,
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function writeStore(records: VideoCompositionRecord[]) {
  ensureStore();
  dbReplaceAll(
    COLLECTION,
    records.map((r) => ({ key: r.compositionId, data: r })),
  );
}

export function listVideoCompositions() {
  return readStore().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function listTaskVideoCompositions(taskId: string) {
  return listVideoCompositions().filter((record) => record.taskId === taskId);
}

export function getLatestTaskVideoComposition(taskId: string) {
  return listTaskVideoCompositions(taskId)[0] ?? null;
}

export function getLatestCompletedTaskVideoComposition(taskId: string) {
  return (
    listTaskVideoCompositions(taskId).find(
      (record) => record.status === "COMPLETED" && Boolean(record.outputVideoUrl),
    ) ?? null
  );
}

export function getVideoComposition(compositionId: string) {
  return readStore().find((record) => record.compositionId === compositionId) ?? null;
}

export function upsertVideoComposition(record: VideoCompositionRecord) {
  ensureStore();
  dbUpsert(COLLECTION, record.compositionId, record);
  return record;
}

function assertCompositionDeletionReason(options: TaskArtifactDeletionOptions | undefined) {
  if (options?.reason !== "user_manual_delete" && options?.reason !== "successful_replacement") {
    throw new Error("删除合成视频产物需要明确的手动删除或成功替换原因");
  }
}

export function patchVideoComposition(compositionId: string, updates: Partial<VideoCompositionRecord>) {
  ensureStore();
  const current = readStore().find((item) => item.compositionId === compositionId);
  if (!current) return null;

  const nextRecord: VideoCompositionRecord = {
    ...current,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  dbUpsert(COLLECTION, compositionId, nextRecord);
  return nextRecord;
}

export function deleteVideoComposition(compositionId: string, options: TaskArtifactDeletionOptions) {
  assertCompositionDeletionReason(options);

  ensureStore();
  const currentRecord = readStore().find((item) => item.compositionId === compositionId);
  if (!currentRecord) return null;

  if (currentRecord.outputVideoUrl?.startsWith("/")) {
    const localFilePath = resolveRuntimeAssetUrlToPath(currentRecord.outputVideoUrl);

    if (existsSync(localFilePath)) {
      unlinkSync(localFilePath);
    }
  }

  if (currentRecord.subtitleSrtUrl?.startsWith("/")) {
    const localSubtitlePath = resolveRuntimeAssetUrlToPath(currentRecord.subtitleSrtUrl);

    if (existsSync(localSubtitlePath)) {
      unlinkSync(localSubtitlePath);
    }
  }

  dbDelete(COLLECTION, compositionId);

  const compositionJobs = listVideoJobs().filter((job) => job.mode === "composition" && job.jobId === compositionId);
  for (const job of compositionJobs) {
    deleteVideoJob(job.jobId, options);
  }

  return currentRecord;
}

export function deleteTaskVideoCompositions(
  taskId: string,
  options: TaskArtifactDeletionOptions & { excludeCompositionIds?: string[] },
) {
  assertCompositionDeletionReason(options);

  const excludedIds = new Set(options?.excludeCompositionIds ?? []);
  const compositions = listTaskVideoCompositions(taskId).filter((record) => !excludedIds.has(record.compositionId));

  for (const composition of compositions) {
    deleteVideoComposition(composition.compositionId, options);
  }

  return compositions;
}
