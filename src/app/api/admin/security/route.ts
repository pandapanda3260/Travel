import { NextRequest, NextResponse } from "next/server";

import { toAuthErrorResponse } from "../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../lib/auth-session";
import { getSecurityManagementSnapshot } from "../../../../lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    return NextResponse.json(getSecurityManagementSnapshot());
  } catch (error) {
    return toAuthErrorResponse(error, "运营账号数据加载失败");
  }
}
