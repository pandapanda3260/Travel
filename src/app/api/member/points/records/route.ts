import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { isMemberCenterEnabled } from "../../../../../lib/member-service";
import { getPointsPayload } from "../../../../../lib/points-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }
  if (!isMemberCenterEnabled()) {
    return NextResponse.json({ error: "会员中心未开启" }, { status: 404 });
  }

  const payload = getPointsPayload(session.userId);
  return NextResponse.json({
    account: payload.account,
    rules: payload.rules,
    records: payload.records,
  });
}
