import { countNarrationCharacters } from "./narration";
import { buildIndexedBlockText } from "./indexed-text-blocks";
import {
  buildDirectorPlanFromTaskData,
  buildShotPlanFromDirectorPlan,
  getTaskDirectorPlan,
} from "./video-task-director";
import { buildNarrationScriptFromSubtitlePlan, normalizeSubtitlePlanSource } from "./subtitle-plan-source";
import type {
  DirectorRenderSegment,
  DirectorStoryShot,
  SegmentSubtitlePlan,
  ShotPlan,
  ShotPlanItem,
  VideoTaskDraftBundle,
  VideoTaskRecord,
} from "./video-task-schema";

const MAX_EDIT_TEXT_LENGTH = 12_000;
const MIN_SHOT_DURATION_SECONDS = 0.8;
const MAX_SHOT_DURATION_SECONDS = 60;

export type ShotPlanEditorShot = {
  shotId: string;
  shotIndex: number;
  sourceShotIndex?: number;
  segmentId: string;
  segmentIndex: number;
  purpose: string;
  location: string;
  sceneDescription: string;
  action: string;
  emotion: string;
  cameraMovement: string;
  durationSeconds: number;
  startAtSeconds: number;
  endAtSeconds: number;
  hasVoice: boolean;
  hasSubtitle: boolean;
  requiresLipSync: boolean;
  assetId?: string | null;
  assetSubjectSummary?: string | null;
  referenceImageUrl?: string | null;
  sourceTrace?: ShotPlanItem["sourceTrace"];
  generationMode?: ShotPlanItem["generationMode"];
  needsAiFallback?: boolean;
  fallbackReason?: string | null;
  backupAssetIds?: string[];
  imagePrompt: string;
  videoPrompt: string;
  narrationHint: string;
};

export type ShotPlanEditorSegment = {
  segmentId: string;
  segmentIndex: number;
  title: string;
  durationSeconds: number;
  narrationText: string;
  shots: ShotPlanEditorShot[];
};

export type ShotPlanEditorState = {
  totalDurationSeconds: number;
  segments: ShotPlanEditorSegment[];
};

export type ShotPlanEditorShotInput = Partial<
  Pick<
    ShotPlanEditorShot,
    | "sourceShotIndex"
    | "purpose"
    | "location"
    | "sceneDescription"
    | "action"
    | "emotion"
    | "cameraMovement"
    | "durationSeconds"
    | "hasVoice"
    | "hasSubtitle"
    | "requiresLipSync"
    | "imagePrompt"
    | "videoPrompt"
    | "narrationHint"
  >
> & {
  shotIndex: number;
};

export type ShotPlanEditorSegmentInput = {
  segmentId?: string;
  segmentIndex: number;
  narrationText?: string;
  shots?: ShotPlanEditorShotInput[];
};

export type ShotPlanEditorSavePayload = {
  segments?: ShotPlanEditorSegmentInput[];
};

export type AppliedShotPlanEditorSave = {
  shotPlan: ShotPlan;
  draftBundle: VideoTaskDraftBundle;
  directorPlan: VideoTaskRecord["directorPlan"];
};

function normalizeSingleLineText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EDIT_TEXT_LENGTH);
}

function normalizeLongText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_EDIT_TEXT_LENGTH);
}

function normalizeDurationSeconds(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(Math.min(MAX_SHOT_DURATION_SECONDS, Math.max(MIN_SHOT_DURATION_SECONDS, numeric)).toFixed(2));
}

function getSegmentKey(segmentIndex: number, segmentId?: string | null) {
  return `${segmentIndex}:${segmentId?.trim() || `segment-${segmentIndex}`}`;
}

function findSegmentByShot(segments: DirectorRenderSegment[], shotIndex: number) {
  return segments.find((segment) => segment.shotIndexes.includes(shotIndex)) ?? null;
}

function buildStoryShotMap(storyShots: DirectorStoryShot[]) {
  return new Map(storyShots.map((shot) => [shot.shotIndex, shot]));
}

function buildSegmentMap(segments: DirectorRenderSegment[]) {
  return new Map(segments.map((segment) => [getSegmentKey(segment.segmentIndex, segment.segmentId), segment]));
}

function buildFallbackShotPlan(
  task: Pick<VideoTaskRecord, "draftBundle" | "shotPlan" | "directorPlan" | "parameters">,
) {
  const directorPlan = getTaskDirectorPlan(task);
  return {
    directorPlan,
    shotPlan: task.shotPlan ?? buildShotPlanFromDirectorPlan(directorPlan),
  };
}

function groupShotPlanItemsBySegment(shots: ShotPlanItem[]) {
  const grouped = new Map<
    string,
    {
      segmentId: string;
      segmentIndex: number;
      shots: ShotPlanItem[];
    }
  >();

  for (const shot of [...shots].sort((left, right) => left.shotIndex - right.shotIndex)) {
    const segmentIndex = shot.segmentIndex ?? shot.shotIndex;
    const segmentId = shot.segmentId?.trim() || `segment-${segmentIndex}`;
    const key = getSegmentKey(segmentIndex, segmentId);
    const current = grouped.get(key);
    if (current) {
      current.shots.push(shot);
      continue;
    }
    grouped.set(key, {
      segmentId,
      segmentIndex,
      shots: [shot],
    });
  }

  return Array.from(grouped.values()).sort((left, right) => left.segmentIndex - right.segmentIndex);
}

function buildSubtitlePlanForSegments(input: {
  shotPlan: ShotPlan;
  currentDirectorPlan: NonNullable<VideoTaskRecord["directorPlan"]>;
  segmentInputs: Map<string, ShotPlanEditorSegmentInput>;
}) {
  const normalizedBase = normalizeSubtitlePlanSource(input.shotPlan, input.currentDirectorPlan.videoType);
  const existingSubtitleMap = new Map(
    (normalizedBase.subtitlePlan ?? []).map((segment) => [
      getSegmentKey(segment.segmentIndex, segment.segmentId),
      segment,
    ]),
  );
  const currentSegmentMap = buildSegmentMap(input.currentDirectorPlan.renderSegments);
  const nextSubtitlePlan: SegmentSubtitlePlan[] = [];
  let cursor = 0;

  for (const group of groupShotPlanItemsBySegment(input.shotPlan.shots)) {
    const key = getSegmentKey(group.segmentIndex, group.segmentId);
    const existingSegment = existingSubtitleMap.get(key);
    const currentSegment = currentSegmentMap.get(key);
    const segmentInput = input.segmentInputs.get(key);
    const durationSeconds = Number(
      group.shots.reduce((sum, shot) => sum + Math.max(0, shot.durationSeconds || 0), 0).toFixed(2),
    );
    const existingText = existingSegment?.subtitles
      .map((subtitle) => normalizeLongText(subtitle.text))
      .filter(Boolean)
      .join("，");
    const fallbackText =
      currentSegment?.narrationText ||
      currentSegment?.subtitleText ||
      group.shots
        .map((shot) => normalizeLongText(shot.narrationHint))
        .filter(Boolean)
        .join("，");
    const text =
      segmentInput?.narrationText !== undefined
        ? normalizeLongText(segmentInput.narrationText)
        : existingText || fallbackText;

    nextSubtitlePlan.push({
      segmentId: group.segmentId,
      segmentIndex: group.segmentIndex,
      subtitles: text
        ? [
            {
              text,
              startAtSeconds: cursor,
              durationSeconds,
              charCount: countNarrationCharacters(text),
              coveredShotIndexes: group.shots.map((shot) => shot.shotIndex),
            },
          ]
        : [],
    });
    cursor = Number((cursor + durationSeconds).toFixed(2));
  }

  return nextSubtitlePlan;
}

function buildDraftBundleFromEditedShotPlan(input: {
  shotPlan: ShotPlan;
  currentDirectorPlan: NonNullable<VideoTaskRecord["directorPlan"]>;
}) {
  const storyShotMap = buildStoryShotMap(input.currentDirectorPlan.storyShots);
  const promptBlocks = input.shotPlan.shots
    .slice()
    .sort((left, right) => left.shotIndex - right.shotIndex)
    .map((shot) => {
      const currentShot = storyShotMap.get(shot.shotIndex);
      return {
        shot,
        imagePrompt:
          normalizeLongText(shot.img2imgPrompt) ||
          normalizeLongText(currentShot?.imagePrompt) ||
          normalizeLongText(shot.sceneDescription),
        videoPrompt:
          normalizeLongText(shot.i2vPrompt) ||
          normalizeLongText(currentShot?.videoPrompt) ||
          normalizeLongText(shot.sceneDescription || shot.action),
      };
    });

  return {
    textToImagePrompt: buildIndexedBlockText(
      "镜头",
      promptBlocks.map((block) => ({
        index: block.shot.shotIndex,
        text: block.imagePrompt,
      })),
    ),
    imageToVideoPrompt: buildIndexedBlockText(
      "镜头",
      promptBlocks.map((block) => ({
        index: block.shot.shotIndex,
        text: block.videoPrompt,
      })),
    ),
    narrationScript: buildNarrationScriptFromSubtitlePlan(input.shotPlan, input.currentDirectorPlan.videoType),
  } satisfies VideoTaskDraftBundle;
}

export function buildShotPlanEditorState(
  task: Pick<VideoTaskRecord, "draftBundle" | "shotPlan" | "directorPlan" | "parameters">,
): ShotPlanEditorState {
  const directorPlan = getTaskDirectorPlan(task);
  const timingByShotIndex = new Map<number, { startAtSeconds: number; endAtSeconds: number }>();
  let cursor = 0;

  for (const shot of [...directorPlan.storyShots].sort((left, right) => left.shotIndex - right.shotIndex)) {
    const durationSeconds = Math.max(0, shot.durationSeconds || 0);
    const startAtSeconds = Number.isFinite(shot.startAtSeconds) ? Number(shot.startAtSeconds) : cursor;
    const endAtSeconds = Number.isFinite(shot.endAtSeconds)
      ? Number(shot.endAtSeconds)
      : startAtSeconds + durationSeconds;
    timingByShotIndex.set(shot.shotIndex, {
      startAtSeconds,
      endAtSeconds,
    });
    cursor = endAtSeconds;
  }

  return {
    totalDurationSeconds: directorPlan.totalDurationSeconds,
    segments: [...directorPlan.renderSegments]
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .map((segment) => ({
        segmentId: segment.segmentId,
        segmentIndex: segment.segmentIndex,
        title: segment.title || `片段 ${segment.segmentIndex}`,
        durationSeconds: segment.durationSeconds,
        narrationText: segment.narrationText || segment.subtitleText || "",
        shots: directorPlan.storyShots
          .filter((shot) => segment.shotIndexes.includes(shot.shotIndex))
          .sort((left, right) => left.shotIndex - right.shotIndex)
          .map((shot) => {
            const timing = timingByShotIndex.get(shot.shotIndex);
            return {
              shotId: shot.shotId,
              shotIndex: shot.shotIndex,
              sourceShotIndex: shot.shotIndex,
              segmentId: shot.segmentId,
              segmentIndex: shot.segmentIndex,
              purpose: shot.purpose,
              location: shot.location,
              sceneDescription: shot.sceneDescription,
              action: shot.action,
              emotion: shot.emotion,
              cameraMovement: shot.cameraMovement,
              durationSeconds: shot.durationSeconds,
              startAtSeconds: timing?.startAtSeconds ?? 0,
              endAtSeconds: timing?.endAtSeconds ?? shot.durationSeconds,
              hasVoice: shot.hasVoice,
              hasSubtitle: shot.hasSubtitle,
              requiresLipSync: shot.requiresLipSync,
              assetId: shot.assetId ?? null,
              assetSubjectSummary: shot.assetSubjectSummary ?? null,
              referenceImageUrl: shot.referenceImageUrl ?? null,
              sourceTrace: shot.sourceTrace ?? null,
              generationMode: shot.generationMode,
              needsAiFallback: shot.needsAiFallback ?? false,
              fallbackReason: shot.fallbackReason ?? null,
              backupAssetIds: shot.backupAssetIds ?? [],
              imagePrompt: shot.imagePrompt,
              videoPrompt: shot.videoPrompt,
              narrationHint: shot.narrationHint,
            } satisfies ShotPlanEditorShot;
          }),
      })),
  };
}

function reindexStoryboardPlan(
  storyboard: ShotPlan["storyboard"],
  shotIndexMap: Map<number, number>,
  segmentIndexMap: Map<number, number | null>,
): ShotPlan["storyboard"] {
  if (!storyboard || shotIndexMap.size === 0) {
    return storyboard;
  }

  const mapIndexes = (indexes: number[]) =>
    indexes
      .map((index) => shotIndexMap.get(index) ?? index)
      .filter((index) => Number.isFinite(index) && index > 0)
      .sort((left, right) => left - right);

  return {
    ...storyboard,
    beats: storyboard.beats.map((beat) => ({
      ...beat,
      targetShotIndexes: mapIndexes(beat.targetShotIndexes),
    })),
    materialIntents: storyboard.materialIntents.map((asset) => ({
      ...asset,
      mappedShotIndexes: mapIndexes(asset.mappedShotIndexes),
    })),
    shotBindings: storyboard.shotBindings
      .map((binding) => {
        const nextShotIndex = shotIndexMap.get(binding.shotIndex) ?? binding.shotIndex;
        return {
          ...binding,
          shotIndex: nextShotIndex,
          segmentIndex: segmentIndexMap.get(binding.shotIndex) ?? binding.segmentIndex,
        };
      })
      .sort((left, right) => left.shotIndex - right.shotIndex),
  };
}

export function applyShotPlanEditorSave(
  task: Pick<VideoTaskRecord, "draftBundle" | "shotPlan" | "directorPlan" | "parameters">,
  payload: ShotPlanEditorSavePayload,
): AppliedShotPlanEditorSave {
  const { directorPlan: currentDirectorPlan, shotPlan: currentShotPlan } = buildFallbackShotPlan(task);
  const currentStoryShotMap = buildStoryShotMap(currentDirectorPlan.storyShots);
  const shotInputs = new Map<number, ShotPlanEditorShotInput>();
  const orderedShotInputs: Array<{
    input: ShotPlanEditorShotInput;
    sourceShotIndex: number;
    segmentId: string;
    segmentIndex: number;
  }> = [];
  const segmentInputs = new Map<string, ShotPlanEditorSegmentInput>();

  for (const segment of payload.segments ?? []) {
    const segmentIndex = Number(segment.segmentIndex);
    if (!Number.isFinite(segmentIndex) || segmentIndex <= 0) {
      throw new Error("片段编号不合法");
    }
    const segmentId = segment.segmentId?.trim() || `segment-${segmentIndex}`;
    segmentInputs.set(getSegmentKey(segmentIndex, segmentId), segment);
    for (const shot of segment.shots ?? []) {
      const shotIndex = Number(shot.shotIndex);
      if (!Number.isFinite(shotIndex) || shotIndex <= 0) {
        throw new Error("镜头编号不合法");
      }
      const sourceShotIndex = Number(shot.sourceShotIndex ?? shot.shotIndex);
      if (!Number.isFinite(sourceShotIndex) || sourceShotIndex <= 0) {
        throw new Error("原始镜头编号不合法");
      }
      const normalizedInput = {
        ...shot,
        shotIndex,
        sourceShotIndex,
      };
      shotInputs.set(sourceShotIndex, normalizedInput);
      orderedShotInputs.push({
        input: normalizedInput,
        sourceShotIndex,
        segmentId,
        segmentIndex,
      });
    }
  }

  if (shotInputs.size === 0 && segmentInputs.size === 0) {
    throw new Error("没有可保存的镜头计划内容");
  }

  const currentShotPlanMap = new Map(currentShotPlan.shots.map((shot) => [shot.shotIndex, shot]));
  const shotIndexMap = new Map<number, number>();
  const segmentIndexMap = new Map<number, number | null>();
  const buildEditedShot = (
    shot: ShotPlanItem,
    input: ShotPlanEditorShotInput | undefined,
    nextIdentity?: {
      shotIndex: number;
      segmentId: string;
      segmentIndex: number;
    },
  ) => {
    const sourceShotIndex = input?.sourceShotIndex ?? shot.shotIndex;
    const currentShot = currentStoryShotMap.get(sourceShotIndex);
    if (!input) {
      if (!nextIdentity) {
        return shot;
      }
      return {
        ...shot,
        shotId: `shot-${nextIdentity.shotIndex}`,
        shotIndex: nextIdentity.shotIndex,
        segmentId: nextIdentity.segmentId,
        segmentIndex: nextIdentity.segmentIndex,
      } satisfies ShotPlanItem;
    }

    const imagePrompt =
      input.imagePrompt !== undefined
        ? normalizeLongText(input.imagePrompt)
        : normalizeLongText(shot.img2imgPrompt) || normalizeLongText(currentShot?.imagePrompt);
    const videoPrompt =
      input.videoPrompt !== undefined
        ? normalizeLongText(input.videoPrompt)
        : normalizeLongText(shot.i2vPrompt) || normalizeLongText(currentShot?.videoPrompt);

    return {
      ...shot,
      shotId: nextIdentity ? `shot-${nextIdentity.shotIndex}` : shot.shotId,
      shotIndex: nextIdentity?.shotIndex ?? shot.shotIndex,
      segmentId: nextIdentity?.segmentId ?? shot.segmentId,
      segmentIndex: nextIdentity?.segmentIndex ?? shot.segmentIndex,
      purpose: input.purpose !== undefined ? normalizeSingleLineText(input.purpose) : shot.purpose,
      location: input.location !== undefined ? normalizeSingleLineText(input.location) : shot.location,
      sceneDescription:
        input.sceneDescription !== undefined ? normalizeLongText(input.sceneDescription) : shot.sceneDescription,
      action: input.action !== undefined ? normalizeSingleLineText(input.action) : shot.action,
      emotion: input.emotion !== undefined ? normalizeSingleLineText(input.emotion) : shot.emotion,
      cameraMovement:
        input.cameraMovement !== undefined ? normalizeSingleLineText(input.cameraMovement) : shot.cameraMovement,
      durationSeconds:
        input.durationSeconds !== undefined
          ? normalizeDurationSeconds(input.durationSeconds, shot.durationSeconds)
          : shot.durationSeconds,
      hasVoice: input.hasVoice !== undefined ? Boolean(input.hasVoice) : shot.hasVoice,
      hasSubtitle: input.hasSubtitle !== undefined ? Boolean(input.hasSubtitle) : shot.hasSubtitle,
      requiresLipSync: input.requiresLipSync !== undefined ? Boolean(input.requiresLipSync) : shot.requiresLipSync,
      narrationHint: input.narrationHint !== undefined ? normalizeLongText(input.narrationHint) : shot.narrationHint,
      img2imgPrompt: imagePrompt || null,
      i2vPrompt: videoPrompt || null,
    } satisfies ShotPlanItem;
  };
  const usedSourceShotIndexes = new Set<number>();
  let nextShotIndex = 1;
  const shouldApplyExplicitOrder = orderedShotInputs.length === currentShotPlan.shots.length;
  const orderedNextShots = shouldApplyExplicitOrder
    ? orderedShotInputs.map((entry) => {
        const sourceShot = currentShotPlanMap.get(entry.sourceShotIndex);
        if (!sourceShot) {
          throw new Error(`镜头 ${entry.sourceShotIndex} 不存在，无法调整顺序`);
        }
        usedSourceShotIndexes.add(entry.sourceShotIndex);
        const identity = {
          shotIndex: nextShotIndex,
          segmentId: entry.segmentId,
          segmentIndex: entry.segmentIndex,
        };
        shotIndexMap.set(entry.sourceShotIndex, nextShotIndex);
        segmentIndexMap.set(entry.sourceShotIndex, entry.segmentIndex);
        nextShotIndex += 1;
        return buildEditedShot(sourceShot, entry.input, identity);
      })
    : [];
  const omittedShots = currentShotPlan.shots
    .slice()
    .sort((left, right) => left.shotIndex - right.shotIndex)
    .filter((shot) => !usedSourceShotIndexes.has(shot.shotIndex))
    .map((shot) => {
      const identity = {
        shotIndex: nextShotIndex,
        segmentId: shot.segmentId?.trim() || `segment-${shot.segmentIndex ?? nextShotIndex}`,
        segmentIndex: shot.segmentIndex ?? nextShotIndex,
      };
      shotIndexMap.set(shot.shotIndex, nextShotIndex);
      segmentIndexMap.set(shot.shotIndex, identity.segmentIndex);
      nextShotIndex += 1;
      return buildEditedShot(shot, shotInputs.get(shot.shotIndex), identity);
    });
  const nextShots =
    shouldApplyExplicitOrder
      ? [...orderedNextShots, ...omittedShots]
      : currentShotPlan.shots
          .slice()
          .sort((left, right) => left.shotIndex - right.shotIndex)
          .map((shot) => buildEditedShot(shot, shotInputs.get(shot.shotIndex)));

  const nextShotPlanBase: ShotPlan = {
    ...currentShotPlan,
    shots: nextShots,
    storyboard: reindexStoryboardPlan(currentShotPlan.storyboard, shotIndexMap, segmentIndexMap),
    totalDurationSeconds: Number(
      nextShots.reduce((sum, shot) => sum + Math.max(0, shot.durationSeconds || 0), 0).toFixed(2),
    ),
  };
  const nextShotPlan: ShotPlan = {
    ...nextShotPlanBase,
    subtitlePlan: buildSubtitlePlanForSegments({
      shotPlan: nextShotPlanBase,
      currentDirectorPlan,
      segmentInputs,
    }),
  };
  const draftBundle = buildDraftBundleFromEditedShotPlan({
    shotPlan: nextShotPlan,
    currentDirectorPlan,
  });
  const directorPlan = buildDirectorPlanFromTaskData({
    draftBundle,
    shotPlan: nextShotPlan,
    directorPlan: currentDirectorPlan,
    parameters: task.parameters,
    forceRebuild: true,
  });

  return {
    shotPlan: nextShotPlan,
    draftBundle,
    directorPlan,
  };
}
