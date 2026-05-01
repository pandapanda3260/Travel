export function shouldSyncTaskSelectionFromUrl(input: {
  taskIdFromUrl: string | null | undefined;
  taskIds: string[];
  selectedTaskId: string;
  isNewTaskDraftMode: boolean;
  isExplicitNewTaskDraftMode?: boolean;
}) {
  const { taskIdFromUrl, taskIds, selectedTaskId, isNewTaskDraftMode, isExplicitNewTaskDraftMode } = input;
  if (isNewTaskDraftMode && isExplicitNewTaskDraftMode) {
    return false;
  }

  if (!taskIdFromUrl || !taskIds.includes(taskIdFromUrl)) {
    return false;
  }

  return selectedTaskId !== taskIdFromUrl;
}

export function resolveTaskSelectionAfterIndexReady(input: {
  taskIdFromUrl: string | null | undefined;
  taskIds: string[];
  selectedTaskId: string;
  isNewTaskDraftMode: boolean;
  isExplicitNewTaskDraftMode?: boolean;
  lastSelectedTaskId?: string | null;
}) {
  const taskIds = new Set(input.taskIds);
  if (input.isNewTaskDraftMode && input.isExplicitNewTaskDraftMode) {
    return "";
  }

  if (input.taskIdFromUrl && taskIds.has(input.taskIdFromUrl)) {
    return input.taskIdFromUrl;
  }

  if (input.selectedTaskId && taskIds.has(input.selectedTaskId)) {
    return input.selectedTaskId;
  }

  if (input.lastSelectedTaskId && taskIds.has(input.lastSelectedTaskId)) {
    return input.lastSelectedTaskId;
  }

  return input.taskIds[0] ?? "";
}

export function shouldDeferTaskIdUrlSync(input: {
  isDraftHydrated: boolean;
  isTaskIndexReady: boolean;
  isNewTaskDraftMode: boolean;
  isExplicitNewTaskDraftMode?: boolean;
  taskIdFromUrl: string | null | undefined;
  taskIds: string[];
  selectedTaskId: string;
}) {
  if (!input.taskIdFromUrl) {
    return false;
  }

  if (!input.isDraftHydrated || !input.isTaskIndexReady) {
    return true;
  }

  if (input.isNewTaskDraftMode && input.isExplicitNewTaskDraftMode) {
    return false;
  }

  if (!input.taskIds.length) {
    return true;
  }

  return (
    input.taskIds.includes(input.taskIdFromUrl) &&
    (input.selectedTaskId !== input.taskIdFromUrl || input.isNewTaskDraftMode)
  );
}

export function shouldAllowHotelAssetInputTaskEnsure(input: {
  isDraftHydrated: boolean;
  isTaskIndexReady: boolean;
  isNewTaskDraftMode: boolean;
  isExplicitNewTaskDraftMode?: boolean;
  taskIdFromUrl: string | null | undefined;
  taskIds: string[];
  selectedTaskId: string;
  lastSelectedTaskId?: string | null;
}) {
  if (!input.isDraftHydrated || !input.isTaskIndexReady) {
    return false;
  }

  if (input.selectedTaskId && input.taskIds.includes(input.selectedTaskId)) {
    return true;
  }

  if (input.isNewTaskDraftMode && input.isExplicitNewTaskDraftMode) {
    return true;
  }

  if (input.taskIdFromUrl || input.lastSelectedTaskId) {
    return false;
  }

  return true;
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
