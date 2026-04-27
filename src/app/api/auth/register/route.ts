import { NextRequest, NextResponse } from "next/server";

import { applyUserSessionCookie } from "../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../lib/auth-http";
import { registerUserWithPassword } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      password?: string;
      nickname?: string;
    };
    const result = registerUserWithPassword(
      {
        phone: body.phone ?? "",
        password: body.password ?? "",
        nickname: body.nickname?.trim() || undefined,
      },
      getAuditContextFromRequest(request),
    );
    const response = NextResponse.json(result);
    applyUserSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return toAuthErrorResponse(error, "注册失败");
  }
}
