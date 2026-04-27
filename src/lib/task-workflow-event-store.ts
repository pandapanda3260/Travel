import { dbGetAll, dbReplaceAll, dbUpsert } from "./db";

export type TaskWorkflowEventStatus =
  | "queued"
  | "running"
  | "progress"
  | "success"
  | "failed"
  | "skipped"
  | "recovered";

export type TaskWorkflowEventKind = "stage" | "workflow" | "step" | "artifact" | "system";

export type TaskWorkflowEventRecord = {
  eventId: string;
  taskId: string;
  kind: TaskWorkflowEventKind;
  workflowType: string | null;
  workflowId: string | null;
  stageKey: string | null;
  stepKey: string | null;
  status: TaskWorkflowEventStatus;
  message: string;
  errorMessage: string | null;
  provider: string | null;
  modelId: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
};

type AppendTaskWorkflowEventInput = Partial<
  Omit<TaskWorkflowEventRecord, "eventId" | "createdAt" | "durationMs">
> & {
  eventId?: string;
  taskId: string;
  kind: TaskWorkflowEventKind;
  status: TaskWorkflowEventStatus;
  createdAt?: string;
  durationMs?: number | null;
};

const COLLECTION = "task-workflow-events";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeText(value: unknown) {
  return normalizeNullableText(value) ?? "";
}

function normalizeDurationMs(input: {
  durationMs?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}) {
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    return Math.max(0, Math.round(input.durationMs));
  }

  const startedAtMs = input.startedAt ? Date.parse(input.startedAt) : NaN;
  const finishedAtMs = input.finishedAt ? Date.parse(input.finishedAt) : NaN;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return null;
  }
  return Math.max(0, Math.round(finishedAtMs - startedAtMs));
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeEventRecord(record: Partial<TaskWorkflowEventRecord>): TaskWorkflowEventRecord {
  const createdAt = record.createdAt ?? nowIso();
  const startedAt = record.startedAt ?? null;
  const finishedAt = record.finishedAt ?? null;
  return {
    eventId: normalizeText(record.eventId) || crypto.randomUUID(),
    taskId: normalizeText(record.taskId),
    kind: (record.kind ?? "system") as TaskWorkflowEventKind,
    workflowType: normalizeNullableText(record.workflowType),
    workflowId: normalizeNullableText(record.workflowId),
    stageKey: normalizeNullableText(record.stageKey),
    stepKey: normalizeNullableText(record.stepKey),
    status: (record.status ?? "progress") as TaskWorkflowEventStatus,
    message: normalizeText(record.message),
    errorMessage: normalizeNullableText(record.errorMessage),
    provider: normalizeNullableText(record.provider),
    modelId: normalizeNullableText(record.modelId),
    metadata: normalizeMetadata(record.metadata),
    startedAt,
    finishedAt,
    durationMs: normalizeDurationMs({
      durationMs: record.durationMs,
      startedAt,
      finishedAt,
    }),
    createdAt,
  };
}

function readEvents() {
  try {
    return dbGetAll<Partial<TaskWorkflowEventRecord>>(COLLECTION).map(normalizeEventRecord);
  } catch {
    return [] as TaskWorkflowEventRecord[];
  }
}

function getEventSortTimestamp(record: TaskWorkflowEventRecord) {
  const timestamp = Date.parse(record.finishedAt ?? record.startedAt ?? record.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function appendTaskWorkflowEvent(input: AppendTaskWorkflowEventInput) {
  const record = normalizeEventRecord({
    ...input,
    eventId: input.eventId ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? nowIso(),
  });
  dbUpsert(COLLECTION, record.eventId, record);
  return record;
}

export function safeAppendTaskWorkflowEvent(input: AppendTaskWorkflowEventInput) {
  try {
    return appendTaskWorkflowEvent(input);
  } catch {
    return null;
  }
}

export function listTaskWorkflowEvents(taskId: string, options?: { limit?: number }) {
  const limit = Number.isFinite(options?.limit) ? Math.max(0, Number(options?.limit)) : 0;
  const events = readEvents()
    .filter((record) => record.taskId === taskId)
    .sort((left, right) => {
      const byEventTime = getEventSortTimestamp(left) - getEventSortTimestamp(right);
      if (byEventTime !== 0) {
        return byEventTime;
      }
      const byCreatedAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }
      return left.eventId.localeCompare(right.eventId);
    });

  if (!limit) {
    return events;
  }
  return events.slice(Math.max(0, events.length - limit));
}

export function deleteTaskWorkflowEventsByTaskId(taskId: string) {
  const kept = readEvents().filter((record) => record.taskId !== taskId);
  dbReplaceAll(
    COLLECTION,
    kept.map((record) => ({
      key: record.eventId,
      data: record,
    })),
  );
}
