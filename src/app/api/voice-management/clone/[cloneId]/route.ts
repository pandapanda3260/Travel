import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { deleteClonedVoice } from "../../../../../lib/voice-management-store";

type RouteParams = {
  params: Promise<{
    cloneId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteParams) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const { cloneId } = await context.params;
  const deleted = deleteClonedVoice(cloneId, session.userId);

  if (!deleted) {
    return NextResponse.json({ error: "复刻音色不存在" }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
