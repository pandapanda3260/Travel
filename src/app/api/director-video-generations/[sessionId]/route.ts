import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import {
  deleteDirectorVideoGenerationSession,
  getDirectorVideoGenerationSession,
  patchDirectorVideoGenerationSession,
} from "../../../../lib/director-video-generation-store";
import { getVideoJob } from "../../../../lib/video-job-store";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export const dynamic = "force-dynamic";

function requireOwnedSession(request: NextRequest, sessionId: string) {
  const userSession = requireUserApiSession(request);
  if (!userSession) {
    return {
      response: userApiUnauthorizedResponse(),
    } as const;
  }

  const generationSession = getDirectorVideoGenerationSession(sessionId);
  if (!generationSession) {
    return {
      response: NextResponse.json({ error: "视频生成会话不存在" }, { status: 404 }),
    } as const;
  }

  if (generationSession.ownerUserId !== userSession.userId) {
    return {
      response: NextResponse.json({ error: "无权访问该视频生成会话" }, { status: 403 }),
    } as const;
  }

  return {
    userSession,
    generationSession,
  } as const;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const access = requireOwnedSession(request, sessionId);
  if ("response" in access) {
    return access.response;
  }

  return NextResponse.json({
    session: access.generationSession,
    videoJob: access.generationSession.videoJobId ? getVideoJob(access.generationSession.videoJobId) : null,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const access = requireOwnedSession(request, sessionId);
  if ("response" in access) {
    return access.response;
  }

  const body = (await request.json().catch(() => ({}))) as Parameters<
    typeof patchDirectorVideoGenerationSession
  >[1];
  const nextSession = patchDirectorVideoGenerationSession(sessionId, body);

  return NextResponse.json({
    session: nextSession,
    videoJob: nextSession?.videoJobId ? getVideoJob(nextSession.videoJobId) : null,
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const access = requireOwnedSession(request, sessionId);
  if ("response" in access) {
    return access.response;
  }

  deleteDirectorVideoGenerationSession(sessionId);
  return NextResponse.json({ ok: true });
}
