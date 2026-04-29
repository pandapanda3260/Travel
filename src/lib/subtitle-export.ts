import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NarrationDraftClip } from "./narration";
import type { NarrationResultRecord } from "./narration-result-store";
import { joinRuntimePublicStoragePath } from "./runtime-storage";
import { normalizeSubtitleDisplayCues } from "./subtitle-display";
import { countSubtitleDisplayCharacters } from "./subtitle-text-utils";

export type SubtitleCue = {
  cueId: string;
  text: string;
  startAtSeconds: number;
  endAtSeconds: number;
  bindToSegmentId: string | null;
  characterFocus: string;
  sourceClipId: string;
};

function getSubtitleOutputDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-subtitles", taskId?.trim() || "_unassigned");
}

function ensureSubtitleOutputDir(taskId?: string | null) {
  const subtitleOutputDir = getSubtitleOutputDir(taskId);
  if (!existsSync(subtitleOutputDir)) {
    mkdirSync(subtitleOutputDir, { recursive: true });
  }

  return subtitleOutputDir;
}

function getSafeSeconds(value: number | null | undefined, fallback = 0) {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function getClipSegmentKey(clip: NarrationDraftClip, index: number) {
  const segmentIndex = clip.segmentIndex ?? clip.shotIndex ?? index + 1;
  const sortIndex = Math.round(segmentIndex * 1000);
  const segmentId = clip.segmentId?.trim() || clip.bindToSegmentId?.trim() || `segment-${segmentIndex}`;
  return `${String(sortIndex).padStart(8, "0")}-${segmentId}`;
}

function getClipWindowSeconds(clip: NarrationDraftClip) {
  return Math.max(
    0.2,
    getSafeSeconds(clip.durationSeconds),
    getSafeSeconds(clip.audioDurationSeconds),
    clip.words?.length ? Math.max(...clip.words.map((word) => getSafeSeconds(word.endTime))) : 0,
  );
}

function buildEffectiveClipStartMap(clips: NarrationDraftClip[]) {
  const segmentMap = new Map<
    string,
    {
      firstStartAtSeconds: number;
      endAtSeconds: number;
      clipIndexes: number[];
    }
  >();

  clips.forEach((clip, index) => {
    const key = getClipSegmentKey(clip, index);
    const startAtSeconds = getSafeSeconds(clip.startAtSeconds);
    const windowEndAtSeconds = startAtSeconds + getClipWindowSeconds(clip);
    const current = segmentMap.get(key);

    if (current) {
      current.firstStartAtSeconds = Math.min(current.firstStartAtSeconds, startAtSeconds);
      current.endAtSeconds = Math.max(current.endAtSeconds, windowEndAtSeconds);
      current.clipIndexes.push(index);
      return;
    }

    segmentMap.set(key, {
      firstStartAtSeconds: startAtSeconds,
      endAtSeconds: windowEndAtSeconds,
      clipIndexes: [index],
    });
  });

  const segments = Array.from(segmentMap.entries()).sort(([left], [right]) => left.localeCompare(right));
  let previousEndAtSeconds = segments[0] ? segments[0][1].endAtSeconds : 0;
  const startsOverlapAcrossSegments = segments.slice(1).some(([, segment]) => {
    const overlaps = segment.firstStartAtSeconds < previousEndAtSeconds - 0.05;
    previousEndAtSeconds = Math.max(previousEndAtSeconds, segment.endAtSeconds);
    return overlaps;
  });

  if (!startsOverlapAcrossSegments) {
    return new Map(clips.map((clip, index) => [index, getSafeSeconds(clip.startAtSeconds)]));
  }

  const startMap = new Map<number, number>();
  let cursor = 0;

  for (const [, segment] of segments) {
    for (const clipIndex of segment.clipIndexes) {
      const localStartAtSeconds = getSafeSeconds(clips[clipIndex]?.startAtSeconds);
      startMap.set(clipIndex, Number((cursor + localStartAtSeconds - segment.firstStartAtSeconds).toFixed(3)));
    }
    cursor = Number((cursor + segment.endAtSeconds - segment.firstStartAtSeconds).toFixed(3));
  }

  return startMap;
}

function normalizeCueText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
export {
  groupWordsIntoPhrases,
  splitTextIntoPhrases,
  wrapSubtitleText,
  type SubtitlePhrase,
} from "./subtitle-text-utils";

export function formatSrtTimestamp(totalSeconds: number) {
  const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSubtitleCuesFromNarrationClips(clips: NarrationDraftClip[]) {
  const effectiveStartMap = buildEffectiveClipStartMap(clips);

  return clips
    .flatMap((clip, index) => {
      const text = normalizeCueText(clip.subtitleText || clip.narrationText || "");
      if (!text) {
        return [];
      }

      const startAtSeconds = effectiveStartMap.get(index) ?? getSafeSeconds(clip.startAtSeconds);
      const durationSeconds = Math.max(0.8, getSafeSeconds(clip.audioDurationSeconds ?? clip.durationSeconds, 2));
      const wordEndTime = clip.words?.length ? Math.max(...clip.words.map((word) => getSafeSeconds(word.endTime))) : 0;
      const computedEndAtSeconds = clip.words?.length
        ? Math.max(startAtSeconds + 0.8, startAtSeconds + wordEndTime)
        : startAtSeconds + durationSeconds;
      const manualDisplayCues = normalizeSubtitleDisplayCues(clip.subtitleDisplayCues, 16);
      const manualDisplayText = manualDisplayCues.map((cue) => cue.text).join("");
      if (
        manualDisplayCues.length > 0 &&
        countSubtitleDisplayCharacters(manualDisplayText) === countSubtitleDisplayCharacters(text)
      ) {
        const totalWeight = manualDisplayCues.reduce(
          (sum, cue) => sum + Math.max(1, countSubtitleDisplayCharacters(cue.text)),
          0,
        );
        let cursor = startAtSeconds;

        return manualDisplayCues.map((cue, cueIndex) => {
          const isLastCue = cueIndex === manualDisplayCues.length - 1;
          const cueDuration = isLastCue
            ? computedEndAtSeconds - cursor
            : (computedEndAtSeconds - startAtSeconds) *
              (Math.max(1, countSubtitleDisplayCharacters(cue.text)) / totalWeight);
          const cueStartAtSeconds = cursor;
          const cueEndAtSeconds = isLastCue ? computedEndAtSeconds : cursor + cueDuration;
          cursor = cueEndAtSeconds;

          return {
            cueId: `cue-${index + 1}-${cueIndex + 1}`,
            text: cue.lines.join("\n"),
            startAtSeconds: cueStartAtSeconds,
            endAtSeconds: cueEndAtSeconds,
            bindToSegmentId: clip.bindToSegmentId ?? null,
            characterFocus: clip.characterFocus,
            sourceClipId: clip.id,
          } satisfies SubtitleCue;
        });
      }

      return {
        cueId: `cue-${index + 1}`,
        text,
        startAtSeconds,
        endAtSeconds: computedEndAtSeconds,
        bindToSegmentId: clip.bindToSegmentId ?? null,
        characterFocus: clip.characterFocus,
        sourceClipId: clip.id,
      } satisfies SubtitleCue;
    })
    .sort((left, right) => left.startAtSeconds - right.startAtSeconds)
    .map((cue, index, allCues) => {
      const nextCue = allCues[index + 1];
      const endAtSeconds = nextCue
        ? Math.min(cue.endAtSeconds, Math.max(cue.startAtSeconds + 0.2, nextCue.startAtSeconds - 0.04))
        : cue.endAtSeconds;

      return {
        ...cue,
        endAtSeconds: Math.max(cue.startAtSeconds + 0.2, endAtSeconds),
      };
    });
}

export function buildSrtFromSubtitleCues(cues: SubtitleCue[]) {
  return cues
    .map((cue, index) => {
      return [
        String(index + 1),
        `${formatSrtTimestamp(cue.startAtSeconds)} --> ${formatSrtTimestamp(cue.endAtSeconds)}`,
        cue.text,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildSrtFromNarrationResult(result: Pick<NarrationResultRecord, "clips">) {
  return buildSrtFromSubtitleCues(buildSubtitleCuesFromNarrationClips(result.clips));
}

export function writeSrtSubtitleFile(resultId: string, srtText: string, taskId?: string | null) {
  const subtitleOutputDir = ensureSubtitleOutputDir(taskId);
  const fileName = `${resultId}.srt`;
  const absolutePath = join(subtitleOutputDir, fileName);
  writeFileSync(absolutePath, srtText, "utf8");
  return {
    absolutePath,
    publicUrl: `/generated-subtitles/${taskId?.trim() || "_unassigned"}/${fileName}`,
  };
}
