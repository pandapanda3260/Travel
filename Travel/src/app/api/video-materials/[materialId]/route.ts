import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

import {
  getVideoMaterial,
  updateVideoMaterial,
  deleteVideoMaterial,
  ensureUploadsDir,
  type VideoMaterialRecord,
  type ProcessingMode,
} from "../../../../lib/video-material-store";
import { transcribeAudioFile } from "../../../../lib/asr-provider";
import { getEffectiveConstraintPrompt } from "../../../../lib/constraint-prompt-store";
import { getGenerationRuntime } from "../../../../lib/vision-provider-config";
import { extractFrames, analyzeVideoWithRetry } from "../../../../lib/video-analyzer";

const execFileAsync = promisify(execFile);
const require = createRequire(process.cwd() + "/package.json");

type RouteContext = {
  params: Promise<{ materialId: string }>;
};

const maxFileSizeBytes = 500 * 1024 * 1024;

function resolveFfmpegPath() {
  const runtimePath = require("ffmpeg-static") as string | null;
  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }
  return runtimePath;
}

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

async function convertVideoToAudio(
  videoPath: string,
  outputDir: string,
  outputBaseName: string,
): Promise<{ audioPath: string; audioFileName: string }> {
  const ffmpegPath = resolveFfmpegPath();
  const audioFileName = `${outputBaseName}.wav`;
  const audioPath = join(outputDir, audioFileName);

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    audioPath,
  ]);

  return { audioPath, audioFileName };
}

/**
 * Generate content by combining video analysis + audio transcript.
 * Uses the text generation runtime (Volcengine Ark or compatible).
 */
async function generateContentFromAnalysis(
  rawTranscript: string,
  videoAnalysis: string,
): Promise<{
  contentScript: string;
  videoTemplatePrompt: string;
  reversePrompt: string;
  subtitle: string;
}> {
  const runtime = getGenerationRuntime();

  if (!runtime.liveEnabled) {
    return {
      contentScript: rawTranscript || videoAnalysis,
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: rawTranscript,
    };
  }

  const hasTranscript = rawTranscript.trim().length > 0;
  const hasVideoAnalysis = videoAnalysis.trim().length > 0;

  if (!hasTranscript && !hasVideoAnalysis) {
    return { contentScript: "", videoTemplatePrompt: "", reversePrompt: "", subtitle: "" };
  }

  let userMessage: string;
  if (hasVideoAnalysis && hasTranscript) {
    userMessage = `以下是视频的结构化分析结果（来自视觉AI逐帧分析）：\n\n${videoAnalysis}\n\n以下是视频语音转文字的原始文稿：\n\n${rawTranscript}`;
  } else if (hasVideoAnalysis) {
    userMessage = `以下是视频的结构化分析结果（来自视觉AI逐帧分析），该视频无语音内容：\n\n${videoAnalysis}`;
  } else {
    userMessage = `以下是视频语音转文字的原始稿（无视觉分析数据）：\n\n${rawTranscript}`;
  }

  const systemPrompt = getEffectiveConstraintPrompt("video_script_generation");

  try {
    const url = `${runtime.apiBase}${runtime.chatEndpoint}`;
    const requestBody = JSON.stringify({
      model: runtime.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_completion_tokens: 8192,
    });
    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    };

    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, { method: "POST", headers: requestHeaders, body: requestBody });
      if (response.status !== 429) break;
      const retryAfter = Number(response.headers.get("retry-after")) || 0;
      const waitSeconds = Math.max(retryAfter, 30) + attempt * 15;
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    }

    if (!response || !response.ok) {
      throw new Error(`GPT-5.4 内容生成请求失败 (HTTP ${response?.status ?? "?"})`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        contentScript?: string;
        videoTemplatePrompt?: string;
        reversePrompt?: string;
        subtitle?: string;
      };
      return {
        contentScript: parsed.contentScript ?? "",
        videoTemplatePrompt: parsed.videoTemplatePrompt ?? "",
        reversePrompt: parsed.reversePrompt ?? "",
        subtitle: parsed.subtitle ?? rawTranscript,
      };
    }

    return {
      contentScript: rawTranscript || videoAnalysis,
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: rawTranscript,
    };
  } catch {
    return {
      contentScript: rawTranscript || videoAnalysis,
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: rawTranscript,
    };
  }
}

function getMaterialName(text: string, videoFileName: string | null): string {
  const cleaned = text.trim().replace(/\n/g, "");
  if (cleaned) {
    const chars = Array.from(cleaned);
    return chars.length <= 8 ? chars.join("") : `${chars.slice(0, 8).join("")}…`;
  }
  return videoFileName ?? "未命名素材";
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { materialId } = await context.params;
    const material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材查询失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { materialId } = await context.params;
    const deleted = deleteVideoMaterial(materialId);
    if (!deleted) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材删除失败" },
      { status: 500 },
    );
  }
}

/* =============================================
 * Pipeline: audio_only mode
 * Upload → FFmpeg audio extract → ASR → done
 * ============================================= */
async function processAudioOnly(material: VideoMaterialRecord) {
  const uploadsDir = ensureUploadsDir();

  if (!material.videoFileName) throw new Error("视频文件不存在");
  const videoPath = join(uploadsDir, material.videoFileName);
  if (!existsSync(videoPath)) throw new Error("视频文件不存在于磁盘");

  // 1. Convert video to audio
  updateVideoMaterial(material.materialId, {
    status: "converting",
    statusMessage: "正在将视频转换为音频文件…",
  });

  const { audioFileName } = await convertVideoToAudio(
    videoPath, uploadsDir, material.materialId,
  );
  const audioFileUrl = `/video-materials/${audioFileName}`;

  updateVideoMaterial(material.materialId, {
    audioFileName,
    audioFileUrl,
    audioConvertedAt: new Date().toISOString(),
    status: "transcribing",
    statusMessage: "音频转换完成，正在进行语音识别…",
  });

  // 2. ASR
  let rawTranscript = "";
  try {
    const audioAbsolutePath = join(uploadsDir, audioFileName);
    const result = await transcribeAudioFile(audioAbsolutePath, "wav");
    rawTranscript = result.text;
  } catch (asrError) {
    updateVideoMaterial(material.materialId, {
      status: "error",
      statusMessage: `语音识别失败: ${asrError instanceof Error ? asrError.message : "未知错误"}`,
      rawTranscript: "",
    });
    return;
  }

  updateVideoMaterial(material.materialId, {
    rawTranscript,
    name: getMaterialName(rawTranscript, material.videoFileName),
    status: "ready",
    statusMessage: rawTranscript.trim()
      ? "音频识别完成"
      : "处理完成，但未识别到语音内容",
  });
}

/* =============================================
 * Pipeline: auto_all mode
 * Upload → FFmpeg audio extract
 *        → parallel: [ASR] + [Frame extraction → GPT-4o]
 *        → wait for both
 *        → GPT-5.x unified generation → done
 * ============================================= */
async function processAutoAll(material: VideoMaterialRecord) {
  const uploadsDir = ensureUploadsDir();

  if (!material.videoFileName) throw new Error("视频文件不存在");
  const videoPath = join(uploadsDir, material.videoFileName);
  if (!existsSync(videoPath)) throw new Error("视频文件不存在于磁盘");

  // Step 1: Convert video to audio
  updateVideoMaterial(material.materialId, {
    status: "converting",
    statusMessage: "正在将视频转换为音频文件…",
  });

  const { audioFileName } = await convertVideoToAudio(
    videoPath, uploadsDir, material.materialId,
  );
  const audioFileUrl = `/video-materials/${audioFileName}`;

  updateVideoMaterial(material.materialId, {
    audioFileName,
    audioFileUrl,
    audioConvertedAt: new Date().toISOString(),
    status: "transcribing",
    statusMessage: "正在并行处理：语音识别 + 视频帧提取与分析…",
  });

  // Step 2 & 3: Parallel — ASR + Video frame analysis (20 sampled frames)
  const [asrResult, videoAnalysisResult] = await Promise.allSettled([
    (async () => {
      const audioAbsolutePath = join(uploadsDir, audioFileName);
      return await transcribeAudioFile(audioAbsolutePath, "wav");
    })(),
    (async () => {
      const { allFrames, sampledFrames } = await extractFrames(videoPath);
      updateVideoMaterial(material.materialId, {
        framesExtracted: allFrames.length,
        statusMessage: `已提取 ${allFrames.length} 帧，采样 ${sampledFrames.length} 帧发送视频分析…`,
      });
      const { analysis } = await analyzeVideoWithRetry(sampledFrames, 1);
      return analysis;
    })(),
  ]);

  let rawTranscript = "";
  let asrErrorMsg = "";
  if (asrResult.status === "fulfilled") {
    rawTranscript = asrResult.value.text;
  } else {
    asrErrorMsg = asrResult.reason instanceof Error
      ? asrResult.reason.message : "语音识别失败";
  }

  let videoAnalysis = "";
  let analysisErrorMsg = "";
  if (videoAnalysisResult.status === "fulfilled") {
    videoAnalysis = videoAnalysisResult.value;
  } else {
    analysisErrorMsg = videoAnalysisResult.reason instanceof Error
      ? videoAnalysisResult.reason.message : "视频分析失败";
  }

  if (!rawTranscript.trim() && !videoAnalysis) {
    updateVideoMaterial(material.materialId, {
      rawTranscript, videoAnalysis,
      videoAnalysisCompletedAt: null,
      status: "error",
      statusMessage: [asrErrorMsg, analysisErrorMsg].filter(Boolean).join("；") || "语音识别和视频分析均未返回有效结果",
    });
    return;
  }

  updateVideoMaterial(material.materialId, {
    rawTranscript, videoAnalysis,
    videoAnalysisCompletedAt: videoAnalysis ? new Date().toISOString() : null,
    status: "generating",
    statusMessage: buildAnalysisSummary(rawTranscript, videoAnalysis, asrErrorMsg, analysisErrorMsg),
  });

  // Step 4: GPT-5.4 unified content generation
  const generated = await generateContentFromAnalysis(rawTranscript, videoAnalysis);

  const finalParts: string[] = [];
  if (rawTranscript.trim()) finalParts.push("语音识别完成");
  else if (asrErrorMsg) finalParts.push("语音识别失败");
  else finalParts.push("未检测到语音");
  if (videoAnalysis) finalParts.push("视频分析完成");
  else if (analysisErrorMsg) finalParts.push(`视频分析失败: ${analysisErrorMsg.slice(0, 80)}`);
  finalParts.push("脚本生成完成");

  updateVideoMaterial(material.materialId, {
    contentScript: generated.contentScript,
    videoTemplatePrompt: generated.videoTemplatePrompt,
    reversePrompt: generated.reversePrompt,
    subtitle: generated.subtitle,
    name: getMaterialName(generated.subtitle || rawTranscript, material.videoFileName),
    status: "ready",
    statusMessage: finalParts.join("；"),
  });
}

function buildAnalysisSummary(
  rawTranscript: string,
  videoAnalysis: string,
  asrError: string,
  analysisError: string,
): string {
  const parts: string[] = [];
  if (rawTranscript.trim()) {
    parts.push("语音识别完成");
  } else if (asrError) {
    parts.push(`语音识别失败(${asrError.slice(0, 50)})`);
  } else {
    parts.push("未检测到语音内容");
  }
  if (videoAnalysis) {
    parts.push("视频分析完成");
  } else if (analysisError) {
    parts.push(`视频分析失败(${analysisError.slice(0, 50)})`);
  }
  return parts.join("，") + "，正在生成内容脚本与提示词…";
}

async function processVideoMaterial(material: VideoMaterialRecord) {
  try {
    if (material.processingMode === "audio_only") {
      await processAudioOnly(material);
    } else {
      await processAutoAll(material);
    }
  } catch (processError) {
    updateVideoMaterial(material.materialId, {
      status: "error",
      statusMessage: processError instanceof Error ? processError.message : "处理失败",
    });
  }
}

/**
 * PATCH — reprocess an existing material (no re-upload needed).
 * Resets analysis fields and re-runs the full pipeline.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { materialId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      processingMode?: string;
    };

    let material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材记录不存在" }, { status: 404 });
    }
    if (!material.videoFileName) {
      return NextResponse.json({ error: "该素材没有视频文件，无法重新处理" }, { status: 400 });
    }

    const mode = (body.processingMode ?? material.processingMode ?? "auto_all") as ProcessingMode;

    material = updateVideoMaterial(materialId, {
      processingMode: mode,
      status: "converting",
      statusMessage: "正在重新处理…",
      framesExtracted: 0,
      videoAnalysis: "",
      videoAnalysisCompletedAt: null,
      rawTranscript: "",
      contentScript: "",
      videoTemplatePrompt: "",
      reversePrompt: "",
      subtitle: "",
    })!;

    processVideoMaterial(material).catch(() => {
      updateVideoMaterial(materialId, {
        status: "error",
        statusMessage: "后台重新处理异常",
      });
    });

    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新处理失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { materialId } = await context.params;

    const formData = await request.formData();
    const file = formData.get("file");
    const processingMode = ((formData.get("processingMode") as string) || "auto_all") as ProcessingMode;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传视频文件" }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ error: "视频文件不能超过 500MB" }, { status: 400 });
    }

    const extension = getSafeVideoExtension(file.name, file.type);
    if (!extension) {
      return NextResponse.json(
        { error: "不支持的视频格式，请上传 mp4、mov、avi、mkv、webm 等格式" },
        { status: 400 },
      );
    }

    let material = getVideoMaterial(materialId);
    if (!material) {
      return NextResponse.json({ error: "素材记录不存在" }, { status: 404 });
    }

    const uploadsDir = ensureUploadsDir();
    const videoFileName = `${materialId}.${extension}`;
    const videoPath = join(uploadsDir, videoFileName);
    const bytes = Buffer.from(await file.arrayBuffer());
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(videoPath, bytes);

    const videoFileUrl = `/video-materials/${videoFileName}`;

    material = updateVideoMaterial(materialId, {
      videoFileName,
      videoFileUrl,
      videoUploadedAt: new Date().toISOString(),
      processingMode,
      status: "converting",
      statusMessage: "视频文件已保存，开始处理…",
    })!;

    processVideoMaterial(material).catch(() => {
      updateVideoMaterial(materialId, {
        status: "error",
        statusMessage: "后台处理异常",
      });
    });

    return NextResponse.json({ material });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频上传失败" },
      { status: 500 },
    );
  }
}
