import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../../lib/auth-session";
import {
  getMemberAdminDashboard,
  isMemberAdminEnabled,
  listMemberRulesPayload,
  updateMemberBenefitMapsForAdmin,
  updateMemberGrowthRulesForAdmin,
  updateMemberLevelsForAdmin,
  updateMemberSystemConfigForAdmin,
  updatePointRulesForAdmin,
} from "../../../../../lib/member-service";

export const dynamic = "force-dynamic";

type RuleAction =
  | "update_config"
  | "update_levels"
  | "update_growth_rules"
  | "update_point_rules"
  | "update_benefit_maps";

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  if (!isMemberAdminEnabled()) {
    return NextResponse.json({ error: "会员后台未开启" }, { status: 404 });
  }

  return NextResponse.json({
    rules: listMemberRulesPayload(),
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
    action?: RuleAction;
    memberConfig?: {
      memberCenterEnabled: boolean;
      memberGrowthEnabled: boolean;
      memberBenefitEnforcementEnabled: boolean;
      memberAdminEnabled: boolean;
      growthExpireDays: number;
      gracePeriodDays: number;
    };
    pointsConfig?: {
      pointsEnabled: boolean;
      defaultExpireDays: number | null;
    };
    levels?: Array<{
      levelCode: "L1" | "L2" | "L3" | "L4" | "L5";
      name: string;
      upgradeThreshold: number;
      retainThreshold: number;
      badgeLabel: string;
      enabled: boolean;
    }>;
    growthRules?: Array<{
      ruleCode: string;
      growthValue: number;
      dailyLimit: number | null;
      enabled: boolean;
    }>;
    pointRules?: Array<{
      ruleCode: string;
      pointValue: number;
      dailyLimit: number | null;
      enabled: boolean;
    }>;
    levelBenefitMaps?: Array<{
      mapId: string;
      benefitValue: string | number | boolean;
      enabled: boolean;
    }>;
  };

  const actor = { adminId: session.adminId };

  if (body.action === "update_config") {
    if (!body.memberConfig || !body.pointsConfig) {
      return NextResponse.json({ error: "缺少系统配置数据", code: "CONFIG_REQUIRED" }, { status: 400 });
    }
    if (body.memberConfig.growthExpireDays < 1 || body.memberConfig.gracePeriodDays < 1) {
      return NextResponse.json({ error: "成长有效期和观察期必须大于 0", code: "CONFIG_INVALID" }, { status: 400 });
    }
    if (body.pointsConfig.defaultExpireDays !== null && body.pointsConfig.defaultExpireDays < 1) {
      return NextResponse.json({ error: "积分有效期必须为空或大于 0", code: "CONFIG_INVALID" }, { status: 400 });
    }
    const rules = updateMemberSystemConfigForAdmin(
      {
        memberConfig: body.memberConfig,
        pointsConfig: body.pointsConfig,
      },
      actor,
    );
    return NextResponse.json({ rules, dashboard: getMemberAdminDashboard() });
  }

  if (body.action === "update_levels") {
    if (!Array.isArray(body.levels) || body.levels.length === 0) {
      return NextResponse.json({ error: "缺少等级规则", code: "LEVELS_REQUIRED" }, { status: 400 });
    }
    if (!body.levels.some((item) => item.enabled)) {
      return NextResponse.json({ error: "至少保留一个启用等级", code: "LEVELS_INVALID" }, { status: 400 });
    }
    const sortedLevels = [...body.levels].sort((left, right) => left.levelCode.localeCompare(right.levelCode));
    for (let index = 0; index < sortedLevels.length; index += 1) {
      const current = sortedLevels[index];
      if (current.retainThreshold > current.upgradeThreshold) {
        return NextResponse.json({ error: `${current.levelCode} 保级门槛不能高于升级门槛`, code: "LEVELS_INVALID" }, { status: 400 });
      }
      if (index > 0 && current.upgradeThreshold < sortedLevels[index - 1]!.upgradeThreshold) {
        return NextResponse.json({ error: "升级门槛需要按等级递增", code: "LEVELS_INVALID" }, { status: 400 });
      }
    }
    const rules = updateMemberLevelsForAdmin(body.levels, actor);
    return NextResponse.json({ rules, dashboard: getMemberAdminDashboard() });
  }

  if (body.action === "update_growth_rules") {
    if (!Array.isArray(body.growthRules) || body.growthRules.length === 0) {
      return NextResponse.json({ error: "缺少成长规则", code: "GROWTH_RULES_REQUIRED" }, { status: 400 });
    }
    const rules = updateMemberGrowthRulesForAdmin(body.growthRules, actor);
    return NextResponse.json({ rules, dashboard: getMemberAdminDashboard() });
  }

  if (body.action === "update_point_rules") {
    if (!Array.isArray(body.pointRules) || body.pointRules.length === 0) {
      return NextResponse.json({ error: "缺少积分规则", code: "POINT_RULES_REQUIRED" }, { status: 400 });
    }
    const rules = updatePointRulesForAdmin(body.pointRules, actor);
    return NextResponse.json({ rules, dashboard: getMemberAdminDashboard() });
  }

  if (body.action === "update_benefit_maps") {
    if (!Array.isArray(body.levelBenefitMaps) || body.levelBenefitMaps.length === 0) {
      return NextResponse.json({ error: "缺少权益映射", code: "BENEFIT_MAPS_REQUIRED" }, { status: 400 });
    }
    const rules = updateMemberBenefitMapsForAdmin(body.levelBenefitMaps, actor);
    return NextResponse.json({ rules, dashboard: getMemberAdminDashboard() });
  }

  return NextResponse.json({ error: "不支持的规则动作", code: "INVALID_ACTION" }, { status: 400 });
}
