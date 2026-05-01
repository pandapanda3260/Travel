import type { AudioAlignment, NarrationDraftClip } from "./narration";
import type { TimedWord } from "./video-task-schema";

function normalizeDurationSeconds(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeTimedWords(words: TimedWord[] | null | undefined) {
  return (words ?? [])
    .map((word) => {
      const startTime = Number(word.startTime);
      const endTime = Number(word.endTime);
      const text = String(word.word ?? "").trim();
      if (!text || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        return null;
      }
      return {
        word: text,
        startTime: Math.max(0, startTime),
        endTime: Math.max(Math.max(0, startTime), endTime),
      } satisfies TimedWord;
    })
    .filter((word): word is TimedWord => word !== null)
    .sort((left, right) => left.startTime - right.startTime);
}

export function buildAudioAlignment(input: {
  audioDurationSeconds?: number | null;
  words?: TimedWord[] | null;
  fallbackDurationSeconds?: number | null;
}): AudioAlignment {
  const wordTimestamps = normalizeTimedWords(input.words);
  const audioDurationSeconds =
    normalizeDurationSeconds(input.audioDurationSeconds) ?? normalizeDurationSeconds(input.fallbackDurationSeconds);

  if (wordTimestamps.length > 0) {
    return {
      audioDurationSeconds,
      source: "provider_word",
      confidence: "high",
      wordTimestamps,
    };
  }

  return {
    audioDurationSeconds,
    source: "estimated",
    confidence: "low",
    wordTimestamps: [],
  };
}

export function resolveNarrationClipWordTimestamps(
  clip: Pick<NarrationDraftClip, "audioAlignment" | "words">,
): TimedWord[] {
  return clip.audioAlignment?.wordTimestamps?.length ? clip.audioAlignment.wordTimestamps : (clip.words ?? []);
}
