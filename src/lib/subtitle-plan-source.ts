import type { NarrationDraftClip } from "./narration";
import { countNarrationCharacters, sanitizeNarrationText } from "./narration";
import { parseNarrationScriptLines } from "./narration-script";
import {
  getVideoTaskTypeProfile,
  type SegmentSubtitlePlan,
  type ShotPlan,
  type ShotPlanItem,
  type VideoTaskVideoType,
} from "./video-task-schema";

function getSegmentSortKey(segmentIndex: number, segmentId: string) {
  return `${String(segmentIndex).padStart(4, "0")}-${segmentId}`;
}

function getShotSegmentKey(shot: Pick<ShotPlanItem, "segmentIndex" | "segmentId" | "shotIndex">) {
  const segmentIndex = shot.segmentIndex ?? shot.shotIndex;
  const segmentId = shot.segmentId?.trim() || `segment-${segmentIndex}`;
  return {
    segmentIndex,
    segmentId,
    sortKey: getSegmentSortKey(segmentIndex, segmentId),
  };
}

function groupShotsBySegment(shots: ShotPlanItem[]) {
  const map = new Map<
    string,
    {
      segmentIndex: number;
      segmentId: string;
      shots: ShotPlanItem[];
    }
  >();

  for (const shot of [...shots].sort((left, right) => left.shotIndex - right.shotIndex)) {
    const key = getShotSegmentKey(shot);
    const current = map.get(key.sortKey);
    if (current) {
      current.shots.push(shot);
      continue;
    }
    map.set(key.sortKey, {
      segmentIndex: key.segmentIndex,
      segmentId: key.segmentId,
      shots: [shot],
    });
  }

  return Array.from(map.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function sanitizeSubtitleText(text: string | null | undefined) {
  return sanitizeNarrationText(String(text ?? ""), {
    stripLeadingDayPrefix: true,
  });
}

function buildFallbackSegmentText(shots: ShotPlanItem[]) {
  return shots
    .map((shot) => sanitizeSubtitleText(shot.narrationHint))
    .filter(Boolean)
    .join("，");
}

export function usesSegmentLevelSubtitleSource(videoType: VideoTaskVideoType) {
  const profile = getVideoTaskTypeProfile(videoType);
  return profile.hasVoice && !profile.requiresLipSync && profile.defaultSegmentMode === "multi_shot_montage";
}

export function normalizeSubtitlePlanSource(shotPlan: ShotPlan, videoType: VideoTaskVideoType): ShotPlan {
  if (!shotPlan.shots.length) {
    return shotPlan;
  }

  const segmentGroups = groupShotsBySegment(shotPlan.shots);
  const segmentPlanMap = new Map<string, SegmentSubtitlePlan>();
  for (const segment of shotPlan.subtitlePlan ?? []) {
    const segmentIndex = Number(segment.segmentIndex) || 0;
    const segmentId = String(segment.segmentId ?? "").trim() || `segment-${segmentIndex}`;
    segmentPlanMap.set(getSegmentSortKey(segmentIndex, segmentId), {
      segmentIndex,
      segmentId,
      subtitles: Array.isArray(segment.subtitles) ? segment.subtitles : [],
    });
  }

  const normalizedSubtitlePlan = segmentGroups.map((group) => {
    const segmentKey = getSegmentSortKey(group.segmentIndex, group.segmentId);
    const existing = segmentPlanMap.get(segmentKey);
    const segmentStart = group.shots[0]?.startAtSeconds ?? 0;
    const segmentDuration = Number(
      group.shots.reduce((sum, shot) => sum + Math.max(0, shot.durationSeconds || 0), 0).toFixed(2),
    );
    const coveredShotIndexes = group.shots.map((shot) => shot.shotIndex);
    const fallbackText = buildFallbackSegmentText(group.shots);
    const validSubtitles = (existing?.subtitles ?? [])
      .map((subtitle) => {
        const text = sanitizeSubtitleText(subtitle.text);
        if (!text) {
          return null;
        }
        return {
          text,
          startAtSeconds: Number(subtitle.startAtSeconds) || segmentStart,
          durationSeconds: Number(subtitle.durationSeconds) || segmentDuration,
          charCount: Number(subtitle.charCount) || countNarrationCharacters(text),
          coveredShotIndexes:
            Array.isArray(subtitle.coveredShotIndexes) && subtitle.coveredShotIndexes.length > 0
              ? subtitle.coveredShotIndexes.map(Number)
              : coveredShotIndexes,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (usesSegmentLevelSubtitleSource(videoType)) {
      const mergedText = validSubtitles.map((subtitle) => subtitle.text).filter(Boolean).join("，") || fallbackText;
      const text = sanitizeSubtitleText(mergedText);
      return {
        segmentIndex: group.segmentIndex,
        segmentId: group.segmentId,
        subtitles: text
          ? [
              {
                text,
                startAtSeconds: segmentStart,
                durationSeconds: segmentDuration,
                charCount: countNarrationCharacters(text),
                coveredShotIndexes,
              },
            ]
          : [],
      } satisfies SegmentSubtitlePlan;
    }

    return {
      segmentIndex: group.segmentIndex,
      segmentId: group.segmentId,
      subtitles:
        validSubtitles.length > 0
          ? validSubtitles
          : fallbackText
            ? [
                {
                  text: fallbackText,
                  startAtSeconds: segmentStart,
                  durationSeconds: segmentDuration,
                  charCount: countNarrationCharacters(fallbackText),
                  coveredShotIndexes,
                },
              ]
            : [],
    } satisfies SegmentSubtitlePlan;
  });

  return {
    ...shotPlan,
    subtitlePlan: normalizedSubtitlePlan,
  };
}

export function buildNarrationScriptFromSubtitlePlan(
  shotPlan: ShotPlan | null | undefined,
  videoType: VideoTaskVideoType,
) {
  if (!shotPlan?.subtitlePlan?.length) {
    return "";
  }

  const normalizedPlan = normalizeSubtitlePlanSource(shotPlan, videoType);
  const lines = (normalizedPlan.subtitlePlan ?? [])
    .map((segment) => {
      const text = segment.subtitles.map((subtitle) => sanitizeSubtitleText(subtitle.text)).filter(Boolean).join("，");
      return `片段${segment.segmentIndex}：${text}`;
    });

  return lines.join("\n");
}

export function countSubtitlePlanEntries(subtitlePlan: SegmentSubtitlePlan[] | null | undefined) {
  return subtitlePlan?.reduce((sum, segment) => sum + (segment.subtitles?.length ?? 0), 0) ?? 0;
}

export function countSubtitlePlanTextEntries(subtitlePlan: SegmentSubtitlePlan[] | null | undefined) {
  return (
    subtitlePlan?.reduce(
      (sum, segment) => sum + (segment.subtitles?.filter((subtitle) => sanitizeSubtitleText(subtitle.text)).length ?? 0),
      0,
    ) ?? 0
  );
}

export function hasSubtitlePlanText(subtitlePlan: SegmentSubtitlePlan[] | null | undefined) {
  return countSubtitlePlanTextEntries(subtitlePlan) > 0;
}

export function syncNarrationScriptIntoSubtitlePlan(
  shotPlan: ShotPlan | null | undefined,
  script: string,
  videoType: VideoTaskVideoType,
) {
  if (!shotPlan) {
    return shotPlan;
  }

  const normalizedPlan = normalizeSubtitlePlanSource(shotPlan, videoType);
  if (!usesSegmentLevelSubtitleSource(videoType)) {
    return normalizedPlan;
  }

  const lineMap = new Map(
    parseNarrationScriptLines(script, normalizedPlan)
      .filter((line) => line.scope === "segment")
      .map((line) => [line.segmentIndex, sanitizeSubtitleText(line.text)]),
  );

  return {
    ...normalizedPlan,
    subtitlePlan: normalizedPlan.subtitlePlan?.map((segment) => {
      const lineText = lineMap.get(segment.segmentIndex);
      if (!lineText) {
        return segment;
      }

      const currentSubtitle = segment.subtitles[0];
      return {
        ...segment,
        subtitles: [
          {
            text: lineText,
            startAtSeconds: currentSubtitle?.startAtSeconds ?? 0,
            durationSeconds: currentSubtitle?.durationSeconds ?? 0,
            charCount: countNarrationCharacters(lineText),
            coveredShotIndexes: currentSubtitle?.coveredShotIndexes ?? [],
          },
        ],
      } satisfies SegmentSubtitlePlan;
    }),
  } satisfies ShotPlan;
}

export function syncNarrationClipsIntoSubtitlePlan(
  shotPlan: ShotPlan | null | undefined,
  clips: NarrationDraftClip[],
  videoType: VideoTaskVideoType,
) {
  if (!shotPlan) {
    return shotPlan;
  }

  const normalizedPlan = normalizeSubtitlePlanSource(shotPlan, videoType);
  if (!usesSegmentLevelSubtitleSource(videoType)) {
    return normalizedPlan;
  }

  const clipMap = new Map<string, NarrationDraftClip>();
  for (const clip of clips) {
    const segmentIndex = clip.segmentIndex ?? clip.shotIndex;
    const segmentId = clip.segmentId?.trim() || clip.bindToSegmentId?.trim() || `segment-${segmentIndex}`;
    clipMap.set(getSegmentSortKey(segmentIndex, segmentId), clip);
  }

  return {
    ...normalizedPlan,
    subtitlePlan: normalizedPlan.subtitlePlan?.map((segment) => {
      const clip = clipMap.get(getSegmentSortKey(segment.segmentIndex, segment.segmentId));
      if (!clip) {
        return segment;
      }

      const text = sanitizeSubtitleText(clip.subtitleText || clip.narrationText);
      const currentSubtitle = segment.subtitles[0];
      return {
        ...segment,
        subtitles: text
          ? [
              {
                text,
                startAtSeconds: currentSubtitle?.startAtSeconds ?? clip.startAtSeconds,
                durationSeconds: clip.audioDurationSeconds ?? clip.durationSeconds,
                charCount: countNarrationCharacters(text),
                coveredShotIndexes: currentSubtitle?.coveredShotIndexes ?? [],
              },
            ]
          : [],
      } satisfies SegmentSubtitlePlan;
    }),
  } satisfies ShotPlan;
}

export function getSegmentSubtitleEntry(
  subtitlePlan: SegmentSubtitlePlan[] | null | undefined,
  input: { segmentId?: string | null; segmentIndex?: number | null },
) {
  if (!subtitlePlan?.length) {
    return null;
  }

  const segment = subtitlePlan.find(
    (item) =>
      (input.segmentId && item.segmentId === input.segmentId) ||
      (input.segmentIndex != null && item.segmentIndex === input.segmentIndex),
  );
  return segment?.subtitles[0] ?? null;
}
