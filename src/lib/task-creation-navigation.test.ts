import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTaskSelectionAfterIndexReady,
  shouldAllowHotelAssetInputTaskEnsure,
  shouldDeferTaskIdUrlSync,
  shouldResumeTaskCreationDraft,
  shouldSyncTaskSelectionFromUrl,
} from "./task-creation-navigation";

test("shouldSyncTaskSelectionFromUrl 在用户显式新建草稿模式下不会被 URL taskId 拉回旧任务", () => {
  assert.equal(
    shouldSyncTaskSelectionFromUrl({
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: true,
    }),
    false,
  );
});

test("shouldSyncTaskSelectionFromUrl 在自动恢复草稿模式下仍允许 URL taskId 找回旧任务", () => {
  assert.equal(
    shouldSyncTaskSelectionFromUrl({
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: false,
    }),
    true,
  );
});

test("shouldSyncTaskSelectionFromUrl 仅在非草稿模式且 URL taskId 有效时同步任务", () => {
  assert.equal(
    shouldSyncTaskSelectionFromUrl({
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "task-other",
      isNewTaskDraftMode: false,
    }),
    true,
  );

  assert.equal(
    shouldSyncTaskSelectionFromUrl({
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "task-existing",
      isNewTaskDraftMode: false,
    }),
    false,
  );
});

test("shouldResumeTaskCreationDraft 会在无 URL taskId 时恢复旧版未落库草稿", () => {
  assert.equal(
    shouldResumeTaskCreationDraft({
      isDraftHydrated: true,
      hasTaskIdInUrl: false,
      hasAnyCreateInput: true,
      currentDraftKey: "draft-editing",
      lastCreatedDraftKey: "",
    }),
    true,
  );

  assert.equal(
    shouldResumeTaskCreationDraft({
      isDraftHydrated: true,
      hasTaskIdInUrl: true,
      hasAnyCreateInput: true,
      currentDraftKey: "draft-editing",
      lastCreatedDraftKey: "",
    }),
    false,
  );
});

test("shouldResumeTaskCreationDraft 已有保存基线时不再退回前端临时草稿", () => {
  assert.equal(
    shouldResumeTaskCreationDraft({
      isDraftHydrated: true,
      hasTaskIdInUrl: false,
      hasAnyCreateInput: true,
      currentDraftKey: "draft-editing-after-server-save",
      lastCreatedDraftKey: "server-backed-task-draft",
    }),
    false,
  );
});

test("shouldDeferTaskIdUrlSync 会在任务索引加载前保留 URL taskId", () => {
  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: false,
      isNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: [],
      selectedTaskId: "",
    }),
    true,
  );
});

test("shouldDeferTaskIdUrlSync 会等待有效 URL taskId 恢复成选中任务", () => {
  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
    }),
    true,
  );

  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "task-existing",
    }),
    false,
  );
});

test("shouldDeferTaskIdUrlSync 会在 ready 早于任务列表提交时继续保留 URL taskId", () => {
  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: [],
      selectedTaskId: "",
    }),
    true,
  );
});

test("shouldDeferTaskIdUrlSync 在自动恢复草稿模式下继续保留有效 URL taskId", () => {
  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
    }),
    true,
  );

  assert.equal(
    shouldDeferTaskIdUrlSync({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: true,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
    }),
    false,
  );
});

test("resolveTaskSelectionAfterIndexReady 优先用 URL taskId，其次恢复上次选中任务", () => {
  assert.equal(
    resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl: "task-from-url",
      taskIds: ["task-from-url", "task-last"],
      selectedTaskId: "",
      isNewTaskDraftMode: false,
      lastSelectedTaskId: "task-last",
    }),
    "task-from-url",
  );

  assert.equal(
    resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl: null,
      taskIds: ["task-current", "task-last"],
      selectedTaskId: "",
      isNewTaskDraftMode: false,
      lastSelectedTaskId: "task-last",
    }),
    "task-last",
  );

  assert.equal(
    resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl: null,
      taskIds: ["task-first", "task-second"],
      selectedTaskId: "",
      isNewTaskDraftMode: false,
      lastSelectedTaskId: "",
    }),
    "task-first",
  );
});

test("resolveTaskSelectionAfterIndexReady 在自动恢复草稿模式下优先恢复 URL taskId", () => {
  assert.equal(
    resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl: "task-from-url",
      taskIds: ["task-from-url", "task-last"],
      selectedTaskId: "",
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: false,
      lastSelectedTaskId: "task-last",
    }),
    "task-from-url",
  );

  assert.equal(
    resolveTaskSelectionAfterIndexReady({
      taskIdFromUrl: "task-from-url",
      taskIds: ["task-from-url", "task-last"],
      selectedTaskId: "",
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: true,
      lastSelectedTaskId: "task-last",
    }),
    "",
  );
});

test("shouldAllowHotelAssetInputTaskEnsure 在旧任务可恢复时阻止上传新建任务", () => {
  assert.equal(
    shouldAllowHotelAssetInputTaskEnsure({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing"],
      selectedTaskId: "",
      lastSelectedTaskId: "",
    }),
    false,
  );

  assert.equal(
    shouldAllowHotelAssetInputTaskEnsure({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: false,
      taskIdFromUrl: null,
      taskIds: [],
      selectedTaskId: "",
      lastSelectedTaskId: "",
    }),
    true,
  );
});

test("shouldAllowHotelAssetInputTaskEnsure 只有用户显式新建草稿时才允许上传触发新建任务", () => {
  assert.equal(
    shouldAllowHotelAssetInputTaskEnsure({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: false,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing"],
      selectedTaskId: "",
      lastSelectedTaskId: "",
    }),
    false,
  );

  assert.equal(
    shouldAllowHotelAssetInputTaskEnsure({
      isDraftHydrated: true,
      isTaskIndexReady: true,
      isNewTaskDraftMode: true,
      isExplicitNewTaskDraftMode: true,
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing"],
      selectedTaskId: "",
      lastSelectedTaskId: "",
    }),
    true,
  );
});
