import type { ReactNode } from "react";

import "./assets-shared.css";

import { requireUserPageSession } from "../../lib/auth-session";

export const dynamic = "force-dynamic";

export default async function AssetsLayout({ children }: { children: ReactNode }) {
  await requireUserPageSession();
  return children;
}
