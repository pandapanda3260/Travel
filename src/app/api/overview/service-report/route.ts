import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { buildOverviewServiceReport } from "../../../../lib/overview-service-report";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    return NextResponse.json({
      reports: buildOverviewServiceReport(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "概览服务统计加载失败" },
      { status: 500 },
    );
  }
}
