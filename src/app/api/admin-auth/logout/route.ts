import { NextRequest, NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, clearAdminSessionCookie } from "../../../../lib/auth-session";
import { logoutAdminByToken } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  logoutAdminByToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null);
  const response = NextResponse.json({ ok: true });
  clearAdminSessionCookie(response);
  return response;
}
