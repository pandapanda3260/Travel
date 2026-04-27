import { dbDelete, dbGet, dbGetAll, dbUpsert } from "./db";
import { safeAppendTaskWorkflowEvent } from "./task-workflow-event-store";
import {
  isVideoGenerationWorkflowRunning,
  videoGenerationStepKeys,
  type VideoGenerationStepKey,
  type VideoGenerationStepRecord,
  type VideoGenerationWorkflowRecord,
  type VideoGenerationWorkflowStatus,
  type VideoGenerationStepStatus,
} from "./video-generation-workflow";

export {
  isVideoGenerationWorkflowRunning,
  videoGenerationStepKeys,
  type VideoGenerationStepKey,
  type VideoGenerationStepRecord,
  type VideoGenerationWorkflowRecord,
  type VideoGenerationWorkflowStatus,
  type VideoGenerationStepStatus,
} from "./video-generation-workflow";

type VideoGenerationWorkflowLockRecord = {
  taskId: string;
  workflowId: string;
  acquiredAt: string;
  heartbeatAt: string;
};

const WORKFLOW_COLLECTION = "video-generation-workflows";
const LOCK_COLLECTION = "video-generation-workflow-locks";
const DEFAULT_STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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

function createEmptyStep(stepKey: VideoGenerationStepKey): VideoGenerationStepRecord {
  return {
    stepKey,
    label: stepKey === videoGenerationStepKeys.clipGeneration ? "视频片段" : "视频合成",
    status: "pending",
    startedAt: null,
    finishedAt: null,
    updatedAt: nowIso(),
    errorMessage: null,
  };
}

function createEmptySteps() {
  return {
    [videoGenerationStepKeys.clipGeneration]: createEmptyStep(videoGenerationStepKeys.clipGeneration),
    [videoGenerationStepKeys.composition]: createEmptyStep(videoGenerationStepKeys.composition),
  } satisfies Record<VideoGenerationStepKey, VideoGenerationStepRecord>;
}

function normalizeStepRecord(
  stepKey: VideoGenerationStepKey,
  record: Partial<VideoGenerationStepRecord> | null | undefined,
): VideoGenerationStepRecord {
  const base = createEmptyStep(stepKey);
  return {
    ...base,
    ...record,
    stepKey,
    label: record?.label?.trim() || base.label,
    status: (record?.status ?? base.status) as VideoGenerationStepStatus,
    updatedAt: record?.updatedAt ?? base.updatedAt,
    errorMessage: record?.errorMessage ?? null,
  };
}

function normalizeWorkflowRecord(record: Partial<VideoGenerationWorkflowRecord>): VideoGenerationWorkflowRecord {
  const createdAt = record.createdAt ?? nowIso();
  const steps = record.steps ?? createEmptySteps();
  return {
    workflowId: record.workflowId ?? crypto.randomUUID(),
    taskId: record.taskId ?? "",
    ownerUserId: record.ownerUserId ?? null,
    requestId: record.requestId?.trim() || crypto.randomUUID(),
    status: (record.status ?? "pending") as VideoGenerationWorkflowStatus,
    currentStepKey: (record.currentStepKey ?? null) as VideoGenerationStepKey | null,
    createdAt,
    updatedAt: record.updatedAt ?? createdAt,
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? null,
    lastError: record.lastError ?? null,
    requestSnapshot: record.requestSnapshot ?? null,
    steps: {
      [videoGenerationStepKeys.clipGeneration]: normalizeStepRecord(
        videoGenerationStepKeys.clipGeneration,
        steps[videoGenerationStepKeys.clipGeneration],
      ),
      [videoGenerationStepKeys.composition]: normalizeStepRecord(
        videoGenerationStepKeys.composition,
        steps[videoGenerationStepKeys.composition],
      ),
    },
  };
}

function getLock(taskId: string) {
  return dbGet<VideoGenerationWorkflowLockRecord>(LOCK_COLLECTION, taskId);
}

function writeLock(record: VideoGenerationWorkflowLockRecord) {
  dbUpsert(LOCK_COLLECTION, record.taskId, record);
  return record;
}

function removeLock(taskId: string) {
  dbDelete(LOCK_COLLECTION, taskId);
}

function isTerminalWorkflowStatus(status: VideoGenerationWorkflowStatus) {
  return status === "success" || status === "failed";
}

function recordVideoGenerationWorkflowEvent(
  workflow: VideoGenerationWorkflowRecord | null,
  status: "queued" | "running" | "success" | "failed" | "recovered",
  message: string,
) {
  if (!workflow) {
    return;
  }

  safeAppendTaskWorkflowEvent({
    taskId: workflow.taskId,
    kind: "workflow",
    workflowType: "video_generation",
    workflowId: workflow.workflowId,
    status,
    message,
    errorMessage: workflow.lastError,
    startedAt: workflow.startedAt,
    finishedAt: workflow.finishedAt,
    metadata: {
      requestId: workflow.requestId,
      currentStepKey: workflow.currentStepKey,
    },
  });
}

function recordVideoGenerationStepEvent(
  workflow: VideoGenerationWorkflowRecord | null,
  stepKey: VideoGenerationStepKey,
  status: "running" | "success" | "failed",
  message: string,
) {
  if (!workflow) {
    return;
  }

  const step = workflow.steps[stepKey];
  safeAppendTaskWorkflowEvent({
    taskId: workflow.taskId,
    kind: "step",
    workflowType: "video_generation",
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
    },
  });
}

export function listVideoGenerationWorkflows(taskId?: string) {
  return dbGetAll<Partial<VideoGenerationWorkflowRecord>>(WORKFLOW_COLLECTION)
    .map(normalizeWorkflowRecord)
    .filter((record) => (taskId ? record.taskId === taskId : true))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getVideoGenerationWorkflow(workflowId: string) {
  const record = dbGet<Partial<VideoGenerationWorkflowRecord>>(WORKFLOW_COLLECTION, workflowId);
  return record ? normalizeWorkflowRecord(record) : null;
}

export function getLatestVideoGenerationWorkflow(taskId: string) {
  return listVideoGenerationWorkflows(taskId)[0] ?? null;
}

export function deleteVideoGenerationWorkflowsByTaskId(taskId: string) {
  const workflows = listVideoGenerationWorkflows(taskId);
  for (const workflow of workflows) {
    dbDelete(WORKFLOW_COLLECTION, workflow.workflowId);
  }
  removeLock(taskId);
  return workflows.length;
}

export function getVideoGenerationWorkflowByRequestId(taskId: string, requestId: string) {
  return listVideoGenerationWorkflows(taskId).find((record) => record.requestId === requestId) ?? null;
}

export function createVideoGenerationWorkflow(input: {
  taskId: string;
  ownerUserId?: string | null;
  requestId?: string;
  requestSnapshot?: Record<string, unknown> | null;
}) {
  const createdAt = nowIso();
  const record = normalizeWorkflowRecord({
    workflowId: crypto.randomUUID(),
    taskId: input.taskId,
    ownerUserId: input.ownerUserId ?? null,
    requestId: input.requestId?.trim() || crypto.randomUUID(),
    status: "pending",
    currentStepKey: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    requestSnapshot: input.requestSnapshot ?? null,
    steps: createEmptySteps(),
  });

  dbUpsert(WORKFLOW_COLLECTION, record.workflowId, record);
  recordVideoGenerationWorkflowEvent(record, "queued", "视频生成任务已创建");
  return record;
}

export function patchVideoGenerationWorkflow(
  workflowId: string,
  updates: Partial<Omit<VideoGenerationWorkflowRecord, "workflowId" | "taskId" | "createdAt" | "steps">> & {
    steps?: Partial<Record<VideoGenerationStepKey, Partial<VideoGenerationStepRecord>>>;
  },
) {
  const current = getVideoGenerationWorkflow(workflowId);
  if (!current) {
    return null;
  }

  const updatedAt = nowIso();
  const next = normalizeWorkflowRecord({
    ...current,
    ...updates,
    updatedAt,
    steps: {
      [videoGenerationStepKeys.clipGeneration]: normalizeStepRecord(
        videoGenerationStepKeys.clipGeneration,
        updates.steps?.[videoGenerationStepKeys.clipGeneration]
          ? {
              ...current.steps[videoGenerationStepKeys.clipGeneration],
              ...updates.steps[videoGenerationStepKeys.clipGeneration],
              updatedAt,
            }
          : current.steps[videoGenerationStepKeys.clipGeneration],
      ),
      [videoGenerationStepKeys.composition]: normalizeStepRecord(
        videoGenerationStepKeys.composition,
        updates.steps?.[videoGenerationStepKeys.composition]
          ? {
              ...current.steps[videoGenerationStepKeys.composition],
              ...updates.steps[videoGenerationStepKeys.composition],
              updatedAt,
            }
          : current.steps[videoGenerationStepKeys.composition],
      ),
    },
  });

  dbUpsert(WORKFLOW_COLLECTION, workflowId, next);
  return next;
}

export function startVideoGenerationWorkflow(workflowId: string) {
  const workflow = patchVideoGenerationWorkflow(workflowId, {
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    lastError: null,
  });
  recordVideoGenerationWorkflowEvent(workflow, "running", "视频生成任务开始");
  return workflow;
}

export function startVideoGenerationWorkflowStep(workflowId: string, stepKey: VideoGenerationStepKey) {
  const startedAt = nowIso();
  const workflow = patchVideoGenerationWorkflow(workflowId, {
    status: "running",
    currentStepKey: stepKey,
    startedAt,
    finishedAt: null,
    lastError: null,
    steps: {
      [stepKey]: {
        status: "running",
        startedAt,
        finishedAt: null,
        errorMessage: null,
      },
    },
  });
  recordVideoGenerationStepEvent(workflow, stepKey, "running", `${workflow?.steps[stepKey].label ?? stepKey}开始`);
  return workflow;
}

export function completeVideoGenerationWorkflowStep(workflowId: string, stepKey: VideoGenerationStepKey) {
  const finishedAt = nowIso();
  const workflow = patchVideoGenerationWorkflow(workflowId, {
    steps: {
      [stepKey]: {
        status: "success",
        finishedAt,
        errorMessage: null,
      },
    },
  });
  recordVideoGenerationStepEvent(workflow, stepKey, "success", `${workflow?.steps[stepKey].label ?? stepKey}完成`);
  return workflow;
}

export function completeVideoGenerationWorkflow(workflowId: string) {
  const finishedAt = nowIso();
  const workflow = patchVideoGenerationWorkflow(workflowId, {
    status: "success",
    currentStepKey: null,
    finishedAt,
    lastError: null,
  });
  recordVideoGenerationWorkflowEvent(workflow, "success", "视频生成任务完成");
  return workflow;
}

export function failVideoGenerationWorkflow(workflowId: string, error: unknown) {
  const current = getVideoGenerationWorkflow(workflowId);
  if (!current) {
    return null;
  }

  const finishedAt = nowIso();
  const currentStepKey = current.currentStepKey;
  const workflow = patchVideoGenerationWorkflow(workflowId, {
    status: "failed",
    finishedAt,
    lastError: toErrorMessage(error),
    steps: currentStepKey
      ? {
          [currentStepKey]: {
            status: "failed",
            finishedAt,
            errorMessage: toErrorMessage(error),
          },
        }
      : undefined,
  });
  if (currentStepKey) {
    recordVideoGenerationStepEvent(workflow, currentStepKey, "failed", `${workflow?.steps[currentStepKey].label ?? currentStepKey}失败`);
  }
  recordVideoGenerationWorkflowEvent(workflow, "failed", "视频生成任务失败");
  return workflow;
}

export function touchVideoGenerationWorkflow(workflowId: string) {
  const workflow = patchVideoGenerationWorkflow(workflowId, {});
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

export function releaseVideoGenerationWorkflowLock(taskId: string, workflowId: string) {
  const lock = getLock(taskId);
  if (!lock || lock.workflowId !== workflowId) {
    return false;
  }
  removeLock(taskId);
  return true;
}

export function acquireVideoGenerationWorkflowLock(input: {
  taskId: string;
  workflowId: string;
  staleTimeoutMs?: number;
}) {
  recoverStaleVideoGenerationWorkflow(input.taskId, input.staleTimeoutMs);

  const now = nowIso();
  const currentLock = getLock(input.taskId);
  if (currentLock && currentLock.workflowId !== input.workflowId) {
    const currentWorkflow = getVideoGenerationWorkflow(currentLock.workflowId);
    const heartbeat = Date.parse(currentLock.heartbeatAt || currentLock.acquiredAt || now);
    const isStale = !Number.isFinite(heartbeat) || Date.now() - heartbeat > (input.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS);

    if (currentWorkflow && !isTerminalWorkflowStatus(currentWorkflow.status) && !isStale) {
      return {
        ok: false as const,
        workflow: currentWorkflow,
      };
    }
  }

  writeLock({
    taskId: input.taskId,
    workflowId: input.workflowId,
    acquiredAt: now,
    heartbeatAt: now,
  });

  return {
    ok: true as const,
    workflow: getVideoGenerationWorkflow(input.workflowId),
  };
}

export function getActiveVideoGenerationWorkflow(taskId: string, staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS) {
  recoverStaleVideoGenerationWorkflow(taskId, staleTimeoutMs);

  const lock = getLock(taskId);
  if (!lock) {
    return null;
  }

  const workflow = getVideoGenerationWorkflow(lock.workflowId);
  if (!workflow || isTerminalWorkflowStatus(workflow.status)) {
    removeLock(taskId);
    return null;
  }

  const heartbeat = Date.parse(lock.heartbeatAt || lock.acquiredAt);
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > staleTimeoutMs) {
    removeLock(taskId);
    return null;
  }

  return workflow;
}

export function recoverStaleVideoGenerationWorkflow(taskId: string, staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS) {
  const lock = getLock(taskId);
  if (!lock) {
    return null;
  }

  const workflow = getVideoGenerationWorkflow(lock.workflowId);
  if (!workflow) {
    removeLock(taskId);
    return null;
  }

  if (isTerminalWorkflowStatus(workflow.status)) {
    removeLock(taskId);
    return workflow;
  }

  const heartbeatAtMs = new Date(lock.heartbeatAt || lock.acquiredAt).getTime();
  if (Number.isFinite(heartbeatAtMs) && Date.now() - heartbeatAtMs <= staleTimeoutMs) {
    return workflow;
  }

  const failed = failVideoGenerationWorkflow(
    workflow.workflowId,
    "视频生成任务长时间未更新，已自动标记失败，请重试。",
  );
  recordVideoGenerationWorkflowEvent(failed, "recovered", "视频生成过期任务已自动标记失败");
  removeLock(taskId);
  return failed;
}

export const videoGenerationWorkflowDefaults = {
  staleTimeoutMs: DEFAULT_STALE_TIMEOUT_MS,
} as const;
