import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { bindPhoneForUser } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      phone?: string;
      code?: string;
    };
    const overview = bindPhoneForUser(
      session.userId,
      {
        phone: body.phone ?? "",
        code: body.code ?? "",
        currentSessionId: session.sessionId,
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json({ overview });
  } catch (error) {
    return toAuthErrorResponse(error, "手机号保存失败");
  }
}
