import {
  countNarrationCharacters,
  inferCharacterFocus,
  getNarrationLengthGuidance,
  sanitizeNarrationText,
  summarizePrompt,
  trimNarrationToCharacterLimit,
  type NarrationDraft,
  type NarrationDraftClip,
} from "./narration";
import type { VideoCompositionRecord } from "./video-composition-store";

type GenerateNarrationInput = {
  prompt: string;
  totalDurationSeconds: number;
  composition: VideoCompositionRecord | null;
};

function clampNarrationTextLength(text: string, durationSeconds: number, fallback: string) {
  const guidance = getNarrationLengthGuidance(durationSeconds);
  const normalized = sanitizeNarrationText(text, { stripTerminalPunctuation: false });
  const fallbackNormalized = sanitizeNarrationText(fallback, { stripTerminalPunctuation: false });

  if (!normalized) return fallbackNormalized;

  if (countNarrationCharacters(normalized) <= guidance.maxCharacters) {
    return sanitizeNarrationText(normalized);
  }

  return trimNarrationToCharacterLimit(normalized, guidance.maxCharacters);
}

export function buildUnifiedSubtitleAndNarrationText(text: string, durationSeconds: number, fallback: string) {
  return clampNarrationTextLength(text, durationSeconds, fallback);
}

function parseNarrationShots(prompt: string, segmentCount: number): string[] {
  const pattern = /(镜头|片段)\s*(\d+)\s*[.．、:：]?\s*/g;
  const matches = Array.from(prompt.matchAll(pattern));

  if (matches.length === 0) {
    const lines = prompt
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    return Array.from({ length: segmentCount }, (_, i) => lines[i] ?? lines[0] ?? prompt.trim());
  }

  const parsed: Array<{ index: number; text: string }> = matches.map((match, mi) => {
    const startIdx = (match.index ?? 0) + match[0].length;
    const endIdx = matches[mi + 1]?.index ?? prompt.length;
    return { index: Number(match[2]), text: prompt.slice(startIdx, endIdx).trim() };
  });

  return Array.from({ length: segmentCount }, (_, i) => {
    const shotNum = i + 1;
    const found = parsed.find((p) => p.index === shotNum);
    return found?.text ?? parsed[i]?.text ?? parsed[0]?.text ?? prompt.trim();
  });
}

export async function generateNarrationDraft(input: GenerateNarrationInput): Promise<NarrationDraft> {
  const segmentCount = Math.max(input.composition?.segments.length ?? 1, 1);
  const perSegmentDuration = Math.max(1, Math.round(input.totalDurationSeconds / segmentCount));
  const shotTexts = parseNarrationShots(input.prompt, segmentCount);

  let accumulated = 0;
  const clips: NarrationDraftClip[] = Array.from({ length: segmentCount }, (_, index) => {
    const segment = input.composition?.segments[index];
    const segmentDuration =
      segment?.durationSeconds && segment.durationSeconds > 0
        ? Math.max(1, Math.round(segment.durationSeconds))
        : perSegmentDuration;
    const rawText = shotTexts[index] ?? "";
    const characterFocus = inferCharacterFocus(rawText || input.prompt);
    const visualFocus = summarizePrompt(segment?.promptSnapshot || rawText, 38);
    const fallbackText = `${characterFocus}的精彩瞬间。`;
    const narrationText = clampNarrationTextLength(rawText, segmentDuration, fallbackText);

    const clip: NarrationDraftClip = {
      id: `shot-${index + 1}`,
      cueId: `cue-${index + 1}`,
      shotIndex: index + 1,
      segmentId: segment?.id ?? null,
      segmentIndex: index + 1,
      bindToSegmentId: segment?.id ?? null,
      startAtSeconds: accumulated,
      durationSeconds: segmentDuration,
      audioDurationSeconds: null,
      characterFocus,
      visualFocus,
      narrationText,
      subtitleText: narrationText,
      note: `镜头 ${index + 1}`,
      hasVoice: true,
      hasSubtitle: true,
      requiresLipSync: false,
      audioUrl: null,
      words: [],
    };

    accumulated += segmentDuration;
    return clip;
  });

  return {
    title: `${input.composition?.title ?? "解说"} · 解说草案`,
    sourcePrompt: input.prompt,
    totalDurationSeconds: input.totalDurationSeconds,
    strategySummary: "按镜头解析解说词文本，自动分配时间并裁剪字数。",
    clips,
  };
}
