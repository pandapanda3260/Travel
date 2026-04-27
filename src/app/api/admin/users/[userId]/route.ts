import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { getUserDetailForAdmin, recordUserDetailViewForAdmin } from "../../../../../lib/auth-service";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    userId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteProps) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const { userId } = await params;
    const detail = getUserDetailForAdmin(userId);
    recordUserDetailViewForAdmin(userId, { adminId: session.adminId }, getAuditContextFromRequest(request));
    return NextResponse.json(detail);
  } catch (error) {
    return toAuthErrorResponse(error, "用户详情加载失败");
  }
}
