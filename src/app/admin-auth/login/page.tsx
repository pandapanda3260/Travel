import { redirect } from "next/navigation";

import { getOptionalAdminPageSession } from "../../../lib/auth-session";
import { AdminLoginContent } from "./AdminLoginContent";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getOptionalAdminPageSession();
  if (session) {
    redirect("/admin/system-status");
  }

  return <AdminLoginContent />;
}
