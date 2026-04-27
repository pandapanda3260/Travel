import { getUnifiedTimbreCatalog, resolveTimbreResourceId } from "./doubao-timbre-service";
import { getSpeakerDisplayNameOverride, resolveClonedVoiceDisplayName } from "./speaker-display-overrides";
import { listClonedVoices, listFavoriteSpeakerIds } from "./voice-management-store";

export type TaskCreationVoiceOption = {
  label: string;
  value: string;
  description?: string;
  group: "my" | "fav";
};

export async function listTaskCreationVoiceOptions(userId?: string | null): Promise<TaskCreationVoiceOption[]> {
  const catalog = await getUnifiedTimbreCatalog();
  const catalogMap = new Map(catalog.map((item) => [item.speakerId, item]));

  const clonedVoices = listClonedVoices(userId)
    .filter((voice) => voice.status === "SUCCESS" || voice.status === "ACTIVE")
    .filter((voice) => Boolean(resolveTimbreResourceId(voice.speakerId)));

  const favoriteIds = listFavoriteSpeakerIds(userId);
  const clonedSpeakerIds = new Set(clonedVoices.map((voice) => voice.speakerId));

  const cloneOptions = clonedVoices.map((voice) => ({
    label: `${resolveClonedVoiceDisplayName(
      voice.speakerId,
      voice.alias ?? catalogMap.get(voice.speakerId)?.speakerName,
      voice.title,
    )}（复刻）`,
    value: voice.speakerId,
    description: voice.transcript,
    group: "my" as const,
  }));

  const favoriteOptions = favoriteIds
    .filter((speakerId) => !clonedSpeakerIds.has(speakerId))
    .map((speakerId) => catalogMap.get(speakerId))
    .filter((item) => item && Boolean(resolveTimbreResourceId(item.speakerId)))
    .map((item) => ({
      label: `${getSpeakerDisplayNameOverride(item!.speakerId) ?? item!.speakerName}`,
      value: item!.speakerId,
      description: item!.description,
      group: "fav" as const,
    }));

  return [...cloneOptions, ...favoriteOptions];
}
