import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { sendPhoneBindCodeForUser, sendPhoneChangeCodeForUser } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      stage?: "bind" | "old" | "new";
      phone?: string;
    };
    if (body.stage === "bind") {
      const result = await sendPhoneBindCodeForUser(
        session.userId,
        {
          phone: body.phone,
        },
        getAuditContextFromRequest(request),
      );
      return NextResponse.json(result);
    }

    const result = await sendPhoneChangeCodeForUser(
      session.userId,
      {
        stage: body.stage ?? "old",
        phone: body.phone,
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json(result);
  } catch (error) {
    return toAuthErrorResponse(error, "验证码发送失败");
  }
}
