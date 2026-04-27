import { NextRequest, NextResponse } from "next/server";

import { applyUserSessionCookie } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { loginUserWithSms } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      code?: string;
    };
    const result = loginUserWithSms(
      {
        phone: body.phone ?? "",
        code: body.code ?? "",
      },
      getAuditContextFromRequest(request),
    );
    const response = NextResponse.json(result);
    applyUserSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return toAuthErrorResponse(error, "验证码登录失败");
  }
}
