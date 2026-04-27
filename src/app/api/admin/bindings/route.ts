import { NextRequest, NextResponse } from "next/server";

import { toAuthErrorResponse } from "../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../lib/auth-session";
import { getBindingManagementSnapshot } from "../../../../lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const keyword = request.nextUrl.searchParams.get("keyword")?.trim() || "";
    return NextResponse.json(getBindingManagementSnapshot(keyword));
  } catch (error) {
    return toAuthErrorResponse(error, "绑定管理数据加载失败");
  }
}
