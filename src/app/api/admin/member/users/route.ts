import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { isMemberAdminEnabled, listMemberUsersPageForAdmin } from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const page = Math.max(Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.max(Number.parseInt(request.nextUrl.searchParams.get("pageSize") ?? "20", 10) || 20, 1);
  const result = listMemberUsersPageForAdmin({
    keyword: request.nextUrl.searchParams.get("keyword") ?? "",
    levelCode: (request.nextUrl.searchParams.get("levelCode") ?? "") as "" | "L1" | "L2" | "L3" | "L4" | "L5",
    memberStatus: (request.nextUrl.searchParams.get("memberStatus") ?? "") as
      | ""
      | "active"
      | "grace"
      | "frozen"
      | "merged",
    page,
    pageSize,
  });

  return NextResponse.json({
    users: result.users,
    pagination: result.pagination,
  });
}
