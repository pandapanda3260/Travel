import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { extractBestJsonObject } from "./llm-json";
import {
  confirmCommercialModelUsageCharge,
  estimateTextModelUsageMetrics,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";
import { getVisionRuntime } from "./vision-provider-config";

const execFileAsync = promisify(execFile);
const FFMPEG_MAX_BUFFER_BYTES = 12 * 1024 * 1024;
const SCENE_CHANGE_THRESHOLD = 0.25;
const LONG_VIDEO_THRESHOLD_SECONDS = 180;
const SHORT_VIDEO_ANALYSIS_INTERVAL_SECONDS = 2;
const LONG_VIDEO_ANALYSIS_INTERVAL_SECONDS = 4;
const LAST_FRAME_SEEK_WINDOW_SECONDS = 0.35;
const SCALE_FILTER = "scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'";
const STRUCTURED_OUTPUT_GPT_4O_MIN_DATE = "2024-08-06";
const STRUCTURED_OUTPUT_GPT_4O_MINI_DATE = "2024-07-18";

const REQUIRED_TOP_LEVEL_FIELDS = [
  "视频级信息",
  "开篇设计",
  "镜头序列",
  "结尾设计",
  "商品与卖点",
  "全局视觉规则",
  "Prompt生成指令",
] as const;

const VIDEO_ANALYSIS_JSON_SCHEMA = {
  name: "video_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      视频级信息: { type: "object" },
      开篇设计: { type: "object" },
      镜头序列: { type: "array" },
      结尾设计: { type: "object" },
      商品与卖点: { type: "object" },
      全局视觉规则: { type: "object" },
      Prompt生成指令: { type: "object" },
    },
    required: [...REQUIRED_TOP_LEVEL_FIELDS],
    additionalProperties: true,
  },
} as const;

class VisionAnalysisRequestError extends Error {
  statusCode: number | null;
  retryable: boolean;

  constructor(message: string, input?: { statusCode?: number | null; retryable?: boolean }) {
    super(message);
    this.name = "VisionAnalysisRequestError";
    this.statusCode = input?.statusCode ?? null;
    this.retryable = input?.retryable ?? false;
  }
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
}

function isModelSnapshotAtLeast(modelId: string, prefix: string, minDate: string) {
  if (modelId === "gpt-4o-mini" && prefix === "gpt-4o-mini") {
    return true;
  }

  const matched = modelId.match(new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})$`));
  if (!matched) {
    return false;
  }

  return matched[1] >= minDate;
}

function buildVisionResponseFormat(runtime: ReturnType<typeof getVisionRuntime>) {
  if (runtime.provider !== "openai") {
    return null;
  }

  const modelId = runtime.modelId;
  if (isModelSnapshotAtLeast(modelId, "gpt-4o", STRUCTURED_OUTPUT_GPT_4O_MIN_DATE)) {
    return {
      type: "json_schema" as const,
      json_schema: VIDEO_ANALYSIS_JSON_SCHEMA,
    };
  }

  if (isModelSnapshotAtLeast(modelId, "gpt-4o-mini", STRUCTURED_OUTPUT_GPT_4O_MINI_DATE)) {
    return {
      type: "json_schema" as const,
      json_schema: VIDEO_ANALYSIS_JSON_SCHEMA,
    };
  }

  return {
    type: "json_object" as const,
  };
}

function isRetryableHttpStatus(statusCode: number | null | undefined) {
  if (statusCode == null) {
    return false;
  }

  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

async function repairAnalysisJsonContent(input: {
  content: string;
  runtime: ReturnType<typeof getVisionRuntime>;
  systemPrompt: string;
  requestHeaders: Record<string, string>;
  url: string;
}) {
  const normalizedContent = input.content.trim();
  if (!normalizedContent) {
    return null;
  }

  const repairPrompt = [
    "上一轮视频分析结果没有成功解析为合法 JSON。",
    "请基于下面已有的分析内容，严格整理为一个合法 JSON 对象。",
    "必须保留以下 7 个顶层字段：视频级信息、开篇设计、镜头序列、结尾设计、商品与卖点、全局视觉规则、Prompt生成指令。",
    "如果某些字段无法从已有内容确定，请填“未知”、空字符串、空数组或空对象，但仍然必须输出完整 JSON 对象。",
    "不要输出解释、不要输出 markdown、不要输出代码块，只返回 JSON 对象。",
    "",
    normalizedContent,
  ].join("\n");
  const responseFormat = buildVisionResponseFormat(input.runtime);

  const repairBody = JSON.stringify({
    model: input.runtime.modelId,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: repairPrompt },
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
    max_completion_tokens: 8192,
    temperature: 0.1,
  });

  const repairResponse = await fetch(input.url, {
    method: "POST",
    headers: input.requestHeaders,
    body: repairBody,
  });

  if (!repairResponse.ok) {
    return null;
  }

  const repairData = (await repairResponse.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const repairContent = repairData.choices?.[0]?.message?.content ?? "";
  return extractBestJsonObject(repairContent, REQUIRED_TOP_LEVEL_FIELDS);
}

export type FrameData = {
  base64: string;
  timestamp: number;
  index: number;
};

function formatFrameTimestamp(timestamp: number) {
  const normalized = Math.max(0, Number(timestamp) || 0);
  if (Math.abs(normalized - Math.round(normalized)) < 0.05) {
    return `${Math.round(normalized)}`;
  }
  return normalized.toFixed(1);
}

export function parseFfmpegDurationSeconds(output: string): number | null {
  const matched = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!matched) {
    return null;
  }

  const [, hours, minutes, seconds] = matched;
  const totalSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : null;
}

function parseShowinfoTimestamps(output: string) {
  const matches = output.matchAll(/pts_time:(\d+(?:\.\d+)?)/g);
  return Array.from(matches, (match) => Number(match[1])).filter((item) => Number.isFinite(item) && item >= 0);
}

export function getVideoAnalysisSamplingIntervalSeconds(durationSeconds: number) {
  const normalizedDuration = Math.max(0, Number(durationSeconds) || 0);
  return normalizedDuration >= LONG_VIDEO_THRESHOLD_SECONDS
    ? LONG_VIDEO_ANALYSIS_INTERVAL_SECONDS
    : SHORT_VIDEO_ANALYSIS_INTERVAL_SECONDS;
}

export function getVideoAnalysisFrameBudget(durationSeconds: number) {
  const normalizedDuration = Math.max(0.1, Number(durationSeconds) || 0.1);
  return Math.max(1, Math.ceil(normalizedDuration / getVideoAnalysisSamplingIntervalSeconds(normalizedDuration)));
}

async function extractSceneChangeFrames(
  ffmpegPath: string,
  videoPath: string,
  outputDir: string,
): Promise<{ frames: FrameData[]; durationSeconds: number | null }> {
  const { stderr = "" } = await execFileAsync(
    ffmpegPath,
    [
      "-hide_banner",
      "-y",
      "-i",
      videoPath,
      "-vf",
      `select='eq(n,0)+gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo,${SCALE_FILTER}`,
      "-vsync",
      "vfr",
      "-q:v",
      "5",
      join(outputDir, "frame_%04d.jpg"),
    ],
    { maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
  );

  const frameFiles = readdirSync(outputDir)
    .filter((fileName) => fileName.startsWith("frame_") && fileName.endsWith(".jpg"))
    .sort();
  const timestamps = parseShowinfoTimestamps(stderr);
  const durationSeconds = parseFfmpegDurationSeconds(stderr);

  return {
    frames: frameFiles.map((fileName, index) => ({
      base64: readFileSync(join(outputDir, fileName)).toString("base64"),
      timestamp: timestamps[index] ?? index,
      index,
    })),
    durationSeconds,
  };
}

async function extractLastFrame(
  ffmpegPath: string,
  videoPath: string,
  outputDir: string,
  durationSeconds: number,
): Promise<FrameData | null> {
  await execFileAsync(
    ffmpegPath,
    [
      "-hide_banner",
      "-y",
      "-sseof",
      `-${LAST_FRAME_SEEK_WINDOW_SECONDS}`,
      "-i",
      videoPath,
      "-vf",
      SCALE_FILTER,
      "-frames:v",
      "1",
      "-q:v",
      "5",
      join(outputDir, "frame_%04d.jpg"),
    ],
    { maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
  );

  const frameFiles = readdirSync(outputDir)
    .filter((fileName) => fileName.startsWith("frame_") && fileName.endsWith(".jpg"))
    .sort();
  const lastFile = frameFiles.at(-1);
  if (!lastFile) {
    return null;
  }

  return {
    base64: readFileSync(join(outputDir, lastFile)).toString("base64"),
    timestamp: Math.max(0, Number(durationSeconds) || 0),
    index: 0,
  };
}

function dedupeFramesByTimestamp(frames: FrameData[]): FrameData[] {
  const seen = new Set<string>();
  const deduped: FrameData[] = [];

  for (const frame of [...frames].sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)) {
    const key = frame.timestamp.toFixed(3);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...frame,
      index: deduped.length,
    });
  }

  return deduped;
}

/**
 * Extract scene-change keyframes from a video, always keeping the
 * first and last frame for temporal coverage. The final payload size
 * scales with video duration:
 * - under 3 minutes: target ~1 frame / 2 seconds
 * - 3 minutes or longer: target ~1 frame / 4 seconds
 */
export async function extractFrames(
  videoPath: string,
): Promise<{ allFrames: FrameData[]; sampledFrames: FrameData[] }> {
  const ffmpegPath = resolveFfmpegPath();
  const videoBase = basename(videoPath, extname(videoPath));
  const framesDir = join(dirname(videoPath), `_frames_${videoBase}`);
  const sceneFramesDir = join(framesDir, "scene");
  const boundaryFramesDir = join(framesDir, "boundary");
  mkdirSync(sceneFramesDir, { recursive: true });
  mkdirSync(boundaryFramesDir, { recursive: true });

  try {
    const { frames: sceneFrames, durationSeconds: detectedDurationSeconds } = await extractSceneChangeFrames(
      ffmpegPath,
      videoPath,
      sceneFramesDir,
    );
    const resolvedDurationSeconds = detectedDurationSeconds ?? sceneFrames.at(-1)?.timestamp ?? 0;
    const lastFrame =
      resolvedDurationSeconds > 0
        ? await extractLastFrame(ffmpegPath, videoPath, boundaryFramesDir, resolvedDurationSeconds).catch(() => null)
        : null;
    const allFrames = dedupeFramesByTimestamp(lastFrame ? [...sceneFrames, lastFrame] : sceneFrames);

    if (allFrames.length === 0) {
      throw new Error("未能从视频中提取有效关键帧");
    }

    const frameBudget = getVideoAnalysisFrameBudget(
      resolvedDurationSeconds > 0 ? resolvedDurationSeconds : (allFrames.at(-1)?.timestamp ?? allFrames.length),
    );
    const sampledFrames = sampleFrames(allFrames, frameBudget);

    return { allFrames, sampledFrames };
  } finally {
    try {
      rmSync(framesDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Evenly sample N frames from a larger scene-keyframe set, always
 * preserving the first and last frame for full temporal coverage.
 */
function sampleFrames(frames: FrameData[], maxCount: number): FrameData[] {
  if (frames.length <= maxCount) return frames;

  const sampled: FrameData[] = [frames[0]];
  const step = (frames.length - 1) / (maxCount - 1);
  for (let i = 1; i < maxCount - 1; i++) {
    sampled.push(frames[Math.round(i * step)]);
  }
  sampled.push(frames[frames.length - 1]);
  return sampled;
}

/**
 * Send extracted frames to the configured vision model for structured video analysis.
 * The system prompt is loaded from the constraint prompt store (tab 7: 视频分析).
 * Returns the raw JSON string of the analysis result.
 */
export async function analyzeVideoFrames(frames: FrameData[]): Promise<string> {
  const runtime = getVisionRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(
      `${runtime.providerLabel} 视觉分析当前未启用，请检查 ${runtime.configFileName} 中的 ${runtime.configHint} 是否已配置。`,
    );
  }

  const imageContent = frames.map((frame) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${frame.base64}`,
      detail: "low" as const,
    },
  }));

  const timeRange =
    frames.length > 1
      ? `第${formatFrameTimestamp(frames[0].timestamp)}秒到第${formatFrameTimestamp(frames[frames.length - 1].timestamp)}秒`
      : `第${formatFrameTimestamp(frames[0].timestamp)}秒`;

  const userContent: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `以下是从一段视频中按时间顺序提取并按片长规则采样的 ${frames.length} 个关键帧画面（覆盖${timeRange}）。请按照系统提示中的结构化格式，对该视频进行完整的镜头拆解和内容分析。`,
    },
    ...imageContent,
  ];

  const systemPrompt = getEffectiveConstraintPrompt("video_analysis");
  const responseFormat = buildVisionResponseFormat(runtime);

  const requestBody = JSON.stringify({
    model: runtime.modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
    max_completion_tokens: 8192,
    temperature: 0.2,
  });

  const requestHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${runtime.apiKey}`,
  };

  const url = `${runtime.apiBase}${runtime.chatEndpoint}`;

  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  const estimatedMetrics = estimateTextModelUsageMetrics({
    inputText: requestBody,
    maxOutputTokens: 8_192,
  });
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "video.analysis",
    estimatedMetrics,
  });

  let response: Response | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
      });

      if (response.status !== 429) break;

      const retryAfter = Number(response.headers.get("retry-after")) || 0;
      const waitSeconds = Math.max(retryAfter, 30) + attempt * 15;
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    }
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }

  if (!response || !response.ok) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    const errorText = response ? await response.text() : "no response";
    throw new VisionAnalysisRequestError(
      `视觉分析请求失败 (HTTP ${response?.status ?? "?"}): ${errorText.slice(0, 300)}`,
      {
        statusCode: response?.status ?? null,
        retryable: isRetryableHttpStatus(response?.status),
      },
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const finishReason = data.choices?.[0]?.finish_reason ?? null;
  const extractedJson =
    extractBestJsonObject(content, REQUIRED_TOP_LEVEL_FIELDS) ??
    (await repairAnalysisJsonContent({
      content,
      runtime,
      systemPrompt,
      requestHeaders,
      url,
    }));

  if (!extractedJson) {
    releaseCommercialModelUsageCharge(commercialCharge, "empty_result");
    if (finishReason === "length") {
      throw new Error("视觉分析输出被截断，未能形成完整 JSON");
    }
    throw new Error("视觉分析返回结果中未找到有效的 JSON 结构");
  }

  try {
    JSON.parse(extractedJson);
  } catch {
    releaseCommercialModelUsageCharge(commercialCharge, "invalid_result");
    throw new Error("视觉分析返回的 JSON 格式不合法");
  }

  confirmCommercialModelUsageCharge(commercialCharge, {
    pricingKey,
    serviceName: "video.analysis",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      inputTokens: Number(data.usage?.prompt_tokens ?? estimatedMetrics.inputTokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? estimatedMetrics.outputTokens ?? 0),
      cachedInputTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    },
    requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
    remark: "视频关键帧分析",
  });

  return extractedJson;
}
/**
 * Validate that the analysis JSON has all required top-level fields.
 */
export function validateAnalysisCompleteness(analysisJson: string): {
  valid: boolean;
  missingFields: string[];
} {
  try {
    const parsed = JSON.parse(analysisJson) as Record<string, unknown>;
    const missing = REQUIRED_TOP_LEVEL_FIELDS.filter((field) => !(field in parsed));
    return { valid: missing.length === 0, missingFields: missing };
  } catch {
    return { valid: false, missingFields: ["JSON格式不合法"] };
  }
}

/**
 * Attempt analysis with automatic retry on validation failure.
 * Accepts the sampled frames subset for the API call.
 */
export async function analyzeVideoWithRetry(
  frames: FrameData[],
  maxRetries: number = 1,
): Promise<{ analysis: string; framesUsed: number; retries: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const analysis = await analyzeVideoFrames(frames);
      const validation = validateAnalysisCompleteness(analysis);

      if (validation.valid || attempt === maxRetries) {
        return { analysis, framesUsed: frames.length, retries: attempt };
      }

      lastError = new Error(`分析结果缺少字段: ${validation.missingFields.join(", ")}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError instanceof VisionAnalysisRequestError && !lastError.retryable) {
        break;
      }
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("视频分析失败");
}
