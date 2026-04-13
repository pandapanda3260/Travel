/**
 * 按 speakerId 覆盖展示用名称（不改存储与上游 API 返回的 ID）。
 * 用于复刻音色、导入槽位等场景下在界面与下拉框中显示友好名称。
 */
const SPEAKER_DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  S_JrhcVlzY1: "李占宁",
};

export function getSpeakerDisplayNameOverride(speakerId: string): string | undefined {
  const key = speakerId.trim();
  return SPEAKER_DISPLAY_NAME_OVERRIDES[key];
}

/** 任务工作台 / 导演模式音色下拉：在服务端 label 基础上强制套用展示名，并保留「（复刻）」后缀。 */
export function resolveTaskVoiceOptionLabel(option: { label: string; value: string }): string {
  const baseOverride = getSpeakerDisplayNameOverride(option.value);
  if (!baseOverride) return option.label;
  const cloneSuffix = "（复刻）";
  if (option.label.includes(cloneSuffix)) {
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
