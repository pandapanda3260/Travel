import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { getVisionRuntime } from "./vision-provider-config";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;
  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }
  return runtimePath;
}

export type FrameData = {
  base64: string;
  timestamp: number;
  index: number;
};

const MAX_FRAMES_FOR_API = 20;

/**
 * Extract frames from a video at 1fps, scaled to 512px.
 * If the video produces more than MAX_FRAMES_FOR_API frames,
 * we evenly sample to stay within GPT-4o's TPM rate limit
 * while preserving full temporal coverage.
 */
export async function extractFrames(
  videoPath: string,
): Promise<{ allFrames: FrameData[]; sampledFrames: FrameData[] }> {
  const ffmpegPath = resolveFfmpegPath();
  const videoBase = basename(videoPath, extname(videoPath));
  const framesDir = join(dirname(videoPath), `_frames_${videoBase}`);
  mkdirSync(framesDir, { recursive: true });

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i", videoPath,
      "-vf", "fps=1,scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'",
      "-q:v", "5",
      join(framesDir, "frame_%04d.jpg"),
    ]);

    const frameFiles = readdirSync(framesDir)
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    const allFrames = frameFiles.map((f, i) => ({
      base64: readFileSync(join(framesDir, f)).toString("base64"),
      timestamp: i + 1,
      index: i,
    }));

    const sampledFrames = sampleFrames(allFrames, MAX_FRAMES_FOR_API);

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
 * Evenly sample N frames from a larger set, always including
 * the first and last frame for full temporal coverage.
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
 * Send extracted frames to GPT-4o for structured video analysis.
 * The system prompt is loaded from the constraint prompt store (tab 7: 视频分析).
 * Returns the raw JSON string of the analysis result.
 */
export async function analyzeVideoFrames(frames: FrameData[]): Promise<string> {
  const runtime = getVisionRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(
      `${runtime.providerLabel} 视觉分析当前未启用，请检查 ${runtime.configFileName} 中的 OPENAI_VISION_API_KEY 是否已配置。`,
    );
  }

  const imageContent = frames.map((frame) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${frame.base64}`,
      detail: "low" as const,
    },
  }));

  const timeRange = frames.length > 1
    ? `第${frames[0].timestamp}秒到第${frames[frames.length - 1].timestamp}秒`
    : `第${frames[0].timestamp}秒`;

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `以下是从一段视频中按时间顺序均匀采样的 ${frames.length} 帧画面（覆盖${timeRange}）。请按照系统提示中的结构化格式，对该视频进行完整的镜头拆解和内容分析。`,
    },
    ...imageContent,
  ];

  const systemPrompt = getEffectiveConstraintPrompt("video_analysis");

  const requestBody = JSON.stringify({
    model: runtime.modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_completion_tokens: 8192,
    temperature: 0.2,
  });

  const requestHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${runtime.apiKey}`,
  };

  const url = `${runtime.apiBase}${runtime.chatEndpoint}`;

  let response: Response | null = null;
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

  if (!response || !response.ok) {
    const errorText = response ? await response.text() : "no response";
    throw new Error(
      `视觉分析请求失败 (HTTP ${response?.status ?? "?"}): ${errorText.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("视觉分析返回结果中未找到有效的 JSON 结构");
  }

  try {
    JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("视觉分析返回的 JSON 格式不合法");
  }

  return jsonMatch[0];
}

const REQUIRED_TOP_LEVEL_FIELDS = [
  "视频级信息",
  "开篇设计",
  "镜头序列",
  "结尾设计",
  "商品与卖点",
  "全局视觉规则",
  "Prompt生成指令",
];

/**
 * Validate that the analysis JSON has all required top-level fields.
 */
export function validateAnalysisCompleteness(analysisJson: string): {
  valid: boolean;
  missingFields: string[];
} {
  try {
    const parsed = JSON.parse(analysisJson) as Record<string, unknown>;
    const missing = REQUIRED_TOP_LEVEL_FIELDS.filter(
      (field) => !(field in parsed),
    );
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

      lastError = new Error(
        `分析结果缺少字段: ${validation.missingFields.join(", ")}`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("视频分析失败");
}
