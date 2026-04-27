import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { revokeUserSessionByOwner } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
    };
    const overview = revokeUserSessionByOwner(
      session.userId,
      body.sessionId ?? "",
      session.sessionId,
      getAuditContextFromRequest(request),
    );
    return NextResponse.json({ overview });
  } catch (error) {
    return toAuthErrorResponse(error, "设备下线失败");
  }
}
