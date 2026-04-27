import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import {
  bindAccountForUserByAdmin,
  bindPhoneForUserByAdmin,
  getBindingManagementSnapshot,
  mergeUsersForAdmin,
} from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      action?: "repair_phone" | "reset_password" | "merge";
      userId?: string;
      phone?: string;
      password?: string;
      sourceUserId?: string;
      targetUserId?: string;
      keyword?: string;
    };
    const actor = { adminId: session.adminId };
    const audit = getAuditContextFromRequest(request);

    if (body.action === "repair_phone" && body.userId && body.phone) {
      const detail = bindPhoneForUserByAdmin({ userId: body.userId, phone: body.phone }, actor, audit);
      return NextResponse.json({ detail, snapshot: getBindingManagementSnapshot(body.keyword) });
    }
    if (body.action === "reset_password" && body.userId && body.password) {
      const detail = bindAccountForUserByAdmin(
        {
          userId: body.userId,
          password: body.password,
        },
        actor,
        audit,
      );
      return NextResponse.json({ detail, snapshot: getBindingManagementSnapshot(body.keyword) });
    }
    if (body.action === "merge" && body.sourceUserId && body.targetUserId) {
      const detail = mergeUsersForAdmin(
        {
          sourceUserId: body.sourceUserId,
          targetUserId: body.targetUserId,
        },
        actor,
        audit,
      );
      return NextResponse.json({ detail, snapshot: getBindingManagementSnapshot(body.keyword) });
    }

    return NextResponse.json({ error: "不支持的动作", code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return toAuthErrorResponse(error, "绑定管理操作失败");
  }
}
