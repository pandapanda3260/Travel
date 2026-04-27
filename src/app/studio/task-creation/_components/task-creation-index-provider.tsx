"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { TaskCreationIndexPayload } from "../../../../lib/task-creation-index-data";

const TaskCreationIndexContext = createContext<TaskCreationIndexPayload | null>(null);

export function TaskCreationIndexProvider({
  initialData,
  children,
}: {
  initialData: TaskCreationIndexPayload | null;
  children: ReactNode;
}) {
  return <TaskCreationIndexContext.Provider value={initialData}>{children}</TaskCreationIndexContext.Provider>;
}

export function useTaskCreationIndexData() {
  return useContext(TaskCreationIndexContext);
}
