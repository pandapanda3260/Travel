import { NextRequest, NextResponse } from "next/server";

import { getOptionalUserPageSession } from "../../../../lib/auth-session";
import { getUserAccountOverview } from "../../../../lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getOptionalUserPageSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  if (request.nextUrl.searchParams.get("mode") === "probe") {
    return NextResponse.json({ authenticated: true });
  }

  return NextResponse.json({
    authenticated: true,
    session: {
      userId: session.userId,
      loginType: session.loginType,
      expiresAt: session.expiresAt,
    },
    overview: getUserAccountOverview(session.userId, session.sessionId),
  });
}
