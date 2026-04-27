import { NextRequest } from "next/server";

import {
  formatDateTime,
  formatLoginType,
  formatSmsCodePurpose,
  formatUserSecurityAction,
  formatUserStatus,
} from "../../../../../../lib/auth-display";
import { getAuditContextFromRequest } from "../../../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../../lib/auth-session";
import {
  getUserDetailForAdmin,
  recordUserDetailExportForAdmin,
} from "../../../../../../lib/auth-service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

function buildCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const routeParams = await params;
    const userId = typeof routeParams.userId === "string" ? routeParams.userId : "";
    if (!userId) {
      return Response.json({ error: "缺少用户 ID", code: "USER_ID_REQUIRED" }, { status: 400 });
    }
    const detail = getUserDetailForAdmin(userId);
    recordUserDetailExportForAdmin(userId, { adminId: session.adminId }, getAuditContextFromRequest(request));

    const rows: Array<Array<string | number>> = [
      ["section", "type", "status", "title", "detail", "extra", "time"],
      [
        "summary",
        "profile",
        formatUserStatus(detail.summary.status),
        detail.summary.nickname,
        detail.summary.maskedPhone ?? "待修正",
        `密码${detail.summary.hasPassword ? "已设置" : "未设置"} / 在线${detail.summary.activeSessionCount}`,
        formatDateTime(detail.summary.createdAt),
      ],
      ...detail.recentLogins.map((item) => [
        "activity",
        "login",
        item.success ? "成功" : "失败",
        formatLoginType(item.loginType),
        item.detail,
        item.ip,
        formatDateTime(item.createdAt),
      ]),
      ...detail.securityLogs.map((item) => [
        "activity",
        "security",
        formatUserSecurityAction(item.actionType),
        formatUserSecurityAction(item.actionType),
        item.detail,
        item.ip,
        formatDateTime(item.createdAt),
      ]),
      ...detail.smsRecords.map((item) => [
        "activity",
        "sms",
        item.used ? "已核销" : new Date(item.expireAt).getTime() <= Date.now() ? "已过期" : "待使用",
        formatSmsCodePurpose(item.purpose),
        item.maskedPhone,
        item.requestIp,
        formatDateTime(item.createdAt),
      ]),
    ];

    const csv = rows.map((row) => row.map(buildCsvCell).join(",")).join("\n");

    return new Response(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="admin-user-${userId}-${Date.now()}.csv"`,
      },
    });
  } catch {
    return Response.json({ error: "导出用户详情失败", code: "EXPORT_USER_DETAIL_FAILED" }, { status: 500 });
  }
}
