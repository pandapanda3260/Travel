export type SubtitlePhrase = {
  text: string;
  startTime: number;
  endTime: number;
};

const phraseSplitPunctuation = /[，。！？；、：,\.!\?;]/;
const trailingNonTerminalPunctuation = /[，、,;；：]+$/;
const trailingAllPunctuation = /[，。！？；、：,\.!\?;]+$/;
const subtitleDisplayIgnoredCharacters = /[\s，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]/g;
const semanticPrefixBoundaryPattern = /^(和|与|及|再|再去|然后|接着|更|也|还|先|再看|再逛|再串)/u;
const semanticBadEndingPattern = /(和|与|及|再|然后|接着|把|给|带|去|看|逛|到)$/u;

export function normalizeSubtitleDisplayText(text: string): string {
  return String(text ?? "").replace(subtitleDisplayIgnoredCharacters, "");
}

export function countSubtitleDisplayCharacters(text: string): number {
  return Array.from(normalizeSubtitleDisplayText(text)).length;
}

function cleanPhraseEnd(text: string): string {
  return text.replace(trailingNonTerminalPunctuation, "");
}

export function groupWordsIntoPhrases(
  words: Array<{ word: string; startTime: number; endTime: number }>,
  maxCharsPerPhrase = 10,
  minCharsPerPhrase = 3,
): SubtitlePhrase[] {
  if (!words.length) return [];

  const rawPhrases: SubtitlePhrase[] = [];
  let currentText = "";
  let currentStart = words[0].startTime;
  let currentEnd = words[0].endTime;

  for (const word of words) {
    const wouldExceed = countSubtitleDisplayCharacters(currentText + word.word) > maxCharsPerPhrase;
    const endsWithPunctuation = phraseSplitPunctuation.test(currentText.slice(-1));

    if (currentText && (wouldExceed || endsWithPunctuation)) {
      rawPhrases.push({ text: currentText.trim(), startTime: currentStart, endTime: currentEnd });
      currentText = word.word;
      currentStart = word.startTime;
      currentEnd = word.endTime;
    } else {
      currentText += word.word;
      currentEnd = word.endTime;
    }
  }

  if (currentText.trim()) {
    rawPhrases.push({ text: currentText.trim(), startTime: currentStart, endTime: currentEnd });
  }

  const merged: SubtitlePhrase[] = [];
  for (const phrase of rawPhrases) {
    const textLength = countSubtitleDisplayCharacters(phrase.text.replace(trailingAllPunctuation, ""));
    if (merged.length > 0 && textLength < minCharsPerPhrase) {
      const prev = merged[merged.length - 1];
      if (countSubtitleDisplayCharacters(prev.text + phrase.text) <= maxCharsPerPhrase) {
        prev.text = prev.text + phrase.text;
        prev.endTime = phrase.endTime;
        continue;
      }
    }
    merged.push({ ...phrase });
  }

  return merged.map((p) => ({ ...p, text: cleanPhraseEnd(p.text) }));
}

function tokenize(text: string): string[] {
  return text.match(/[a-zA-Z]+|\d+(?:\.\d+)?|[，。！？；、：,.!?;]|[^\sa-zA-Z\d，。！？；、：,.!?;]/g) ?? [];
}

export function wrapSubtitleText(text: string, maxCharsPerLine = 12, maxLines = 2): string {
  void maxLines;
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

  return lines.join("\n");
}

function splitTokenByDisplayBudget(token: string, maxCharsPerPhrase: number) {
  const parts: string[] = [];
  let current = "";

  for (const char of Array.from(token)) {
    if (current && countSubtitleDisplayCharacters(current + char) > maxCharsPerPhrase) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function scoreSubtitlePhrase(text: string, input: { minCharsPerPhrase: number; maxCharsPerPhrase: number; isFirst: boolean }) {
  const cleaned = cleanPhraseEnd(text);
  const displayLength = countSubtitleDisplayCharacters(cleaned);
  if (displayLength <= 0 || displayLength > input.maxCharsPerPhrase) {
    return Number.POSITIVE_INFINITY;
  }

  let score = (input.maxCharsPerPhrase - displayLength) * 0.35;
  if (displayLength < input.minCharsPerPhrase) {
    score += 80 + (input.minCharsPerPhrase - displayLength) * 24;
  }
  if (!input.isFirst && semanticPrefixBoundaryPattern.test(cleaned)) {
    score -= 10;
  }
  if (semanticBadEndingPattern.test(cleaned)) {
    score += 45;
  }

  return score;
}

function splitLongTextBySemanticBudget(text: string, maxCharsPerPhrase: number, minCharsPerPhrase: number) {
  const tokens = tokenize(text).flatMap((token) =>
    countSubtitleDisplayCharacters(token) > maxCharsPerPhrase
      ? splitTokenByDisplayBudget(token, maxCharsPerPhrase)
      : [token],
  );
  const tokenCount = tokens.length;
  const bestScores = Array.from({ length: tokenCount + 1 }, () => Number.POSITIVE_INFINITY);
  const previousIndexes = Array.from({ length: tokenCount + 1 }, () => -1);
  bestScores[0] = 0;

  for (let end = 1; end <= tokenCount; end += 1) {
    for (let start = end - 1; start >= 0; start -= 1) {
      const phrase = tokens.slice(start, end).join("");
      const displayLength = countSubtitleDisplayCharacters(phrase);
      if (displayLength > maxCharsPerPhrase) {
        break;
      }
      if (displayLength <= 0 || !Number.isFinite(bestScores[start]!)) {
        continue;
      }

      const phraseScore = scoreSubtitlePhrase(phrase, {
        minCharsPerPhrase,
        maxCharsPerPhrase,
        isFirst: start === 0,
      });
      const nextScore = bestScores[start]! + phraseScore;
      if (nextScore < bestScores[end]!) {
        bestScores[end] = nextScore;
        previousIndexes[end] = start;
      }
    }
  }

  if (!Number.isFinite(bestScores[tokenCount]!) || previousIndexes[tokenCount] < 0) {
    return tokens.reduce<string[]>((parts, token) => {
      const current = parts[parts.length - 1] ?? "";
      if (current && countSubtitleDisplayCharacters(current + token) > maxCharsPerPhrase) {
        parts.push(token);
      } else if (parts.length > 0) {
        parts[parts.length - 1] = current + token;
      } else {
        parts.push(token);
      }
      return parts;
    }, []);
  }

  const result: string[] = [];
  for (let cursor = tokenCount; cursor > 0; ) {
    const start = previousIndexes[cursor]!;
    result.unshift(tokens.slice(start, cursor).join(""));
    cursor = start;
  }

  return result;
}

export function splitTextIntoPhrases(text: string, maxCharsPerPhrase = 10, minCharsPerPhrase = 3): string[] {
  const cleaned = text.replace(/\s+/g, "").trim();
  if (!cleaned) return [];
  if (countSubtitleDisplayCharacters(cleaned) <= maxCharsPerPhrase) return [cleanPhraseEnd(cleaned)];

  const segments = cleaned.split(/([，。！？；、：,\.!\?;])/).reduce<string[]>((acc, part, i) => {
    if (i % 2 === 1 && acc.length > 0) {
      acc[acc.length - 1] += part;
    } else if (part) {
      acc.push(part);
    }
    return acc;
  }, []);

  const phrases: string[] = [];
  let current = "";

  for (const seg of segments) {
    if (countSubtitleDisplayCharacters(current + seg) > maxCharsPerPhrase && current) {
      phrases.push(current);
      current = seg;
    } else {
      current += seg;
    }
  }
  if (current) {
    phrases.push(current);
  }

  const split: string[] = [];
  for (const phrase of phrases) {
    if (countSubtitleDisplayCharacters(phrase) <= maxCharsPerPhrase) {
      split.push(phrase);
    } else {
      split.push(...splitLongTextBySemanticBudget(phrase, maxCharsPerPhrase, minCharsPerPhrase));
    }
  }

  const merged: string[] = [];
  for (const phrase of split) {
    const textLength = countSubtitleDisplayCharacters(phrase.replace(trailingAllPunctuation, ""));
    if (merged.length > 0 && textLength < minCharsPerPhrase) {
      const prev = merged[merged.length - 1];
      if (countSubtitleDisplayCharacters(prev + phrase) <= maxCharsPerPhrase) {
        merged[merged.length - 1] = prev + phrase;
        continue;
      }
    }
    merged.push(phrase);
  }

  return merged.map(cleanPhraseEnd);
}
