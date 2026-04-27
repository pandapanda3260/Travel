import { NextRequest, NextResponse } from "next/server";

import { toAuthErrorResponse } from "../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../lib/auth-session";
import { listUsersForAdminSnapshot, type AdminUserListQuery } from "../../../../lib/auth-service";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const filters: AdminUserListQuery = {
      keyword: request.nextUrl.searchParams.get("keyword")?.trim() || "",
      loginMethod: (request.nextUrl.searchParams.get("loginMethod") as AdminUserListQuery["loginMethod"]) || "all",
      passwordState:
        (request.nextUrl.searchParams.get("passwordState") as AdminUserListQuery["passwordState"]) || "all",
      normalPage: parsePositiveInt(request.nextUrl.searchParams.get("normalPage"), 1),
      riskPage: parsePositiveInt(request.nextUrl.searchParams.get("riskPage"), 1),
      pageSize: parsePositiveInt(request.nextUrl.searchParams.get("pageSize"), 8),
    };
    return NextResponse.json(listUsersForAdminSnapshot(filters));
  } catch (error) {
    return toAuthErrorResponse(error, "用户列表加载失败");
  }
}
