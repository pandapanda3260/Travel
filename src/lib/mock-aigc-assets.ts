import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { estimateNarrationReadingSeconds } from "./narration";
import { writeFetchResponseToPath } from "./file-stream";
import { joinRuntimePublicStoragePath, resolveRuntimeAssetUrlToPath } from "./runtime-storage";

const execFileAsync = promisify(execFile);

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseImageSize(size: string) {
  const matched = size.match(/^(\d+)x(\d+)$/);
  const width = matched ? Number(matched[1]) : 1024;
  const height = matched ? Number(matched[2]) : 1024;
  const longSide = Math.max(width, height);
  const scale = longSide > 1280 ? 1280 / longSide : 1;

  return {
    width: Math.max(512, Math.round(width * scale)),
    height: Math.max(512, Math.round(height * scale)),
  };
}

function buildPromptSnippet(prompt: string, index: number) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const snippet = Array.from(normalized).slice(0, 64).join("");
  return `${index + 1}. ${snippet || "Mock visual"}`;
}

function getMockImagePalette(index: number) {
  const palettes = [
    ["#0F2A43", "#2F8F9D", "#F6D860"],
    ["#332C39", "#5C5470", "#F7E9D7"],
    ["#173B45", "#4FA095", "#F6F5F5"],
    ["#2C3333", "#395B64", "#E7F6F2"],
    ["#2B3467", "#BAD7E9", "#FCFFE7"],
    ["#594545", "#815B5B", "#FFF8EA"],
  ] as const;

  return palettes[index % palettes.length];
}

function buildMockImageSvg(input: {
  prompt: string;
  width: number;
  height: number;
  index: number;
}) {
  const [bgStart, bgEnd, accent] = getMockImagePalette(input.index);
  const promptSnippet = escapeXml(buildPromptSnippet(input.prompt, input.index));
  const badge = escapeXml(`Mock Image ${input.index + 1}`);
  const aspect = escapeXml(`${input.width} × ${input.height}`);

  return `
    <svg width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgStart}" />
          <stop offset="100%" stop-color="${bgEnd}" />
        </linearGradient>
        <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.14)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0.05)" />
        </linearGradient>
      </defs>
      <rect width="${input.width}" height="${input.height}" fill="url(#bg)" />
      <circle cx="${Math.round(input.width * 0.18)}" cy="${Math.round(input.height * 0.16)}" r="${Math.round(input.width * 0.12)}" fill="${accent}" opacity="0.28" />
      <circle cx="${Math.round(input.width * 0.78)}" cy="${Math.round(input.height * 0.22)}" r="${Math.round(input.width * 0.1)}" fill="#FFFFFF" opacity="0.08" />
      <rect x="${Math.round(input.width * 0.08)}" y="${Math.round(input.height * 0.1)}" width="${Math.round(input.width * 0.84)}" height="${Math.round(input.height * 0.8)}" rx="28" fill="url(#card)" stroke="rgba(255,255,255,0.16)" />
      <text x="${Math.round(input.width * 0.12)}" y="${Math.round(input.height * 0.2)}" fill="#FFFFFF" font-size="${Math.round(input.width * 0.04)}" font-family="Arial, sans-serif" font-weight="700">${badge}</text>
      <text x="${Math.round(input.width * 0.12)}" y="${Math.round(input.height * 0.32)}" fill="#F8FBFF" font-size="${Math.round(input.width * 0.072)}" font-family="Arial, sans-serif" font-weight="700">AIGC Placeholder</text>
      <foreignObject x="${Math.round(input.width * 0.12)}" y="${Math.round(input.height * 0.4)}" width="${Math.round(input.width * 0.76)}" height="${Math.round(input.height * 0.28)}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="color:#F8FBFF;font-size:${Math.round(input.width * 0.038)}px;line-height:1.45;font-family:Arial,sans-serif;word-break:break-word;">
          ${promptSnippet}
        </div>
      </foreignObject>
      <text x="${Math.round(input.width * 0.12)}" y="${Math.round(input.height * 0.84)}" fill="rgba(255,255,255,0.82)" font-size="${Math.round(input.width * 0.034)}" font-family="Arial, sans-serif">${aspect}</text>
    </svg>
  `.trim();
}

export async function createMockImageResults(input: {
  prompt: string;
  size: string;
  outputCount: number;
}) {
  const { width, height } = parseImageSize(input.size);
  const total = Math.max(1, Math.min(10, input.outputCount));

  return Promise.all(
    Array.from({ length: total }, async (_, index) => {
      const svg = buildMockImageSvg({
        prompt: input.prompt,
        width,
        height,
        index,
      });
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      return {
        url: null,
        b64Json: png.toString("base64"),
      };
    }),
  );
}

function splitNarrationTokens(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  return normalized.match(/[A-Za-z0-9]+|[\u4E00-\u9FFF]|[^\s]/g) ?? Array.from(normalized);
}

function buildWaveHeader(dataByteLength: number, sampleRate: number) {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataByteLength, 40);
  return buffer;
}

function buildSilentWave(durationSeconds: number, sampleRate: number) {
  const sampleCount = Math.max(1, Math.round(durationSeconds * sampleRate));
  const data = Buffer.alloc(sampleCount * 2);
  return Buffer.concat([buildWaveHeader(data.byteLength, sampleRate), data]);
}

export async function createMockSpeechResult(input: {
  text: string;
  taskId?: string | null;
  sampleRate?: number;
}) {
  const outputDir = joinRuntimePublicStoragePath("generated-audio", input.taskId?.trim() || "_unassigned", "narration");
  mkdirSync(outputDir, { recursive: true });

  const sampleRate = Math.max(8_000, Math.min(48_000, input.sampleRate ?? 24_000));
  const estimatedSeconds = estimateNarrationReadingSeconds(input.text);
  const durationSeconds = Math.max(1.2, Number(estimatedSeconds.toFixed(2)));
  const fileName = `${crypto.randomUUID()}.wav`;
  const absolutePath = join(outputDir, fileName);
  writeFileSync(absolutePath, buildSilentWave(durationSeconds, sampleRate));

  const tokens = splitNarrationTokens(input.text);
  const fallbackToken = tokens.length === 0 ? ["..."] : tokens;
  const sliceDuration = durationSeconds / fallbackToken.length;
  const words = fallbackToken.map((token, index) => ({
    word: token,
    startTime: Number((index * sliceDuration).toFixed(3)),
    endTime: Number(Math.min(durationSeconds, (index + 1) * sliceDuration).toFixed(3)),
  }));

  return {
    audioUrl: `/generated-audio/${input.taskId?.trim() || "_unassigned"}/narration/${fileName}`,
    audioDurationSeconds: durationSeconds,
    words,
    usageTextWords: fallbackToken.length,
  };
}

function getVideoCanvasSize(aspectRatio: "16:9" | "9:16" | "1:1") {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1280, height: 720 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "9:16":
    default:
      return { width: 720, height: 1280 };
  }
}

function parseDataUrl(input: string) {
  const matched = input.match(/^data:(.+?);base64,(.+)$/);
  if (!matched) {
    throw new Error("图片数据格式无效");
  }

  const mimeType = matched[1];
  const bytes = Buffer.from(matched[2], "base64");
  const extension =
    mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : mimeType.includes("webp")
        ? "webp"
        : "png";

  return { bytes, extension };
}

export async function createMockVideoFromImage(input: {
  taskId?: string | null;
  jobId: string;
  sourceImageDataUrl: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
}) {
  const outputDir = joinRuntimePublicStoragePath("generated-videos", input.taskId?.trim() || "_unassigned");
  mkdirSync(outputDir, { recursive: true });
  const tempDir = join(outputDir, ".mock");
  mkdirSync(tempDir, { recursive: true });

  const { bytes, extension } = parseDataUrl(input.sourceImageDataUrl);
  const sourcePath = join(tempDir, `${input.jobId}.${extension}`);
  writeFileSync(sourcePath, bytes);

  const outputPath = join(outputDir, `${input.jobId}.mp4`);
  const { width, height } = getVideoCanvasSize(input.aspectRatio);
  const ffmpegPath = getFfmpegBinaryPath();

  await execFileAsync(ffmpegPath, [
    "-y",
    "-loop",
    "1",
    "-i",
    sourcePath,
    "-t",
    String(Math.max(1, input.durationSeconds)),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
    "-r",
    "24",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);

  return {
    videoUrl: `/generated-videos/${input.taskId?.trim() || "_unassigned"}/${input.jobId}.mp4`,
    resolvedDurationSeconds: Math.max(1, input.durationSeconds),
  };
}

export async function createMockLipSyncVideo(input: {
  taskId?: string | null;
  jobId: string;
  sourceVideoUrl: string;
}) {
  const outputDir = joinRuntimePublicStoragePath("generated-videos", input.taskId?.trim() || "_unassigned");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${input.jobId}.mp4`);

  if (input.sourceVideoUrl.startsWith("/")) {
    copyFileSync(resolveRuntimeAssetUrlToPath(input.sourceVideoUrl), outputPath);
  } else {
    const response = await fetch(input.sourceVideoUrl);
    if (!response.ok) {
      throw new Error("Mock 口型同步视频复制失败");
    }
    await writeFetchResponseToPath(response, outputPath);
  }

  return {
    videoUrl: `/generated-videos/${input.taskId?.trim() || "_unassigned"}/${input.jobId}.mp4`,
  };
}
