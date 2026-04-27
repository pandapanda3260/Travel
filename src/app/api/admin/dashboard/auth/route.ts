import { NextRequest, NextResponse } from "next/server";

import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getAdminDashboardSnapshot, refreshAdminDashboardSnapshotForAdmin } from "../../../../../lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    return NextResponse.json(getAdminDashboardSnapshot());
  } catch (error) {
    return toAuthErrorResponse(error, "账号看板加载失败");
  }
}

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    return NextResponse.json({
      snapshot: refreshAdminDashboardSnapshotForAdmin(
        { adminId: session.adminId },
        getAuditContextFromRequest(request),
      ),
    });
  } catch (error) {
    return toAuthErrorResponse(error, "账号看板刷新失败");
  }
}
