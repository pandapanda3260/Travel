import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTaskWorkflowEvent,
  deleteTaskWorkflowEventsByTaskId,
  listTaskWorkflowEvents,
} from "./task-workflow-event-store";

function createTestTaskId() {
  return `task-workflow-events-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("任务工作流事件按任务隔离并保留耗时", () => {
  const taskId = createTestTaskId();
  const otherTaskId = `${taskId}-other`;

  try {
    appendTaskWorkflowEvent({
      taskId,
      kind: "step",
      workflowType: "video_generation",
      workflowId: "workflow-1",
      stepKey: "clip_generation",
      status: "running",
      message: "视频片段生成开始",
      createdAt: "2026-04-26T00:00:00.000Z",
      startedAt: "2026-04-26T00:00:00.000Z",
    });
    appendTaskWorkflowEvent({
      taskId: otherTaskId,
      kind: "step",
      workflowType: "video_generation",
      workflowId: "workflow-2",
      stepKey: "composition",
      status: "success",
      message: "其他任务完成",
      createdAt: "2026-04-26T00:00:05.000Z",
    });
    appendTaskWorkflowEvent({
      taskId,
      kind: "step",
      workflowType: "video_generation",
      workflowId: "workflow-1",
      stepKey: "clip_generation",
      status: "success",
      message: "视频片段生成完成",
      createdAt: "2026-04-26T00:00:10.000Z",
      startedAt: "2026-04-26T00:00:00.000Z",
      finishedAt: "2026-04-26T00:00:10.000Z",
    });

    const events = listTaskWorkflowEvents(taskId);
    assert.equal(events.length, 2);
    assert.equal(events[0].status, "running");
    assert.equal(events[1].status, "success");
    assert.equal(events[1].durationMs, 10_000);

    const latest = listTaskWorkflowEvents(taskId, { limit: 1 });
    assert.equal(latest.length, 1);
    assert.equal(latest[0].status, "success");
  } finally {
    deleteTaskWorkflowEventsByTaskId(taskId);
    deleteTaskWorkflowEventsByTaskId(otherTaskId);
  }
});
