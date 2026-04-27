import test from "node:test";
import assert from "node:assert/strict";

import { shouldResumeTaskCreationDraft, shouldSyncTaskSelectionFromUrl } from "./task-creation-navigation";

test("shouldSyncTaskSelectionFromUrl 在草稿模式下不会被 URL taskId 拉回旧任务", () => {
  assert.equal(
    shouldSyncTaskSelectionFromUrl({
      taskIdFromUrl: "task-existing",
      taskIds: ["task-existing", "task-other"],
      selectedTaskId: "",
      isNewTaskDraftMode: true,
    }),
    false,
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
