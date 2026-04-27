import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import {
  deleteMemberCampaignForAdmin,
  executeMemberCampaignForAdmin,
  getMemberAdminDashboard,
  isMemberAdminEnabled,
  listMemberCampaignsForAdmin,
  saveMemberCampaignForAdmin,
} from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

type CampaignAction = "save_campaign" | "execute_campaign" | "delete_campaign";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  return NextResponse.json({
    campaigns: listMemberCampaignsForAdmin(),
    dashboard: getMemberAdminDashboard(),
  });
}

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: CampaignAction;
    campaignId?: string;
    campaign?: {
      campaignId?: string | null;
      name: string;
      enabled: boolean;
      targetType: "all_metric_users" | "levels" | "user_ids";
      targetLevelCodes: Array<"L1" | "L2" | "L3" | "L4" | "L5">;
      targetUserIds: string[];
      grantType: "growth" | "points" | "benefit" | "level";
      growthValue: number | null;
      pointsValue: number | null;
      benefitKey: string | null;
      benefitValue: string | null;
      levelCode: "L1" | "L2" | "L3" | "L4" | "L5" | null;
      effectiveDays: number | null;
      remark: string;
    };
  };

  const actor = { adminId: session.adminId };

  if (body.action === "save_campaign") {
    if (!body.campaign?.name?.trim()) {
      return NextResponse.json({ error: "活动名称不能为空", code: "CAMPAIGN_NAME_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.targetType === "levels" && body.campaign.targetLevelCodes.length === 0) {
      return NextResponse.json({ error: "按等级发放时至少选择一个等级", code: "CAMPAIGN_TARGET_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.targetType === "user_ids" && body.campaign.targetUserIds.length === 0) {
      return NextResponse.json({ error: "按用户发放时至少填写一个 userId", code: "CAMPAIGN_TARGET_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.grantType === "growth" && !body.campaign.growthValue) {
      return NextResponse.json({ error: "请填写成长值", code: "CAMPAIGN_GRANT_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.grantType === "points" && !body.campaign.pointsValue) {
      return NextResponse.json({ error: "请填写积分值", code: "CAMPAIGN_GRANT_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.grantType === "benefit" && (!body.campaign.benefitKey || !body.campaign.benefitValue)) {
      return NextResponse.json({ error: "请填写权益项和权益值", code: "CAMPAIGN_GRANT_REQUIRED" }, { status: 400 });
    }
    if (body.campaign.grantType === "level" && !body.campaign.levelCode) {
      return NextResponse.json({ error: "请填写目标等级", code: "CAMPAIGN_GRANT_REQUIRED" }, { status: 400 });
    }
    const saved = saveMemberCampaignForAdmin(
      {
        ...body.campaign,
        campaignId: body.campaign.campaignId ?? null,
      },
      actor,
    );
    return NextResponse.json({
      campaign: saved,
      campaigns: listMemberCampaignsForAdmin(),
      dashboard: getMemberAdminDashboard(),
    });
  }

  if (body.action === "execute_campaign") {
    if (!body.campaignId?.trim()) {
      return NextResponse.json({ error: "缺少活动 ID", code: "CAMPAIGN_ID_REQUIRED" }, { status: 400 });
    }
    const result = executeMemberCampaignForAdmin(body.campaignId.trim(), actor);
    if (!result) {
      return NextResponse.json({ error: "活动不存在或已停用", code: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({
      result,
      campaigns: listMemberCampaignsForAdmin(),
      dashboard: getMemberAdminDashboard(),
    });
  }

  if (body.action === "delete_campaign") {
    if (!body.campaignId?.trim()) {
      return NextResponse.json({ error: "缺少活动 ID", code: "CAMPAIGN_ID_REQUIRED" }, { status: 400 });
    }
    const deleted = deleteMemberCampaignForAdmin(body.campaignId.trim(), actor);
    if (!deleted) {
      return NextResponse.json({ error: "活动不存在", code: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      campaigns: listMemberCampaignsForAdmin(),
      dashboard: getMemberAdminDashboard(),
    });
  }

  return NextResponse.json({ error: "不支持的活动动作", code: "INVALID_ACTION" }, { status: 400 });
}
