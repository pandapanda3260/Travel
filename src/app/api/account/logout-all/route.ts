import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest } from "../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { logoutOtherUserSessionsByOwner } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    ok: true,
    overview: logoutOtherUserSessionsByOwner(session.userId, session.sessionId, getAuditContextFromRequest(request)),
  });
}
