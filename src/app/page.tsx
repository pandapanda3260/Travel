import { getOptionalUserPageSession } from "../lib/auth-session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getOptionalUserPageSession();
  redirect(session ? "/overview" : "/login");
}
