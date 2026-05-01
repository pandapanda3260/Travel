import type { ReactNode } from "react";

import { TaskCreationIndexProvider } from "./_components/task-creation-index-provider";

export default function TaskCreationLayout({ children }: { children: ReactNode }) {
  return <TaskCreationIndexProvider initialData={null}>{children}</TaskCreationIndexProvider>;
}
