import { dbDelete, dbGet, dbGetAll, dbUpsert } from "./db";
import { safeAppendTaskWorkflowEvent } from "./task-workflow-event-store";

export const keyMaterialStepKeys = {
  subtitleAudio: "subtitle_audio",
  visualImages: "visual_images",
} as const;

export type KeyMaterialStepKey = (typeof keyMaterialStepKeys)[keyof typeof keyMaterialStepKeys];

export type KeyMaterialWorkflowStatus = "pending" | "running" | "success" | "failed" | "partial_failed";
export type KeyMaterialStepStatus = "pending" | "running" | "success" | "failed";
export type KeyMaterialWorkflowMode = "run" | "retry_failed_step" | "retry_all";

export type KeyMaterialStepOutput = {
  narrationResultId?: string | null;
  subtitleSrtUrl?: string | null;
  mergedAudioUrl?: string | null;
  generatedShotCount?: number | null;
  selectedShotCount?: number | null;
  validationPassed?: boolean | null;
};

export type KeyMaterialStepRecord = {
  stepKey: KeyMaterialStepKey;
  label: string;
  status: KeyMaterialStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  errorMessage: string | null;
  retryCount: number;
  runId: string | null;
  carriedFromWorkflowId: string | null;
  output: KeyMaterialStepOutput | null;
};

export type KeyMaterialWorkflowRecord = {
  workflowId: string;
  taskId: string;
  ownerUserId: string | null;
  requestId: string;
  mode: KeyMaterialWorkflowMode;
  status: KeyMaterialWorkflowStatus;
  currentStepKey: KeyMaterialStepKey | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryOfWorkflowId: string | null;
  lastError: string | null;
  requestSnapshot: Record<string, unknown> | null;
  steps: Record<KeyMaterialStepKey, KeyMaterialStepRecord>;
};

type KeyMaterialWorkflowLockRecord = {
  taskId: string;
  workflowId: string;
  acquiredAt: string;
  heartbeatAt: string;
};

const WORKFLOW_COLLECTION = "key-material-workflows";
const LOCK_COLLECTION = "key-material-workflow-locks";

const DEFAULT_STALE_TIMEOUT_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown, fallback = "执行失败") {
  if (error instanceof Error) {
    return error.message.trim() || fallback;
  }
  if (typeof error === "string") {
    return error.trim() || fallback;
  }
  return fallback;
}

function createEmptyStep(stepKey: KeyMaterialStepKey): KeyMaterialStepRecord {
  return {
    stepKey,
    label: stepKey === keyMaterialStepKeys.subtitleAudio ? "字幕音频" : "视觉图片",
    status: "pending",
    startedAt: null,
    finishedAt: null,
    updatedAt: nowIso(),
    errorMessage: null,
    retryCount: 0,
    runId: null,
    carriedFromWorkflowId: null,
    output: null,
  };
}

function createEmptySteps() {
  return {
    [keyMaterialStepKeys.subtitleAudio]: createEmptyStep(keyMaterialStepKeys.subtitleAudio),
    [keyMaterialStepKeys.visualImages]: createEmptyStep(keyMaterialStepKeys.visualImages),
  } satisfies Record<KeyMaterialStepKey, KeyMaterialStepRecord>;
}

function normalizeStepRecord(
  stepKey: KeyMaterialStepKey,
  record: Partial<KeyMaterialStepRecord> | null | undefined,
): KeyMaterialStepRecord {
  const base = createEmptyStep(stepKey);
  return {
    ...base,
    ...record,
    stepKey,
    label: record?.label?.trim() || base.label,
    status: (record?.status ?? base.status) as KeyMaterialStepStatus,
    updatedAt: record?.updatedAt ?? base.updatedAt,
    errorMessage: record?.errorMessage ?? null,
    retryCount: Number.isFinite(record?.retryCount) ? Math.max(0, Number(record?.retryCount)) : 0,
    runId: record?.runId ?? null,
    carriedFromWorkflowId: record?.carriedFromWorkflowId ?? null,
    output: record?.output ?? null,
  };
}

function normalizeWorkflowRecord(record: Partial<KeyMaterialWorkflowRecord>): KeyMaterialWorkflowRecord {
  const createdAt = record.createdAt ?? nowIso();
  const steps = record.steps ?? createEmptySteps();
  return {
    workflowId: record.workflowId ?? crypto.randomUUID(),
    taskId: record.taskId ?? "",
    ownerUserId: record.ownerUserId ?? null,
    requestId: record.requestId?.trim() || crypto.randomUUID(),
    mode: (record.mode ?? "run") as KeyMaterialWorkflowMode,
    status: (record.status ?? "pending") as KeyMaterialWorkflowStatus,
    currentStepKey: (record.currentStepKey ?? null) as KeyMaterialStepKey | null,
    createdAt,
    updatedAt: record.updatedAt ?? createdAt,
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? null,
    retryOfWorkflowId: record.retryOfWorkflowId ?? null,
    lastError: record.lastError ?? null,
    requestSnapshot: record.requestSnapshot ?? null,
    steps: {
      [keyMaterialStepKeys.subtitleAudio]: normalizeStepRecord(
        keyMaterialStepKeys.subtitleAudio,
        steps[keyMaterialStepKeys.subtitleAudio],
      ),
      [keyMaterialStepKeys.visualImages]: normalizeStepRecord(
        keyMaterialStepKeys.visualImages,
        steps[keyMaterialStepKeys.visualImages],
      ),
    },
  };
}

function getLock(taskId: string) {
  return dbGet<KeyMaterialWorkflowLockRecord>(LOCK_COLLECTION, taskId);
}

function writeLock(record: KeyMaterialWorkflowLockRecord) {
  dbUpsert(LOCK_COLLECTION, record.taskId, record);
  return record;
}

function removeLock(taskId: string) {
  dbDelete(LOCK_COLLECTION, taskId);
}

function isTerminalWorkflowStatus(status: KeyMaterialWorkflowStatus) {
  return status === "success" || status === "failed" || status === "partial_failed";
}

function deriveFailedWorkflowStatus(workflow: Pick<KeyMaterialWorkflowRecord, "steps">): KeyMaterialWorkflowStatus {
  const subtitleSucceeded = workflow.steps[keyMaterialStepKeys.subtitleAudio].status === "success";
  const visualFailed = workflow.steps[keyMaterialStepKeys.visualImages].status === "failed";
  if (subtitleSucceeded && visualFailed) {
    return "partial_failed";
  }
  return "failed";
}

function recordKeyMaterialWorkflowEvent(
  workflow: KeyMaterialWorkflowRecord | null,
  status: "queued" | "running" | "success" | "failed" | "recovered",
  message: string,
) {
  if (!workflow) {
    return;
  }

  safeAppendTaskWorkflowEvent({
    taskId: workflow.taskId,
    kind: "workflow",
    workflowType: "key_material",
    workflowId: workflow.workflowId,
    status,
    message,
    errorMessage: workflow.lastError,
    startedAt: workflow.startedAt,
    finishedAt: workflow.finishedAt,
    metadata: {
      mode: workflow.mode,
      requestId: workflow.requestId,
      retryOfWorkflowId: workflow.retryOfWorkflowId,
      currentStepKey: workflow.currentStepKey,
    },
  });
}

function recordKeyMaterialStepEvent(
  workflow: KeyMaterialWorkflowRecord | null,
  stepKey: KeyMaterialStepKey,
  status: "running" | "success" | "failed" | "recovered",
  message: string,
) {
  if (!workflow) {
    return;
  }

  const step = workflow.steps[stepKey];
  safeAppendTaskWorkflowEvent({
    taskId: workflow.taskId,
    kind: "step",
    workflowType: "key_material",
    workflowId: workflow.workflowId,
    stageKey: stepKey,
    stepKey,
    status,
    message,
    errorMessage: step.errorMessage,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    metadata: {
      label: step.label,
      retryCount: step.retryCount,
      runId: step.runId,
      carriedFromWorkflowId: step.carriedFromWorkflowId,
      output: step.output,
    },
  });
}

export function listKeyMaterialWorkflows(taskId?: string) {
  return dbGetAll<Partial<KeyMaterialWorkflowRecord>>(WORKFLOW_COLLECTION)
    .map(normalizeWorkflowRecord)
    .filter((record) => (taskId ? record.taskId === taskId : true))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getKeyMaterialWorkflow(workflowId: string) {
  const record = dbGet<Partial<KeyMaterialWorkflowRecord>>(WORKFLOW_COLLECTION, workflowId);
  return record ? normalizeWorkflowRecord(record) : null;
}

export function getLatestKeyMaterialWorkflow(taskId: string) {
  return listKeyMaterialWorkflows(taskId)[0] ?? null;
}

export function getKeyMaterialWorkflowByRequestId(taskId: string, requestId: string) {
  return listKeyMaterialWorkflows(taskId).find((record) => record.requestId === requestId) ?? null;
}

export function createKeyMaterialWorkflow(input: {
  taskId: string;
  ownerUserId?: string | null;
  requestId?: string;
  mode?: KeyMaterialWorkflowMode;
  retryOfWorkflowId?: string | null;
  requestSnapshot?: Record<string, unknown> | null;
  carrySubtitleStepFromWorkflow?: KeyMaterialWorkflowRecord | null;
}) {
  const createdAt = nowIso();
  const steps = createEmptySteps();
  const carrySource = input.carrySubtitleStepFromWorkflow;
  if (carrySource?.steps[keyMaterialStepKeys.subtitleAudio].status === "success") {
    steps[keyMaterialStepKeys.subtitleAudio] = normalizeStepRecord(keyMaterialStepKeys.subtitleAudio, {
      ...carrySource.steps[keyMaterialStepKeys.subtitleAudio],
      carriedFromWorkflowId: carrySource.workflowId,
      updatedAt: createdAt,
      errorMessage: null,
    });
  }

  const record = normalizeWorkflowRecord({
    workflowId: crypto.randomUUID(),
    taskId: input.taskId,
    ownerUserId: input.ownerUserId ?? null,
    requestId: input.requestId?.trim() || crypto.randomUUID(),
    mode: input.mode ?? "run",
    status: "pending",
    currentStepKey:
      steps[keyMaterialStepKeys.subtitleAudio].status === "success" ? keyMaterialStepKeys.visualImages : null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    retryOfWorkflowId: input.retryOfWorkflowId ?? null,
    lastError: null,
    requestSnapshot: input.requestSnapshot ?? null,
    steps,
  });

  dbUpsert(WORKFLOW_COLLECTION, record.workflowId, record);
  recordKeyMaterialWorkflowEvent(record, "queued", "关键素材任务已创建");
  return record;
}

export function patchKeyMaterialWorkflow(
  workflowId: string,
  updates: Partial<Omit<KeyMaterialWorkflowRecord, "workflowId" | "taskId" | "createdAt" | "steps">> & {
    steps?: Partial<Record<KeyMaterialStepKey, Partial<KeyMaterialStepRecord>>>;
  },
) {
  const current = getKeyMaterialWorkflow(workflowId);
  if (!current) {
    return null;
  }

  const updatedAt = updates.updatedAt ?? nowIso();
  const nextSteps = {
    [keyMaterialStepKeys.subtitleAudio]: normalizeStepRecord(keyMaterialStepKeys.subtitleAudio, {
      ...current.steps[keyMaterialStepKeys.subtitleAudio],
      ...updates.steps?.[keyMaterialStepKeys.subtitleAudio],
      updatedAt:
        updates.steps?.[keyMaterialStepKeys.subtitleAudio] != null
          ? updatedAt
          : current.steps[keyMaterialStepKeys.subtitleAudio].updatedAt,
    }),
    [keyMaterialStepKeys.visualImages]: normalizeStepRecord(keyMaterialStepKeys.visualImages, {
      ...current.steps[keyMaterialStepKeys.visualImages],
      ...updates.steps?.[keyMaterialStepKeys.visualImages],
      updatedAt:
        updates.steps?.[keyMaterialStepKeys.visualImages] != null
          ? updatedAt
          : current.steps[keyMaterialStepKeys.visualImages].updatedAt,
    }),
  } satisfies Record<KeyMaterialStepKey, KeyMaterialStepRecord>;

  const next = normalizeWorkflowRecord({
    ...current,
    ...updates,
    workflowId,
    updatedAt,
    steps: nextSteps,
  });

  dbUpsert(WORKFLOW_COLLECTION, workflowId, next);
  return next;
}

export function startKeyMaterialWorkflow(workflowId: string) {
  const workflow = patchKeyMaterialWorkflow(workflowId, {
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    lastError: null,
  });
  recordKeyMaterialWorkflowEvent(workflow, "running", "关键素材任务开始");
  return workflow;
}

export function startKeyMaterialWorkflowStep(
  workflowId: string,
  stepKey: KeyMaterialStepKey,
  input?: {
    runId?: string | null;
  },
) {
  const startedAt = nowIso();
  const current = getKeyMaterialWorkflow(workflowId);
  const retryCount = (current?.steps[stepKey].retryCount ?? 0) + 1;
  const workflow = patchKeyMaterialWorkflow(workflowId, {
    status: "running",
    currentStepKey: stepKey,
    finishedAt: null,
    lastError: null,
    steps: {
      [stepKey]: {
        status: "running",
        startedAt,
        finishedAt: null,
        errorMessage: null,
        retryCount,
        runId: input?.runId ?? crypto.randomUUID(),
      },
    },
  });
  recordKeyMaterialStepEvent(workflow, stepKey, "running", `${workflow?.steps[stepKey].label ?? stepKey}开始`);
  return workflow;
}

export function completeKeyMaterialWorkflowStep(
  workflowId: string,
  stepKey: KeyMaterialStepKey,
  output?: KeyMaterialStepOutput | null,
) {
  const finishedAt = nowIso();
  const workflow = patchKeyMaterialWorkflow(workflowId, {
    steps: {
      [stepKey]: {
        status: "success",
        finishedAt,
        errorMessage: null,
        output: output ?? null,
      },
    },
  });
  recordKeyMaterialStepEvent(workflow, stepKey, "success", `${workflow?.steps[stepKey].label ?? stepKey}完成`);
  return workflow;
}

export function failKeyMaterialWorkflowStep(workflowId: string, stepKey: KeyMaterialStepKey, error: unknown) {
  const finishedAt = nowIso();
  const workflow = patchKeyMaterialWorkflow(workflowId, {
    steps: {
      [stepKey]: {
        status: "failed",
        finishedAt,
        errorMessage: toErrorMessage(error),
      },
    },
  });
  recordKeyMaterialStepEvent(workflow, stepKey, "failed", `${workflow?.steps[stepKey].label ?? stepKey}失败`);
  return workflow;
}

export function completeKeyMaterialWorkflow(workflowId: string) {
  const finishedAt = nowIso();
  const workflow = patchKeyMaterialWorkflow(workflowId, {
    status: "success",
    currentStepKey: null,
    finishedAt,
    lastError: null,
  });
  recordKeyMaterialWorkflowEvent(workflow, "success", "关键素材任务完成");
  return workflow;
}

export function failKeyMaterialWorkflow(workflowId: string, error: unknown) {
  const current = getKeyMaterialWorkflow(workflowId);
  if (!current) {
    return null;
  }

  const errorMessage = toErrorMessage(error);
  const currentStepKey = current.currentStepKey;
  const next =
    currentStepKey && current.steps[currentStepKey].status === "running"
      ? failKeyMaterialWorkflowStep(workflowId, currentStepKey, error)
      : current;

  if (!next) {
    return null;
  }

  const failedWorkflow = patchKeyMaterialWorkflow(workflowId, {
    status: deriveFailedWorkflowStatus(next),
    currentStepKey: null,
    finishedAt: nowIso(),
    lastError: errorMessage,
  });
  recordKeyMaterialWorkflowEvent(failedWorkflow, "failed", "关键素材任务失败");
  return failedWorkflow;
}

export function resolveLatestKeyMaterialVisualImagesFailure(taskId: string, output?: KeyMaterialStepOutput | null) {
  const workflow = getLatestKeyMaterialWorkflow(taskId);
  if (!workflow) {
    return null;
  }

  const visualStep = workflow.steps[keyMaterialStepKeys.visualImages];
  if (visualStep.status !== "failed") {
    return workflow;
  }

  const subtitleStep = workflow.steps[keyMaterialStepKeys.subtitleAudio];
  const subtitleError = subtitleStep.status === "failed" ? subtitleStep.errorMessage : null;
  const resolvedAt = nowIso();
  const nextStatus: KeyMaterialWorkflowStatus =
    subtitleStep.status === "success"
      ? "success"
      : subtitleStep.status === "failed"
        ? "failed"
        : workflow.status === "partial_failed"
          ? "failed"
          : workflow.status;

  const resolved = patchKeyMaterialWorkflow(workflow.workflowId, {
    status: nextStatus,
    currentStepKey: nextStatus === "success" ? null : workflow.currentStepKey,
    finishedAt: nextStatus === "success" ? resolvedAt : workflow.finishedAt,
    lastError: nextStatus === "success" ? null : subtitleError,
    steps: {
      [keyMaterialStepKeys.visualImages]: {
        status: "success",
        finishedAt: resolvedAt,
        errorMessage: null,
        output: output ?? visualStep.output,
      },
    },
  });
  recordKeyMaterialStepEvent(resolved, keyMaterialStepKeys.visualImages, "recovered", "视觉图片失败状态已恢复");
  if (resolved?.status === "success") {
    recordKeyMaterialWorkflowEvent(resolved, "recovered", "关键素材任务失败状态已恢复");
  }
  return resolved;
}

export function touchKeyMaterialWorkflow(workflowId: string) {
  const workflow = patchKeyMaterialWorkflow(workflowId, {});
  if (!workflow) {
    return null;
  }

  const lock = getLock(workflow.taskId);
  if (lock?.workflowId === workflowId) {
    writeLock({
      ...lock,
      heartbeatAt: workflow.updatedAt,
    });
  }
  return workflow;
}

export function releaseKeyMaterialWorkflowLock(taskId: string, workflowId: string) {
  const lock = getLock(taskId);
  if (!lock || lock.workflowId !== workflowId) {
    return;
  }
  removeLock(taskId);
}

export function acquireKeyMaterialWorkflowLock(input: { taskId: string; workflowId: string; staleTimeoutMs?: number }) {
  const recovered = recoverStaleKeyMaterialWorkflow(input.taskId, input.staleTimeoutMs);
  void recovered;

  const currentLock = getLock(input.taskId);
  if (currentLock && currentLock.workflowId !== input.workflowId) {
    const currentWorkflow = getKeyMaterialWorkflow(currentLock.workflowId);
    if (currentWorkflow && !isTerminalWorkflowStatus(currentWorkflow.status)) {
      return {
        ok: false as const,
        workflow: currentWorkflow,
      };
    }
    removeLock(input.taskId);
  }

  const timestamp = nowIso();
  writeLock({
    taskId: input.taskId,
    workflowId: input.workflowId,
    acquiredAt: currentLock?.acquiredAt ?? timestamp,
    heartbeatAt: timestamp,
  });

  return {
    ok: true as const,
  };
}

export function getActiveKeyMaterialWorkflow(taskId: string, staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS) {
  recoverStaleKeyMaterialWorkflow(taskId, staleTimeoutMs);
  const lock = getLock(taskId);
  if (!lock) {
    return null;
  }
  const workflow = getKeyMaterialWorkflow(lock.workflowId);
  if (!workflow || isTerminalWorkflowStatus(workflow.status)) {
    removeLock(taskId);
    return null;
  }
  return workflow;
}

export function recoverStaleKeyMaterialWorkflow(taskId: string, staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS) {
  const lock = getLock(taskId);
  if (!lock) {
    return null;
  }

  const workflow = getKeyMaterialWorkflow(lock.workflowId);
  if (!workflow) {
    removeLock(taskId);
    return null;
  }

  if (isTerminalWorkflowStatus(workflow.status)) {
    removeLock(taskId);
    return workflow;
  }

  const heartbeatAtMs = new Date(lock.heartbeatAt).getTime();
  if (!Number.isFinite(heartbeatAtMs) || Date.now() - heartbeatAtMs <= staleTimeoutMs) {
    return workflow;
  }

  const failed = failKeyMaterialWorkflow(workflow.workflowId, "关键素材任务长时间未更新，已自动标记失败，请重试。");
  recordKeyMaterialWorkflowEvent(failed, "recovered", "关键素材过期任务已自动标记失败");
  removeLock(taskId);
  return failed;
}

export function deleteKeyMaterialWorkflowsByTaskId(taskId: string) {
  const workflows = listKeyMaterialWorkflows(taskId);
  for (const workflow of workflows) {
    dbDelete(WORKFLOW_COLLECTION, workflow.workflowId);
  }
  removeLock(taskId);
  return workflows.length;
}

export function buildRetryKeyMaterialWorkflow(input: {
  taskId: string;
  ownerUserId?: string | null;
  requestId?: string;
  mode: Exclude<KeyMaterialWorkflowMode, "run">;
  previousWorkflow: KeyMaterialWorkflowRecord;
  requestSnapshot?: Record<string, unknown> | null;
}) {
  const carrySubtitle =
    input.mode === "retry_failed_step" &&
    input.previousWorkflow.steps[keyMaterialStepKeys.subtitleAudio].status === "success" &&
    input.previousWorkflow.steps[keyMaterialStepKeys.visualImages].status === "failed"
      ? input.previousWorkflow
      : null;

  return createKeyMaterialWorkflow({
    taskId: input.taskId,
    ownerUserId: input.ownerUserId ?? null,
    requestId: input.requestId,
    mode: input.mode,
    retryOfWorkflowId: input.previousWorkflow.workflowId,
    requestSnapshot: input.requestSnapshot ?? null,
    carrySubtitleStepFromWorkflow: carrySubtitle,
  });
}

export function isKeyMaterialWorkflowRunning(workflow: Pick<KeyMaterialWorkflowRecord, "status"> | null | undefined) {
  return workflow?.status === "pending" || workflow?.status === "running";
}

export const keyMaterialWorkflowDefaults = {
  staleTimeoutMs: DEFAULT_STALE_TIMEOUT_MS,
} as const;
