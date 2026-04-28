import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import { getEffectiveConstraintPrompt } from "../../../../../lib/constraint-prompt-store";
import { formatDirectorVideoGenerationError } from "../../../../../lib/director-video-generation-errors";
import {
  getDirectorVideoGenerationImageDataUrl,
  getDirectorVideoGenerationSession,
  getSelectedDirectorVideoGenerationImage,
  patchDirectorVideoGenerationSession,
} from "../../../../../lib/director-video-generation-store";
import { createMockVideoFromImage } from "../../../../../lib/mock-aigc-assets";
import { runWithModelUsageContext } from "../../../../../lib/model-usage-context";
import { getDefaultKlingGenerationSettings, type KlingGenerationSettings } from "../../../../../lib/prompt";
import { createVideoJobRecord, refreshLiveJob, scheduleVideoJobPolling } from "../../../../../lib/video-job-runner";
import { deriveTaskName, getVideoJob, upsertVideoJob, type VideoJobRecord } from "../../../../../lib/video-job-store";
import { getProviderRuntime } from "../../../../../lib/video-provider-config";
import { submitSeedanceVideoJob } from "../../../../../lib/video-provider";
import type { SeedanceGenerationInput } from "../../../../../lib/video-provider";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type VideoRequest = {
  action?: "generate";
  videoPrompt?: string;
  videoOriginalPrompt?: string;
  videoModificationInstruction?: string;
  videoSettings?: {
    durationSeconds?: number;
    ratio?: "16:9" | "9:16" | "1:1";
    resolution?: string;
    generateAudio?: boolean;
    watermark?: boolean;
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

function patchSessionStatusFromJob(sessionId: string, job: VideoJobRecord | null) {
  if (!job) {
    return getDirectorVideoGenerationSession(sessionId);
  }
  if (job.status === "COMPLETED") {
    return patchDirectorVideoGenerationSession(sessionId, {
      videoStatus: "success",
      videoError: null,
    });
  }
  if (job.status === "FAILED") {
    return patchDirectorVideoGenerationSession(sessionId, {
      videoStatus: "failed",
      videoError: job.error ? formatDirectorVideoGenerationError(job.error, "视频生成失败") : "视频生成失败",
    });
  }
  return patchDirectorVideoGenerationSession(sessionId, {
    videoStatus: "running",
    videoError: null,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const access = requireOwnedSession(request, sessionId);
  if ("response" in access) {
    return access.response;
  }

  let videoJob = access.generationSession.videoJobId ? getVideoJob(access.generationSession.videoJobId) : null;
  if (videoJob?.mode === "live" && (videoJob.status === "QUEUED" || videoJob.status === "IN_PROGRESS")) {
    videoJob = (await refreshLiveJob(videoJob.jobId).catch(() => videoJob)) ?? videoJob;
  }

  const nextSession = patchSessionStatusFromJob(sessionId, videoJob);
  return NextResponse.json({
    session: nextSession ?? access.generationSession,
    videoJob,
    runtime: getProviderRuntime("seedance"),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const access = requireOwnedSession(request, sessionId);
    if ("response" in access) {
      return access.response;
    }

    const body = (await request.json().catch(() => ({}))) as VideoRequest;
    if (body.action && body.action !== "generate") {
      return NextResponse.json({ error: "不支持的视频操作" }, { status: 400 });
    }

    const selectedImage = getSelectedDirectorVideoGenerationImage(access.generationSession);
    if (!selectedImage) {
      return NextResponse.json({ error: "请先生成并选择图片" }, { status: 400 });
    }

    const sourceImageDataUrl = getDirectorVideoGenerationImageDataUrl(selectedImage);
    if (!sourceImageDataUrl) {
      return NextResponse.json({ error: "选中图片读取失败，请重新生成图片" }, { status: 400 });
    }

    const prompt = String(
      body.videoPrompt ??
        access.generationSession.videoPrompt ??
        access.generationSession.optimizedPrompt ??
        access.generationSession.imagePrompt ??
        "",
    ).trim();
    if (!prompt) {
      return NextResponse.json({ error: "请先填写视频提示词" }, { status: 400 });
    }
    const videoOriginalPrompt = String(body.videoOriginalPrompt ?? access.generationSession.videoOriginalPrompt ?? "").trim();
    const videoModificationInstruction = String(
      body.videoModificationInstruction ?? access.generationSession.videoModificationInstruction ?? "",
    ).trim();

    const preparedSession =
      patchDirectorVideoGenerationSession(sessionId, {
        videoOriginalPrompt,
        videoModificationInstruction,
        videoPrompt: prompt,
        videoSettings: body.videoSettings ?? {},
        videoStatus: "running",
        videoError: null,
      }) ?? access.generationSession;
    const runtime = getProviderRuntime("seedance");
    const defaults = getDefaultKlingGenerationSettings();
    const generationSettings: KlingGenerationSettings = {
      ...defaults,
      durationSeconds: preparedSession.videoSettings.durationSeconds,
      mode: defaults.mode,
      aspectRatio: preparedSession.videoSettings.ratio,
      cfgScale: defaults.cfgScale,
      cameraControl: "auto",
      generateAudio: preparedSession.videoSettings.generateAudio,
      watermark: preparedSession.videoSettings.watermark,
      negativePrompt: getEffectiveConstraintPrompt("negative_prompt"),
      multiShot: false,
      shotType: "customize",
      multiPrompt: [],
      sourceImageUrl: selectedImage.imageUrl,
    };
    const taskName = deriveTaskName(preparedSession.title || prompt);
    const submittedAt = new Date().toISOString();
    let videoJob: VideoJobRecord;

    if (runtime.liveEnabled) {
      const seedanceInput: SeedanceGenerationInput = {
        prompt,
        imageUrls: [sourceImageDataUrl],
        durationSeconds: preparedSession.videoSettings.durationSeconds,
        ratio: preparedSession.videoSettings.ratio,
        resolution: preparedSession.videoSettings.resolution,
        generateAudio: preparedSession.videoSettings.generateAudio,
        watermark: preparedSession.videoSettings.watermark,
      };
      const submission = await runWithModelUsageContext(
        {
          userId: access.userSession.userId,
          routePath: "/api/director-video-generations/[sessionId]/video",
          objectType: "director_video_generation",
          objectId: sessionId,
        },
        () => submitSeedanceVideoJob(seedanceInput),
      );
      videoJob = createVideoJobRecord({
        jobId: submission.jobId,
        sourceTaskId: sessionId,
        taskName,
        originalPrompt: prompt,
        optimizedPrompt: submission.optimizedPrompt ?? prompt,
        strategy: {
          angle: "视频生成",
          hook: prompt.slice(0, 48),
          style: "Seedance 2.0 图生视频",
        },
        submittedAt,
        status: "QUEUED",
        mode: "live",
        logs: submission.logs,
        provider: submission.provider,
        modelId: submission.modelId,
        generationSettings,
      });
      upsertVideoJob(videoJob);
      scheduleVideoJobPolling(videoJob.jobId);
    } else {
      const mockJobId = crypto.randomUUID();
      const mockVideo = await createMockVideoFromImage({
        taskId: sessionId,
        jobId: mockJobId,
        sourceImageDataUrl,
        durationSeconds: preparedSession.videoSettings.durationSeconds,
        aspectRatio: preparedSession.videoSettings.ratio,
      });
      videoJob = upsertVideoJob({
        ...createVideoJobRecord({
          jobId: mockJobId,
          sourceTaskId: sessionId,
          taskName,
          originalPrompt: prompt,
          optimizedPrompt: prompt,
          strategy: {
            angle: "视频生成",
            hook: prompt.slice(0, 48),
            style: "Mock 本地图生视频",
          },
          submittedAt,
          status: "COMPLETED",
          mode: "mock",
          logs: ["Seedance 2.0 未启用，已生成本地 Mock 视频。"],
          videoUrl: mockVideo.videoUrl,
          provider: null,
          modelId: "mock/local-still-video",
          generationSettings,
        }),
        resolvedDurationSeconds: mockVideo.resolvedDurationSeconds,
      });
    }

    const nextSession = patchDirectorVideoGenerationSession(sessionId, {
      videoJobId: videoJob.jobId,
      videoStatus: videoJob.status === "COMPLETED" ? "success" : "running",
      videoError: null,
    });

    return NextResponse.json({
      session: nextSession,
      videoJob,
      runtime,
    });
  } catch (error) {
    const { sessionId } = await context.params;
    const message = formatDirectorVideoGenerationError(error, "视频生成失败");
    try {
      patchDirectorVideoGenerationSession(sessionId, {
        videoStatus: "failed",
        videoError: message,
      });
    } catch (patchError) {
      console.error("[director-video-generation] failed to persist video failure", patchError);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
