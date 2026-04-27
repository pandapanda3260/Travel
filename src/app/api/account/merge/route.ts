import { NextRequest, NextResponse } from "next/server";

import {
  applyUserSessionCookie,
  requireUserApiSession,
  userApiUnauthorizedResponse,
} from "../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../lib/auth-http";
import { mergeCurrentUserIntoTargetByPhone } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      targetUserId?: string;
      phone?: string;
      code?: string;
    };
    const result = mergeCurrentUserIntoTargetByPhone(
      session.userId,
      {
        targetUserId: body.targetUserId ?? "",
        phone: body.phone ?? "",
        code: body.code ?? "",
      },
      getAuditContextFromRequest(request),
    );
    const response = NextResponse.json(result);
    applyUserSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return toAuthErrorResponse(error, "账号合并失败");
  }
}
