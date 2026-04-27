import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../../lib/auth-session";
import {
  ensurePendingVideoMaterialImageCleaning,
  scheduleVideoMaterialImageCleaning,
  startVideoMaterialImageCleaningJob,
} from "../../../../../lib/video-material-image-clean-runner";
import { deleteVideoMaterialCleanedFrames, getVideoMaterial } from "../../../../../lib/video-material-store";

type RouteContext = { params: Promise<{ materialId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "clean_selected" | "clean_all";
      imageIds?: string[];
    };
    const material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    if (material.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权操作该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }
    ensurePendingVideoMaterialImageCleaning(materialId);

    const targetFrames =
      body.action === "clean_all"
        ? material.extractedFrames
        : material.extractedFrames.filter((frame) => (body.imageIds ?? []).includes(frame.imageId));

    if (!targetFrames.length) {
      return NextResponse.json({ error: "没有可清洗的抽帧图片" }, { status: 400 });
    }

    if (material.imageCleaningJob.status === "running") {
      scheduleVideoMaterialImageCleaning(materialId);
      return NextResponse.json({
        material: getVideoMaterial(materialId),
        warning: "当前已有图片清洗任务在执行，已继续在后台处理。",
      });
    }

    const updated = startVideoMaterialImageCleaningJob(
      materialId,
      targetFrames.map((frame) => frame.imageId),
    );
    if (!updated) {
      return NextResponse.json({ error: "图片清洗任务启动失败" }, { status: 500 });
    }

    return NextResponse.json({ material: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片清洗失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      imageIds?: string[];
    };
    const material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    if (material.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权操作该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }

    const targetFrames = material.cleanedFrames.filter((frame) => (body.imageIds ?? []).includes(frame.imageId));
    if (!targetFrames.length) {
      return NextResponse.json({ error: "没有可删除的清洗图片" }, { status: 400 });
    }

    const updated = deleteVideoMaterialCleanedFrames(
      materialId,
      targetFrames.map((frame) => frame.imageId),
    );
    if (!updated) {
      return NextResponse.json({ error: "清洗图片删除失败" }, { status: 500 });
    }

    return NextResponse.json({ material: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "清洗图片删除失败" }, { status: 500 });
  }
}
