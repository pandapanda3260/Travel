import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { formatDirectorVideoGenerationError } from "../../../../../lib/director-video-generation-errors";
import { optimizeDirectorVideoPrompt } from "../../../../../lib/director-video-generation-runtime";
import {
  getDirectorVideoGenerationSession,
  patchDirectorVideoGenerationSession,
} from "../../../../../lib/director-video-generation-store";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export const dynamic = "force-dynamic";

type PromptTarget = "image" | "video";

function getPromptTarget(value: unknown): PromptTarget {
  return value === "video" ? "video" : "image";
}

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

  return { userSession, generationSession } as const;
}

export async function POST(request: NextRequest, context: RouteContext) {
  let promptTarget: PromptTarget = "image";
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    const body = (await request.json().catch(() => ({}))) as {
      target?: PromptTarget;
      originalPrompt?: string;
      modificationInstruction?: string;
    };
    promptTarget = getPromptTarget(body.target);
    const originalPrompt = (
      body.originalPrompt ??
      (promptTarget === "video" ? access.generationSession.videoOriginalPrompt : access.generationSession.originalPrompt)
    ).trim();
    const modificationInstruction = (
      body.modificationInstruction ??
      (promptTarget === "video"
        ? access.generationSession.videoModificationInstruction
        : access.generationSession.modificationInstruction)
    ).trim();

    if (!originalPrompt && !modificationInstruction) {
      return NextResponse.json({ error: "请先输入原始提示词或修改要求" }, { status: 400 });
    }

    patchDirectorVideoGenerationSession(
      sessionId,
      promptTarget === "video"
        ? {
            videoOriginalPrompt: originalPrompt,
            videoModificationInstruction: modificationInstruction,
            videoPromptStatus: "running",
            videoPromptError: null,
          }
        : {
            originalPrompt,
            modificationInstruction,
            promptStatus: "running",
            promptError: null,
          },
    );

    const result = await runWithModelUsageContext(
      {
        userId: access.userSession.userId,
        routePath: "/api/director-video-generations/[sessionId]/prompt",
        objectType: "director_video_generation",
        objectId: sessionId,
      },
      () => optimizeDirectorVideoPrompt({ originalPrompt, modificationInstruction, target: promptTarget }),
    );
    const nextSession = patchDirectorVideoGenerationSession(
      sessionId,
      promptTarget === "video"
        ? {
            videoOriginalPrompt: originalPrompt,
            videoModificationInstruction: modificationInstruction,
            videoOptimizedPrompt: result.optimizedPrompt,
            videoPrompt: result.optimizedPrompt,
            videoPromptStatus: "success",
            videoPromptError: result.usedFallback ? "GPT-5.5 未启用，已使用本地提示词拼接结果。" : null,
          }
        : {
            originalPrompt,
            modificationInstruction,
            optimizedPrompt: result.optimizedPrompt,
            imagePrompt: result.optimizedPrompt,
            promptStatus: "success",
            promptError: result.usedFallback ? "GPT-5.5 未启用，已使用本地提示词拼接结果。" : null,
          },
    );

    return NextResponse.json({
      session: nextSession,
      runtime: result.runtime,
      usedFallback: result.usedFallback,
    });
  } catch (error) {
    const { sessionId } = await context.params;
    const message = formatDirectorVideoGenerationError(error, "提示词优化失败");
    patchDirectorVideoGenerationSession(
      sessionId,
      promptTarget === "video"
        ? {
            videoPromptStatus: "failed",
            videoPromptError: message,
          }
        : {
            promptStatus: "failed",
            promptError: message,
          },
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
