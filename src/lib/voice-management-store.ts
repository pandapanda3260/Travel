import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dbGetSingleton, dbSetSingleton, migrateJsonSingletonIfNeeded } from "./db";

export type ClonedVoiceRecord = {
  cloneId: string;
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

type VoiceManagementStore = {
  addedSpeakerIds: string[];
  searchDisplaySpeakerIds: string[];
  favoriteSpeakerIds: string[];
  clonedVoices: ClonedVoiceRecord[];
};

const dataDir = join(process.cwd(), "data");
const COLLECTION = "voice-management";
const legacyJsonPath = join(dataDir, "voice-management.json");

let migrated = false;
function ensureStore() {
  mkdirSync(dataDir, { recursive: true });
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
    clonedVoices: stored?.clonedVoices ?? [],
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

  const localPath = join(process.cwd(), "public", audioUrl.slice(1));
  if (existsSync(localPath)) {
    unlinkSync(localPath);
  }
}

export function listAddedSpeakerIds() {
  return readStore().addedSpeakerIds;
}

export function listSearchDisplaySpeakerIds() {
  const store = readStore();
  return store.searchDisplaySpeakerIds.length > 0 ? store.searchDisplaySpeakerIds : store.addedSpeakerIds;
}

export function addSpeakerToLibrary(speakerId: string) {
  const store = readStore();
  if (!store.addedSpeakerIds.includes(speakerId)) {
    store.addedSpeakerIds.unshift(speakerId);
    writeStore(store);
  }
  return store.addedSpeakerIds;
}

export function removeSpeakerFromLibrary(speakerId: string) {
  const store = readStore();
  store.addedSpeakerIds = store.addedSpeakerIds.filter((item) => item !== speakerId);
  writeStore(store);
  return store.addedSpeakerIds;
}

export function addSpeakerToSearchDisplay(speakerId: string) {
  const store = readStore();
  if (!store.searchDisplaySpeakerIds.includes(speakerId)) {
    store.searchDisplaySpeakerIds.unshift(speakerId);
    writeStore(store);
  }
  return store.searchDisplaySpeakerIds;
}

export function removeSpeakerFromSearchDisplay(speakerId: string) {
  const store = readStore();
  store.searchDisplaySpeakerIds = store.searchDisplaySpeakerIds.filter((item) => item !== speakerId);
  writeStore(store);
  return store.searchDisplaySpeakerIds;
}

export function listClonedVoices() {
  return [...readStore().clonedVoices].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getClonedVoice(cloneId: string) {
  return readStore().clonedVoices.find((item) => item.cloneId === cloneId) ?? null;
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

export function patchClonedVoice(cloneId: string, updates: Partial<ClonedVoiceRecord>) {
  const store = readStore();
  const index = store.clonedVoices.findIndex((item) => item.cloneId === cloneId);

  if (index < 0) {
    return null;
  }

  const current = store.clonedVoices[index];
  const next = {
    ...current,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  } satisfies ClonedVoiceRecord;

  if (current.demoAudioUrl && current.demoAudioUrl !== next.demoAudioUrl) {
    deleteLocalDemoAudio(current.demoAudioUrl);
  }

  store.clonedVoices[index] = next;
  writeStore(store);
  return next;
}

export function listFavoriteSpeakerIds() {
  return readStore().favoriteSpeakerIds;
}

export function addFavoriteSpeaker(speakerId: string) {
  const store = readStore();
  if (!store.favoriteSpeakerIds.includes(speakerId)) {
    store.favoriteSpeakerIds.unshift(speakerId);
    writeStore(store);
  }
  return store.favoriteSpeakerIds;
}

export function removeFavoriteSpeaker(speakerId: string) {
  const store = readStore();
  store.favoriteSpeakerIds = store.favoriteSpeakerIds.filter((id) => id !== speakerId);
  writeStore(store);
  return store.favoriteSpeakerIds;
}

export function isFavoriteSpeaker(speakerId: string) {
  return readStore().favoriteSpeakerIds.includes(speakerId);
}

export function deleteClonedVoice(cloneId: string) {
  const store = readStore();
  const index = store.clonedVoices.findIndex((item) => item.cloneId === cloneId);

  if (index < 0) {
    return null;
  }

  const current = store.clonedVoices[index];
  deleteLocalDemoAudio(current.demoAudioUrl);
  store.clonedVoices.splice(index, 1);
  writeStore(store);
  return current;
}
