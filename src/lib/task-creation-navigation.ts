export function shouldSyncTaskSelectionFromUrl(input: {
  taskIdFromUrl: string | null | undefined;
  taskIds: string[];
  selectedTaskId: string;
  isNewTaskDraftMode: boolean;
}) {
  const { taskIdFromUrl, taskIds, selectedTaskId, isNewTaskDraftMode } = input;
  if (isNewTaskDraftMode) {
    return false;
  }

  if (!taskIdFromUrl || !taskIds.includes(taskIdFromUrl)) {
    return false;
  }

  return selectedTaskId !== taskIdFromUrl;
}

export function shouldResumeTaskCreationDraft(input: {
  isDraftHydrated: boolean;
  hasTaskIdInUrl: boolean;
  hasAnyCreateInput: boolean;
  currentDraftKey: string;
  lastCreatedDraftKey: string;
}) {
  if (!input.isDraftHydrated || input.hasTaskIdInUrl || !input.hasAnyCreateInput) {
    return false;
  }

  // 新建任务现在是后端持久化草稿。只要曾经拿到过已保存基线，
  // 回到页面时就应优先恢复真实 taskId，而不是退回无 taskId 的前端临时草稿。
  if (input.lastCreatedDraftKey) {
    return false;
  }

  return input.currentDraftKey !== input.lastCreatedDraftKey;
}
