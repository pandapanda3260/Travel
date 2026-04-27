import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetryKeyMaterialWorkflow,
  completeKeyMaterialWorkflowStep,
  createKeyMaterialWorkflow,
  deleteKeyMaterialWorkflowsByTaskId,
  failKeyMaterialWorkflow,
  keyMaterialStepKeys,
  startKeyMaterialWorkflowStep,
} from "./key-material-task-store";
import { deleteTaskWorkflowEventsByTaskId, listTaskWorkflowEvents } from "./task-workflow-event-store";

function createTestTaskId() {
  return `task-key-material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("关键素材父任务在字幕成功后图片失败时标记为 partial_failed", () => {
  const taskId = createTestTaskId();

  try {
    const workflow = createKeyMaterialWorkflow({
      taskId,
      mode: "run",
    });

    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio);
    completeKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio, {
      narrationResultId: "result-1",
      subtitleSrtUrl: "/subtitle.srt",
      mergedAudioUrl: "/audio.mp3",
    });
    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.visualImages);

    const failedWorkflow = failKeyMaterialWorkflow(workflow.workflowId, "视觉图片生成失败");

    assert.equal(failedWorkflow?.status, "partial_failed");
    assert.equal(failedWorkflow?.steps[keyMaterialStepKeys.subtitleAudio].status, "success");
    assert.equal(failedWorkflow?.steps[keyMaterialStepKeys.visualImages].status, "failed");
    assert.equal(failedWorkflow?.lastError, "视觉图片生成失败");

    const events = listTaskWorkflowEvents(taskId);
    assert.equal(events.some((event) => event.workflowType === "key_material" && event.status === "queued"), true);
    assert.equal(events.some((event) => event.stepKey === keyMaterialStepKeys.subtitleAudio && event.status === "success"), true);
    assert.equal(events.some((event) => event.stepKey === keyMaterialStepKeys.visualImages && event.status === "failed"), true);
  } finally {
    deleteKeyMaterialWorkflowsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});

test("重试失败步骤会继承已成功的字幕音频结果", () => {
  const taskId = createTestTaskId();

  try {
    const workflow = createKeyMaterialWorkflow({
      taskId,
      mode: "run",
    });

    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio);
    completeKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.subtitleAudio, {
      narrationResultId: "result-2",
      subtitleSrtUrl: "/subtitle-2.srt",
      mergedAudioUrl: "/audio-2.mp3",
    });
    startKeyMaterialWorkflowStep(workflow.workflowId, keyMaterialStepKeys.visualImages);
    const failedWorkflow = failKeyMaterialWorkflow(workflow.workflowId, "视觉图片生成失败");

    if (!failedWorkflow) {
      throw new Error("failedWorkflow should not be null");
    }

    const retryWorkflow = buildRetryKeyMaterialWorkflow({
      taskId,
      mode: "retry_failed_step",
      previousWorkflow: failedWorkflow,
      requestSnapshot: {
        retryReason: "visual_failed",
      },
    });

    assert.equal(retryWorkflow.steps[keyMaterialStepKeys.subtitleAudio].status, "success");
    assert.equal(
      retryWorkflow.steps[keyMaterialStepKeys.subtitleAudio].carriedFromWorkflowId,
      failedWorkflow.workflowId,
    );
    assert.equal(retryWorkflow.steps[keyMaterialStepKeys.visualImages].status, "pending");
    assert.equal(retryWorkflow.currentStepKey, keyMaterialStepKeys.visualImages);
  } finally {
    deleteKeyMaterialWorkflowsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});
