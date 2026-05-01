import { dbDelete, dbGet, dbGetAll, dbUpsert } from "./db";
import { getHotelAssetDisplayOrder } from "./hotel-asset-ordering";
import { deleteTaskHotelAsset, listTaskHotelAssets, type TaskHotelAssetRecord } from "./task-hotel-asset-store";

export type TaskHotelAssetOptimizationState = {
  taskId: string;
  rootAssetId: string;
  currentAssetId: string;
  currentRoundCandidateIds: string[];
  historyAssetIds: string[];
  createdAt: string;
  updatedAt: string;
};

const COLLECTION = "task-hotel-asset-optimizations";

function buildKey(taskId: string, rootAssetId: string) {
  return `${taskId}:${rootAssetId}`;
}

function normalizeUniqueIds(values: unknown[], requiredFirstIds: string[] = []) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...requiredFirstIds, ...values]) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeState(record: Partial<TaskHotelAssetOptimizationState>): TaskHotelAssetOptimizationState {
  const now = new Date().toISOString();
  const taskId = record.taskId?.trim() ?? "";
  const rootAssetId = record.rootAssetId?.trim() ?? "";
  const currentAssetId = record.currentAssetId?.trim() || rootAssetId;
  const createdAt = record.createdAt ?? now;

  return {
    taskId,
    rootAssetId,
    currentAssetId,
    currentRoundCandidateIds: normalizeUniqueIds(record.currentRoundCandidateIds ?? []),
    historyAssetIds: normalizeUniqueIds(record.historyAssetIds ?? [], rootAssetId ? [rootAssetId] : []),
    createdAt,
    updatedAt: record.updatedAt ?? createdAt,
  };
}

function saveState(state: TaskHotelAssetOptimizationState) {
  const next = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  dbUpsert(COLLECTION, buildKey(next.taskId, next.rootAssetId), next);
  return next;
}

export function getTaskHotelAssetOptimizationState(taskId: string, rootAssetId: string) {
  const record = dbGet<Partial<TaskHotelAssetOptimizationState>>(COLLECTION, buildKey(taskId, rootAssetId));
  return record ? normalizeState(record) : null;
}

export function listTaskHotelAssetOptimizationStates(taskId?: string) {
  const records = dbGetAll<Partial<TaskHotelAssetOptimizationState>>(COLLECTION).map(normalizeState);
  return taskId ? records.filter((record) => record.taskId === taskId) : records;
}

export function deleteTaskHotelAssetOptimizationState(taskId: string, rootAssetId: string) {
  dbDelete(COLLECTION, buildKey(taskId, rootAssetId));
}

export function deleteTaskHotelAssetOptimizationStatesByTaskId(taskId: string) {
  const states = listTaskHotelAssetOptimizationStates(taskId);
  for (const state of states) {
    deleteTaskHotelAssetOptimizationState(state.taskId, state.rootAssetId);
  }
  return states;
}

export function isRootHotelAsset(asset: Pick<TaskHotelAssetRecord, "sourceType" | "enhancedFromAssetId">) {
  return asset.sourceType === "user_upload" && !asset.enhancedFromAssetId;
}

export function findRootAssetIdForHotelAsset(
  assetId: string,
  assets: Pick<TaskHotelAssetRecord, "assetId" | "enhancedFromAssetId">[],
) {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  let current = assetById.get(assetId.trim()) ?? null;
  const seen = new Set<string>();

  while (current?.enhancedFromAssetId) {
    if (seen.has(current.assetId)) {
      break;
    }
    seen.add(current.assetId);
    current = assetById.get(current.enhancedFromAssetId) ?? null;
  }

  return current?.assetId ?? assetId.trim();
}

export function ensureTaskHotelAssetOptimizationState(input: {
  taskId: string;
  rootAssetId: string;
  currentAssetId?: string | null;
}) {
  const existing = getTaskHotelAssetOptimizationState(input.taskId, input.rootAssetId);
  if (existing) {
    const nextCurrentAssetId = input.currentAssetId?.trim();
    if (nextCurrentAssetId && nextCurrentAssetId !== existing.currentAssetId) {
      return saveState({
        ...existing,
        currentAssetId: nextCurrentAssetId,
        historyAssetIds: normalizeUniqueIds(existing.historyAssetIds, [existing.rootAssetId]),
      });
    }
    return existing;
  }

  return saveState(
    normalizeState({
      taskId: input.taskId,
      rootAssetId: input.rootAssetId,
      currentAssetId: input.currentAssetId?.trim() || input.rootAssetId,
      currentRoundCandidateIds: [],
      historyAssetIds: [input.rootAssetId],
    }),
  );
}

export function selectTaskHotelAssetOptimizationVariant(input: {
  taskId: string;
  rootAssetId: string;
  assetId: string;
}) {
  const state = ensureTaskHotelAssetOptimizationState({
    taskId: input.taskId,
    rootAssetId: input.rootAssetId,
  });

  return saveState({
    ...state,
    currentAssetId: input.assetId,
    historyAssetIds: normalizeUniqueIds(state.historyAssetIds, [state.rootAssetId]),
  });
}

export function prepareNextTaskHotelAssetOptimizationRound(input: { taskId: string; rootAssetId: string }) {
  const state = ensureTaskHotelAssetOptimizationState(input);
  const staleCandidateIds = state.currentRoundCandidateIds.filter((assetId) => assetId !== state.currentAssetId);
  const historyAssetIds =
    state.currentAssetId && state.currentAssetId !== state.rootAssetId
      ? normalizeUniqueIds([...state.historyAssetIds, state.currentAssetId], [state.rootAssetId])
      : normalizeUniqueIds(state.historyAssetIds, [state.rootAssetId]);

  const nextState = saveState({
    ...state,
    historyAssetIds,
    currentRoundCandidateIds: [],
  });

  return {
    state: nextState,
    staleCandidateIds,
  };
}

export function listDisposableEnhancedCandidateAssetIds(input: {
  assets: Pick<TaskHotelAssetRecord, "assetId" | "sourceType" | "enhancedFromAssetId">[];
  sourceAssetId: string;
  preserveAssetIds?: string[];
}) {
  const sourceAssetId = input.sourceAssetId.trim();
  if (!sourceAssetId) {
    return [];
  }

  const preservedAssetIds = new Set(normalizeUniqueIds(input.preserveAssetIds ?? [], [sourceAssetId]));
  return input.assets
    .filter(
      (asset) =>
        asset.sourceType === "enhanced" &&
        asset.enhancedFromAssetId === sourceAssetId &&
        !preservedAssetIds.has(asset.assetId),
    )
    .map((asset) => asset.assetId);
}

export function replaceTaskHotelAssetOptimizationRoundCandidates(input: {
  taskId: string;
  rootAssetId: string;
  candidateIds: string[];
}) {
  const state = ensureTaskHotelAssetOptimizationState(input);
  return saveState({
    ...state,
    currentRoundCandidateIds: normalizeUniqueIds(input.candidateIds),
    historyAssetIds: normalizeUniqueIds(state.historyAssetIds, [state.rootAssetId]),
  });
}

export function removeTaskHotelAssetFromOptimizationStates(taskId: string, assetId: string) {
  const removedAssetId = assetId.trim();
  if (!removedAssetId) {
    return [];
  }

  const affectedStates: TaskHotelAssetOptimizationState[] = [];
  for (const state of listTaskHotelAssetOptimizationStates(taskId)) {
    if (state.rootAssetId === removedAssetId) {
      deleteTaskHotelAssetOptimizationState(state.taskId, state.rootAssetId);
      affectedStates.push(state);
      continue;
    }

    const nextCurrentAssetId = state.currentAssetId === removedAssetId ? state.rootAssetId : state.currentAssetId;
    const nextCurrentRoundCandidateIds = state.currentRoundCandidateIds.filter((candidateId) => candidateId !== removedAssetId);
    const nextHistoryAssetIds = normalizeUniqueIds(
      state.historyAssetIds.filter((historyAssetId) => historyAssetId !== removedAssetId),
      [state.rootAssetId],
    );
    const shouldPatch =
      nextCurrentAssetId !== state.currentAssetId ||
      nextCurrentRoundCandidateIds.length !== state.currentRoundCandidateIds.length ||
      nextHistoryAssetIds.length !== state.historyAssetIds.length;

    if (shouldPatch) {
      affectedStates.push(
        saveState({
          ...state,
          currentAssetId: nextCurrentAssetId,
          currentRoundCandidateIds: nextCurrentRoundCandidateIds,
          historyAssetIds: nextHistoryAssetIds,
        }),
      );
    }
  }

  return affectedStates;
}

export function deleteTaskHotelAssetOptimizationHistoryForRoot(taskId: string, rootAssetId: string) {
  const normalizedRootAssetId = rootAssetId.trim();
  if (!normalizedRootAssetId) {
    return [];
  }

  const allAssets = listTaskHotelAssets(taskId);
  const descendantIds = allAssets
    .filter(
      (asset) =>
        asset.assetId !== normalizedRootAssetId &&
        findRootAssetIdForHotelAsset(asset.assetId, allAssets) === normalizedRootAssetId,
    )
    .map((asset) => asset.assetId);

  deleteTaskHotelAssetOptimizationState(taskId, normalizedRootAssetId);
  for (const assetId of descendantIds) {
    removeTaskHotelAssetFromOptimizationStates(taskId, assetId);
    deleteTaskHotelAsset(assetId);
  }

  return descendantIds;
}

export function listEffectiveTaskHotelAssets(taskId: string) {
  const assets = listTaskHotelAssets(taskId);
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const stateByRootId = new Map(listTaskHotelAssetOptimizationStates(taskId).map((state) => [state.rootAssetId, state]));
  const selectedAssetIds = new Set<string>();
  const effectiveAssets: TaskHotelAssetRecord[] = [];

  for (const rootAsset of getHotelAssetDisplayOrder(assets.filter(isRootHotelAsset))) {
    const state = stateByRootId.get(rootAsset.assetId);
    const selectedAsset = state?.currentAssetId ? assetById.get(state.currentAssetId) : null;
    const effectiveAsset = selectedAsset?.taskId === taskId ? selectedAsset : rootAsset;
    if (selectedAssetIds.has(effectiveAsset.assetId)) {
      continue;
    }
    selectedAssetIds.add(effectiveAsset.assetId);
    effectiveAssets.push(effectiveAsset);
  }

  const rootAssetIds = new Set(effectiveAssets.map((asset) => asset.assetId));
  const orphanAssets = assets.filter((asset) => {
    if (rootAssetIds.has(asset.assetId)) {
      return false;
    }
    if (isRootHotelAsset(asset)) {
      return false;
    }
    return !asset.enhancedFromAssetId && asset.sourceType !== "enhanced";
  });

  return [...effectiveAssets, ...getHotelAssetDisplayOrder(orphanAssets)];
}
