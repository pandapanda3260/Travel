import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { formatDirectorVideoGenerationError } from "../../../../lib/director-video-generation-errors";
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
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    return NextResponse.json({
      session: access.generationSession,
      videoJob: access.generationSession.videoJobId ? getVideoJob(access.generationSession.videoJobId) : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatDirectorVideoGenerationError(error, "快速生成会话加载失败") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
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
  } catch (error) {
    return NextResponse.json(
      { error: formatDirectorVideoGenerationError(error, "快速生成会话保存失败") },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    deleteDirectorVideoGenerationSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatDirectorVideoGenerationError(error, "删除失败") }, { status: 500 });
  }
}
