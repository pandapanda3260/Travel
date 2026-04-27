import { NextRequest, NextResponse } from "next/server";

import { getOptionalAdminPageSession } from "../../../../lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getOptionalAdminPageSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  if (request.nextUrl.searchParams.get("mode") === "probe") {
    return NextResponse.json({ authenticated: true });
  }

  return NextResponse.json({
    authenticated: true,
    session,
  });
}
