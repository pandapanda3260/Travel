import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { deleteVideoJob, listVideoJobs } from "./video-job-store";

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
  audioPlan: CompositionAudioPlan;
  subtitleSrtUrl: string | null;
  segments: CompositionSegment[];
  consistencyProfile: GlobalConsistencyProfile;
  outputVideoUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const dataDir = join(process.cwd(), "data");
const COLLECTION = "video-compositions";
const legacyJsonPath = join(dataDir, "video-compositions.json");

function createDefaultAudioPlan(audioMode: CompositionAudioMode, backgroundMusicUrl: string | null): CompositionAudioPlan {
  const tracks: CompositionAudioTrack[] = [];

  if (backgroundMusicUrl) {
    tracks.push({
      id: "bgm-track",
      kind: "bgm",
      name: "背景音乐",
      enabled: true,
      mute: false,
      volume: 1,
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
  mkdirSync(dataDir, { recursive: true });
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
      audioPlan: record.audioPlan ?? createDefaultAudioPlan(record.audioMode ?? "mute", record.backgroundMusicUrl ?? null),
      subtitleSrtUrl: record.subtitleSrtUrl ?? null,
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
  dbReplaceAll(COLLECTION, records.map((r) => ({ key: r.compositionId, data: r })));
}

export function listVideoCompositions() {
  return readStore().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getVideoComposition(compositionId: string) {
  return readStore().find((record) => record.compositionId === compositionId) ?? null;
}

export function upsertVideoComposition(record: VideoCompositionRecord) {
  ensureStore();
  dbUpsert(COLLECTION, record.compositionId, record);
  return record;
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

export function deleteVideoComposition(compositionId: string) {
  ensureStore();
  const currentRecord = readStore().find((item) => item.compositionId === compositionId);
  if (!currentRecord) return null;

  if (currentRecord.outputVideoUrl?.startsWith("/")) {
    const localFilePath = join(process.cwd(), "public", currentRecord.outputVideoUrl.slice(1));

    if (existsSync(localFilePath)) {
      unlinkSync(localFilePath);
    }
  }

  if (currentRecord.subtitleSrtUrl?.startsWith("/")) {
    const localSubtitlePath = join(process.cwd(), "public", currentRecord.subtitleSrtUrl.slice(1));

    if (existsSync(localSubtitlePath)) {
      unlinkSync(localSubtitlePath);
    }
  }

  dbDelete(COLLECTION, compositionId);

  const compositionJobs = listVideoJobs().filter(
    (job) => job.mode === "composition" && job.jobId === compositionId,
  );
  for (const job of compositionJobs) {
    deleteVideoJob(job.jobId);
  }

  return currentRecord;
}
