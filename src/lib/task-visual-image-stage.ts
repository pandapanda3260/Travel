import { taskStageProgressKeys } from "./task-stage-progress";
import { completeTaskStageProgress, getTaskStageProgress } from "./task-stage-progress-store";
import {
  autoSelectRecommendedCandidates,
  listTaskVisualImageShots,
  parseTaskVisualImageShots,
} from "./task-visual-image-store";
import { resolveLatestKeyMaterialVisualImagesFailure } from "./key-material-task-store";
import { getExpectedVisualReferenceShotCount } from "./video-task-stage-counts";
import { getVideoTask, patchVideoTask } from "./video-task-store";
import { getVideoTaskStatusIndex } from "./video-task-schema";

export function syncTaskVisualImageSelectionState(
  taskId: string,
  options?: {
    completionMessage?: string;
  },
) {
  const task = getVideoTask(taskId);
  if (!task) {
    return null;
  }

  autoSelectRecommendedCandidates(taskId);

  const savedShots = listTaskVisualImageShots(taskId);
  const shotsWithSelection = savedShots.filter((shot) => Boolean(shot.selectedCandidateId));

  let parsedShots: Array<{ shotIndex: number }> = [];
  try {
    parsedShots = parseTaskVisualImageShots(task);
  } catch {
    parsedShots = [];
  }

  const requiredCount = getExpectedVisualReferenceShotCount(task) || parsedShots.length || shotsWithSelection.length;
  const allSelected = shotsWithSelection.length > 0 && shotsWithSelection.length >= requiredCount;
  let nextTask = task;

  if (allSelected && getVideoTaskStatusIndex(task.status) < getVideoTaskStatusIndex("IMAGES_READY")) {
    nextTask = patchVideoTask(taskId, { status: "IMAGES_READY" }) ?? getVideoTask(taskId) ?? task;
  }

  if (allSelected) {
    const currentProgress = getTaskStageProgress(taskId, taskStageProgressKeys.visualImages);
    if (currentProgress?.status === "FAILED") {
      completeTaskStageProgress(taskId, taskStageProgressKeys.visualImages, {
        runId: currentProgress.runId,
        startedAt: currentProgress.startedAt,
        provider: currentProgress.provider,
        modelId: currentProgress.modelId,
        message: options?.completionMessage ?? "参考图已就绪",
      });
    }
    resolveLatestKeyMaterialVisualImagesFailure(taskId, {
      generatedShotCount: savedShots.length,
      selectedShotCount: shotsWithSelection.length,
      validationPassed: true,
    });
  }

  return nextTask;
}
