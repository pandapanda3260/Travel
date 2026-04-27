import {
  countSubtitleDisplayCharacters,
  normalizeSubtitleDisplayText,
  splitTextIntoPhrases,
} from "./subtitle-text-utils";
import type { SubtitleDisplayMode } from "./subtitle-style-config";

export type SubtitleDisplayWord = {
  word: string;
  startTime: number;
  endTime: number;
};

export type SubtitleDisplayUnit = {
  text: string;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export type SubtitleDisplayPlanEntry = {
  text: string;
  startAtSeconds: number;
  durationSeconds: number;
};

type TimedDisplayCharacter = {
  char: string;
  startTime: number;
  endTime: number;
};

const punctuationOnlyPattern = /[\s，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]+/g;
const phraseBoundaryPunctuationPattern = /[，。！？；、：,.!?;]/;
const preciseSubtitleTrailingAllowanceSeconds = 0.12;
const estimatedSubtitleTailTrimSeconds = 0.15;
const subtitleCueGapSeconds = 0.04;
const minSubtitleUnitDurationSeconds = 0.08;
const semanticInlineBoundaryWords = [
  "再去",
  "再看",
  "再逛",
  "再串",
  "然后",
  "接着",
  "和",
  "与",
  "及",
  "更",
  "也",
  "还",
  "先",
  "再",
];

function countSubtitleSpeechUnits(text: string) {
  const normalized = String(text ?? "").replace(punctuationOnlyPattern, "").trim();
  return Array.from(normalized).length || 1;
}

function normalizeTimelineDuration(durationSeconds: number) {
  return Math.max(0.2, Number(durationSeconds) || 0.2);
}

function normalizeDisplayBudget(maxCharsPerLine: number) {
  const numeric = Math.round(Number(maxCharsPerLine) || 12);
  return Math.max(1, numeric);
}

function clampOffset(value: number, totalDurationSeconds: number) {
  return Math.max(0, Math.min(totalDurationSeconds, value));
}

function resolveWordTimelineEndSeconds(words: SubtitleDisplayWord[] | null | undefined) {
  if (!words?.length) {
    return null;
  }

  const endSeconds = Math.max(...words.map((word) => Number(word.endTime) || 0));
  return Number.isFinite(endSeconds) && endSeconds > 0 ? endSeconds : null;
}

function hasDisplayTextCoverage(units: SubtitleDisplayUnit[], sourceText: string) {
  return (
    countSubtitleDisplayCharacters(units.map((unit) => unit.text).join("")) >=
    countSubtitleDisplayCharacters(sourceText)
  );
}

function buildWordDisplayTimeline(words: SubtitleDisplayWord[], totalDurationSeconds: number) {
  const normalizedDuration = normalizeTimelineDuration(totalDurationSeconds);
  const characters: TimedDisplayCharacter[] = [];

  for (const word of [...words].sort((left, right) => left.startTime - right.startTime)) {
    const normalizedWord = Array.from(normalizeSubtitleDisplayText(word.word));
    if (!normalizedWord.length) {
      continue;
    }

    const startTime = clampOffset(word.startTime, normalizedDuration);
    const endTime = clampOffset(Math.max(word.endTime, word.startTime + 0.08), normalizedDuration);
    const duration = Math.max(0, endTime - startTime);

    normalizedWord.forEach((char, index) => {
      const charStartTime = startTime + duration * (index / normalizedWord.length);
      const charEndTime = startTime + duration * ((index + 1) / normalizedWord.length);
      characters.push({
        char,
        startTime: Number(charStartTime.toFixed(3)),
        endTime: Number(Math.max(charStartTime, charEndTime).toFixed(3)),
      });
    });
  }

  return {
    text: characters.map((item) => item.char).join(""),
    characters,
  };
}

function resolveDisplayCutIndex(text: string, maxChars: number) {
  const chars = Array.from(text);
  let displayCount = 0;

  for (let index = 0; index < chars.length; index += 1) {
    displayCount += countSubtitleDisplayCharacters(chars[index]!);
    if (displayCount >= maxChars) {
      return index + 1;
    }
  }

  return chars.length;
}

function startsWithSemanticInlineBoundary(text: string) {
  const normalized = normalizeSubtitleDisplayText(text);
  return semanticInlineBoundaryWords.some((word) => normalized.startsWith(word));
}

function findSemanticDisplayCutIndex(
  text: string,
  maxCutIndex: number,
  input: { minCharsPerPhrase: number; allowShortSuffix: boolean },
) {
  const chars = Array.from(text);

  for (let cutIndex = Math.min(maxCutIndex, chars.length - 1); cutIndex >= 1; cutIndex -= 1) {
    const prefix = chars.slice(0, cutIndex).join("");
    const suffix = chars.slice(cutIndex).join("");
    const prefixLength = countSubtitleDisplayCharacters(prefix);
    const suffixLength = countSubtitleDisplayCharacters(suffix);

    if (prefixLength < input.minCharsPerPhrase) {
      continue;
    }
    if (!input.allowShortSuffix && suffixLength < input.minCharsPerPhrase) {
      continue;
    }
    if (startsWithSemanticInlineBoundary(suffix)) {
      return cutIndex;
    }
  }

  return -1;
}

function splitLongWordForDisplay(text: string, maxCharsPerLine: number, input: { hasFollowingWord: boolean }) {
  const minCharsPerPhrase = Math.min(3, maxCharsPerLine);
  const parts: string[] = [];
  let remaining = text;

  while (countSubtitleDisplayCharacters(remaining) > maxCharsPerLine) {
    const maxCutIndex = resolveDisplayCutIndex(remaining, maxCharsPerLine);
    const semanticCutIndex = findSemanticDisplayCutIndex(remaining, maxCutIndex, {
      minCharsPerPhrase,
      allowShortSuffix: input.hasFollowingWord,
    });
    const cutIndex = semanticCutIndex > 0 ? semanticCutIndex : maxCutIndex;
    const chars = Array.from(remaining);

    if (cutIndex <= 0 || cutIndex >= chars.length + 1) {
      break;
    }

    parts.push(chars.slice(0, cutIndex).join(""));
    remaining = chars.slice(cutIndex).join("");
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts.length > 0 ? parts : [text];
}

function buildWordBoundaryPhrases(text: string, words: SubtitleDisplayWord[], maxCharsPerLine: number) {
  if (phraseBoundaryPunctuationPattern.test(text)) {
    return splitTextIntoPhrases(text, maxCharsPerLine);
  }

  const normalizedText = normalizeSubtitleDisplayText(text);
  const wordTexts = [...words]
    .sort((left, right) => left.startTime - right.startTime)
    .map((word) => normalizeSubtitleDisplayText(word.word))
    .filter((word) => word.length > 0);

  if (!wordTexts.length || wordTexts.join("") !== normalizedText) {
    return splitTextIntoPhrases(text, maxCharsPerLine);
  }

  const phrases: string[] = [];
  let current = "";
  const flushCurrent = () => {
    if (current) {
      phrases.push(current);
      current = "";
    }
  };

  wordTexts.forEach((wordText, wordIndex) => {
    const wordLength = countSubtitleDisplayCharacters(wordText);
    if (wordLength > maxCharsPerLine) {
      flushCurrent();
      const parts = splitLongWordForDisplay(wordText, maxCharsPerLine, {
        hasFollowingWord: wordIndex < wordTexts.length - 1,
      });

      parts.forEach((part, partIndex) => {
        const isLastPart = partIndex === parts.length - 1;
        if (isLastPart) {
          current = part;
        } else {
          phrases.push(part);
        }
      });
      return;
    }

    if (current && countSubtitleDisplayCharacters(current + wordText) > maxCharsPerLine) {
      flushCurrent();
    }

    current += wordText;
  });

  flushCurrent();
  return phrases.length > 0 ? phrases : splitTextIntoPhrases(text, maxCharsPerLine);
}

function buildWeightedPhraseUnits(phrases: string[], totalDurationSeconds: number): SubtitleDisplayUnit[] {
  if (phrases.length === 0) {
    return [];
  }

  if (phrases.length === 1) {
    return [
      {
        text: phrases[0]!,
        startOffsetSeconds: 0,
        endOffsetSeconds: normalizeTimelineDuration(totalDurationSeconds),
      },
    ];
  }

  const normalizedDuration = normalizeTimelineDuration(totalDurationSeconds);
  const weights = phrases.map((phrase) => Math.max(1, countSubtitleSpeechUnits(phrase)));
  const minUnitDuration = normalizedDuration <= phrases.length * 0.35 ? normalizedDuration / phrases.length : 0.35;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const distributableDuration = Math.max(0, normalizedDuration - minUnitDuration * phrases.length);

  let cursor = 0;

  return phrases.map((phrase, index) => {
    const duration =
      index === phrases.length - 1
        ? Math.max(0.1, normalizedDuration - cursor)
        : minUnitDuration + distributableDuration * (weights[index]! / totalWeight);
    const startOffsetSeconds = cursor;
    const endOffsetSeconds =
      index === phrases.length - 1
        ? normalizedDuration
        : clampOffset(cursor + duration, normalizedDuration);

    cursor = endOffsetSeconds;

    return {
      text: phrase,
      startOffsetSeconds,
      endOffsetSeconds: Math.max(startOffsetSeconds, endOffsetSeconds),
    } satisfies SubtitleDisplayUnit;
  });
}

function buildWordTimedUnits(words: SubtitleDisplayWord[], totalDurationSeconds: number): SubtitleDisplayUnit[] {
  const normalizedDuration = normalizeTimelineDuration(totalDurationSeconds);
  const sortedWords = [...words].sort((left, right) => left.startTime - right.startTime);

  return sortedWords
    .map((word) => {
      const startOffsetSeconds = clampOffset(word.startTime, normalizedDuration);
      const endOffsetSeconds = clampOffset(
        Math.max(word.endTime, word.startTime + 0.12),
        normalizedDuration,
      );

      if (!word.word?.trim()) {
        return null;
      }

      const remainingDuration = Math.max(0, normalizedDuration - startOffsetSeconds);
      const minDuration = Math.min(0.08, remainingDuration);

      return {
        text: word.word,
        startOffsetSeconds,
        endOffsetSeconds: Math.min(normalizedDuration, Math.max(startOffsetSeconds + minDuration, endOffsetSeconds)),
      } satisfies SubtitleDisplayUnit;
    })
    .filter((item): item is SubtitleDisplayUnit => item !== null && countSubtitleDisplayCharacters(item.text) > 0);
}

export function splitSegmentWordTimelineBySubtitleEntries(
  entries: SubtitleDisplayPlanEntry[],
  words: SubtitleDisplayWord[],
) {
  if (!entries.length) {
    return [] as Array<SubtitleDisplayWord[]>;
  }

  const sortedEntries = [...entries]
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => left.startAtSeconds - right.startAtSeconds);
  const sortedWords = [...words].sort((left, right) => left.startTime - right.startTime);
  const segmentBaseStartAtSeconds = sortedEntries[0]?.startAtSeconds ?? 0;
  const assignedWords = entries.map(() => [] as SubtitleDisplayWord[]);

  for (const word of sortedWords) {
    const midpoint = (word.startTime + word.endTime) / 2;
    let matchedEntry = sortedEntries.find((entry) => {
      const localStart = Math.max(0, entry.startAtSeconds - segmentBaseStartAtSeconds);
      const localEnd = localStart + Math.max(0.1, entry.durationSeconds);
      return midpoint >= localStart - 0.04 && midpoint <= localEnd + 0.04;
    });

    if (!matchedEntry) {
      matchedEntry =
        midpoint < Math.max(0, sortedEntries[0]!.startAtSeconds - segmentBaseStartAtSeconds)
          ? sortedEntries[0]!
          : sortedEntries[sortedEntries.length - 1]!;
    }

    const entryLocalStart = Math.max(0, matchedEntry.startAtSeconds - segmentBaseStartAtSeconds);
    const entryLocalEnd = entryLocalStart + Math.max(0.1, matchedEntry.durationSeconds);

    assignedWords[matchedEntry.index]!.push({
      word: word.word,
      startTime: clampOffset(word.startTime - entryLocalStart, matchedEntry.durationSeconds),
      endTime: clampOffset(
        Math.max(word.endTime - entryLocalStart, word.startTime - entryLocalStart + 0.08),
        matchedEntry.durationSeconds,
      ),
    });
  }

  return assignedWords.map((entryWords) =>
    entryWords
      .filter((word) => word.word?.trim())
      .sort((left, right) => left.startTime - right.startTime),
  );
}

function buildTextPhraseTimedUnits(
  text: string,
  words: SubtitleDisplayWord[],
  maxCharsPerLine: number,
  totalDurationSeconds: number,
) {
  const normalizedDuration = normalizeTimelineDuration(totalDurationSeconds);
  const phrases = buildWordBoundaryPhrases(text, words, maxCharsPerLine);
  const wordDisplayTimeline = buildWordDisplayTimeline(words, normalizedDuration);

  if (!phrases.length || !wordDisplayTimeline.characters.length) {
    return [];
  }

  const units: SubtitleDisplayUnit[] = [];
  let searchCursor = 0;

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeSubtitleDisplayText(phrase);
    if (!normalizedPhrase) {
      continue;
    }

    const phraseStartIndex = wordDisplayTimeline.text.indexOf(normalizedPhrase, searchCursor);
    if (phraseStartIndex < 0) {
      return [];
    }
    const phraseEndIndex = phraseStartIndex + Array.from(normalizedPhrase).length - 1;
    const firstCharacter = wordDisplayTimeline.characters[phraseStartIndex];
    const lastCharacter = wordDisplayTimeline.characters[phraseEndIndex];
    if (!firstCharacter || !lastCharacter) {
      return [];
    }
    searchCursor = phraseEndIndex + 1;

    units.push({
      text: phrase,
      startOffsetSeconds: clampOffset(firstCharacter.startTime, normalizedDuration),
      endOffsetSeconds: clampOffset(Math.max(lastCharacter.endTime, firstCharacter.startTime + 0.08), normalizedDuration),
    });
  }

  return units;
}

function splitOversizedDisplayUnit(unit: SubtitleDisplayUnit, maxCharsPerLine: number): SubtitleDisplayUnit[] {
  if (countSubtitleDisplayCharacters(unit.text) <= maxCharsPerLine) {
    return [{ ...unit, text: unit.text.replace(/\s+/g, "").trim() }];
  }

  const phrases = splitTextIntoPhrases(unit.text, maxCharsPerLine);
  if (phrases.length <= 1) {
    return [{ ...unit, text: phrases[0] ?? unit.text.replace(/\s+/g, "").trim() }];
  }

  const durationSeconds = Math.max(0, unit.endOffsetSeconds - unit.startOffsetSeconds);
  return buildWeightedPhraseUnits(phrases, durationSeconds).map((phraseUnit) => ({
    text: phraseUnit.text,
    startOffsetSeconds: unit.startOffsetSeconds + phraseUnit.startOffsetSeconds,
    endOffsetSeconds: unit.startOffsetSeconds + phraseUnit.endOffsetSeconds,
  }));
}

function normalizeDisplayUnits(
  units: SubtitleDisplayUnit[],
  maxCharsPerLine: number,
  totalDurationSeconds: number,
): SubtitleDisplayUnit[] {
  const normalizedDuration = normalizeTimelineDuration(totalDurationSeconds);
  return units
    .flatMap((unit) => splitOversizedDisplayUnit(unit, maxCharsPerLine))
    .map((unit) => {
      const text = unit.text.replace(/\s+/g, "").trim();
      const startOffsetSeconds = clampOffset(unit.startOffsetSeconds, normalizedDuration);
      const endOffsetSeconds = clampOffset(unit.endOffsetSeconds, normalizedDuration);

      return {
        text,
        startOffsetSeconds,
        endOffsetSeconds: Math.max(startOffsetSeconds, endOffsetSeconds),
      } satisfies SubtitleDisplayUnit;
    })
    .filter((unit) => unit.text && countSubtitleDisplayCharacters(unit.text) > 0);
}

export function normalizeSubtitleCueTiming(
  units: SubtitleDisplayUnit[],
  input: {
    totalDurationSeconds: number;
    words?: SubtitleDisplayWord[] | null;
    trimEstimatedTail?: boolean;
  },
) {
  if (!units.length) {
    return [] as SubtitleDisplayUnit[];
  }

  const normalizedDuration = normalizeTimelineDuration(input.totalDurationSeconds);
  const speechEndSeconds = resolveWordTimelineEndSeconds(input.words);
  const finalEndLimit =
    speechEndSeconds != null
      ? Math.min(normalizedDuration, speechEndSeconds + preciseSubtitleTrailingAllowanceSeconds)
      : input.trimEstimatedTail === true
        ? Math.max(0.2, normalizedDuration - Math.min(estimatedSubtitleTailTrimSeconds, normalizedDuration * 0.08))
        : normalizedDuration;

  return units.map((unit, index) => {
    const nextUnit = units[index + 1] ?? null;
    const startOffsetSeconds = clampOffset(unit.startOffsetSeconds, normalizedDuration);
    const originalEndOffsetSeconds = clampOffset(unit.endOffsetSeconds, normalizedDuration);
    const nextStartOffsetSeconds = nextUnit ? clampOffset(nextUnit.startOffsetSeconds, normalizedDuration) : null;
    const cueGapSeconds = input.trimEstimatedTail === true ? subtitleCueGapSeconds : 0;
    const nextStartLimit = nextUnit
      ? Math.max(startOffsetSeconds, (nextStartOffsetSeconds ?? normalizedDuration) - cueGapSeconds)
      : normalizedDuration;
    const endLimit = Math.min(nextStartLimit, index === units.length - 1 ? finalEndLimit : normalizedDuration);
    const safeEndLimit = Math.max(startOffsetSeconds, endLimit);
    const minReadableEnd = Math.min(safeEndLimit, startOffsetSeconds + minSubtitleUnitDurationSeconds);
    const endOffsetSeconds = Math.max(minReadableEnd, Math.min(originalEndOffsetSeconds, safeEndLimit));

    return {
      ...unit,
      startOffsetSeconds,
      endOffsetSeconds,
    };
  });
}

export function buildSubtitleDisplayUnits(input: {
  text: string;
  durationSeconds: number;
  words?: SubtitleDisplayWord[] | null;
  maxCharsPerLine: number;
  displayMode: SubtitleDisplayMode;
  trimEstimatedTail?: boolean;
}) {
  const text = String(input.text ?? "").trim();
  if (!text) {
    return [] as SubtitleDisplayUnit[];
  }

  const normalizedDuration = normalizeTimelineDuration(input.durationSeconds);
  const words = input.words?.length ? input.words : null;
  const maxCharsPerLine = normalizeDisplayBudget(input.maxCharsPerLine);

  if (input.displayMode === "word_by_word" && words) {
    const wordTimedUnits = buildWordTimedUnits(words, normalizedDuration);
    return normalizeSubtitleCueTiming(
      normalizeDisplayUnits(
        hasDisplayTextCoverage(wordTimedUnits, text)
          ? wordTimedUnits
          : buildWeightedPhraseUnits(splitTextIntoPhrases(text, maxCharsPerLine), normalizedDuration),
        maxCharsPerLine,
        normalizedDuration,
      ),
      {
        totalDurationSeconds: normalizedDuration,
        words,
        trimEstimatedTail: input.trimEstimatedTail,
      },
    );
  }

  if (words) {
    const textTimedUnits = buildTextPhraseTimedUnits(text, words, maxCharsPerLine, normalizedDuration);
    return normalizeSubtitleCueTiming(
      normalizeDisplayUnits(
        hasDisplayTextCoverage(textTimedUnits, text)
          ? textTimedUnits
          : buildWeightedPhraseUnits(splitTextIntoPhrases(text, maxCharsPerLine), normalizedDuration),
        maxCharsPerLine,
        normalizedDuration,
      ),
      {
        totalDurationSeconds: normalizedDuration,
        words,
        trimEstimatedTail: input.trimEstimatedTail,
      },
    );
  }

  const phrases = splitTextIntoPhrases(text, maxCharsPerLine);
  return normalizeSubtitleCueTiming(
    normalizeDisplayUnits(
      buildWeightedPhraseUnits(phrases.length > 0 ? phrases : [text], normalizedDuration),
      maxCharsPerLine,
      normalizedDuration,
    ),
    {
      totalDurationSeconds: normalizedDuration,
      words: null,
      trimEstimatedTail: input.trimEstimatedTail,
    },
  );
}
