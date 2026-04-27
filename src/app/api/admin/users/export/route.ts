import { NextRequest } from "next/server";

import { formatDateTime, formatLoginType, formatUserStatus } from "../../../../../lib/auth-display";
import { getAuditContextFromRequest } from "../../../../../lib/auth-http";
import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { listUsersForAdmin, recordUserExportForAdmin, type AdminUserListFilters } from "../../../../../lib/auth-service";

export const dynamic = "force-dynamic";

function buildCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const filters: AdminUserListFilters = {
      keyword: request.nextUrl.searchParams.get("keyword")?.trim() || "",
      loginMethod: (request.nextUrl.searchParams.get("loginMethod") as AdminUserListFilters["loginMethod"]) || "all",
      passwordState:
        (request.nextUrl.searchParams.get("passwordState") as AdminUserListFilters["passwordState"]) || "all",
    };

    recordUserExportForAdmin(filters, { adminId: session.adminId }, getAuditContextFromRequest(request));
    const users = listUsersForAdmin(filters);
    const csv = [
      ["user_id", "昵称", "状态", "手机号", "密码状态", "登录方式", "注册时间", "最近登录", "在线会话"],
      ...users.map((item) => [
        item.userId,
        item.nickname,
        formatUserStatus(item.status),
        item.maskedPhone ?? "待修正",
        item.hasPassword ? "已设置" : "未设置",
        item.loginMethods.length > 0 ? item.loginMethods.map(formatLoginType).join(" / ") : "暂无",
        formatDateTime(item.createdAt),
        item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "未登录",
        item.activeSessionCount,
      ]),
    ]
      .map((row) => row.map(buildCsvCell).join(","))
      .join("\n");

    return new Response(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="admin-users-${Date.now()}.csv"`,
      },
    });
  } catch {
    return Response.json({ error: "导出用户列表失败", code: "EXPORT_USERS_FAILED" }, { status: 500 });
  }
}
