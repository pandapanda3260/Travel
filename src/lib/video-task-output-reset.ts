import { listNarrationResults } from "./narration-result-store";
import { listTaskClipShots } from "./task-clip-store";
import { listTaskVideoCompositions } from "./video-composition-store";
import { deleteVideoGenerationWorkflowsByTaskId } from "./video-generation-workflow-store";
import { listTaskVisualImageShots } from "./task-visual-image-store";
import { listVideoJobs } from "./video-job-store";
import { taskStageProgressKeys } from "./task-stage-progress";
import { deleteTaskStageProgress } from "./task-stage-progress-store";
import type { VideoTaskDraftBundle, VideoTaskParameterBundle, VideoTaskRecord, VideoTaskSource } from "./video-task-schema";

function hasChanged(currentValue: unknown, nextValue: unknown) {
  return JSON.stringify(currentValue) !== JSON.stringify(nextValue);
}

function buildGeneratedOutputDefinitionParameters(parameters: VideoTaskParameterBundle) {
  const { composition: _composition, ...definitionParameters } = parameters;
  return definitionParameters;
}

export function shouldResetTaskGeneratedOutputs(input: {
  task: Pick<VideoTaskRecord, "source" | "draftBundle" | "parameters">;
  nextSource: VideoTaskSource;
  nextDraftBundle: VideoTaskDraftBundle;
  nextParameters: VideoTaskParameterBundle;
}) {
  return (
    hasChanged(input.task.source, input.nextSource) ||
    hasChanged(input.task.draftBundle, input.nextDraftBundle) ||
    hasChanged(
      buildGeneratedOutputDefinitionParameters(input.task.parameters),
      buildGeneratedOutputDefinitionParameters(input.nextParameters),
    )
  );
}

export function clearTaskNarrationOutputs(taskId: string) {
  const relatedNarrations = listNarrationResults().filter((item) => item.taskId === taskId);

  return {
    preservedNarrationResultIds: relatedNarrations.map((item) => item.resultId),
  };
}

export function clearTaskCompositionOutputs(taskId: string) {
  deleteTaskStageProgress(taskId, taskStageProgressKeys.composition);
  const relatedCompositions = listTaskVideoCompositions(taskId);

  return {
    preservedCompositionIds: relatedCompositions.map((item) => item.compositionId),
  };
}

export function clearTaskClipAndCompositionOutputs(taskId: string) {
  const deletedVideoGenerationWorkflowCount = deleteVideoGenerationWorkflowsByTaskId(taskId);
  deleteTaskStageProgress(taskId, taskStageProgressKeys.clipGeneration);
  const compositionResult = clearTaskCompositionOutputs(taskId);
  const relatedClipRecords = listTaskClipShots(taskId);
  const relatedVideoJobIds = listVideoJobs()
    .filter((job) => job.sourceTaskId === taskId)
    .map((job) => job.jobId);

  return {
    ...compositionResult,
    preservedClipShotIndexes: relatedClipRecords.map((clip) => clip.shotIndex),
    preservedVideoJobIds: relatedVideoJobIds,
    deletedVideoGenerationWorkflowCount,
  };
}

export function clearTaskClipAndCompositionOutputsForShotIndexes(taskId: string, shotIndexes: number[]) {
  const normalizedShotIndexes = Array.from(
    new Set(
      shotIndexes.map((shotIndex) => Number(shotIndex)).filter((shotIndex) => Number.isFinite(shotIndex) && shotIndex > 0),
    ),
  );

  const deletedVideoGenerationWorkflowCount = deleteVideoGenerationWorkflowsByTaskId(taskId);
  deleteTaskStageProgress(taskId, taskStageProgressKeys.clipGeneration);
  const compositionResult = clearTaskCompositionOutputs(taskId);

  const preservedClipRecords = listTaskClipShots(taskId).filter((clip) => normalizedShotIndexes.includes(clip.shotIndex));
  const preservedVideoJobIds = Array.from(
    new Set(
      preservedClipRecords
        .flatMap((clip) => [clip.videoJobId, clip.lipSyncJobId])
        .filter((jobId): jobId is string => Boolean(jobId)),
    ),
  );

  return {
    ...compositionResult,
    preservedClipShotIndexes: preservedClipRecords.map((clip) => clip.shotIndex),
    preservedVideoJobIds,
    deletedVideoGenerationWorkflowCount,
  };
}

export function clearTaskGeneratedOutputs(taskId: string) {
  const narrationResult = clearTaskNarrationOutputs(taskId);
  deleteTaskStageProgress(taskId, taskStageProgressKeys.subtitleAudio);
  deleteTaskStageProgress(taskId, taskStageProgressKeys.visualImages);
  const preservedVisualShotIndexes = listTaskVisualImageShots(taskId).map((shot) => shot.shotIndex);
  const clipResult = clearTaskClipAndCompositionOutputs(taskId);

  return {
    ...narrationResult,
    ...clipResult,
    preservedVisualShotIndexes,
  };
}
