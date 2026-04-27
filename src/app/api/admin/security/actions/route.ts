import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import { getAuditContextFromRequest, toAuthErrorResponse } from "../../../../../lib/auth-http";
import {
  addRiskBlockForAdmin,
  removeRiskBlockForAdmin,
  updateRiskConfigForAdmin,
  upsertOperatorForAdmin,
} from "../../../../../lib/auth-service";

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as {
      action?: "update_config" | "add_block" | "remove_block" | "upsert_operator";
      config?: {
        smsEnabled?: boolean;
        smsDebugMode?: boolean;
        smsExpireSeconds?: number;
        smsCooldownSeconds?: number;
        smsHourlyLimitPerPhone?: number;
        smsHourlyLimitPerIp?: number;
      };
      type?: "phone" | "ip";
      value?: string;
      reason?: string;
      blockId?: string;
      operator?: {
        adminId?: string;
        username?: string;
        displayName?: string;
        role?: "super_admin" | "operator" | "viewer";
        status?: "active" | "disabled";
        password?: string;
      };
    };
    const actor = { adminId: session.adminId };
    const audit = getAuditContextFromRequest(request);

    if (body.action === "update_config") {
      return NextResponse.json({
        snapshot: updateRiskConfigForAdmin(body.config ?? {}, actor, audit),
      });
    }
    if (body.action === "add_block" && body.type && body.value) {
      return NextResponse.json({
        snapshot: addRiskBlockForAdmin(
          {
            type: body.type,
            value: body.value,
            reason: body.reason ?? "",
          },
          actor,
          audit,
        ),
      });
    }
    if (body.action === "remove_block" && body.blockId) {
      return NextResponse.json({
        snapshot: removeRiskBlockForAdmin(body.blockId, actor, audit),
      });
    }
    if (body.action === "upsert_operator" && body.operator) {
      return NextResponse.json({
        snapshot: upsertOperatorForAdmin(
          {
            adminId: body.operator.adminId,
            username: body.operator.username ?? "",
            displayName: body.operator.displayName ?? "",
            role: body.operator.role ?? "operator",
            status: body.operator.status ?? "active",
            password: body.operator.password,
          },
          actor,
          audit,
        ),
      });
    }

    return NextResponse.json({ error: "不支持的动作", code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return toAuthErrorResponse(error, "安全配置更新失败");
  }
}
