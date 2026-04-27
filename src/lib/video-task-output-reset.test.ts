import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultSubtitleConfig } from "./subtitle-style-config";
import {
  deleteTaskClipShotsByTaskId,
  listTaskClipShots,
  upsertTaskClipShot,
  type TaskClipShotRecord,
} from "./task-clip-store";
import {
  clearTaskClipAndCompositionOutputs,
  clearTaskClipAndCompositionOutputsForShotIndexes,
} from "./video-task-output-reset";
import { deleteTaskVideoCompositions, listTaskVideoCompositions, upsertVideoComposition } from "./video-composition-store";
import { createVideoGenerationWorkflow, getVideoGenerationWorkflow } from "./video-generation-workflow-store";
import { deleteVideoJob, getVideoJob, upsertVideoJob, type VideoJobRecord } from "./video-job-store";

function createTestTaskId() {
  return `task-output-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildClip(taskId: string, shotIndex: number, videoJobId: string, lipSyncJobId: string): TaskClipShotRecord {
  return {
    taskId,
    segmentId: `segment-${shotIndex}`,
    segmentIndex: shotIndex,
    shotIndex,
    shotTitle: `片段 ${shotIndex}`,
    segmentMode: "single_speaking",
    videoPrompt: `video prompt ${shotIndex}`,
    multiPrompt: [],
    subtitleText: `字幕 ${shotIndex}`,
    narrationText: `口播 ${shotIndex}`,
    wordTimeline: [],
    visualImageSessionId: `image-${shotIndex}`,
    visualImageUrl: `/generated-images/${taskId}/${shotIndex}.png`,
    durationSeconds: 5,
    videoJobId,
    lipSyncJobId,
    thumbnailUrl: null,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    generatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function buildJob(taskId: string, jobId: string): VideoJobRecord {
  return {
    jobId,
    sourceTaskId: taskId,
    taskName: jobId,
    originalPrompt: jobId,
    optimizedPrompt: jobId,
    strategy: {
      angle: jobId,
      hook: jobId,
      style: jobId,
    },
    submittedAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    status: "COMPLETED",
    mode: "mock",
    logs: [],
    videoUrl: null,
    remoteVideoUrl: null,
    error: null,
    provider: null,
    modelId: "test",
    generationSettings: null,
    resolvedDurationSeconds: 5,
    deletedAt: null,
  };
}

test("clearTaskClipAndCompositionOutputsForShotIndexes preserves existing clips and jobs for changed shots", () => {
  const taskId = createTestTaskId();

  try {
    upsertTaskClipShot(buildClip(taskId, 1, `${taskId}-job-1`, `${taskId}-lip-1`));
    upsertTaskClipShot(buildClip(taskId, 2, `${taskId}-job-2`, `${taskId}-lip-2`));
    for (const jobId of [`${taskId}-job-1`, `${taskId}-lip-1`, `${taskId}-job-2`, `${taskId}-lip-2`]) {
      upsertVideoJob(buildJob(taskId, jobId));
    }

    const workflow = createVideoGenerationWorkflow({ taskId });
    upsertVideoComposition({
      compositionId: `${taskId}-composition`,
      taskId,
      title: "局部失效测试",
      aspectRatio: "9:16",
      status: "COMPLETED",
      transitionMode: "cut",
      transitionDurationSeconds: 0,
      audioMode: "mute",
      backgroundMusicUrl: null,
      backgroundMusicVolume: 0,
      audioPlan: { mode: "mute", tracks: [] },
      subtitleSrtUrl: null,
      subtitleConfig: getDefaultSubtitleConfig(),
      segments: [
        {
          id: "segment-1",
          sourceJobId: `${taskId}-job-1`,
          sourceVideoUrl: "",
          order: 0,
          transition: "cut",
          promptSnapshot: "",
        },
      ],
      consistencyProfile: {
        subjectRule: "",
        sceneRule: "",
        styleRule: "",
        forbiddenRule: "",
      },
      outputVideoUrl: null,
      error: null,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    });

    const result = clearTaskClipAndCompositionOutputsForShotIndexes(taskId, [1]);

    assert.deepEqual(result.preservedClipShotIndexes, [1]);
    assert.deepEqual(listTaskClipShots(taskId).map((clip) => clip.shotIndex), [1, 2]);
    assert.notEqual(getVideoJob(`${taskId}-job-1`), null);
    assert.notEqual(getVideoJob(`${taskId}-lip-1`), null);
    assert.notEqual(getVideoJob(`${taskId}-job-2`), null);
    assert.notEqual(getVideoJob(`${taskId}-lip-2`), null);
    assert.equal(listTaskVideoCompositions(taskId).length, 1);
    assert.equal(getVideoGenerationWorkflow(workflow.workflowId), null);
  } finally {
    clearTaskClipAndCompositionOutputs(taskId);
    deleteTaskVideoCompositions(taskId, { reason: "user_manual_delete" });
    deleteTaskClipShotsByTaskId(taskId, { reason: "user_manual_delete" });
    for (const jobId of [`${taskId}-job-1`, `${taskId}-lip-1`, `${taskId}-job-2`, `${taskId}-lip-2`]) {
      deleteVideoJob(jobId, { reason: "user_manual_delete" });
    }
  }
});
