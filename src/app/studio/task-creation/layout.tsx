import type { ReactNode } from "react";

import { requireUserPageSession } from "../../../lib/auth-session";
import { getTaskCreationIndexPayload } from "../../../lib/task-creation-index-data";
import { TaskCreationIndexProvider } from "./_components/task-creation-index-provider";

export const dynamic = "force-dynamic";

export default async function TaskCreationLayout({ children }: { children: ReactNode }) {
  const session = await requireUserPageSession();
  let initialData = null;

  try {
    initialData = await getTaskCreationIndexPayload({
      includeVoiceOptions: false,
      userId: session.userId,
    });
  } catch {
    initialData = null;
  }

  return <TaskCreationIndexProvider initialData={initialData}>{children}</TaskCreationIndexProvider>;
}
