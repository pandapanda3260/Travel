import { NextRequest, NextResponse } from "next/server";

import { getUserSidebarProfile } from "../../../../lib/auth-service";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { getCommercialCreditBalance } from "../../../../lib/commercial-credit-ledger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }
  const includeDetails = request.nextUrl.searchParams.get("details") === "1";

  const sidebarProfile = includeDetails ? getUserSidebarProfile(session.userId) : null;
  const creditBalance = includeDetails ? getCommercialCreditBalance(session.userId) : null;

  return NextResponse.json({
    user: {
      userId: session.userId,
      nickname: session.user.nickname,
      avatar: session.user.avatar,
      status: session.user.status,
      planLevel: session.user.planLevel,
      certificationLabel: session.user.certificationLabel,
      maskedPhone: sidebarProfile?.maskedPhone ?? null,
      activeSessionCount: sidebarProfile?.activeSessionCount ?? 0,
      availablePoints: creditBalance?.availableCredits ?? 0,
    },
  });
}
