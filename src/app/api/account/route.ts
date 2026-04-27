import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import { getUserAccountOverview } from "../../../lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    authenticated: true,
    overview: getUserAccountOverview(session.userId, session.sessionId),
  });
}
