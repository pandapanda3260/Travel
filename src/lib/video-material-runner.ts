import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { createAdminTaskStageTracker, withAdminProviderCallTracking } from "./admin-data-flow-tracking";
import { transcribeAudioFile, type AsrResult } from "./asr-provider";
import { getAsrRuntime } from "./asr-provider-config";
import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { dbDelete, dbGet, dbUpsert } from "./db";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { extractBestJsonObject } from "./llm-json";
import { extractFrames, analyzeVideoWithRetry } from "./video-analyzer";
import {
  clearVideoMaterialDerivedAssets,
  ensureUploadsDir,
  getVideoMaterial,
  listVideoMaterials,
  persistVideoMaterialExtractedFrames,
  type VideoMaterialRecord,
  type ProcessingMode,
  updateVideoMaterial,
} from "./video-material-store";
import { runWithModelUsageContext } from "./model-usage-context";
import { recordModelUsage } from "./model-usage-service";
import { getGenerationRuntime, getVisionRuntime } from "./vision-provider-config";
import { extractVisualSubtitleLinesFromAnalysis } from "./video-material-subtitles";

const execFileAsync = promisify(execFile);
const activeMaterialRuns = new Set<string>();
const PROCESSING_LOCK_COLLECTION = "video-material-processing-locks";
const PROCESSING_LOCK_TTL_MS = 15 * 60 * 1000;

type VideoMaterialProcessingLock = {
  materialId: string;
  runId: string;
  expiresAt: string;
  updatedAt: string;
};

function getProcessingLock(materialId: string) {
  return dbGet<VideoMaterialProcessingLock>(PROCESSING_LOCK_COLLECTION, materialId);
}

function upsertProcessingLock(materialId: string, runId: string) {
  const now = new Date();
  dbUpsert(PROCESSING_LOCK_COLLECTION, materialId, {
    materialId,
    runId,
    expiresAt: new Date(now.getTime() + PROCESSING_LOCK_TTL_MS).toISOString(),
    updatedAt: now.toISOString(),
  } satisfies VideoMaterialProcessingLock);
}

function isProcessingLockExpired(lock: VideoMaterialProcessingLock | null) {
  return !lock || new Date(lock.expiresAt).getTime() <= Date.now();
}

function tryAcquireProcessingLock(materialId: string, runId: string) {
  const currentLock = getProcessingLock(materialId);
  if (currentLock && currentLock.runId !== runId && !isProcessingLockExpired(currentLock)) {
    return false;
  }

  upsertProcessingLock(materialId, runId);
  return true;
}

function refreshProcessingLock(materialId: string, runId: string) {
  const currentLock = getProcessingLock(materialId);
  if (!currentLock || currentLock.runId !== runId) {
    return false;
  }

  upsertProcessingLock(materialId, runId);
  return true;
}

function releaseProcessingLock(materialId: string, runId: string) {
  const currentLock = getProcessingLock(materialId);
  if (!currentLock || currentLock.runId !== runId) {
    return false;
  }

  dbDelete(PROCESSING_LOCK_COLLECTION, materialId);
  return true;
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
}

function isProcessingStatus(status: VideoMaterialRecord["status"]) {
  return status === "converting" || status === "transcribing" || status === "analyzing" || status === "generating";
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
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    audioPath,
  ]);

  return { audioPath, audioFileName };
}

async function generateContentFromAnalysis(
  materialId: string,
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
    userMessage = `以下是视频的结构化分析结果（来自视觉AI关键帧分析）：\n\n${videoAnalysis}\n\n以下是视频语音转文字的原始文稿：\n\n${rawTranscript}`;
  } else if (hasVideoAnalysis) {
    userMessage = `以下是视频的结构化分析结果（来自视觉AI关键帧分析），该视频无语音内容：\n\n${videoAnalysis}`;
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

    const response = await withAdminProviderCallTracking(
      {
        enabled: runtime.liveEnabled,
        serviceName: "llm.material_script",
        provider: runtime.providerLabel,
        modelId: runtime.modelId,
        objectType: "video_material",
        objectId: materialId,
      },
      async () => {
        let requestResponse: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          requestResponse = await fetch(url, { method: "POST", headers: requestHeaders, body: requestBody });
          if (requestResponse.status !== 429) {
            break;
          }
          const retryAfter = Number(requestResponse.headers.get("retry-after")) || 0;
          const waitSeconds = Math.max(retryAfter, 30) + attempt * 15;
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        }
        if (!requestResponse) {
          throw new Error("GPT-5.4 内容生成未返回响应");
        }
        return requestResponse;
      },
    );

    if (!response.ok) {
      throw new Error(`GPT-5.4 内容生成请求失败 (HTTP ${response.status})`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: {
          cached_tokens?: number;
        };
      };
    };

    recordModelUsage({
      pricingKey: runtime.modelId.startsWith("gpt-5.4")
        ? "openai.gpt-5.4"
        : runtime.modelId.startsWith("gpt-4o")
          ? "openai.gpt-4o"
          : runtime.modelId.includes("doubao-seed-2.0-pro")
            ? "doubao.seed.2.0.pro"
            : null,
      serviceName: "llm.material_script",
      provider: runtime.providerLabel,
      modelId: runtime.modelId,
      metrics: {
        inputTokens: Number(data.usage?.prompt_tokens ?? 0),
        outputTokens: Number(data.usage?.completion_tokens ?? 0),
        cachedInputTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      },
      requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
      remark: "素材脚本生成",
    });

    const content = data.choices?.[0]?.message?.content ?? "";
    const extractedJson = extractBestJsonObject(content);
    if (extractedJson) {
      const parsed = JSON.parse(extractedJson) as {
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

function resolveGeneratedMaterialName(materialId: string, text: string, videoFileName: string | null): string {
  const current = getVideoMaterial(materialId);
  if (current?.nameEditedAt && current.name.trim()) {
    return current.name;
  }
  return getMaterialName(text, videoFileName);
}

function normalizeTranscriptLines(
  utterances: AsrResult["utterances"],
): NonNullable<VideoMaterialRecord["transcriptLines"]> {
  return utterances
    .map((utterance) => ({
      text: utterance.text.trim(),
      startTime: Number.isFinite(utterance.startTime) ? Math.max(0, utterance.startTime) : 0,
      endTime: Number.isFinite(utterance.endTime) ? Math.max(0, utterance.endTime) : 0,
    }))
    .filter((line) => line.text.length > 0);
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

async function processAudioOnly(material: VideoMaterialRecord, runId: string) {
  const uploadsDir = ensureUploadsDir();
  const asrRuntime = getAsrRuntime();
  const stageTracker = createAdminTaskStageTracker({
    taskId: material.materialId,
    stageKey: "material_processing",
    provider: asrRuntime.providerLabel,
    modelId: material.processingMode ?? "audio_only",
  });

  if (!material.videoFileName) {
    stageTracker.fail(new Error("视频文件不存在"));
    throw new Error("视频文件不存在");
  }
  const videoPath = join(uploadsDir, material.videoFileName);
  if (!existsSync(videoPath)) {
    stageTracker.fail(new Error("视频文件不存在于磁盘"));
    throw new Error("视频文件不存在于磁盘");
  }

  updateVideoMaterial(material.materialId, {
    status: "converting",
    statusMessage: "正在将视频转换为音频文件…",
  });
  refreshProcessingLock(material.materialId, runId);

  const { audioFileName } = await convertVideoToAudio(videoPath, uploadsDir, material.materialId);
  const audioFileUrl = `/video-materials/${audioFileName}`;

  updateVideoMaterial(material.materialId, {
    audioFileName,
    audioFileUrl,
    audioConvertedAt: new Date().toISOString(),
    status: "transcribing",
    statusMessage: "音频转换完成，正在进行语音识别…",
  });
  refreshProcessingLock(material.materialId, runId);

  let rawTranscript = "";
  let transcriptLines: NonNullable<VideoMaterialRecord["transcriptLines"]> = [];
  try {
    const audioAbsolutePath = join(uploadsDir, audioFileName);
    const result = await withAdminProviderCallTracking(
      {
        enabled: asrRuntime.liveEnabled,
        serviceName: "audio.asr",
        provider: asrRuntime.providerLabel,
        modelId: asrRuntime.resourceId,
        objectType: "video_material",
        objectId: material.materialId,
      },
      () => transcribeAudioFile(audioAbsolutePath, "wav"),
    );
    rawTranscript = result.text;
    transcriptLines = normalizeTranscriptLines(result.utterances);
  } catch (asrError) {
    stageTracker.fail(asrError);
    updateVideoMaterial(material.materialId, {
      status: "error",
      statusMessage: `语音识别失败: ${asrError instanceof Error ? asrError.message : "未知错误"}`,
      rawTranscript: "",
      transcriptLines: [],
    });
    refreshProcessingLock(material.materialId, runId);
    return;
  }

  updateVideoMaterial(material.materialId, {
    rawTranscript,
    transcriptLines,
    name: resolveGeneratedMaterialName(material.materialId, rawTranscript, material.videoFileName),
    status: "ready",
    statusMessage: rawTranscript.trim() ? "音频识别完成" : "处理完成，但未识别到语音内容",
  });
  refreshProcessingLock(material.materialId, runId);
  stageTracker.complete();
}

async function processAutoAll(material: VideoMaterialRecord, runId: string) {
  const uploadsDir = ensureUploadsDir();
  const asrRuntime = getAsrRuntime();
  const analysisRuntime = getVisionRuntime();
  const stageTracker = createAdminTaskStageTracker({
    taskId: material.materialId,
    stageKey: "material_processing",
    provider: "素材自动处理",
    modelId: material.processingMode ?? "auto_all",
  });

  if (!material.videoFileName) {
    stageTracker.fail(new Error("视频文件不存在"));
    throw new Error("视频文件不存在");
  }
  const videoPath = join(uploadsDir, material.videoFileName);
  if (!existsSync(videoPath)) {
    stageTracker.fail(new Error("视频文件不存在于磁盘"));
    throw new Error("视频文件不存在于磁盘");
  }

  updateVideoMaterial(material.materialId, {
    status: "converting",
    statusMessage: "正在将视频转换为音频文件…",
  });
  refreshProcessingLock(material.materialId, runId);

  const { audioFileName } = await convertVideoToAudio(videoPath, uploadsDir, material.materialId);
  const audioFileUrl = `/video-materials/${audioFileName}`;

  updateVideoMaterial(material.materialId, {
    audioFileName,
    audioFileUrl,
    audioConvertedAt: new Date().toISOString(),
    status: "transcribing",
    statusMessage: "正在并行处理：语音识别 + 视频关键帧检测与分析…",
  });
  refreshProcessingLock(material.materialId, runId);

  const [asrResult, videoAnalysisResult] = await Promise.allSettled([
    (async () => {
      const audioAbsolutePath = join(uploadsDir, audioFileName);
      return withAdminProviderCallTracking(
        {
          enabled: asrRuntime.liveEnabled,
          serviceName: "audio.asr",
          provider: asrRuntime.providerLabel,
          modelId: asrRuntime.resourceId,
          objectType: "video_material",
          objectId: material.materialId,
        },
        () => transcribeAudioFile(audioAbsolutePath, "wav"),
      );
    })(),
    (async () => {
      const { allFrames, sampledFrames } = await extractFrames(videoPath);
      const extractedFrames = await persistVideoMaterialExtractedFrames(material.materialId, allFrames);
      updateVideoMaterial(material.materialId, {
        framesExtracted: extractedFrames.length,
        extractedFrames,
        status: "analyzing",
        statusMessage: `已检测到 ${allFrames.length} 个关键帧，按片长规则采样 ${sampledFrames.length} 帧发送视频分析…`,
      });
      refreshProcessingLock(material.materialId, runId);
      const { analysis } = await withAdminProviderCallTracking(
        {
          enabled: analysisRuntime.liveEnabled,
          serviceName: "video.analysis",
          provider: analysisRuntime.providerLabel,
          modelId: analysisRuntime.modelId,
          objectType: "video_material",
          objectId: material.materialId,
        },
        () => analyzeVideoWithRetry(sampledFrames, 1),
      );
      return analysis;
    })(),
  ]);

  let rawTranscript = "";
  let transcriptLines: NonNullable<VideoMaterialRecord["transcriptLines"]> = [];
  let asrErrorMsg = "";
  if (asrResult.status === "fulfilled") {
    rawTranscript = asrResult.value.text;
    transcriptLines = normalizeTranscriptLines(asrResult.value.utterances);
  } else {
    asrErrorMsg = asrResult.reason instanceof Error ? asrResult.reason.message : "语音识别失败";
  }

  let videoAnalysis = "";
  let analysisErrorMsg = "";
  if (videoAnalysisResult.status === "fulfilled") {
    videoAnalysis = videoAnalysisResult.value;
  } else {
    analysisErrorMsg =
      videoAnalysisResult.reason instanceof Error ? videoAnalysisResult.reason.message : "视频分析失败";
  }

  if (!rawTranscript.trim() && !videoAnalysis) {
    stageTracker.fail(new Error([asrErrorMsg, analysisErrorMsg].filter(Boolean).join("；") || "素材自动处理失败"));
    updateVideoMaterial(material.materialId, {
      rawTranscript,
      transcriptLines,
      videoAnalysis,
      visualSubtitleText: "",
      visualSubtitleLines: [],
      videoAnalysisCompletedAt: null,
      status: "error",
      statusMessage: [asrErrorMsg, analysisErrorMsg].filter(Boolean).join("；") || "语音识别和视频分析均未返回有效结果",
    });
    refreshProcessingLock(material.materialId, runId);
    return;
  }

  const visualSubtitleLines = extractVisualSubtitleLinesFromAnalysis(videoAnalysis);

  updateVideoMaterial(material.materialId, {
    rawTranscript,
    transcriptLines,
    videoAnalysis,
    visualSubtitleText: visualSubtitleLines.join("\n"),
    visualSubtitleLines,
    videoAnalysisCompletedAt: videoAnalysis ? new Date().toISOString() : null,
    status: "generating",
    statusMessage: buildAnalysisSummary(rawTranscript, videoAnalysis, asrErrorMsg, analysisErrorMsg),
  });
  refreshProcessingLock(material.materialId, runId);

  const generated = await generateContentFromAnalysis(material.materialId, rawTranscript, videoAnalysis);

  const finalParts: string[] = [];
  if (rawTranscript.trim()) {
    finalParts.push("语音识别完成");
  } else if (asrErrorMsg) {
    finalParts.push("语音识别失败");
  } else {
    finalParts.push("未检测到语音");
  }
  if (videoAnalysis) {
    finalParts.push("视频分析完成");
  } else if (analysisErrorMsg) {
    finalParts.push(`视频分析失败: ${analysisErrorMsg.slice(0, 80)}`);
  }
  finalParts.push("脚本生成完成");

  updateVideoMaterial(material.materialId, {
    contentScript: generated.contentScript,
    videoTemplatePrompt: generated.videoTemplatePrompt,
    reversePrompt: generated.reversePrompt,
    subtitle: generated.subtitle,
    name: resolveGeneratedMaterialName(
      material.materialId,
      generated.subtitle || rawTranscript,
      material.videoFileName,
    ),
    status: "ready",
    statusMessage: finalParts.join("；"),
  });
  refreshProcessingLock(material.materialId, runId);
  stageTracker.complete();
}

async function runVideoMaterialProcessing(materialId: string, runId: string) {
  const executeProcessing = async () => {
    try {
      const material = getVideoMaterial(materialId);
      if (!material) {
        return null;
      }
      refreshProcessingLock(materialId, runId);
      const mode = (material.processingMode ?? "auto_all") as ProcessingMode;
      clearVideoMaterialDerivedAssets(materialId);
      if (mode === "audio_only") {
        await processAudioOnly(material, runId);
      } else {
        await processAutoAll(material, runId);
      }
    } catch (processError) {
      updateVideoMaterial(materialId, {
        status: "error",
        statusMessage: processError instanceof Error ? processError.message : "处理失败",
      });
      refreshProcessingLock(materialId, runId);
    } finally {
      releaseProcessingLock(materialId, runId);
    }

    return getVideoMaterial(materialId);
  };

  const material = getVideoMaterial(materialId);
  if (!material) {
    releaseProcessingLock(materialId, runId);
    return null;
  }

  if (!material.ownerUserId) {
    return executeProcessing();
  }

  return runWithModelUsageContext(
    {
      userId: material.ownerUserId,
      routePath: "/internal/video-material-processing",
      objectType: "video_material",
      objectId: materialId,
    },
    executeProcessing,
  );
}

export function scheduleVideoMaterialProcessing(materialId: string) {
  const normalizedMaterialId = materialId.trim();
  if (!normalizedMaterialId || activeMaterialRuns.has(normalizedMaterialId)) {
    return false;
  }

  const material = getVideoMaterial(normalizedMaterialId);
  if (!material || !material.videoFileName || !isProcessingStatus(material.status)) {
    return false;
  }

  const runId = randomUUID();
  if (!tryAcquireProcessingLock(normalizedMaterialId, runId)) {
    return false;
  }

  activeMaterialRuns.add(normalizedMaterialId);
  void runVideoMaterialProcessing(normalizedMaterialId, runId).finally(() => {
    activeMaterialRuns.delete(normalizedMaterialId);
  });
  return true;
}

export function ensurePendingVideoMaterialProcessing(materialId?: string) {
  const materials = materialId
    ? [getVideoMaterial(materialId)].filter((item): item is VideoMaterialRecord => Boolean(item))
    : listVideoMaterials();

  for (const material of materials) {
    if (!material.videoFileName || !isProcessingStatus(material.status)) {
      continue;
    }

    scheduleVideoMaterialProcessing(material.materialId);
  }
}
