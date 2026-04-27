import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { bindAccountForUser } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      password?: string;
    };
    const overview = bindAccountForUser(
      session.userId,
      {
        password: body.password ?? "",
        currentSessionId: session.sessionId,
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json({ overview });
  } catch (error) {
    return toAuthErrorResponse(error, "密码更新失败");
  }
}
