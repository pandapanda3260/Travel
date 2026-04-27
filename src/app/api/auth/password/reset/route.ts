import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { applyUserSessionCookie } from "../../../../../lib/auth-session";
import { resetPasswordWithSms } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      code?: string;
      password?: string;
    };
    const result = resetPasswordWithSms(
      {
        phone: body.phone ?? "",
        code: body.code ?? "",
        password: body.password ?? "",
      },
      getAuditContextFromRequest(request),
    );
    const response = NextResponse.json(result);
    applyUserSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return toAuthErrorResponse(error, "重置密码失败");
  }
}
