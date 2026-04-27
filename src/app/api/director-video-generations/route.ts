import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import {
  createDirectorVideoGenerationSession,
  listDirectorVideoGenerationSessions,
} from "../../../lib/director-video-generation-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  return NextResponse.json({
    sessions: listDirectorVideoGenerationSessions(session.userId),
  });
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    originalPrompt?: string;
    modificationInstruction?: string;
  };
  const created = createDirectorVideoGenerationSession({
    ownerUserId: session.userId,
    title: body.title,
    originalPrompt: body.originalPrompt,
    modificationInstruction: body.modificationInstruction,
  });

  return NextResponse.json({ session: created });
}
