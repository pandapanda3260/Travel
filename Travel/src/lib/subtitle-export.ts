import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NarrationDraftClip } from "./narration";
import type { NarrationResultRecord } from "./narration-result-store";

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
  return join(process.cwd(), "public", "generated-subtitles", taskId?.trim() || "_unassigned");
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

function normalizeCueText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function wrapSubtitleText(text: string, maxCharsPerLine = 12, maxLines = 2): string {
  const cleaned = text.replace(/\s+/g, "").trim();
  if (cleaned.length <= maxCharsPerLine) {
    return cleaned;
  }

  const punctuation = /([，。！？；、：])/;
  const segments = cleaned.split(punctuation).reduce<string[]>((acc, part, i) => {
    if (i % 2 === 1 && acc.length > 0) {
      acc[acc.length - 1] += part;
    } else if (part) {
      acc.push(part);
    }
    return acc;
  }, []);

  const lines: string[] = [];
  let current = "";
  for (const seg of segments) {
    if ((current + seg).length > maxCharsPerLine && current) {
      lines.push(current);
      current = seg;
    } else {
      current += seg;
    }
  }
  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  const result = lines.slice(0, maxLines);
  const lastLine = result[maxLines - 1];
  if (lastLine && lastLine.length > maxCharsPerLine) {
    result[maxLines - 1] = lastLine.slice(0, maxCharsPerLine);
  }
  return result.join("\n");
}

export { groupWordsIntoPhrases, splitTextIntoPhrases, type SubtitlePhrase } from "./subtitle-text-utils";

export function formatSrtTimestamp(totalSeconds: number) {
  const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSubtitleCuesFromNarrationClips(clips: NarrationDraftClip[]) {
  return clips
    .map((clip, index) => {
      const text = normalizeCueText(clip.subtitleText || clip.narrationText || "");
      if (!text) {
        return null;
      }

      const startAtSeconds = getSafeSeconds(clip.startAtSeconds);
      const durationSeconds = Math.max(0.8, getSafeSeconds(clip.audioDurationSeconds ?? clip.durationSeconds, 2));
      const wordEndTime = clip.words?.length
        ? Math.max(...clip.words.map((word) => getSafeSeconds(word.endTime)))
        : 0;
      const computedEndAtSeconds = clip.words?.length
        ? Math.max(startAtSeconds + 0.8, wordEndTime)
        : startAtSeconds + durationSeconds;

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
    .filter((item): item is SubtitleCue => Boolean(item))
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
