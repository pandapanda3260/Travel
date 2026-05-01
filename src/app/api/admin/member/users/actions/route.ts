import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../../lib/auth-session";
import {
  adjustMemberGrowthForAdmin,
  adjustMemberLevelForAdmin,
  getMemberUserDetailForAdmin,
  grantBenefitForAdmin,
  isMemberAdminEnabled,
  revokeBenefitGrantForAdmin,
} from "../../../../../../lib/member-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: "adjust_level" | "adjust_growth" | "adjust_points" | "grant_benefit" | "revoke_benefit";
    userId?: string;
    levelCode?: "auto" | "L1" | "L2" | "L3" | "L4" | "L5";
    effectiveDays?: number | null;
    reason?: string;
    changeValue?: number;
    benefitKey?: string;
    benefitValue?: string;
    grantId?: string;
  };

  if (!body.userId) {
    return NextResponse.json({ error: "缺少 userId", code: "USER_ID_REQUIRED" }, { status: 400 });
  }

  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "请填写操作原因", code: "REASON_REQUIRED" }, { status: 400 });
  }

  const actor = { adminId: session.adminId };

  if (body.action === "adjust_points") {
    return NextResponse.json(
      {
        error: "旧积分调整已下线，请使用「充值与套餐」中的商业积分订单或补偿入口。",
        code: "LEGACY_POINTS_DISABLED",
      },
      { status: 410 },
    );
  }

  if (body.action === "adjust_level") {
    if (!body.levelCode) {
      return NextResponse.json({ error: "缺少目标等级", code: "LEVEL_REQUIRED" }, { status: 400 });
    }
    const profile = adjustMemberLevelForAdmin(
      body.userId,
      {
        levelCode: body.levelCode,
        effectiveDays: typeof body.effectiveDays === "number" ? body.effectiveDays : null,
        reason: body.reason.trim(),
      },
      actor,
    );

    return NextResponse.json({
      profile,
      detail: getMemberUserDetailForAdmin(body.userId),
    });
  }

  if (body.action === "adjust_growth") {
    if (typeof body.changeValue !== "number" || Number.isNaN(body.changeValue) || body.changeValue === 0) {
      return NextResponse.json({ error: "成长值调整值必须为非 0 数字", code: "CHANGE_VALUE_INVALID" }, { status: 400 });
    }
    const profile = adjustMemberGrowthForAdmin(
      body.userId,
      {
        changeValue: body.changeValue,
        reason: body.reason.trim(),
      },
      actor,
    );
    return NextResponse.json({
      profile,
      detail: getMemberUserDetailForAdmin(body.userId),
    });
  }

  if (body.action === "grant_benefit") {
    if (!body.benefitKey?.trim() || !body.benefitValue?.trim()) {
      return NextResponse.json(
        { error: "权益 key 与权益值不能为空", code: "BENEFIT_GRANT_INVALID" },
        { status: 400 },
      );
    }
    const detail = grantBenefitForAdmin(
      body.userId,
      {
        benefitKey: body.benefitKey.trim(),
        benefitValue: body.benefitValue.trim(),
        effectiveDays: typeof body.effectiveDays === "number" ? body.effectiveDays : null,
        reason: body.reason.trim(),
      },
      actor,
    );

    if (!detail) {
      return NextResponse.json({ error: "权益配置不存在", code: "BENEFIT_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ detail });
  }

  if (body.action === "revoke_benefit") {
    if (!body.grantId?.trim()) {
      return NextResponse.json({ error: "缺少权益发放记录", code: "BENEFIT_GRANT_ID_REQUIRED" }, { status: 400 });
    }
    const detail = revokeBenefitGrantForAdmin(
      body.userId,
      {
        grantId: body.grantId.trim(),
        reason: body.reason.trim(),
      },
      actor,
    );
    if (!detail) {
      return NextResponse.json({ error: "权益发放记录不存在", code: "BENEFIT_GRANT_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ detail });
  }

  return NextResponse.json({ error: "不支持的动作", code: "INVALID_ACTION" }, { status: 400 });
}
