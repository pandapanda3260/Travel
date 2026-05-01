import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { getCommercialCreditAccountPayload } from "../../../../../lib/commercial-billing-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const payload = getCommercialCreditAccountPayload(session.userId);
  return NextResponse.json({
    account: {
      ...payload.balance,
      availablePoints: payload.balance.availableCredits,
      lifetimePoints: payload.balance.lifetimePurchasedCredits,
    },
    rules: [],
    records: payload.transactions.map((item) => ({
      ...item,
      recordId: item.transactionId,
      changeValue: item.changeCredits,
      balanceAfter: item.balanceAfter,
    })),
  });
}
