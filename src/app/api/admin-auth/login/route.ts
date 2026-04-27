import { NextRequest, NextResponse } from "next/server";

import { applyAdminSessionCookie } from "../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../lib/auth-http";
import { loginAdminWithPassword } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const result = loginAdminWithPassword(
      {
        username: body.username ?? "",
        password: body.password ?? "",
      },
      getAuditContextFromRequest(request),
    );
    const response = NextResponse.json(result);
    applyAdminSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return toAuthErrorResponse(error, "运营后台登录失败");
  }
}
