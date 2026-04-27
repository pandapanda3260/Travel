import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { changePhoneForUser } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      oldCode?: string;
      newPhone?: string;
      newCode?: string;
    };
    const overview = changePhoneForUser(
      session.userId,
      {
        oldCode: body.oldCode ?? "",
        newPhone: body.newPhone ?? "",
        newCode: body.newCode ?? "",
        currentSessionId: session.sessionId,
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json({ overview });
  } catch (error) {
    return toAuthErrorResponse(error, "手机号换绑失败");
  }
}
