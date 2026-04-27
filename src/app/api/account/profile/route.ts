import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../lib/auth-http";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { updateUserProfile } from "../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      nickname?: string;
    };
    const overview = updateUserProfile(
      session.userId,
      {
        nickname: body.nickname ?? "",
      },
      getAuditContextFromRequest(request),
    );
    return NextResponse.json({ overview });
  } catch (error) {
    return toAuthErrorResponse(error, "资料更新失败");
  }
}
