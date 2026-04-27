import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { getMemberCenterPayload, isMemberCenterEnabled } from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }
  if (!isMemberCenterEnabled()) {
    return NextResponse.json({ error: "会员中心未开启" }, { status: 404 });
  }

  const payload = getMemberCenterPayload(session.userId);
  return NextResponse.json({
    records: payload?.growthRecords ?? [],
  });
}
