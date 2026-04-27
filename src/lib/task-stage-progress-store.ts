import { join } from "node:path";

import { dbDelete, dbGet, dbGetAll, dbReplaceAll, dbUpsert, migrateJsonArrayIfNeeded } from "./db";
import { joinRuntimeDataPath } from "./runtime-storage";
import {
  normalizeTaskStageProgressPercent,
  type TaskStageProgressKey,
  type TaskStageProgressSnapshot,
  type TaskStageProgressStatus,
} from "./task-stage-progress";
import { safeAppendTaskWorkflowEvent } from "./task-workflow-event-store";

const COLLECTION = "task-stage-progress";
const legacyJsonPath = joinRuntimeDataPath("task-stage-progress.json");

function buildTaskStageProgressKey(taskId: string, stageKey: TaskStageProgressKey) {
  return `${taskId}:${stageKey}`;
}

let migrated = false;
function ensureStore() {
  if (!migrated) {
    migrateJsonArrayIfNeeded(COLLECTION, legacyJsonPath, (item) => {
      const record = item as Partial<TaskStageProgressSnapshot>;
      return buildTaskStageProgressKey(record.taskId ?? "", (record.stageKey ?? "shot_plan") as TaskStageProgressKey);
    });
    migrated = true;
  }
}

function normalizeTaskStageProgressRecord(record: Partial<TaskStageProgressSnapshot>): TaskStageProgressSnapshot {
  const now = new Date().toISOString();
  return {
    taskId: record.taskId ?? "",
    stageKey: (record.stageKey ?? "shot_plan") as TaskStageProgressKey,
    runId: record.runId ?? crypto.randomUUID(),
    status: (record.status ?? "IN_PROGRESS") as TaskStageProgressStatus,
    percent: normalizeTaskStageProgressPercent(record.percent),
    message: record.message?.trim() ?? "",
    provider: record.provider ?? null,
    modelId: record.modelId ?? null,
    startedAt: record.startedAt ?? now,
    updatedAt: record.updatedAt ?? record.startedAt ?? now,
    finishedAt: record.finishedAt ?? null,
    errorMessage: record.errorMessage ?? null,
  };
}

function readStore() {
  ensureStore();
  try {
    return dbGetAll<Partial<TaskStageProgressSnapshot>>(COLLECTION).map(normalizeTaskStageProgressRecord);
  } catch {
    return [] as TaskStageProgressSnapshot[];
  }
}

function writeRecord(record: TaskStageProgressSnapshot) {
  ensureStore();
  dbUpsert(COLLECTION, buildTaskStageProgressKey(record.taskId, record.stageKey), record);
  return record;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "执行失败");
}

function recordStageProgressEvent(
  record: TaskStageProgressSnapshot | null,
  status: "queued" | "running" | "success" | "failed",
) {
  if (!record) {
    return;
  }

  safeAppendTaskWorkflowEvent({
    taskId: record.taskId,
    kind: "stage",
    workflowType: "stage_progress",
    workflowId: record.runId,
    stageKey: record.stageKey,
    status,
    message: record.message,
    errorMessage: record.errorMessage,
    provider: record.provider,
    modelId: record.modelId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  });
}

function parseTimestampMs(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isStaleRunUpdate(
  current: TaskStageProgressSnapshot | null,
  updates: Partial<TaskStageProgressSnapshot>,
) {
  if (!current?.runId || !updates.runId || current.runId === updates.runId) {
    return false;
  }

  const currentStartedAtMs = parseTimestampMs(current.startedAt);
  const incomingStartedAtMs = parseTimestampMs(updates.startedAt);

  if (currentStartedAtMs === null || incomingStartedAtMs === null) {
    return true;
  }

  return incomingStartedAtMs <= currentStartedAtMs;
}

export function getTaskStageProgress(taskId: string, stageKey: TaskStageProgressKey) {
  ensureStore();
  try {
    const record = dbGet<Partial<TaskStageProgressSnapshot>>(COLLECTION, buildTaskStageProgressKey(taskId, stageKey));
    return record ? normalizeTaskStageProgressRecord(record) : null;
  } catch {
    return null;
  }
}

export function listTaskStageProgress(taskId: string) {
  return readStore()
    .filter((record) => record.taskId === taskId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function upsertTaskStageProgress(
  taskId: string,
  stageKey: TaskStageProgressKey,
  updates: Partial<TaskStageProgressSnapshot>,
) {
  const current = getTaskStageProgress(taskId, stageKey);
  if (isStaleRunUpdate(current, updates)) {
    return current;
  }

  const nextRecord = normalizeTaskStageProgressRecord({
    ...current,
    ...updates,
    taskId,
    stageKey,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  });
  return writeRecord(nextRecord);
}

export function startTaskStageProgress(input: {
  taskId: string;
  stageKey: TaskStageProgressKey;
  runId?: string;
  provider?: string | null;
  modelId?: string | null;
  startedAt?: string;
  message?: string;
  percent?: number;
  status?: Extract<TaskStageProgressStatus, "QUEUED" | "IN_PROGRESS">;
}) {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const record = writeRecord(
    normalizeTaskStageProgressRecord({
      taskId: input.taskId,
      stageKey: input.stageKey,
      runId: input.runId ?? crypto.randomUUID(),
      status: input.status ?? "IN_PROGRESS",
      percent: input.percent ?? 1,
      message: input.message ?? "",
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      errorMessage: null,
    }),
  );
  recordStageProgressEvent(record, record.status === "QUEUED" ? "queued" : "running");
  return record;
}

export function completeTaskStageProgress(
  taskId: string,
  stageKey: TaskStageProgressKey,
  updates?: Partial<TaskStageProgressSnapshot>,
) {
  const record = upsertTaskStageProgress(taskId, stageKey, {
    ...updates,
    status: "COMPLETED",
    percent: 100,
    finishedAt: updates?.finishedAt ?? new Date().toISOString(),
    errorMessage: null,
  });
  recordStageProgressEvent(record, "success");
  return record;
}

export function failTaskStageProgress(
  taskId: string,
  stageKey: TaskStageProgressKey,
  error: unknown,
  updates?: Partial<TaskStageProgressSnapshot>,
) {
  const errorMessage = toErrorMessage(error);
  const record = upsertTaskStageProgress(taskId, stageKey, {
    ...updates,
    status: "FAILED",
    message: updates?.message ?? errorMessage,
    finishedAt: updates?.finishedAt ?? new Date().toISOString(),
    errorMessage,
  });
  recordStageProgressEvent(record, "failed");
  return record;
}

export function createTaskStageProgressReporter(input: {
  taskId: string;
  stageKey: TaskStageProgressKey;
  runId?: string;
  provider?: string | null;
  modelId?: string | null;
  startedAt?: string;
  initialMessage?: string;
  initialPercent?: number;
  initialStatus?: Extract<TaskStageProgressStatus, "QUEUED" | "IN_PROGRESS">;
}) {
  const initial = startTaskStageProgress({
    taskId: input.taskId,
    stageKey: input.stageKey,
    runId: input.runId,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    startedAt: input.startedAt,
    message: input.initialMessage,
    percent: input.initialPercent,
    status: input.initialStatus,
  });

  return {
    runId: initial.runId,
    onProgress(step: string, percent: number, message: string) {
      void step;
      upsertTaskStageProgress(input.taskId, input.stageKey, {
        runId: initial.runId,
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt: initial.startedAt,
        status: initial.status === "QUEUED" && percent <= 1 ? "QUEUED" : "IN_PROGRESS",
        percent,
        message,
        finishedAt: null,
        errorMessage: null,
      });
    },
    queue(message: string, percent = 1) {
      upsertTaskStageProgress(input.taskId, input.stageKey, {
        runId: initial.runId,
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt: initial.startedAt,
        status: "QUEUED",
        percent,
        message,
        finishedAt: null,
        errorMessage: null,
      });
    },
    complete(message = "完成") {
      completeTaskStageProgress(input.taskId, input.stageKey, {
        runId: initial.runId,
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt: initial.startedAt,
        message,
      });
    },
    fail(error: unknown, message?: string) {
      failTaskStageProgress(input.taskId, input.stageKey, error, {
        runId: initial.runId,
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt: initial.startedAt,
        message,
      });
    },
  };
}

export function deleteTaskStageProgress(taskId: string, stageKey: TaskStageProgressKey) {
  ensureStore();
  dbDelete(COLLECTION, buildTaskStageProgressKey(taskId, stageKey));
}

export function deleteTaskStageProgressByTaskId(taskId: string) {
  const records = readStore().filter((record) => record.taskId !== taskId);
  ensureStore();
  dbReplaceAll(
    COLLECTION,
    records.map((record) => ({
      key: buildTaskStageProgressKey(record.taskId, record.stageKey),
      data: record,
    })),
  );
}
