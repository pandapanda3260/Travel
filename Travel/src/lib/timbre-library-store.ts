import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { TimbreItem } from "./doubao-timbre-service";
import { dbGetSingleton, dbSetSingleton, migrateJsonSingletonIfNeeded } from "./db";

export type StoredTimbreLibraryItem = TimbreItem & {
  searchText: string;
  updatedAt: string;
};

type TimbreLibraryStore = {
  syncedAt: string | null;
  items: StoredTimbreLibraryItem[];
};

const dataDir = join(process.cwd(), "data");
const COLLECTION = "timbre-library";
const legacyJsonPath = join(dataDir, "timbre-library.json");

let migrated = false;
function ensureStore() {
  mkdirSync(dataDir, { recursive: true });
  if (!migrated) {
    migrateJsonSingletonIfNeeded(COLLECTION, legacyJsonPath);
    migrated = true;
  }
}

function readStore(): TimbreLibraryStore {
  ensureStore();
  const stored = dbGetSingleton<Partial<TimbreLibraryStore>>(COLLECTION);
  return {
    syncedAt: stored?.syncedAt ?? null,
    items: stored?.items ?? [],
  };
}

function writeStore(store: TimbreLibraryStore) {
  ensureStore();
  dbSetSingleton(COLLECTION, store);
}

export function listStoredTimbres() {
  return readStore().items;
}

export function getStoredTimbreLibraryMeta() {
  const store = readStore();
  return {
    syncedAt: store.syncedAt,
    count: store.items.length,
  };
}

export function replaceStoredTimbres(items: StoredTimbreLibraryItem[]) {
  const nextStore = {
    syncedAt: new Date().toISOString(),
    items,
  } satisfies TimbreLibraryStore;
  writeStore(nextStore);
  return nextStore;
}
