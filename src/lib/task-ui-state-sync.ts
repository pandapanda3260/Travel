import type { VideoTaskRecord } from "./video-task-schema";

type ComparableTaskStepActionState =
  | {
      label: string;
      onAction: () => void;
      isRunning?: boolean;
      progressPercent?: number | null;
      canRun?: boolean;
      blockedReason?: string | null;
    }
  | null;

type NumericSummaryState = Record<string, number> | null;

export function mergeStructuredState<T>(current: T, next: T): T {
  if (current === next) {
    return current;
  }

  if (current == null || next == null) {
    return next;
  }

  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

export function mergeTaskStepActionState<T extends ComparableTaskStepActionState>(current: T, next: T): T {
  if (current === next) {
    return current;
  }

  if (!current || !next) {
    return next;
  }

  if (
    current.label === next.label &&
    current.isRunning === next.isRunning &&
    (current.progressPercent ?? null) === (next.progressPercent ?? null) &&
    (current.canRun ?? true) === (next.canRun ?? true) &&
    (current.blockedReason ?? null) === (next.blockedReason ?? null)
  ) {
    return current;
  }

  return next;
}

export function mergeNumericSummaryState<T extends NumericSummaryState>(current: T, next: T): T {
  if (current === next) {
    return current;
  }

  if (!current || !next) {
    return next;
  }

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) {
    return next;
  }

  if (
    currentKeys.every((key) => Object.prototype.hasOwnProperty.call(next, key) && current[key] === next[key])
  ) {
    return current;
  }

  return next;
}

export function areTaskRecordsEquivalentForUi(current: VideoTaskRecord, next: VideoTaskRecord) {
  if (current.taskId !== next.taskId) {
    return false;
  }

  if (current.updatedAt !== next.updatedAt || current.status !== next.status || current.title !== next.title) {
    return false;
  }

  return JSON.stringify(current) === JSON.stringify(next);
}

export function upsertTaskRecordIfChanged(current: VideoTaskRecord[], nextTask: VideoTaskRecord) {
  const existingIndex = current.findIndex((task) => task.taskId === nextTask.taskId);
  if (existingIndex < 0) {
    return [...current, nextTask].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }

  const existingTask = current[existingIndex]!;
  if (areTaskRecordsEquivalentForUi(existingTask, nextTask)) {
    return current;
  }

  const nextTasks = current.slice();
  nextTasks[existingIndex] = nextTask;
  nextTasks.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return nextTasks;
}
