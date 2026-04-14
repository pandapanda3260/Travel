import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { buildMergedNarrationAudio, deleteMergedNarrationAudio } from "./narration-audio-bundle";
import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import type { NarrationDraft, NarrationDraftClip } from "./narration";
import { sanitizeNarrationText } from "./narration";
import { buildSrtFromSubtitleCues, buildSubtitleCuesFromNarrationClips, writeSrtSubtitleFile } from "./subtitle-export";

export type NarrationResultRecord = {
  resultId: string;
  taskId: string | null;
  title: string;
  sourcePrompt: string;
  totalDurationSeconds: number;
  strategySummary: string;
  compositionId: string | null;
  compositionTitle: string | null;
  voiceId: string | null;
  subtitleSrtUrl: string | null;
  mergedAudioUrl: string | null;
  clips: NarrationDraftClip[];
  createdAt: string;
  updatedAt: string;
};

const dataDir = join(process.cwd(), "data");
const COLLECTION = "narration-results";
const legacyJsonPath = join(dataDir, "narration-results.json");

let migrated = false;
function ensureStore() {
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as NarrationResultRecord).resultId);
    migrated = true;
  }
}

function normalizeNarrationClip(clip: NarrationDraftClip): NarrationDraftClip {
  const unifiedText = sanitizeNarrationText(clip.narrationText?.trim() || clip.subtitleText?.trim() || "");

  return {
    ...clip,
    narrationText: clip.hasVoice === false ? "" : unifiedText,
    subtitleText: clip.hasSubtitle === false ? "" : unifiedText,
  };
}

function normalizeNarrationClips(clips: NarrationDraftClip[]) {
  return clips.map((clip) => normalizeNarrationClip(clip));
}

function readStore() {
  ensureStore();

  try {
    return dbGetAll<Partial<NarrationResultRecord>>(COLLECTION).map(
      (item) =>
        ({
          resultId: item.resultId ?? crypto.randomUUID(),
          taskId: item.taskId ?? null,
          title: item.title ?? "未命名解说结果",
          sourcePrompt: item.sourcePrompt ?? "",
          totalDurationSeconds: item.totalDurationSeconds ?? 0,
          strategySummary: item.strategySummary ?? "",
          compositionId: item.compositionId ?? null,
          compositionTitle: item.compositionTitle ?? null,
          voiceId: item.voiceId ?? null,
          subtitleSrtUrl: item.subtitleSrtUrl ?? null,
          mergedAudioUrl: item.mergedAudioUrl ?? null,
          clips: normalizeNarrationClips(item.clips ?? []),
          createdAt: item.createdAt ?? new Date().toISOString(),
          updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
        }) satisfies NarrationResultRecord,
    );
  } catch {
    return [];
  }
}

function writeStore(records: NarrationResultRecord[]) {
  ensureStore();
  dbReplaceAll(
    COLLECTION,
    records.map((r) => ({ key: r.resultId, data: r })),
  );
}

function deleteLocalAudioFile(audioUrl: string | null | undefined) {
  if (!audioUrl?.startsWith("/")) {
    return;
  }

  const localFilePath = join(process.cwd(), "public", audioUrl.slice(1));
  if (existsSync(localFilePath)) {
    unlinkSync(localFilePath);
  }
}

function deleteLocalSubtitleFile(subtitleUrl: string | null | undefined) {
  if (!subtitleUrl?.startsWith("/")) {
    return;
  }

  const localFilePath = join(process.cwd(), "public", subtitleUrl.slice(1));
  if (existsSync(localFilePath)) {
    unlinkSync(localFilePath);
  }
}

function cleanupRemovedAudio(previousClips: NarrationDraftClip[], nextClips: NarrationDraftClip[]) {
  const nextAudioUrls = new Set(nextClips.map((clip) => clip.audioUrl).filter(Boolean));

  for (const clip of previousClips) {
    if (clip.audioUrl && !nextAudioUrls.has(clip.audioUrl)) {
      deleteLocalAudioFile(clip.audioUrl);
    }
  }
}

export function listNarrationResults() {
  return readStore().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getNarrationResult(resultId: string) {
  return readStore().find((item) => item.resultId === resultId) ?? null;
}

export function createNarrationResult(input: {
  resultId?: string;
  taskId?: string | null;
  compositionId?: string | null;
  compositionTitle?: string | null;
  voiceId?: string | null;
  draft: NarrationDraft;
}) {
  const createdAt = new Date().toISOString();
  const record: NarrationResultRecord = {
    resultId: input.resultId ?? crypto.randomUUID(),
    taskId: input.taskId ?? null,
    title: input.draft.title,
    sourcePrompt: input.draft.sourcePrompt,
    totalDurationSeconds: input.draft.totalDurationSeconds,
    strategySummary: input.draft.strategySummary,
    compositionId: input.compositionId ?? null,
    compositionTitle: input.compositionTitle ?? null,
    voiceId: input.voiceId ?? null,
    subtitleSrtUrl: null,
    mergedAudioUrl: null,
    clips: normalizeNarrationClips(input.draft.clips),
    createdAt,
    updatedAt: createdAt,
  };
  const subtitleCues = buildSubtitleCuesFromNarrationClips(record.clips);
  const subtitleFile = writeSrtSubtitleFile(record.resultId, buildSrtFromSubtitleCues(subtitleCues), record.taskId);
  record.subtitleSrtUrl = subtitleFile.publicUrl;

  ensureStore();
  dbUpsert(COLLECTION, record.resultId, record);
  return record;
}

export async function patchNarrationResult(resultId: string, updates: Partial<NarrationResultRecord>) {
  ensureStore();
  const current = readStore().find((item) => item.resultId === resultId);
  if (!current) return null;

  const next: NarrationResultRecord = {
    ...current,
    ...updates,
    clips: updates.clips ? normalizeNarrationClips(updates.clips) : current.clips,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  if (updates.clips) {
    cleanupRemovedAudio(current.clips, next.clips);
  }

  const subtitleCues = buildSubtitleCuesFromNarrationClips(next.clips);
  const subtitleFile = writeSrtSubtitleFile(next.resultId, buildSrtFromSubtitleCues(subtitleCues), next.taskId);
  next.subtitleSrtUrl = subtitleFile.publicUrl;
  deleteMergedNarrationAudio(current.mergedAudioUrl);
  next.mergedAudioUrl = (await buildMergedNarrationAudio(next.resultId, next.clips, next.taskId))?.publicUrl ?? null;

  dbUpsert(COLLECTION, resultId, next);
  return next;
}

export function deleteNarrationResult(resultId: string) {
  ensureStore();
  const current = readStore().find((item) => item.resultId === resultId);
  if (!current) return null;

  for (const clip of current.clips) {
    deleteLocalAudioFile(clip.audioUrl);
  }
  deleteLocalSubtitleFile(current.subtitleSrtUrl);
  deleteMergedNarrationAudio(current.mergedAudioUrl);
  dbDelete(COLLECTION, resultId);
  return current;
}
