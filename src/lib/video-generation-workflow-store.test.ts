import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  acquireVideoGenerationWorkflowLock,
  completeVideoGenerationWorkflow,
  completeVideoGenerationWorkflowStep,
  createVideoGenerationWorkflow,
  deleteVideoGenerationWorkflowsByTaskId,
  failVideoGenerationWorkflow,
  getActiveVideoGenerationWorkflow,
  getVideoGenerationWorkflow,
  isVideoGenerationWorkflowRunning,
  releaseVideoGenerationWorkflowLock,
  startVideoGenerationWorkflow,
  startVideoGenerationWorkflowStep,
  videoGenerationStepKeys,
} from "./video-generation-workflow-store";
import { deleteTaskWorkflowEventsByTaskId, listTaskWorkflowEvents } from "./task-workflow-event-store";

function createTestTaskId() {
  return `task-video-generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("视频生成工作流可以按片段到合成顺序完成", () => {
  const taskId = createTestTaskId();
  let workflowId = "";

  try {
    const workflow = createVideoGenerationWorkflow({
      taskId,
      requestSnapshot: {
        composition: {
          includeBackgroundMusic: true,
          backgroundMusicUrl: "https://example.com/bgm.mp3",
        },
      },
    });
    workflowId = workflow.workflowId;

    const lock = acquireVideoGenerationWorkflowLock({
      taskId,
      workflowId: workflow.workflowId,
    });

    assert.equal(lock.ok, true);
    startVideoGenerationWorkflow(workflow.workflowId);
    startVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.clipGeneration);
    completeVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.clipGeneration);
    startVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.composition);
    completeVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.composition);
    const completed = completeVideoGenerationWorkflow(workflow.workflowId);

    assert.equal(completed?.status, "success");
    assert.equal(completed?.steps[videoGenerationStepKeys.clipGeneration].status, "success");
    assert.equal(completed?.steps[videoGenerationStepKeys.composition].status, "success");
    assert.equal(isVideoGenerationWorkflowRunning(completed), false);

    const events = listTaskWorkflowEvents(taskId);
    assert.equal(events.some((event) => event.workflowType === "video_generation" && event.status === "queued"), true);
    assert.equal(events.some((event) => event.stepKey === videoGenerationStepKeys.clipGeneration && event.status === "success"), true);
    assert.equal(events.some((event) => event.stepKey === videoGenerationStepKeys.composition && event.status === "success"), true);
  } finally {
    if (workflowId) {
      releaseVideoGenerationWorkflowLock(taskId, workflowId);
    }
    deleteVideoGenerationWorkflowsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});

test("视频生成工作流失败后会释放活动锁并记录失败步骤", () => {
  const taskId = createTestTaskId();

  try {
    const workflow = createVideoGenerationWorkflow({ taskId });
    acquireVideoGenerationWorkflowLock({
      taskId,
      workflowId: workflow.workflowId,
    });
    startVideoGenerationWorkflow(workflow.workflowId);
    startVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.clipGeneration);

    const failed = failVideoGenerationWorkflow(workflow.workflowId, "片段生成失败");
    releaseVideoGenerationWorkflowLock(taskId, workflow.workflowId);

    assert.equal(failed?.status, "failed");
    assert.equal(failed?.steps[videoGenerationStepKeys.clipGeneration].status, "failed");
    assert.equal(failed?.lastError, "片段生成失败");
    assert.equal(getActiveVideoGenerationWorkflow(taskId), null);
  } finally {
    deleteVideoGenerationWorkflowsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});

test("视频生成活动工作流长时间无更新时会自动标记失败并释放锁", async () => {
  const taskId = createTestTaskId();

  try {
    const workflow = createVideoGenerationWorkflow({ taskId });
    acquireVideoGenerationWorkflowLock({
      taskId,
      workflowId: workflow.workflowId,
    });
    startVideoGenerationWorkflow(workflow.workflowId);
    startVideoGenerationWorkflowStep(workflow.workflowId, videoGenerationStepKeys.clipGeneration);

    await delay(5);

    const active = getActiveVideoGenerationWorkflow(taskId, 1);
    const recovered = getVideoGenerationWorkflow(workflow.workflowId);

    assert.equal(active, null);
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.steps[videoGenerationStepKeys.clipGeneration].status, "failed");
    assert.match(recovered?.lastError ?? "", /长时间未更新/);
  } finally {
    deleteVideoGenerationWorkflowsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});
