import type { ReactNode } from "react";

import { requireUserPageSession } from "../../../lib/auth-session";

export const dynamic = "force-dynamic";

export default async function StudioVideoGenerationLayout({ children }: { children: ReactNode }) {
  await requireUserPageSession();
  return children;
}
