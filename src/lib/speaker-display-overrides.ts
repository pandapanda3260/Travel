/**
 * 按 speakerId 覆盖展示用名称（不改存储与上游 API 返回的 ID）。
 * 用于复刻音色、导入槽位等场景下在界面与下拉框中显示友好名称。
 */
const SPEAKER_DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  S_JrhcVlzY1: "李占宁",
  S_LrhcVlzY1: "沙僧",
};

const TASK_VOICE_CLONE_SUFFIXES = ["（复刻）", "(复刻)"] as const;
const SPEAKER_ID_PATTERN = /\bS_[A-Za-z0-9_]+\b/;

function normalizeSpeakerDisplayKey(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "");
}

export function getSpeakerDisplayNameOverride(speakerId: string): string | undefined {
  const key = normalizeSpeakerDisplayKey(speakerId);
  return SPEAKER_DISPLAY_NAME_OVERRIDES[key];
}

export function isGenericCloneDisplayName(value: string | null | undefined, speakerId: string) {
  const normalizedValue = normalizeSpeakerDisplayKey(value);
  if (!normalizedValue) {
    return true;
  }

  const normalizedSpeakerId = normalizeSpeakerDisplayKey(speakerId);
  return (
    normalizedValue === normalizedSpeakerId ||
    normalizedValue === normalizeSpeakerDisplayKey(`导入音色 ${speakerId}`)
  );
}

function extractSpeakerIdFromTaskVoiceOption(option: { label: string; value: string }) {
  const directMatch = normalizeSpeakerDisplayKey(option.value);
  if (SPEAKER_DISPLAY_NAME_OVERRIDES[directMatch]) {
    return directMatch;
  }

  const label = String(option.label ?? "").trim();
  const labelWithoutCloneSuffix = TASK_VOICE_CLONE_SUFFIXES.reduce(
    (current, suffix) => (current.endsWith(suffix) ? current.slice(0, -suffix.length) : current),
    label,
  );
  const labelMatch = label.match(SPEAKER_ID_PATTERN)?.[0] ?? "";
  const candidates = [labelWithoutCloneSuffix, labelMatch];

  for (const candidate of candidates) {
    const normalized = normalizeSpeakerDisplayKey(candidate);
    if (SPEAKER_DISPLAY_NAME_OVERRIDES[normalized]) {
      return normalized;
    }
  }

  return "";
}

/** 任务工作台 / 导演模式音色下拉：在服务端 label 基础上强制套用展示名，并保留「（复刻）」后缀。 */
export function resolveTaskVoiceOptionLabel(option: { label: string; value: string }): string {
  const speakerId = extractSpeakerIdFromTaskVoiceOption(option);
  const baseOverride = speakerId ? getSpeakerDisplayNameOverride(speakerId) : undefined;
  if (!baseOverride) return option.label;

  const cloneSuffix = TASK_VOICE_CLONE_SUFFIXES.find((suffix) => option.label.includes(suffix));
  if (cloneSuffix) {
    return `${baseOverride}${cloneSuffix}`;
  }
  return baseOverride;
}

export function resolveClonedVoiceDisplayName(
  speakerId: string,
  alias: string | null | undefined,
  title: string | null | undefined,
): string {
  const override = getSpeakerDisplayNameOverride(speakerId);
  if (override) return override;
  const fromAlias = String(alias ?? "").trim();
  if (fromAlias) return fromAlias;
  const fromTitle = String(title ?? "").trim();
  if (fromTitle) return fromTitle;
  return speakerId;
}

type TimbreDisplayFields = {
  speakerId: string;
  speakerName: string;
  avatarText: string;
};

export function applySpeakerDisplayNameOverride<T extends TimbreDisplayFields>(item: T): T {
  const override = getSpeakerDisplayNameOverride(item.speakerId);
  if (!override) return item;
  const trimmed = override.trim();
  return {
    ...item,
    speakerName: override,
    avatarText: trimmed ? trimmed.slice(0, 1) : "声",
  };
}

export function mapTimbreCatalogDisplayOverrides<T extends TimbreDisplayFields>(items: readonly T[]): T[] {
  return items.map((item) => applySpeakerDisplayNameOverride(item));
}
