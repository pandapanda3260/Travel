import { join } from "node:path";

import { dbGetAll, dbUpsert, dbDelete, dbReplaceAll, migrateJsonArrayIfNeeded } from "./db";
import { importLegacyVideoTasksIfNeeded } from "./legacy-local-data-import";
import { joinRuntimeDataPath } from "./runtime-storage";
import {
  audioFormatOptions,
  audioLoudnessRateOptions,
  audioSampleRateOptions,
  audioSpeechRateOptions,
  getDefaultTaskCreationParameterState,
  inferTaskCreationExpectedDurationRange,
} from "./task-creation-parameters";
import { buildDirectorPlanFromTaskData, buildShotPlanFromDirectorPlan } from "./video-task-director";
import {
  computeVideoTaskStoryShotCount,
  deriveVideoTaskTitle,
  getDefaultTaskConstraints,
  getVideoTaskTypeProfile,
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
  const defaults = getDefaultTaskCreationParameterState();

  try {
    return dbGetAll<Partial<VideoTaskRecord>>(COLLECTION).map((record) => {
      const source = normalizeVideoTaskSource(record.source);
      const rawVideoType = record.parameters?.video?.videoType ?? defaults.videoType;
      const profile = getVideoTaskTypeProfile(rawVideoType);
      const segmentCount = record.parameters?.video?.segmentCount ?? defaults.videoSegmentCount;
      const durationSeconds = record.parameters?.video?.durationSeconds ?? defaults.videoDurationSeconds;
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
        title: record.title ?? deriveVideoTaskTitle(source),
        status: record.status ?? "CREATED",
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
          VIDEO_BURN_READY: record.stageTimestamps?.VIDEO_BURN_READY,
        },
      } satisfies VideoTaskRecord;
    });
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

export function getVideoTask(taskId: string) {
  return readStore().find((record) => record.taskId === taskId) ?? null;
}

export function createVideoTask(input: {
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
      constraints?: Partial<VideoTaskRecord["parameters"]["constraints"]>;
    };
  },
) {
  const records = readStore();
  const index = records.findIndex((record) => record.taskId === taskId);

  if (index < 0) {
    return null;
  }

  const nextStatus = updates.status ?? records[index].status;
  const nextStageTimestamps = {
    ...records[index].stageTimestamps,
    ...updates.stageTimestamps,
  };

  if (nextStatus !== records[index].status && !nextStageTimestamps[nextStatus]) {
    nextStageTimestamps[nextStatus] = new Date().toISOString();
  }

  const nextSource = {
    ...records[index].source,
    ...updates.source,
  };

  const nextDraftBundle = {
    ...records[index].draftBundle,
    ...updates.draftBundle,
  };

  const nextParameters = {
    ...records[index].parameters,
    ...updates.parameters,
    image: {
      ...records[index].parameters.image,
      ...updates.parameters?.image,
    },
    video: {
      ...records[index].parameters.video,
      ...updates.parameters?.video,
    },
    audio: {
      ...records[index].parameters.audio,
      ...updates.parameters?.audio,
    },
    constraints: {
      ...records[index].parameters.constraints,
      ...updates.parameters?.constraints,
    },
  };
  const nextDirectorPlan =
    updates.directorPlan ??
    buildDirectorPlanFromTaskData({
      draftBundle: nextDraftBundle,
      shotPlan: updates.shotPlan ?? records[index].shotPlan,
      directorPlan: records[index].directorPlan,
      parameters: nextParameters,
      forceRebuild: Boolean(updates.draftBundle || updates.parameters || updates.shotPlan),
    });
  const nextShotPlan = updates.shotPlan ?? buildShotPlanFromDirectorPlan(nextDirectorPlan, records[index].shotPlan);

  const nextRecord: VideoTaskRecord = {
    ...records[index],
    ...updates,
    title: updates.title ?? records[index].title ?? deriveVideoTaskTitle(nextSource),
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
  const records = readStore();
  const index = records.findIndex((record) => record.taskId === taskId);

  if (index < 0) {
    return null;
  }

  const deletedRecord = records[index];
  ensureStore();
  dbDelete(COLLECTION, taskId);
  return deletedRecord;
}

export function resetVideoTaskStore() {
  ensureStore();
  dbReplaceAll(COLLECTION, []);
}
