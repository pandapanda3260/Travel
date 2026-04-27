import type { ReactNode } from "react";

import { requireAdminPageSession } from "../../lib/auth-session";
import { AdminShell } from "./_components/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminPageSession();
  return <AdminShell admin={session.admin}>{children}</AdminShell>;
}
