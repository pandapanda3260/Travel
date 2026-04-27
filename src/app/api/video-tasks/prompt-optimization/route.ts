import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import {
  optimizeTaskCreationUserPrompt,
  type TaskPromptOptimizationInput,
} from "../../../../lib/video-task-prompt-optimizer";
import { getVideoTaskTypeProfile, type VideoTaskVideoType } from "../../../../lib/video-task-schema";

type PromptOptimizationRequest = {
  title?: string | null;
  productInfoTitle?: string | null;
  productInfoSnapshot?: string | null;
  userPrompt?: string;
  videoTemplatePrompt?: string | null;
  videoType?: VideoTaskVideoType;
  expectedDurationRange?: string;
  expectedDurationLabel?: string;
  aspectRatio?: string;
};

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as PromptOptimizationRequest;
    const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
    if (!userPrompt) {
      return NextResponse.json({ error: "请先输入你对视频的要求和想法" }, { status: 400 });
    }

    const videoType = body.videoType;
    const profile = getVideoTaskTypeProfile(videoType);
    const input: TaskPromptOptimizationInput = {
      title: body.title ?? "",
      productInfoTitle: body.productInfoTitle ?? "",
      productInfoSnapshot: body.productInfoSnapshot ?? "",
      userPrompt,
      videoTemplatePrompt: body.videoTemplatePrompt ?? "",
      videoType: profile.key,
      videoTypeLabel: profile.label,
      expectedDurationRange: body.expectedDurationRange,
      expectedDurationLabel: body.expectedDurationLabel,
      aspectRatio: body.aspectRatio,
    };

    const { result, usedFallback, providerLabel } = await optimizeTaskCreationUserPrompt(input);

    return NextResponse.json({
      optimizedPrompt: result.upgradedPrompt,
      result,
      usedFallback,
      providerLabel,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "优化提示词生成失败" }, { status: 500 });
  }
}
