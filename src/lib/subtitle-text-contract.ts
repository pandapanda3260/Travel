const subtitleContractIgnoredCharacters = /[\s，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]/g;

export type SubtitleTextIntegrityInput = {
  fullSemanticSentence: string;
  screenSubtitleSentences: Array<{
    text: string;
    lines: string[];
  }>;
  maxLinesPerScreenSentence?: number;
};

export type SubtitleTextIntegrityResult = {
  ok: boolean;
  reason?: "sentence_mismatch" | "line_mismatch" | "too_many_lines" | "empty_line";
};

export function normalizeSubtitleContractText(text: string | null | undefined) {
  return String(text ?? "").replace(subtitleContractIgnoredCharacters, "");
}

function normalizeContractSourceText(text: string | null | undefined) {
  return String(text ?? "").replace(/\s+/g, "").trim();
}

function firstNonEmptyText(values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeContractSourceText(value);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

export function validateSubtitleTextIntegrity(input: SubtitleTextIntegrityInput): SubtitleTextIntegrityResult {
  const maxLinesPerScreenSentence = Math.max(1, Math.round(input.maxLinesPerScreenSentence ?? 2));
  const expected = normalizeSubtitleContractText(input.fullSemanticSentence);
  const screenText = normalizeSubtitleContractText(input.screenSubtitleSentences.map((item) => item.text).join(""));
  if (screenText !== expected) {
    return { ok: false, reason: "sentence_mismatch" };
  }

  for (const item of input.screenSubtitleSentences) {
    if (item.lines.length > maxLinesPerScreenSentence) {
      return { ok: false, reason: "too_many_lines" };
    }
    if (item.lines.some((line) => !normalizeSubtitleContractText(line))) {
      return { ok: false, reason: "empty_line" };
    }
    if (normalizeSubtitleContractText(item.lines.join("")) !== normalizeSubtitleContractText(item.text)) {
      return { ok: false, reason: "line_mismatch" };
    }
  }

  return { ok: true };
}

type NarrationClipTextContractShape = {
  fullSemanticSentence?: string | null;
  narrationText?: string | null;
  spokenText?: string | null;
  subtitleText?: string | null;
  hasVoice?: boolean;
  hasSubtitle?: boolean;
};

export function normalizeNarrationClipTextContract<T extends NarrationClipTextContractShape>(
  clip: T,
): T & { fullSemanticSentence: string; narrationText: string; spokenText: string; subtitleText: string } {
  const hasVoice = clip.hasVoice !== false;
  const hasSubtitle = clip.hasSubtitle !== false;
  const fullSemanticSentence = firstNonEmptyText([
    clip.fullSemanticSentence,
    hasVoice ? clip.spokenText : null,
    clip.narrationText,
    hasVoice ? clip.subtitleText : null,
    clip.subtitleText,
    clip.spokenText,
  ]);

  return {
    ...clip,
    fullSemanticSentence,
    narrationText: hasVoice ? fullSemanticSentence : "",
    spokenText: hasVoice ? fullSemanticSentence : "",
    subtitleText: hasSubtitle ? fullSemanticSentence : "",
  };
}

export function resolveNarrationClipFullSemanticText(clip: NarrationClipTextContractShape) {
  return normalizeNarrationClipTextContract(clip).fullSemanticSentence;
}

export function resolveNarrationClipSpokenText(clip: NarrationClipTextContractShape) {
  return normalizeNarrationClipTextContract(clip).spokenText;
}

export function resolveNarrationClipSubtitleText(clip: NarrationClipTextContractShape) {
  return normalizeNarrationClipTextContract(clip).subtitleText;
}
