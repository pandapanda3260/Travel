import { resolveTaskClipCompletionState } from "./task-clip-completion";
import { getTaskClipNarrationResult, listTaskClipShots, parseTaskClipShots } from "./task-clip-store";
import { getLatestCompletedTaskVideoComposition } from "./video-composition-store";
import { listVideoJobs } from "./video-job-store";
import { getVideoTask, patchVideoTask } from "./video-task-store";
import {
  getVideoTaskStatusIndex,
  promoteVideoTaskStatus,
  type VideoTaskRecord,
  type VideoTaskStatus,
} from "./video-task-schema";

function promoteTaskStatusIfNeeded(task: VideoTaskRecord, targetStatus: VideoTaskStatus) {
  if (getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex(targetStatus)) {
    return task;
  }

  return patchVideoTask(task.taskId, {
    status: promoteVideoTaskStatus(task.status, targetStatus),
  }) ?? task;
}

/**
 * Repairs stale task status from durable artifacts after refresh/re-entry.
 * This only promotes status when artifacts prove completion; destructive resets stay in explicit mutation paths.
 */
export function reconcileVideoTaskRuntimeStatus(taskId: string) {
  let task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  const completedComposition = getLatestCompletedTaskVideoComposition(taskId);
  if (completedComposition) {
    task = promoteTaskStatusIfNeeded(task, "COMPOSITION_READY");
    return task;
  }

  try {
    const clipCompletionState = resolveTaskClipCompletionState({
      shotDefinitions: parseTaskClipShots(task, getTaskClipNarrationResult(taskId, task)),
      clipRecords: listTaskClipShots(taskId),
      jobs: listVideoJobs(),
    });
    if (clipCompletionState.allCompleted) {
      task = promoteTaskStatusIfNeeded(task, "CLIPS_READY");
    }
  } catch {
    // Some early-stage tasks do not have enough narration data to derive clip definitions yet.
  }

  return task;
}
