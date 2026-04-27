import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { formatDirectorVideoGenerationError } from "../../../../../lib/director-video-generation-errors";
import {
  deleteDirectorVideoGenerationImageCandidate,
  getDirectorVideoGenerationSession,
  patchDirectorVideoGenerationSession,
  replaceDirectorVideoGenerationImageCandidate,
  selectDirectorVideoGenerationImage,
  setDirectorVideoGenerationImageCandidates,
} from "../../../../../lib/director-video-generation-store";
import { generateSeedreamImages } from "../../../../../lib/image-provider";
import { getVideoPipelineImageGenerationRuntime } from "../../../../../lib/image-provider-config";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type ImagesRequest =
  | {
      action: "generate";
      imagePrompt?: string;
      imageSettings?: {
        size?: string;
        guidanceScale?: number;
        watermark?: boolean;
        seed?: number | null;
        outputCount?: number;
      };
    }
  | {
      action: "select";
      candidateId?: string;
    }
  | {
      action: "delete";
      candidateId?: string;
    }
  | {
      action: "regenerate";
      candidateId?: string;
      imagePrompt?: string;
      imageSettings?: {
        size?: string;
        guidanceScale?: number;
        watermark?: boolean;
        seed?: number | null;
        outputCount?: number;
      };
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

  return { userSession, generationSession } as const;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    const body = (await request.json().catch(() => ({}))) as Partial<ImagesRequest>;

    if (body.action === "select") {
      const candidateId = String((body as { candidateId?: string }).candidateId ?? "").trim();
      if (!candidateId) {
        return NextResponse.json({ error: "请选择图片" }, { status: 400 });
      }
      const nextSession = selectDirectorVideoGenerationImage(sessionId, candidateId);
      if (!nextSession) {
        return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
      }
      return NextResponse.json({ session: nextSession });
    }

    if (body.action === "delete") {
      const candidateId = String((body as { candidateId?: string }).candidateId ?? "").trim();
      if (!candidateId) {
        return NextResponse.json({ error: "请选择图片" }, { status: 400 });
      }
      const nextSession = deleteDirectorVideoGenerationImageCandidate(sessionId, candidateId);
      if (!nextSession) {
        return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
      }
      return NextResponse.json({ session: nextSession });
    }

    if (body.action !== "generate" && body.action !== "regenerate") {
      return NextResponse.json({ error: "不支持的图片操作" }, { status: 400 });
    }

    const incomingSettings = (body as Extract<ImagesRequest, { action: "generate" | "regenerate" }>).imageSettings ?? {};
    const prompt = String(
      (body as Extract<ImagesRequest, { action: "generate" | "regenerate" }>).imagePrompt ??
        access.generationSession.imagePrompt ??
        access.generationSession.optimizedPrompt ??
        access.generationSession.originalPrompt ??
        "",
    ).trim();
    if (!prompt) {
      return NextResponse.json({ error: "请先填写图片提示词" }, { status: 400 });
    }

    const preparedSession =
      patchDirectorVideoGenerationSession(sessionId, {
        imagePrompt: prompt,
        imageSettings: incomingSettings,
        imageStatus: "running",
        imageError: null,
      }) ?? access.generationSession;
    const runtime = getVideoPipelineImageGenerationRuntime();
    const candidateId =
      body.action === "regenerate" ? String((body as { candidateId?: string }).candidateId ?? "").trim() : "";
    if (body.action === "regenerate" && !candidateId) {
      return NextResponse.json({ error: "请选择图片" }, { status: 400 });
    }

    const assets = await runWithModelUsageContext(
      {
        userId: access.userSession.userId,
        routePath: "/api/director-video-generations/[sessionId]/images",
        objectType: "director_video_generation",
        objectId: sessionId,
      },
      () =>
        generateSeedreamImages({
          prompt,
          size: preparedSession.imageSettings.size,
          guidanceScale: preparedSession.imageSettings.guidanceScale,
          watermark: preparedSession.imageSettings.watermark,
          seed: preparedSession.imageSettings.seed,
          outputCount: body.action === "regenerate" ? 1 : preparedSession.imageSettings.outputCount,
          runtimeOverride: runtime,
        }),
    );
    const singleAsset = assets[0];
    if (body.action === "regenerate" && !singleAsset) {
      throw new Error("图片生成结果为空");
    }
    const nextSession =
      body.action === "regenerate"
        ? await replaceDirectorVideoGenerationImageCandidate({
            session: preparedSession,
            candidateId,
            asset: singleAsset,
          })
        : await setDirectorVideoGenerationImageCandidates({
            session: preparedSession,
            assets,
          });

    if (!nextSession) {
      return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
    }

    return NextResponse.json({
      session: nextSession,
      runtime,
    });
  } catch (error) {
    const { sessionId } = await context.params;
    const message = formatDirectorVideoGenerationError(error, "图片生成失败");
    patchDirectorVideoGenerationSession(sessionId, {
      imageStatus: "failed",
      imageError: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
