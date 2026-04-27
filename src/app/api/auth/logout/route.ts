import { NextRequest, NextResponse } from "next/server";

import { clearUserSessionCookie, USER_SESSION_COOKIE } from "../../../../lib/auth-session";
import { logoutUserByToken } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  logoutUserByToken(request.cookies.get(USER_SESSION_COOKIE)?.value ?? null);
  const response = NextResponse.json({ ok: true });
  clearUserSessionCookie(response);
  return response;
}
