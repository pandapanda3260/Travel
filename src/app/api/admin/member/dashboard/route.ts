import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getMemberAdminDashboard, isMemberAdminEnabled, listMemberRulesPayload } from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  return NextResponse.json({
    dashboard: getMemberAdminDashboard(),
    rules: listMemberRulesPayload(),
  });
}
