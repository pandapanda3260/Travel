import { join } from "node:path";

import { dbGet, dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { importLegacyVideoTasksIfNeeded } from "./legacy-local-data-import";
import { joinRuntimeDataPath } from "./runtime-storage";
import {
  audioFormatOptions,
  audioLoudnessRateOptions,
  audioSampleRateOptions,
  audioSpeechRateOptions,
  getDefaultTaskCreationParameterState,
  getTaskCreationExpectedDurationDefaults,
  inferTaskCreationExpectedDurationRange,
  normalizeCompositionBackgroundMusicVolume,
} from "./task-creation-parameters";
import { hydrateSubtitleConfig } from "./subtitle-style-config";
import { normalizeNullableMediaSourceInput } from "./media-source-input";
import { buildDirectorPlanFromTaskData, buildShotPlanFromDirectorPlan } from "./video-task-director";
import {
  computeVideoTaskStoryShotCount,
  deriveVideoTaskTitle,
  getDefaultTaskConstraints,
  getVideoTaskTypeProfile,
  normalizeVideoTaskStatus,
  normalizeVideoTaskSource,
  type ShotPlan,
  type VideoTaskDirectorPlan,
  type VideoTaskDraftBundle,
  type VideoTaskRecord,
  type VideoTaskSource,
} from "./video-task-schema";

const COLLECTION = "video-tasks";
const legacyJsonPath = joinRuntimeDataPath("video-tasks.json");

let migrated = false;
function ensureStore() {
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => (item as VideoTaskRecord).taskId);
    importLegacyVideoTasksIfNeeded();
    migrated = true;
  }
}

function readStore() {
  ensureStore();

  try {
    return dbGetAll<Partial<VideoTaskRecord>>(COLLECTION).map((record) => normalizeVideoTaskRecord(record));
  } catch {
    return [] as VideoTaskRecord[];
  }
}

function writeStore(records: VideoTaskRecord[]) {
  ensureStore();
  dbReplaceAll(
    COLLECTION,
    records.map((r) => ({ key: r.taskId, data: r })),
  );
}

export function listVideoTasks() {
  return readStore().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function listAccessibleVideoTasks(userId: string) {
  return listVideoTasks().filter((item) => item.ownerUserId === null || item.ownerUserId === userId);
}

export function countOwnedVideoTasksCreatedToday(userId: string, nowAt = new Date().toISOString()) {
  const source = new Date(nowAt);
  const start = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate())).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();

  return listVideoTasks().filter(
    (item) => item.ownerUserId === userId && item.createdAt >= start && item.createdAt < end,
  ).length;
}

export function getVideoTask(taskId: string) {
  ensureStore();

  try {
    const record = dbGet<Partial<VideoTaskRecord>>(COLLECTION, taskId);
    return record ? normalizeVideoTaskRecord(record) : null;
  } catch {
    return null;
  }
}

export function createVideoTask(input: {
  ownerUserId?: string | null;
  title?: string;
  source: VideoTaskSource;
  draftBundle: VideoTaskDraftBundle;
  shotPlan?: ShotPlan | null;
  directorPlan?: VideoTaskDirectorPlan | null;
  parameters: VideoTaskRecord["parameters"];
}) {
  const records = readStore();
  const timestamp = new Date().toISOString();
  const record: VideoTaskRecord = {
    taskId: crypto.randomUUID(),
    ownerUserId: input.ownerUserId ?? null,
    title: input.title?.trim() || deriveVideoTaskTitle(input.source),
    status: "CREATED",
    source: input.source,
    draftBundle: input.draftBundle,
    shotPlan: input.shotPlan ?? null,
    directorPlan: input.directorPlan ?? null,
    parameters: input.parameters,
    createdAt: timestamp,
    updatedAt: timestamp,
    stageTimestamps: {
      CREATED: timestamp,
    },
  };

  ensureStore();
  dbUpsert(COLLECTION, record.taskId, record);
  return record;
}

export function patchVideoTask(
  taskId: string,
  updates: Partial<Pick<VideoTaskRecord, "title" | "status" | "stageTimestamps" | "shotPlan" | "directorPlan">> & {
    source?: Partial<VideoTaskRecord["source"]>;
    draftBundle?: Partial<VideoTaskDraftBundle>;
    parameters?: Partial<VideoTaskRecord["parameters"]> & {
      image?: Partial<VideoTaskRecord["parameters"]["image"]>;
      video?: Partial<VideoTaskRecord["parameters"]["video"]>;
      audio?: Partial<VideoTaskRecord["parameters"]["audio"]>;
      composition?: Partial<VideoTaskRecord["parameters"]["composition"]>;
      constraints?: Partial<VideoTaskRecord["parameters"]["constraints"]>;
    };
  },
) {
  const currentRecord = getVideoTask(taskId);
  if (!currentRecord) {
    return null;
  }

  const nextStatus = updates.status ?? currentRecord.status;
  const nextStageTimestamps = {
    ...currentRecord.stageTimestamps,
    ...updates.stageTimestamps,
  };

  if (nextStatus !== currentRecord.status && !nextStageTimestamps[nextStatus]) {
    nextStageTimestamps[nextStatus] = new Date().toISOString();
  }

  const nextSource = {
    ...currentRecord.source,
    ...updates.source,
  };

  const nextDraftBundle = {
    ...currentRecord.draftBundle,
    ...updates.draftBundle,
  };

  const nextParameters = {
    ...currentRecord.parameters,
    ...updates.parameters,
    image: {
      ...currentRecord.parameters.image,
      ...updates.parameters?.image,
    },
    video: {
      ...currentRecord.parameters.video,
      ...updates.parameters?.video,
    },
    audio: {
      ...currentRecord.parameters.audio,
      ...updates.parameters?.audio,
    },
    composition: {
      ...currentRecord.parameters.composition,
      ...updates.parameters?.composition,
    },
    constraints: {
      ...currentRecord.parameters.constraints,
      ...updates.parameters?.constraints,
    },
  };
  const nextDirectorPlan =
    updates.directorPlan ??
    buildDirectorPlanFromTaskData({
      draftBundle: nextDraftBundle,
      shotPlan: updates.shotPlan ?? currentRecord.shotPlan,
      directorPlan: currentRecord.directorPlan,
      parameters: nextParameters,
      forceRebuild: Boolean(updates.draftBundle || updates.parameters || updates.shotPlan),
    });
  const nextShotPlan = updates.shotPlan ?? buildShotPlanFromDirectorPlan(nextDirectorPlan, currentRecord.shotPlan);

  const nextRecord: VideoTaskRecord = {
    ...currentRecord,
    ...updates,
    title: updates.title ?? currentRecord.title ?? deriveVideoTaskTitle(nextSource),
    status: nextStatus,
    source: nextSource,
    draftBundle: nextDraftBundle,
    shotPlan: nextShotPlan,
    directorPlan: nextDirectorPlan,
    parameters: nextParameters,
    stageTimestamps: nextStageTimestamps,
    updatedAt: new Date().toISOString(),
  };

  ensureStore();
  dbUpsert(COLLECTION, taskId, nextRecord);
  return nextRecord;
}

export function deleteVideoTask(taskId: string) {
  const deletedRecord = getVideoTask(taskId);
  if (!deletedRecord) {
    return null;
  }

  ensureStore();
  dbDelete(COLLECTION, taskId);
  return deletedRecord;
}

export function resetVideoTaskStore() {
  ensureStore();
  dbReplaceAll(COLLECTION, []);
}

function normalizeVideoTaskRecord(record: Partial<VideoTaskRecord>): VideoTaskRecord {
  const defaults = getDefaultTaskCreationParameterState();
  const source = normalizeVideoTaskSource(record.source);
  const rawVideoType = record.parameters?.video?.videoType ?? defaults.videoType;
  const profile = getVideoTaskTypeProfile(rawVideoType);
  const fallbackExpectedDurationRange =
    record.parameters?.video?.expectedDurationRange ?? defaults.videoExpectedDurationRange;
  const durationDefaults = getTaskCreationExpectedDurationDefaults(fallbackExpectedDurationRange, rawVideoType);
  const segmentCount = record.parameters?.video?.segmentCount ?? durationDefaults.videoSegmentCount;
  const durationSeconds = record.parameters?.video?.durationSeconds ?? durationDefaults.videoDurationSeconds;
  const storyShotsPerSegment = record.parameters?.video?.storyShotsPerSegment ?? profile.recommendedShotsPerSegment;
  const storyShotCount =
    record.parameters?.video?.storyShotCount ??
    computeVideoTaskStoryShotCount({
      videoType: rawVideoType,
      segmentCount,
      storyShotsPerSegment,
    });
  const expectedDurationRange =
    record.parameters?.video?.expectedDurationRange ??
    inferTaskCreationExpectedDurationRange({
      videoType: rawVideoType,
      videoSegmentCount: segmentCount,
      videoDurationSeconds: durationSeconds,
    });

  const parameters: VideoTaskRecord["parameters"] = {
    image: {
      size: record.parameters?.image?.size ?? defaults.imageSize,
      guidanceScale: record.parameters?.image?.guidanceScale ?? defaults.imageGuidanceScale,
      watermark: record.parameters?.image?.watermark ?? defaults.imageWatermark,
      seed: record.parameters?.image?.seed ?? null,
    },
    video: {
      videoType: rawVideoType,
      segmentMode: record.parameters?.video?.segmentMode ?? profile.defaultSegmentMode,
      expectedDurationRange,
      storyShotCount,
      storyShotsPerSegment,
      introSegmentDurationSeconds:
        record.parameters?.video?.introSegmentDurationSeconds ?? profile.introSegmentDurationSeconds ?? null,
      mode: record.parameters?.video?.mode ?? defaults.videoMode,
      multiShot: record.parameters?.video?.multiShot ?? defaults.videoMultiShot,
      shotType: record.parameters?.video?.shotType ?? defaults.videoShotType,
      enableTailFrame: record.parameters?.video?.enableTailFrame ?? defaults.videoEnableTailFrame,
      segmentCount,
      durationSeconds,
      aspectRatio: record.parameters?.video?.aspectRatio ?? defaults.videoAspectRatio,
      cfgScale: record.parameters?.video?.cfgScale ?? defaults.videoCfgScale,
      cameraControl: record.parameters?.video?.cameraControl ?? defaults.videoCameraControl,
      generateAudio: record.parameters?.video?.generateAudio ?? defaults.videoGenerateAudio,
      watermark: record.parameters?.video?.watermark ?? defaults.videoWatermark,
      negativePrompt: record.parameters?.video?.negativePrompt ?? defaults.videoNegativePrompt,
    },
    audio: {
      voiceId: record.parameters?.audio?.voiceId ?? defaults.audioVoiceId,
      storyboardEnabled: record.parameters?.audio?.storyboardEnabled ?? defaults.audioStoryboardEnabled,
      storyboardVoiceIds: record.parameters?.audio?.storyboardVoiceIds ?? defaults.audioStoryboardVoiceIds,
      format: audioFormatOptions.some((item) => item.value === record.parameters?.audio?.format)
        ? record.parameters!.audio!.format
        : defaults.audioFormat,
      sampleRate: audioSampleRateOptions.some((item) => item.value === record.parameters?.audio?.sampleRate)
        ? record.parameters!.audio!.sampleRate
        : defaults.audioSampleRate,
      speechRate: audioSpeechRateOptions.some((item) => item.value === record.parameters?.audio?.speechRate)
        ? record.parameters!.audio!.speechRate
        : defaults.audioSpeechRate,
      loudnessRate: audioLoudnessRateOptions.some((item) => item.value === record.parameters?.audio?.loudnessRate)
        ? record.parameters!.audio!.loudnessRate
        : defaults.audioLoudnessRate,
      enableSubtitle:
        typeof record.parameters?.audio?.enableSubtitle === "boolean"
          ? record.parameters.audio.enableSubtitle
          : defaults.audioEnableSubtitle,
    },
    composition: {
      includeBackgroundMusic:
        typeof record.parameters?.composition?.includeBackgroundMusic === "boolean"
          ? record.parameters.composition.includeBackgroundMusic
          : defaults.compositionIncludeBackgroundMusic,
      backgroundMusicUrl:
        typeof record.parameters?.composition?.backgroundMusicUrl === "string"
          ? normalizeNullableMediaSourceInput(record.parameters.composition.backgroundMusicUrl)
          : null,
      backgroundMusicVolume: normalizeCompositionBackgroundMusicVolume(
        record.parameters?.composition?.backgroundMusicVolume,
      ),
      subtitleConfig: hydrateSubtitleConfig(
        record.parameters?.composition?.subtitleConfig,
        defaults.compositionSubtitleConfig,
      ),
    },
    constraints: {
      ...getDefaultTaskConstraints(),
      ...(((record.parameters as Record<string, unknown>)?.constraints as Record<string, unknown>) ?? {}),
    },
  };
  const draftBundle = {
    textToImagePrompt: record.draftBundle?.textToImagePrompt ?? "",
    imageToVideoPrompt: record.draftBundle?.imageToVideoPrompt ?? "",
    narrationScript: record.draftBundle?.narrationScript ?? "",
  };
  const shotPlan = ((record as Record<string, unknown>).shotPlan as ShotPlan | null) ?? null;
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan,
    directorPlan: ((record as Record<string, unknown>).directorPlan as VideoTaskDirectorPlan | null) ?? null,
    parameters,
  });

  return {
    taskId: record.taskId ?? crypto.randomUUID(),
    ownerUserId: record.ownerUserId ?? null,
    title: record.title ?? deriveVideoTaskTitle(source),
    status: normalizeVideoTaskStatus(record.status),
    source,
    draftBundle,
    shotPlan: shotPlan ?? buildShotPlanFromDirectorPlan(directorPlan),
    directorPlan,
    parameters,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
    stageTimestamps: {
      CREATED: record.stageTimestamps?.CREATED ?? record.createdAt ?? new Date().toISOString(),
      SUBTITLE_AUDIO_READY: record.stageTimestamps?.SUBTITLE_AUDIO_READY,
      IMAGES_READY: record.stageTimestamps?.IMAGES_READY,
      CLIPS_READY: record.stageTimestamps?.CLIPS_READY,
      COMPOSITION_READY: record.stageTimestamps?.COMPOSITION_READY,
    },
  } satisfies VideoTaskRecord;
}
