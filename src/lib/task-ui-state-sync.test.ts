import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeNumericSummaryState,
  mergeStructuredState,
  mergeTaskStepActionState,
  upsertTaskRecordIfChanged,
} from "./task-ui-state-sync";
import type { VideoTaskRecord } from "./video-task-schema";

function buildTaskRecord(overrides: Partial<VideoTaskRecord> = {}): VideoTaskRecord {
  return {
    taskId: overrides.taskId ?? "task-1",
    ownerUserId: overrides.ownerUserId ?? "user-1",
    title: overrides.title ?? "测试任务",
    status: overrides.status ?? "CREATED",
    source: (overrides.source ?? {
      productInfoId: null,
      productInfoTitle: null,
      productInfoSnapshot: "",
      userPrompt: "",
      videoMaterialId: null,
      videoMaterialName: null,
      videoTemplatePrompt: "",
    }) as VideoTaskRecord["source"],
    draftBundle: (overrides.draftBundle ?? {
      narrationScript: "",
      subtitleScript: "",
      imagePrompts: [],
      videoPrompts: [],
      compatibleImagePrompts: [],
      compatibleVideoPrompts: [],
      constraintSummary: "",
    }) as VideoTaskRecord["draftBundle"],
    shotPlan: overrides.shotPlan ?? null,
    directorPlan: overrides.directorPlan ?? null,
    parameters: (overrides.parameters ?? {
      image: {},
      video: {},
      audio: {},
      composition: {},
      constraints: {},
    }) as VideoTaskRecord["parameters"],
    createdAt: overrides.createdAt ?? "2026-04-25T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-25T10:00:00.000Z",
    stageTimestamps: overrides.stageTimestamps ?? {},
  };
}

test("mergeTaskStepActionState 在动作语义未变时会复用旧引用", () => {
  const previous = {
    label: "生成视频",
    isRunning: false,
    busyDisplay: "progress" as const,
    progressPercent: null,
    canRun: true,
    blockedReason: null,
    onAction: () => undefined,
  };

  const next = {
    label: "生成视频",
    isRunning: false,
    busyDisplay: "progress" as const,
    progressPercent: null,
    canRun: true,
    blockedReason: null,
    onAction: () => undefined,
  };

  assert.equal(mergeTaskStepActionState(previous, next), previous);
});

test("mergeTaskStepActionState 会识别状态加载和任务进度的展示语义变化", () => {
  type TaskStepActionForMerge = Parameters<typeof mergeTaskStepActionState>[0];
  const previous: TaskStepActionForMerge = {
    label: "任务状态加载中...",
    isRunning: true,
    busyDisplay: "status",
    progressPercent: null,
    canRun: false,
    blockedReason: null,
    onAction: () => undefined,
  };

  const next: TaskStepActionForMerge = {
    label: "任务状态加载中...",
    isRunning: true,
    busyDisplay: "progress",
    progressPercent: 1,
    canRun: false,
    blockedReason: null,
    onAction: () => undefined,
  };

  assert.equal(mergeTaskStepActionState(previous, next), next);
});

test("mergeNumericSummaryState 在数值汇总未变时会复用旧引用", () => {
  const previous = {
    totalCount: 8,
    candidateReadyCount: 8,
    finalSelectedCount: 8,
  };

  const next = {
    totalCount: 8,
    candidateReadyCount: 8,
    finalSelectedCount: 8,
  };

  assert.equal(mergeNumericSummaryState(previous, next), previous);
});

test("mergeStructuredState 在结构化 payload 未变化时会复用旧引用", () => {
  const previous = {
    subtitle_audio: {
      taskId: "task-1",
      status: "IN_PROGRESS",
      percent: 35,
      message: "处理中",
    },
  };

  const next = {
    subtitle_audio: {
      taskId: "task-1",
      status: "IN_PROGRESS",
      percent: 35,
      message: "处理中",
    },
  };

  assert.equal(mergeStructuredState(previous, next), previous);
});

test("upsertTaskRecordIfChanged 在任务壳未变时不会制造新数组", () => {
  const currentTask = buildTaskRecord();
  const current = [currentTask];
  const nextTask = buildTaskRecord();

  assert.equal(upsertTaskRecordIfChanged(current, nextTask), current);
});

test("upsertTaskRecordIfChanged 在任务更新时间变化时会替换记录", () => {
  const currentTask = buildTaskRecord();
  const current = [currentTask];
  const nextTask = buildTaskRecord({ updatedAt: "2026-04-25T10:01:00.000Z", status: "IMAGES_READY" });
  const next = upsertTaskRecordIfChanged(current, nextTask);

  assert.notEqual(next, current);
  assert.equal(next[0]?.updatedAt, "2026-04-25T10:01:00.000Z");
  assert.equal(next[0]?.status, "IMAGES_READY");
});
