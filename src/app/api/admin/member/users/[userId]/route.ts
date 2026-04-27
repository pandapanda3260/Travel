import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../../lib/auth-session";
import { getMemberUserDetailForAdmin, isMemberAdminEnabled } from "../../../../../../lib/member-service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const { userId } = await context.params;
  const detail = getMemberUserDetailForAdmin(userId);
  if (!detail) {
    return NextResponse.json({ error: "会员用户不存在", code: "MEMBER_USER_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ detail });
}
