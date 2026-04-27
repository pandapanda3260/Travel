import type { ReactNode } from "react";

import "./overview.css";

import { requireUserPageSession } from "../../lib/auth-session";

export const dynamic = "force-dynamic";

export default async function OverviewLayout({ children }: { children: ReactNode }) {
  await requireUserPageSession();
  return children;
}
