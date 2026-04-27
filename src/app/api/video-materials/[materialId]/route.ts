import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireUserApiSession, userApiUnauthorizedResponse } from "../../../../lib/auth-session";
import { writeUploadedFileToPath } from "../../../../lib/file-stream";
import {
  createIdleVideoMaterialImageCleaningJob,
  clearVideoMaterialDerivedAssets,
  deleteVideoMaterial,
  ensureUploadsDir,
  getVideoMaterial,
  updateVideoMaterial,
  type ProcessingMode,
} from "../../../../lib/video-material-store";
import { ensurePendingVideoMaterialImageCleaning } from "../../../../lib/video-material-image-clean-runner";
import {
  ensurePendingVideoMaterialProcessing,
  scheduleVideoMaterialProcessing,
} from "../../../../lib/video-material-runner";

type RouteContext = {
  params: Promise<{ materialId: string }>;
};

const maxFileSizeBytes = 500 * 1024 * 1024;
const processingModeOptions = new Set<ProcessingMode>(["auto_all", "audio_only"]);

function getSafeVideoExtension(fileName: string, mimeType: string) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "ts", "m4v"].includes(ext)) {
    return ext;
  }
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return "";
}

function normalizeProcessingMode(value: unknown, fallback: ProcessingMode): ProcessingMode | null {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim() as ProcessingMode;
  return processingModeOptions.has(normalized) ? normalized : null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(_request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;
    let material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    if (material.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权访问该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }
    ensurePendingVideoMaterialProcessing(materialId);
    ensurePendingVideoMaterialImageCleaning(materialId);
    material = getVideoMaterial(materialId) ?? material;
    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "素材查询失败" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(_request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;
    const material = getVideoMaterial(materialId);
    if (material?.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权删除该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }
    const deleted = deleteVideoMaterial(materialId);
    if (!deleted) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "素材删除失败" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "rename" | "reprocess";
      name?: string;
      processingMode?: string;
    };

    let material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材记录不存在" }, { status: 404 });
    }
    if (material.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权修改该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }
    if (body.action === "rename" || typeof body.name === "string") {
      const nextName = typeof body.name === "string" ? body.name.trim() : "";
      if (!nextName) {
        return NextResponse.json({ error: "素材名称不能为空" }, { status: 400 });
      }
      if (Array.from(nextName).length > 60) {
        return NextResponse.json({ error: "素材名称不能超过 60 个字" }, { status: 400 });
      }
      material = updateVideoMaterial(materialId, {
        name: nextName,
        nameEditedAt: new Date().toISOString(),
      })!;
      return NextResponse.json({ material });
    }
    if (!material.videoFileName) {
      return NextResponse.json({ error: "该素材没有视频文件，无法重新处理" }, { status: 400 });
    }

    const mode = normalizeProcessingMode(body.processingMode, material.processingMode ?? "auto_all");
    if (!mode) {
      return NextResponse.json({ error: "不支持的视频素材处理模式" }, { status: 400 });
    }
    clearVideoMaterialDerivedAssets(materialId);

    material = updateVideoMaterial(materialId, {
      processingMode: mode,
      status: "converting",
      statusMessage: "正在重新处理…",
      framesExtracted: 0,
      extractedFrames: [],
      cleanedFrames: [],
      imageCleaningJob: createIdleVideoMaterialImageCleaningJob(),
      videoAnalysis: "",
      videoAnalysisCompletedAt: null,
      rawTranscript: "",
      transcriptLines: [],
      visualSubtitleText: "",
      visualSubtitleLines: [],
      contentScript: "",
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: "",
    })!;

    scheduleVideoMaterialProcessing(materialId);

    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "重新处理失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = requireUserApiSession(request);
  if (!session) {
    return userApiUnauthorizedResponse();
  }

  try {
    const { materialId } = await context.params;

    const formData = await request.formData();
    const file = formData.get("file");
    const processingMode = normalizeProcessingMode(formData.get("processingMode"), "auto_all");
    if (!processingMode) {
      return NextResponse.json({ error: "不支持的视频素材处理模式" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传视频文件" }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ error: "视频文件不能超过 500MB" }, { status: 400 });
    }

    const extension = getSafeVideoExtension(file.name, file.type);
    if (!extension) {
      return NextResponse.json({ error: "不支持的视频格式，请上传 mp4、mov、avi、mkv、webm 等格式" }, { status: 400 });
    }

    let material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材记录不存在" }, { status: 404 });
    }
    if (material.ownerUserId && material.ownerUserId !== session.userId) {
      return NextResponse.json({ error: "无权上传到该素材", code: "VIDEO_MATERIAL_FORBIDDEN" }, { status: 403 });
    }

    const uploadsDir = ensureUploadsDir();
    const videoFileName = `${materialId}.${extension}`;
    const videoPath = join(uploadsDir, videoFileName);
    await writeUploadedFileToPath(file, videoPath);

    const videoFileUrl = `/video-materials/${videoFileName}`;
    clearVideoMaterialDerivedAssets(materialId);

    material = updateVideoMaterial(materialId, {
      videoFileName,
      videoFileUrl,
      videoUploadedAt: new Date().toISOString(),
      processingMode,
      status: "converting",
      statusMessage: "视频文件已保存，开始处理…",
      framesExtracted: 0,
      extractedFrames: [],
      cleanedFrames: [],
      imageCleaningJob: createIdleVideoMaterialImageCleaningJob(),
      videoAnalysis: "",
      videoAnalysisCompletedAt: null,
      rawTranscript: "",
      transcriptLines: [],
      visualSubtitleText: "",
      visualSubtitleLines: [],
      contentScript: "",
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: "",
    })!;

    scheduleVideoMaterialProcessing(materialId);

    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "视频上传失败" }, { status: 500 });
  }
}
