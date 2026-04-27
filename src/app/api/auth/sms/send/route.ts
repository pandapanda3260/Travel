import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { sendSmsCode } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      purpose?: string;
    };
    const purpose = body.purpose ?? "login";
    if (purpose !== "login" && purpose !== "reset_password") {
      return NextResponse.json({ error: "不支持的验证码用途。", code: "INVALID_SMS_PURPOSE" }, { status: 400 });
    }
    const result = await sendSmsCode(
      {
        phone: body.phone ?? "",
        purpose,
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json(result);
  } catch (error) {
    return toAuthErrorResponse(error, "验证码发送失败");
  }
}
