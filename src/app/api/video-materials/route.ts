import { NextRequest, NextResponse } from "next/server";

import { recordAdminDataEvent } from "../../../lib/admin-data-analytics";
import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../lib/auth-session";
import { grantGrowthForEvent } from "../../../lib/member-service";
import { grantPointsForEvent } from "../../../lib/points-service";
import { createVideoMaterial, listAccessibleVideoMaterialSummaries } from "../../../lib/video-material-store";
import { getAsrRuntime } from "../../../lib/asr-provider-config";
import { getTextGenerationRuntime } from "../../../lib/text-provider-config";
import { getVisionRuntime, getGenerationRuntime } from "../../../lib/vision-provider-config";

export async function GET(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const materials = listAccessibleVideoMaterialSummaries(session.userId);
    const asrRuntime = getAsrRuntime();
    const textRuntime = getTextGenerationRuntime();
    const visionRuntime = getVisionRuntime();
    const generationRuntime = getGenerationRuntime();

    return NextResponse.json({
      materials,
      runtime: {
        asrProviderLabel: asrRuntime.providerLabel,
        asrLiveEnabled: asrRuntime.liveEnabled,
        textProviderLabel: textRuntime.providerLabel,
        textLiveEnabled: textRuntime.liveEnabled,
        visionProviderLabel: visionRuntime.providerLabel,
        visionLiveEnabled: visionRuntime.liveEnabled,
        generationProviderLabel: generationRuntime.providerLabel,
        generationLiveEnabled: generationRuntime.liveEnabled,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频素材列表加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const material = createVideoMaterial("", { ownerUserId: session.userId });
    recordAdminDataEvent({
      eventName: "video_material.create",
      actorType: "user",
      actorId: session.userId,
      objectType: "video_material",
      objectId: material.materialId,
      metadata: {
        processingMode: material.processingMode,
      },
    });
    grantGrowthForEvent({
      userId: session.userId,
      eventType: "video_material_create",
      sourceType: "rule",
      sourceBizId: material.materialId,
      idempotentKey: `video_material_create:${material.materialId}`,
      remark: "创建视频素材记录",
    });
    grantPointsForEvent({
      userId: session.userId,
      eventType: "video_material_create",
      sourceType: "rule",
      sourceBizId: material.materialId,
      idempotentKey: `video_material_create:${material.materialId}`,
      remark: "创建视频素材记录",
    });
    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建素材记录失败" }, { status: 500 });
  }
}
