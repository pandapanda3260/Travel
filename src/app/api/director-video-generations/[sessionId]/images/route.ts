import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { formatDirectorVideoGenerationError } from "../../../../../lib/director-video-generation-errors";
import {
  deleteDirectorVideoGenerationImageCandidate,
  getDirectorVideoGenerationSession,
  insertUploadedDirectorVideoGenerationImageCandidate,
  patchDirectorVideoGenerationSession,
  replaceDirectorVideoGenerationImageCandidate,
  replaceUploadedDirectorVideoGenerationImageCandidate,
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
      originalPrompt?: string;
      modificationInstruction?: string;
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
      originalPrompt?: string;
      modificationInstruction?: string;
      imageSettings?: {
        size?: string;
        guidanceScale?: number;
        watermark?: boolean;
        seed?: number | null;
        outputCount?: number;
      };
    };

export const dynamic = "force-dynamic";

const MAX_UPLOAD_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_UPLOAD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  let failureFallback = "图片生成失败";
  let shouldPatchFailureStatus = true;
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      failureFallback = "图片上传失败";
      shouldPatchFailureStatus = false;

      const formData = await request.formData();
      const action = String(formData.get("action") ?? "upload");
      if (action !== "upload" && action !== "reupload") {
        return NextResponse.json({ error: "不支持的图片上传操作" }, { status: 400 });
      }

      const file = formData.get("file");
      if (!(file instanceof File) || file.size <= 0) {
        return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
        return NextResponse.json({ error: "图片不能超过 20MB" }, { status: 413 });
      }
      if (!SUPPORTED_UPLOAD_IMAGE_TYPES.has(file.type)) {
        return NextResponse.json({ error: "仅支持 JPG、PNG、WEBP 图片" }, { status: 400 });
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const nextSession =
        action === "reupload"
          ? await replaceUploadedDirectorVideoGenerationImageCandidate({
              session: access.generationSession,
              candidateId: String(formData.get("candidateId") ?? "").trim(),
              bytes,
              contentType: file.type,
            })
          : await insertUploadedDirectorVideoGenerationImageCandidate({
              session: access.generationSession,
              bytes,
              contentType: file.type,
            });

      if (!nextSession) {
        return NextResponse.json({ error: "候选图片不存在" }, { status: 404 });
      }

      return NextResponse.json({ session: nextSession });
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
    const originalPrompt = String(
      (body as Extract<ImagesRequest, { action: "generate" | "regenerate" }>).originalPrompt ??
        access.generationSession.originalPrompt ??
        "",
    ).trim();
    const modificationInstruction = String(
      (body as Extract<ImagesRequest, { action: "generate" | "regenerate" }>).modificationInstruction ??
        access.generationSession.modificationInstruction ??
        "",
    ).trim();

    const preparedSession =
      patchDirectorVideoGenerationSession(sessionId, {
        originalPrompt,
        modificationInstruction,
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
    const message = formatDirectorVideoGenerationError(error, failureFallback);
    if (shouldPatchFailureStatus) {
      try {
        patchDirectorVideoGenerationSession(sessionId, {
          imageStatus: "failed",
          imageError: message,
        });
      } catch (patchError) {
        console.error("[director-video-generation] failed to persist image failure", patchError);
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
