import test from "node:test";
import assert from "node:assert/strict";

import { resolveDirectorUpstreamBlockedReason, resolveKeyMaterialActionRuntime } from "./director-action-runtime";
import {
  filterTaskStageProgressByTaskId,
  taskStageProgressKeys,
  type TaskStageProgressSnapshot,
} from "./task-stage-progress";
import {
  completeTaskStageProgress,
  deleteTaskStageProgress,
  getTaskStageProgress,
  startTaskStageProgress,
  upsertTaskStageProgress,
} from "./task-stage-progress-store";
import { deleteTaskWorkflowEventsByTaskId, listTaskWorkflowEvents } from "./task-workflow-event-store";

function buildProgress(input: Partial<TaskStageProgressSnapshot>): TaskStageProgressSnapshot {
  return {
    taskId: input.taskId ?? "task-a",
    stageKey: input.stageKey ?? taskStageProgressKeys.shotPlan,
    runId: input.runId ?? "run-1",
    status: input.status ?? "IN_PROGRESS",
    percent: input.percent ?? 42,
    message: input.message ?? "处理中",
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    startedAt: input.startedAt ?? "2026-04-19T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-19T00:00:01.000Z",
    finishedAt: input.finishedAt ?? null,
    errorMessage: input.errorMessage ?? null,
  };
}

test("filterTaskStageProgressByTaskId 会过滤掉上一个任务残留的阶段进度", () => {
  const scoped = filterTaskStageProgressByTaskId(
    {
      [taskStageProgressKeys.shotPlan]: buildProgress({
        taskId: "task-old",
        stageKey: taskStageProgressKeys.shotPlan,
      }),
      [taskStageProgressKeys.subtitleAudio]: buildProgress({
        taskId: "task-new",
        stageKey: taskStageProgressKeys.subtitleAudio,
      }),
    },
    "task-new",
  );

  assert.equal(scoped[taskStageProgressKeys.shotPlan], undefined);
  assert.equal(scoped[taskStageProgressKeys.subtitleAudio]?.taskId, "task-new");
});

test("filterTaskStageProgressByTaskId 在没有当前任务时返回空结果", () => {
  const scoped = filterTaskStageProgressByTaskId(
    {
      [taskStageProgressKeys.shotPlan]: buildProgress({ taskId: "task-old" }),
    },
    "",
  );

  assert.deepEqual(scoped, {});
});

test("阶段进度忽略旧 run 的延迟回写", () => {
  const taskId = `task-stage-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    startTaskStageProgress({
      taskId,
      stageKey: taskStageProgressKeys.visualImages,
      runId: "run-old",
      startedAt: "2026-04-19T00:00:00.000Z",
      message: "旧任务运行中",
      percent: 20,
    });

    startTaskStageProgress({
      taskId,
      stageKey: taskStageProgressKeys.visualImages,
      runId: "run-new",
      startedAt: "2026-04-19T00:01:00.000Z",
      message: "新任务运行中",
      percent: 10,
    });

    upsertTaskStageProgress(taskId, taskStageProgressKeys.visualImages, {
      runId: "run-old",
      startedAt: "2026-04-19T00:00:00.000Z",
      status: "COMPLETED",
      percent: 100,
      message: "旧任务完成",
      finishedAt: "2026-04-19T00:02:00.000Z",
    });

    const current = getTaskStageProgress(taskId, taskStageProgressKeys.visualImages);
    assert.equal(current?.runId, "run-new");
    assert.equal(current?.status, "IN_PROGRESS");
    assert.equal(current?.message, "新任务运行中");
  } finally {
    deleteTaskStageProgress(taskId, taskStageProgressKeys.visualImages);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});

test("阶段进度开始和完成会记录任务事件日志", () => {
  const taskId = `task-stage-progress-events-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    startTaskStageProgress({
      taskId,
      stageKey: taskStageProgressKeys.subtitleAudio,
      runId: "stage-run-1",
      startedAt: "2026-04-26T00:00:00.000Z",
      message: "字幕音频开始",
      percent: 1,
    });

    const completed = getTaskStageProgress(taskId, taskStageProgressKeys.subtitleAudio);
    assert.equal(completed?.status, "IN_PROGRESS");

    const finished = completeTaskStageProgress(taskId, taskStageProgressKeys.subtitleAudio, {
      runId: "stage-run-1",
      startedAt: "2026-04-26T00:00:00.000Z",
      finishedAt: "2026-04-26T00:00:05.000Z",
      message: "字幕音频完成",
    });
    assert.equal(finished?.status, "COMPLETED");

    const events = listTaskWorkflowEvents(taskId);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "stage");
    assert.equal(events[0].status, "running");
    assert.equal(events[1].status, "success");
    assert.equal(events[1].durationMs, 5_000);
  } finally {
    deleteTaskStageProgress(taskId, taskStageProgressKeys.subtitleAudio);
    deleteTaskWorkflowEventsByTaskId(taskId);
  }
});

test("关键素材按钮可从持久化视觉阶段恢复运行态", () => {
  const runtime = resolveKeyMaterialActionRuntime({
    workflowStatus: null,
    subtitleStepStatus: null,
    visualStepStatus: null,
    subtitleStageProgress: null,
    visualStageProgress: buildProgress({
      stageKey: taskStageProgressKeys.visualImages,
      percent: 60,
      message: "镜头 8 参考图生成中...",
    }),
    idleLabel: "生成关键素材",
    fallbackRunningLabel: "关键素材生成中...",
  });

  assert.equal(runtime.isRunning, true);
  assert.equal(runtime.label, "镜头 8 参考图生成中...");
  assert.equal(runtime.progressPercent, 80);
});

test("上游步骤运行中时会阻止下游动作", () => {
  assert.equal(
    resolveDirectorUpstreamBlockedReason({
      planningRunning: true,
      keyMaterialRunning: false,
    }),
    "镜头规划处理中，请等待当前任务完成后再继续。",
  );
  assert.equal(
    resolveDirectorUpstreamBlockedReason({
      planningRunning: false,
      keyMaterialRunning: true,
    }),
    "关键素材生成中，请等待当前任务完成后再继续。",
  );
  assert.equal(
    resolveDirectorUpstreamBlockedReason({
      planningRunning: false,
      keyMaterialRunning: false,
    }),
    null,
  );
});
