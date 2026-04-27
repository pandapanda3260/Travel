import { existsSync, unlinkSync } from "node:fs";

import { dbGetSingleton, dbSetSingleton, migrateJsonSingletonIfNeeded } from "./db";
import { ensureRuntimeDataDir, joinRuntimeDataPath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { getSpeakerDisplayNameOverride, isGenericCloneDisplayName } from "./speaker-display-overrides";

export type ClonedVoiceRecord = {
  cloneId: string;
  ownerUserId: string | null;
  title: string;
  speakerId: string;
  alias: string | null;
  status: "PENDING" | "TRAINING" | "SUCCESS" | "ACTIVE" | "FAILED";
  language: "cn" | "en";
  modelType: 4 | 5;
  sourceFileName: string;
  sourceFormat: string;
  transcript: string;
  demoAudioUrl: string | null;
  trainingVersion: string | null;
  availableTrainingTimes: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type VoiceManagementUserState = {
  addedSpeakerIds: string[];
  searchDisplaySpeakerIds: string[];
  favoriteSpeakerIds: string[];
};

type VoiceManagementStore = {
  addedSpeakerIds: string[];
  searchDisplaySpeakerIds: string[];
  favoriteSpeakerIds: string[];
  clonedVoices: ClonedVoiceRecord[];
  userStates: Record<string, VoiceManagementUserState>;
};

const COLLECTION = "voice-management";
const legacyJsonPath = joinRuntimeDataPath("voice-management.json");

let migrated = false;
function ensureStore() {
  ensureRuntimeDataDir();
  if (!migrated) {
    migrateJsonSingletonIfNeeded(COLLECTION, legacyJsonPath);
    migrated = true;
  }
}

function readStore(): VoiceManagementStore {
  ensureStore();
  const stored = dbGetSingleton<Partial<VoiceManagementStore>>(COLLECTION);
  return {
    addedSpeakerIds: stored?.addedSpeakerIds ?? [],
    searchDisplaySpeakerIds: stored?.searchDisplaySpeakerIds ?? [],
    favoriteSpeakerIds: stored?.favoriteSpeakerIds ?? [],
    clonedVoices: (stored?.clonedVoices ?? []).map((item) => ({
      ...item,
      ownerUserId: item.ownerUserId ?? null,
    })),
    userStates: Object.fromEntries(
      Object.entries(stored?.userStates ?? {}).map(([userId, state]) => [
        userId,
        {
          addedSpeakerIds: state?.addedSpeakerIds ?? [],
          searchDisplaySpeakerIds: state?.searchDisplaySpeakerIds ?? [],
          favoriteSpeakerIds: state?.favoriteSpeakerIds ?? [],
        },
      ]),
    ),
  };
}

function writeStore(store: VoiceManagementStore) {
  ensureStore();
  dbSetSingleton(COLLECTION, store);
}

function deleteLocalDemoAudio(audioUrl: string | null | undefined) {
  if (!audioUrl?.startsWith("/")) {
    return;
  }

  const localPath = resolveRuntimeAssetUrlToPath(audioUrl);
  if (existsSync(localPath)) {
    unlinkSync(localPath);
  }
}

function getUserState(store: VoiceManagementStore, userId?: string | null): VoiceManagementUserState {
  if (!userId) {
    return {
      addedSpeakerIds: store.addedSpeakerIds,
      searchDisplaySpeakerIds: store.searchDisplaySpeakerIds,
      favoriteSpeakerIds: store.favoriteSpeakerIds,
    };
  }

  const userState = store.userStates[userId];
  return {
    addedSpeakerIds: userState?.addedSpeakerIds ?? store.addedSpeakerIds,
    searchDisplaySpeakerIds: userState?.searchDisplaySpeakerIds ?? store.searchDisplaySpeakerIds,
    favoriteSpeakerIds: userState?.favoriteSpeakerIds ?? store.favoriteSpeakerIds,
  };
}

function updateUserState(
  store: VoiceManagementStore,
  userId: string | null | undefined,
  updater: (state: VoiceManagementUserState) => VoiceManagementUserState,
) {
  if (!userId) {
    const next = updater(getUserState(store));
    store.addedSpeakerIds = next.addedSpeakerIds;
    store.searchDisplaySpeakerIds = next.searchDisplaySpeakerIds;
    store.favoriteSpeakerIds = next.favoriteSpeakerIds;
    writeStore(store);
    return next;
  }

  const next = updater(getUserState(store, userId));
  store.userStates[userId] = next;
  writeStore(store);
  return next;
}

export function listAddedSpeakerIds(userId?: string | null) {
  return getUserState(readStore(), userId).addedSpeakerIds;
}

export function listSearchDisplaySpeakerIds(userId?: string | null) {
  const state = getUserState(readStore(), userId);
  return state.searchDisplaySpeakerIds.length > 0 ? state.searchDisplaySpeakerIds : state.addedSpeakerIds;
}

export function addSpeakerToLibrary(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    addedSpeakerIds: state.addedSpeakerIds.includes(speakerId) ? state.addedSpeakerIds : [speakerId, ...state.addedSpeakerIds],
  })).addedSpeakerIds;
}

export function removeSpeakerFromLibrary(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    addedSpeakerIds: state.addedSpeakerIds.filter((item) => item !== speakerId),
  })).addedSpeakerIds;
}

export function addSpeakerToSearchDisplay(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    searchDisplaySpeakerIds: state.searchDisplaySpeakerIds.includes(speakerId)
      ? state.searchDisplaySpeakerIds
      : [speakerId, ...state.searchDisplaySpeakerIds],
  })).searchDisplaySpeakerIds;
}

export function removeSpeakerFromSearchDisplay(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    searchDisplaySpeakerIds: state.searchDisplaySpeakerIds.filter((item) => item !== speakerId),
  })).searchDisplaySpeakerIds;
}

export function listClonedVoices(userId?: string | null) {
  return [...readStore().clonedVoices]
    .filter((item) => !userId || item.ownerUserId === null || item.ownerUserId === userId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function repairClonedVoiceDisplayNames(userId?: string | null) {
  const store = readStore();
  const updatedAt = new Date().toISOString();
  let changed = false;

  store.clonedVoices = store.clonedVoices.map((record) => {
    if (userId && record.ownerUserId !== null && record.ownerUserId !== userId) {
      return record;
    }

    const displayName = getSpeakerDisplayNameOverride(record.speakerId);
    if (!displayName) {
      return record;
    }

    const nextTitle = isGenericCloneDisplayName(record.title, record.speakerId) ? displayName : record.title;
    const nextAlias = isGenericCloneDisplayName(record.alias, record.speakerId) ? displayName : record.alias;
    if (nextTitle === record.title && nextAlias === record.alias) {
      return record;
    }

    changed = true;
    return {
      ...record,
      title: nextTitle,
      alias: nextAlias,
      updatedAt,
    };
  });

  if (changed) {
    writeStore(store);
  }

  return changed;
}

export function countOwnedClonedVoices(userId: string) {
  return readStore().clonedVoices.filter((item) => item.ownerUserId === userId).length;
}

export function getClonedVoice(cloneId: string, userId?: string | null) {
  return listClonedVoices(userId).find((item) => item.cloneId === cloneId) ?? null;
}

export function upsertClonedVoice(record: ClonedVoiceRecord) {
  const store = readStore();
  const index = store.clonedVoices.findIndex((item) => item.cloneId === record.cloneId);

  if (index >= 0) {
    const previous = store.clonedVoices[index];
    if (previous.demoAudioUrl && previous.demoAudioUrl !== record.demoAudioUrl) {
      deleteLocalDemoAudio(previous.demoAudioUrl);
    }
    store.clonedVoices[index] = record;
  } else {
    store.clonedVoices.unshift(record);
  }

  writeStore(store);
  return record;
}

export function patchClonedVoice(cloneId: string, updates: Partial<ClonedVoiceRecord>, userId?: string | null) {
  const store = readStore();
  const index = store.clonedVoices.findIndex((item) => item.cloneId === cloneId);

  if (index < 0) {
    return null;
  }

  const current = store.clonedVoices[index];
  if (userId && current.ownerUserId !== userId) {
    return null;
  }
  const next = {
    ...current,
    ...updates,
    ownerUserId: updates.ownerUserId ?? current.ownerUserId ?? null,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  } satisfies ClonedVoiceRecord;

  if (current.demoAudioUrl && current.demoAudioUrl !== next.demoAudioUrl) {
    deleteLocalDemoAudio(current.demoAudioUrl);
  }

  store.clonedVoices[index] = next;
  writeStore(store);
  return next;
}

export function listFavoriteSpeakerIds(userId?: string | null) {
  return getUserState(readStore(), userId).favoriteSpeakerIds;
}

export function addFavoriteSpeaker(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    favoriteSpeakerIds: state.favoriteSpeakerIds.includes(speakerId)
      ? state.favoriteSpeakerIds
      : [speakerId, ...state.favoriteSpeakerIds],
  })).favoriteSpeakerIds;
}

export function removeFavoriteSpeaker(speakerId: string, userId?: string | null) {
  const store = readStore();
  return updateUserState(store, userId, (state) => ({
    ...state,
    favoriteSpeakerIds: state.favoriteSpeakerIds.filter((id) => id !== speakerId),
  })).favoriteSpeakerIds;
}

export function isFavoriteSpeaker(speakerId: string, userId?: string | null) {
  return getUserState(readStore(), userId).favoriteSpeakerIds.includes(speakerId);
}

export function deleteClonedVoice(cloneId: string, userId?: string | null) {
  const store = readStore();
  const index = store.clonedVoices.findIndex((item) => item.cloneId === cloneId);

  if (index < 0) {
    return null;
  }

  const current = store.clonedVoices[index];
  if (userId && current.ownerUserId && current.ownerUserId !== userId) {
    return null;
  }
  deleteLocalDemoAudio(current.demoAudioUrl);
  store.clonedVoices.splice(index, 1);
  writeStore(store);
  return current;
}
