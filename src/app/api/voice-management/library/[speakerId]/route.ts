import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { removeSpeakerFromSearchDisplay } from "../../../../../lib/voice-management-store";

type RouteParams = {
  params: Promise<{
    speakerId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteParams) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const { speakerId } = await context.params;
  removeSpeakerFromSearchDisplay(decodeURIComponent(speakerId), session.userId);
  return NextResponse.json({ ok: true });
}
