import { NextRequest } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import {
  buildMemberLogExportForAdmin,
  isMemberAdminEnabled,
  type MemberExportLogType,
} from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return Response.json({ error: "会员后台未开启" }, { status: 404 });
  }

  try {
    const logType = (request.nextUrl.searchParams.get("logType")?.trim() || "growth") as MemberExportLogType;
    const result = buildMemberLogExportForAdmin(
      {
        logType,
        userId: request.nextUrl.searchParams.get("userId"),
        startDate: request.nextUrl.searchParams.get("startDate"),
        endDate: request.nextUrl.searchParams.get("endDate"),
        batchId: request.nextUrl.searchParams.get("batchId"),
        status: request.nextUrl.searchParams.get("status"),
      },
      { adminId: session.adminId },
    );

    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Export-Total": String(result.total),
      },
    });
  } catch {
    return Response.json({ error: "导出会员日志失败", code: "EXPORT_MEMBER_LOGS_FAILED" }, { status: 500 });
  }
}
