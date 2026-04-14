export type SubtitlePhrase = {
  text: string;
  startTime: number;
  endTime: number;
};

const phraseSplitPunctuation = /[，。！？；、：,\.!\?;]/;
const trailingNonTerminalPunctuation = /[，、,;；：]+$/;
const trailingAllPunctuation = /[，。！？；、：,\.!\?;]+$/;

function cleanPhraseEnd(text: string): string {
  return text.replace(trailingNonTerminalPunctuation, "");
}

export function groupWordsIntoPhrases(
  words: Array<{ word: string; startTime: number; endTime: number }>,
  maxCharsPerPhrase = 8,
  minCharsPerPhrase = 3,
): SubtitlePhrase[] {
  if (!words.length) return [];

  const rawPhrases: SubtitlePhrase[] = [];
  let currentText = "";
  let currentStart = words[0].startTime;
  let currentEnd = words[0].endTime;

  for (const word of words) {
    const wouldExceed = (currentText + word.word).replace(/\s/g, "").length > maxCharsPerPhrase;
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
    const textLength = phrase.text.replace(trailingAllPunctuation, "").length;
    if (merged.length > 0 && textLength < minCharsPerPhrase) {
      const prev = merged[merged.length - 1];
      if ((prev.text + phrase.text).replace(/\s/g, "").length <= maxCharsPerPhrase + 2) {
        prev.text = prev.text + phrase.text;
        prev.endTime = phrase.endTime;
        continue;
      }
    }
    merged.push({ ...phrase });
  }

  return merged.map((p) => ({ ...p, text: cleanPhraseEnd(p.text) }));
}

export function splitTextIntoPhrases(text: string, maxCharsPerPhrase = 8, minCharsPerPhrase = 3): string[] {
  const cleaned = text.replace(/\s+/g, "").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxCharsPerPhrase) return [cleanPhraseEnd(cleaned)];

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
    if ((current + seg).length > maxCharsPerPhrase && current) {
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
    if (phrase.length <= maxCharsPerPhrase) {
      split.push(phrase);
    } else {
      for (let i = 0; i < phrase.length; i += maxCharsPerPhrase) {
        split.push(phrase.slice(i, i + maxCharsPerPhrase));
      }
    }
  }

  const merged: string[] = [];
  for (const phrase of split) {
    const textLength = phrase.replace(trailingAllPunctuation, "").length;
    if (merged.length > 0 && textLength < minCharsPerPhrase) {
      const prev = merged[merged.length - 1];
      if ((prev + phrase).length <= maxCharsPerPhrase + 2) {
        merged[merged.length - 1] = prev + phrase;
        continue;
      }
    }
    merged.push(phrase);
  }

  return merged.map(cleanPhraseEnd);
}
