import {
  recordAdminDataProviderCall,
  recordAdminDataTaskStageRun,
} from "./admin-data-analytics";

type ProviderCallTrackingInput = {
  enabled?: boolean;
  serviceName: string;
  provider?: string | null;
  modelId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
};

type TaskStageStatus = "IN_PROGRESS" | "QUEUED" | "COMPLETED" | "FAILED";

type TaskStageRunWriteInput = {
  runId?: string;
  taskId: string;
  stageKey: string;
  status: TaskStageStatus;
  provider?: string | null;
  modelId?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
};

type TaskStageTrackerInput = Omit<TaskStageRunWriteInput, "status" | "finishedAt" | "errorMessage"> & {
  initialStatus?: Extract<TaskStageStatus, "IN_PROGRESS" | "QUEUED">;
};

type TaskStageTracker = {
  runId: string;
  startedAt: string;
  update: (status: TaskStageStatus, input?: { finishedAt?: string | null; errorMessage?: string | null }) => void;
  complete: (input?: { finishedAt?: string | null }) => void;
  fail: (error: unknown, input?: { finishedAt?: string | null }) => void;
};

function normalizeTimestamp(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value).toISOString();
  return parsed;
}

function getDurationMs(startedAt: string, finishedAt: string | null | undefined) {
  if (!finishedAt) {
    return null;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function getErrorCode(error: unknown) {
  if (!error) {
    return null;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 180) || "unknown_error";
}

export async function withAdminProviderCallTracking<T>(
  input: ProviderCallTrackingInput,
  operation: () => Promise<T>,
): Promise<T> {
  if (input.enabled === false) {
    return operation();
  }

  const startedAt = Date.now();

  try {
    const result = await operation();
    recordAdminDataProviderCall({
      serviceName: input.serviceName,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      success: true,
      durationMs: Date.now() - startedAt,
      errorCode: null,
    });
    return result;
  } catch (error) {
    recordAdminDataProviderCall({
      serviceName: input.serviceName,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      success: false,
      durationMs: Date.now() - startedAt,
      errorCode: getErrorCode(error),
    });
    throw error;
  }
}

export function writeAdminTaskStageRun(input: TaskStageRunWriteInput) {
  const startedAt = normalizeTimestamp(input.startedAt, new Date().toISOString());
  const finishedAt =
    input.status === "COMPLETED" || input.status === "FAILED"
      ? normalizeTimestamp(input.finishedAt, new Date().toISOString())
      : null;

  recordAdminDataTaskStageRun({
    runId: input.runId ?? crypto.randomUUID(),
    taskId: input.taskId,
    stageKey: input.stageKey,
    status: input.status,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    startedAt,
    finishedAt,
    durationMs: getDurationMs(startedAt, finishedAt),
    errorMessage: input.errorMessage ?? null,
  });
}

export function createAdminTaskStageTracker(input: TaskStageTrackerInput): TaskStageTracker {
  const runId = input.runId ?? crypto.randomUUID();
  const startedAt = normalizeTimestamp(input.startedAt, new Date().toISOString());

  writeAdminTaskStageRun({
    runId,
    taskId: input.taskId,
    stageKey: input.stageKey,
    status: input.initialStatus ?? "IN_PROGRESS",
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    startedAt,
  });

  return {
    runId,
    startedAt,
    update(status, nextInput) {
      writeAdminTaskStageRun({
        runId,
        taskId: input.taskId,
        stageKey: input.stageKey,
        status,
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt,
        finishedAt: nextInput?.finishedAt ?? null,
        errorMessage: nextInput?.errorMessage ?? null,
      });
    },
    complete(nextInput) {
      writeAdminTaskStageRun({
        runId,
        taskId: input.taskId,
        stageKey: input.stageKey,
        status: "COMPLETED",
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt,
        finishedAt: nextInput?.finishedAt ?? null,
      });
    },
    fail(error, nextInput) {
      writeAdminTaskStageRun({
        runId,
        taskId: input.taskId,
        stageKey: input.stageKey,
        status: "FAILED",
        provider: input.provider ?? null,
        modelId: input.modelId ?? null,
        startedAt,
        finishedAt: nextInput?.finishedAt ?? null,
        errorMessage: getErrorCode(error),
      });
    },
  };
}
