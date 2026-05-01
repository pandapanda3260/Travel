import type { VideoCompositionRecord } from "./video-composition-store";
import type { SubtitleDisplayCueInput } from "./subtitle-display";
import type { TimedWord } from "./video-task-schema";

export type SubtitleLine = string;

export type ScreenSubtitleSentence = {
  text: string;
  lines: SubtitleLine[];
  sourceStartIndex?: number;
  sourceEndIndex?: number;
};

export type AudioAlignmentSource =
  | "provider_char"
  | "provider_word"
  | "provider_sentence"
  | "forced_alignment"
  | "estimated";

export type AudioAlignment = {
  audioDurationSeconds: number | null;
  source: AudioAlignmentSource;
  confidence: "high" | "medium" | "low";
  charTimestamps?: Array<{ char: string; index: number; startTime: number; endTime: number }>;
  wordTimestamps?: TimedWord[];
  sentenceTimestamps?: Array<{ sentenceIndex: number; startTime: number; endTime: number }>;
};

export type NarrationDraftClip = {
  id: string;
  cueId?: string;
  shotIndex: number;
  segmentId?: string | null;
  segmentIndex?: number | null;
  bindToSegmentId: string | null;
  startAtSeconds: number;
  durationSeconds: number;
  audioDurationSeconds?: number | null;
  characterFocus: string;
  visualFocus: string;
  fullSemanticSentence?: string | null;
  narrationText: string;
  subtitleText: string;
  spokenText?: string | null;
  screenSubtitleSentences?: ScreenSubtitleSentence[] | null;
  audioAlignment?: AudioAlignment | null;
  note: string;
  hasVoice?: boolean;
  hasSubtitle?: boolean;
  requiresLipSync?: boolean;
  voiceId?: string | null;
  audioUrl?: string | null;
  words?: TimedWord[];
  subtitleDisplayCues?: SubtitleDisplayCueInput[] | null;
};

export type NarrationDraft = {
  resultId?: string;
  title: string;
  sourcePrompt: string;
  totalDurationSeconds: number;
  strategySummary: string;
  clips: NarrationDraftClip[];
};

const punctuationOnlyPattern = /[\s，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]+/g;
const terminalPunctuationPattern = /[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]+$/u;
const terminalOhPattern = /哦+[，。！？；、：,.!?;'"“”‘’（）()【】《》…—-]*$/u;

const characterPatterns = [
  { label: "孙悟空", regex: /(孙悟空|悟空|齐天大圣|猴王)/ },
  { label: "唐僧", regex: /(唐僧|师父|玄奘)/ },
  { label: "猪八戒", regex: /(猪八戒|八戒|天蓬)/ },
  { label: "沙僧", regex: /(沙僧|沙和尚)/ },
  { label: "前台", regex: /(前台|接待|礼宾)/ },
  { label: "客人", regex: /(客人|旅客|住客|宾客)/ },
  { label: "服务员", regex: /(服务员|侍者|管家)/ },
  { label: "调酒师", regex: /(调酒师|酒保|吧台)/ },
  { label: "儿童", regex: /(儿童|孩子|小朋友|萌娃)/ },
  { label: "情侣", regex: /(情侣|爱人|恋人)/ },
  { label: "新娘", regex: /(新娘)/ },
  { label: "新郎", regex: /(新郎)/ },
  { label: "主讲人", regex: /(讲解|主持|主讲)/ },
];

export function inferCharacterFocus(source: string) {
  const matches = characterPatterns.filter((item) => item.regex.test(source)).map((item) => item.label);
  return matches.length ? Array.from(new Set(matches)).join(" / ") : "主角";
}

export function summarizePrompt(source: string, limit = 56) {
  const compact = source.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

export function countNarrationSpeechUnits(text: string) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return 0;
  }

  const chineseCharacters = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = normalized.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;

  return chineseCharacters + latinWords * 2;
}

export function countNarrationCharacters(text: string) {
  return countNarrationSpeechUnits(String(text ?? "").replace(punctuationOnlyPattern, ""));
}

export function sanitizeNarrationText(
  text: string | null | undefined,
  options?: {
    stripLeadingDayPrefix?: boolean;
    stripTerminalPunctuation?: boolean;
    removeTerminalOh?: boolean;
  },
) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/([，。！？；、：,.!?;]){2,}/g, "$1")
    .trim();

  if (!normalized) {
    return "";
  }

  let result = normalized;
  if (options?.stripLeadingDayPrefix) {
    result = result.replace(/^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)[：:，、|｜-]*/i, "");
  }
  if (options?.removeTerminalOh !== false) {
    result = result.replace(terminalOhPattern, "");
  }
  if (options?.stripTerminalPunctuation !== false) {
    result = result.replace(terminalPunctuationPattern, "");
  }

  return result.trim();
}

export function normalizeNarrationSpokenText(
  text: string | null | undefined,
  options?: {
    stripLeadingDayPrefix?: boolean;
    removeTerminalOh?: boolean;
  },
) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/([，。！？；、：,.!?;]){2,}/g, "$1")
    .trim();

  if (!normalized) {
    return "";
  }

  let result = normalized;
  if (options?.stripLeadingDayPrefix) {
    result = result.replace(/^(?:第[一二三四五六七八九十两\d]+天|Day\s*\d+)[：:，、|｜-]*/i, "");
  }
  if (options?.removeTerminalOh !== false) {
    result = result.replace(terminalOhPattern, "");
  }

  return result.trim();
}

export function trimNarrationToCharacterLimit(text: string, maxCharacters: number) {
  const sanitized = sanitizeNarrationText(text, { stripTerminalPunctuation: false });
  if (!sanitized) {
    return "";
  }

  if (countNarrationCharacters(sanitized) <= maxCharacters) {
    return sanitizeNarrationText(sanitized);
  }

  const sentences = sanitized.split(/(?<=[，。！？；])/).filter(Boolean);
  if (sentences.length > 1) {
    let assembled = "";
    for (const sentence of sentences) {
      if (countNarrationCharacters(assembled + sentence) > maxCharacters) {
        break;
      }
      assembled += sentence;
    }
    if (assembled) {
      return sanitizeNarrationText(assembled);
    }
  }

  let result = "";
  for (const char of Array.from(sanitized)) {
    if (countNarrationCharacters(result + char) > maxCharacters) {
      break;
    }
    result += char;
  }

  return sanitizeNarrationText(result);
}

export const NARRATION_LENGTH_GUIDANCE_MIN_RATE = 1.3;
export const NARRATION_LENGTH_GUIDANCE_SUGGESTED_RATE = 3.4;
export const NARRATION_LENGTH_GUIDANCE_MAX_RATE = 5.6;
export const NARRATION_LENGTH_GUIDANCE_MIN_FLOOR = 6;
export const NARRATION_LENGTH_GUIDANCE_SUGGESTED_OFFSET = 2;
export const NARRATION_LENGTH_GUIDANCE_MAX_OFFSET = 4;
export const NARRATION_REPAIR_TRIGGER_EXTRA_MIN = 6;
export const NARRATION_REPAIR_TRIGGER_EXTRA_RATIO = 0.2;
export const NARRATION_EMERGENCY_TRIM_EXTRA_MIN = 10;
export const NARRATION_EMERGENCY_TRIM_EXTRA_RATIO = 0.35;
export const NARRATION_DURATION_OVERFLOW_TOLERANCE_MIN_SECONDS = 0.8;
export const NARRATION_DURATION_OVERFLOW_TOLERANCE_RATIO = 0.18;

export function getNarrationLengthGuidance(durationSeconds: number) {
  const normalizedDuration = Math.max(1, Number(durationSeconds) || 1);
  const minCharacters = Math.max(
    NARRATION_LENGTH_GUIDANCE_MIN_FLOOR,
    Math.floor(normalizedDuration * NARRATION_LENGTH_GUIDANCE_MIN_RATE),
  );
  const suggestedCharacters = Math.max(
    minCharacters + NARRATION_LENGTH_GUIDANCE_SUGGESTED_OFFSET,
    Math.floor(normalizedDuration * NARRATION_LENGTH_GUIDANCE_SUGGESTED_RATE),
  );
  const maxCharacters = Math.max(
    suggestedCharacters + NARRATION_LENGTH_GUIDANCE_MAX_OFFSET,
    Math.floor(normalizedDuration * NARRATION_LENGTH_GUIDANCE_MAX_RATE),
  );

  return {
    minCharacters,
    maxCharacters,
    suggestedCharacters,
  };
}

export function buildNarrationLengthGuidanceDescription(exampleDurationSeconds: number) {
  const duration = Math.max(1, Number(exampleDurationSeconds) || 1);
  const guidance = getNarrationLengthGuidance(duration);
  const repairTriggerCharacters = getNarrationRepairTriggerCharacters(duration);
  const emergencyTrimCharacters = getNarrationEmergencyTrimCharacters(duration);
  return [
    `程序使用 getNarrationLengthGuidance() 预算字数：minCharacters = max(${NARRATION_LENGTH_GUIDANCE_MIN_FLOOR}, floor(D×${NARRATION_LENGTH_GUIDANCE_MIN_RATE}))`,
    `suggestedCharacters = max(min+${NARRATION_LENGTH_GUIDANCE_SUGGESTED_OFFSET}, floor(D×${NARRATION_LENGTH_GUIDANCE_SUGGESTED_RATE}))`,
    `maxCharacters = max(suggested+${NARRATION_LENGTH_GUIDANCE_MAX_OFFSET}, floor(D×${NARRATION_LENGTH_GUIDANCE_MAX_RATE}))。`,
    `示例 D=${duration} 秒：min=${guidance.minCharacters}，suggested=${guidance.suggestedCharacters}，max=${guidance.maxCharacters}（不含标点与空格）。`,
    `系统只会在文本明显超出安全区时才触发修文或硬裁：repairTrigger≈${repairTriggerCharacters}，emergencyTrim≈${emergencyTrimCharacters}。`,
  ].join("；");
}

export function estimateNarrationReadingSeconds(text: string) {
  const normalized = sanitizeNarrationText(text, {
    stripTerminalPunctuation: false,
    removeTerminalOh: false,
  });
  const speechUnits = countNarrationSpeechUnits(normalized);
  if (!speechUnits) {
    return 0;
  }

  const pauseCount = normalized.match(/[，。！？；、：,.!?;]/g)?.length ?? 0;
  return Number((speechUnits / 3.6 + pauseCount * 0.12).toFixed(1));
}

export function getNarrationRepairTriggerCharacters(durationSeconds: number) {
  const guidance = getNarrationLengthGuidance(durationSeconds);
  return (
    guidance.maxCharacters +
    Math.max(
      NARRATION_REPAIR_TRIGGER_EXTRA_MIN,
      Math.floor(guidance.maxCharacters * NARRATION_REPAIR_TRIGGER_EXTRA_RATIO),
    )
  );
}

export function getNarrationEmergencyTrimCharacters(durationSeconds: number) {
  const guidance = getNarrationLengthGuidance(durationSeconds);
  return (
    guidance.maxCharacters +
    Math.max(
      NARRATION_EMERGENCY_TRIM_EXTRA_MIN,
      Math.floor(guidance.maxCharacters * NARRATION_EMERGENCY_TRIM_EXTRA_RATIO),
    )
  );
}

export function getNarrationDurationOverflowTolerance(durationSeconds: number) {
  return Math.max(
    NARRATION_DURATION_OVERFLOW_TOLERANCE_MIN_SECONDS,
    (Number(durationSeconds) || 0) * NARRATION_DURATION_OVERFLOW_TOLERANCE_RATIO,
  );
}

export function isNarrationClearlyOverDuration(text: string, durationSeconds: number) {
  if (durationSeconds <= 0) {
    return false;
  }

  return (
    estimateNarrationReadingSeconds(text) > durationSeconds + getNarrationDurationOverflowTolerance(durationSeconds)
  );
}

export function isNarrationSpeechRateTooSlow(text: string, actualDurationSeconds: number) {
  const speechUnits = countNarrationSpeechUnits(text);
  if (!speechUnits || actualDurationSeconds <= 0) {
    return false;
  }

  return speechUnits / actualDurationSeconds < 1.85;
}

export function buildCompositionPromptSummary(composition: VideoCompositionRecord) {
  const promptSnapshots = composition.segments
    .map((segment) => segment.promptSnapshot?.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (promptSnapshots.length === 0) {
    return composition.title;
  }

  return promptSnapshots.join("；");
}

function buildShotNarrationLine(shotIndex: number, characterFocus: string, visualFocus: string, totalShots: number) {
  if (totalShots === 1) {
    return `画面聚焦${characterFocus}，${visualFocus}，用更凝练的节奏完成整段解说。`;
  }

  if (shotIndex === 0) {
    return `开场先把镜头交给${characterFocus}，${visualFocus}，把观众快速带进当前情境。`;
  }

  if (shotIndex === totalShots - 1) {
    return `最后收束到${characterFocus}，${visualFocus}，让整段解说与镜头情绪自然落下。`;
  }

  return `这一镜继续跟随${characterFocus}，${visualFocus}，把情绪和动作顺势往下推进。`;
}

export function buildNarrationDraftFromComposition(
  composition: VideoCompositionRecord,
  prompt: string,
  totalDurationSeconds: number,
) {
  const segmentCount = Math.max(composition.segments.length, 1);
  let accumulated = 0;

  const clips = composition.segments.map((segment, index) => {
    const segmentDuration =
      segment.durationSeconds && segment.durationSeconds > 0
        ? Math.max(1, Math.round(segment.durationSeconds))
        : Math.max(1, Math.round(totalDurationSeconds / segmentCount));
    const characterFocus = inferCharacterFocus(`${segment.promptSnapshot ?? ""} ${prompt}`);
    const visualFocus = summarizePrompt(segment.promptSnapshot || segment.sourceJobId || composition.title, 38);
    const narrationText = buildShotNarrationLine(index, characterFocus, visualFocus, segmentCount);
    const clip = {
      id: `shot-${index + 1}`,
      cueId: `cue-${index + 1}`,
      shotIndex: index + 1,
      segmentId: segment.id,
      segmentIndex: index + 1,
      bindToSegmentId: segment.id,
      startAtSeconds: accumulated,
      durationSeconds: segmentDuration,
      audioDurationSeconds: null,
      characterFocus,
      visualFocus,
      narrationText,
      subtitleText: narrationText,
      note: `镜头 ${segment.order + 1} · ${characterFocus}`,
      hasVoice: true,
      hasSubtitle: true,
      requiresLipSync: false,
      audioUrl: null,
      words: [],
    } satisfies NarrationDraftClip;

    accumulated += segmentDuration;
    return clip;
  });

  return {
    title: `${composition.title} · 解说草案`,
    sourcePrompt: prompt,
    totalDurationSeconds,
    strategySummary: "按镜头逐段生成解说，并为每一段保留人物锚点与镜头绑定信息。",
    clips,
  } satisfies NarrationDraft;
}

export function buildNarrationDraftFromPrompt(prompt: string, totalDurationSeconds: number) {
  const clipDuration = Math.max(4, Math.round(totalDurationSeconds));
  const characterFocus = inferCharacterFocus(prompt);
  const narrationText = `围绕${characterFocus}展开解说，重点交代${summarizePrompt(prompt, 36)}，整体节奏与视频时长保持一致。`;

  return {
    title: "解说草案",
    sourcePrompt: prompt,
    totalDurationSeconds,
    strategySummary: "未提供镜头信息时，按整段视频输出单段解说草案。",
    clips: [
      {
        id: "shot-1",
        cueId: "cue-1",
        shotIndex: 1,
        segmentId: null,
        segmentIndex: 1,
        bindToSegmentId: null,
        startAtSeconds: 0,
        durationSeconds: clipDuration,
        audioDurationSeconds: null,
        characterFocus,
        visualFocus: summarizePrompt(prompt, 38),
        narrationText,
        subtitleText: narrationText,
        note: "整段视频默认单镜头解说",
        hasVoice: true,
        hasSubtitle: true,
        requiresLipSync: false,
        audioUrl: null,
        words: [],
      },
    ],
  } satisfies NarrationDraft;
}

export function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
}
