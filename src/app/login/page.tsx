import { redirect } from "next/navigation";

import { getOptionalUserPageSession } from "../../lib/auth-session";
import { getPasswordRuleText } from "../../lib/auth-security";
import { LoginContent } from "./LoginContent";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getOptionalUserPageSession();
  if (session) {
    redirect("/overview");
  }

  return <LoginContent passwordRuleText={getPasswordRuleText()} />;
}
