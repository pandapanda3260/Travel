import test from "node:test";
import assert from "node:assert/strict";

import { replaceGeneratedVideoRecord } from "./task-generated-video-state";
import type { VideoTaskGeneratedVideoRecord } from "./video-task-schema";

function buildGeneratedVideoRecord(input: Partial<VideoTaskGeneratedVideoRecord> & Pick<VideoTaskGeneratedVideoRecord, "taskId">) {
  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle ?? input.taskId,
    videoJobId: input.videoJobId ?? `${input.taskId}-job`,
    type: input.type ?? "DIRECTOR",
    status: input.status ?? "COMPLETED",
    createdAt: input.createdAt ?? "2026-04-19T00:00:00.000Z",
    originalPrompt: input.originalPrompt ?? "",
    optimizedPrompt: input.optimizedPrompt ?? "",
    videoUrl: input.videoUrl ?? null,
    modelId: input.modelId ?? null,
    resolvedDurationSeconds: input.resolvedDurationSeconds ?? null,
    generationSettings: input.generationSettings ?? null,
    error: input.error ?? null,
  } satisfies VideoTaskGeneratedVideoRecord;
}

test("replaceGeneratedVideoRecord 会替换同任务的旧成片记录", () => {
  const current = [
    buildGeneratedVideoRecord({ taskId: "task-a", videoJobId: "job-old", videoUrl: "/generated-videos/task-a-old.mp4" }),
    buildGeneratedVideoRecord({ taskId: "task-b", videoJobId: "job-b" }),
  ];
  const next = buildGeneratedVideoRecord({
    taskId: "task-a",
    videoJobId: "job-new",
    videoUrl: "/generated-compositions/task-a-new.mp4",
  });

  assert.deepEqual(replaceGeneratedVideoRecord(current, "task-a", next), [
    next,
    current[1]!,
  ]);
});

test("replaceGeneratedVideoRecord 会在任务结果被回收后移除旧成片记录", () => {
  const current = [
    buildGeneratedVideoRecord({ taskId: "task-a", videoJobId: "job-a" }),
    buildGeneratedVideoRecord({ taskId: "task-b", videoJobId: "job-b" }),
  ];

  assert.deepEqual(replaceGeneratedVideoRecord(current, "task-a", null), [current[1]!]);
});

test("replaceGeneratedVideoRecord 在成片记录未变化时会复用原数组", () => {
  const existing = buildGeneratedVideoRecord({
    taskId: "task-a",
    videoJobId: "job-a",
    videoUrl: "/generated-compositions/task-a.mp4",
  });
  const current = [existing, buildGeneratedVideoRecord({ taskId: "task-b", videoJobId: "job-b" })];
  const next = buildGeneratedVideoRecord({
    taskId: "task-a",
    videoJobId: "job-a",
    videoUrl: "/generated-compositions/task-a.mp4",
  });

  assert.equal(replaceGeneratedVideoRecord(current, "task-a", next), current);
});
