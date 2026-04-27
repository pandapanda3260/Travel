import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import { forceLogoutUserForAdmin, setUserStatusForAdmin } from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      action?: "ban" | "unban" | "force_logout";
      userId?: string;
    };
    if (!body.userId) {
      return NextResponse.json({ error: "缺少 userId", code: "USER_ID_REQUIRED" }, { status: 400 });
    }
    const actor = { adminId: session.adminId };
    const audit = getAuditContextFromRequest(request);

    if (body.action === "ban") {
      return NextResponse.json({
        detail: setUserStatusForAdmin(body.userId, "banned", actor, audit),
      });
    }
    if (body.action === "unban") {
      return NextResponse.json({
        detail: setUserStatusForAdmin(body.userId, "normal", actor, audit),
      });
    }
    if (body.action === "force_logout") {
      return NextResponse.json({
        detail: forceLogoutUserForAdmin(body.userId, actor, audit),
      });
    }

    return NextResponse.json({ error: "不支持的动作", code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return toAuthErrorResponse(error, "用户操作失败");
  }
}
