import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { getUserModelUsagePayload } from "../../../../lib/model-usage-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    usage: getUserModelUsagePayload(session.userId),
  });
}
