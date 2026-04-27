import sharp from "sharp";

import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { getImageCleaningRuntime } from "./image-provider-config";
import { recordModelUsage } from "./model-usage-service";
import { withRetry } from "./retry";

const supportedImageSizes = [
  { value: "2048x2048", ratio: 1 },
  { value: "1664x2496", ratio: 1664 / 2496 },
  { value: "2496x1664", ratio: 2496 / 1664 },
  { value: "1600x2848", ratio: 1600 / 2848 },
  { value: "2848x1600", ratio: 2848 / 1600 },
] as const;

function normalizeApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
}

function buildDataUrl(contentType: string, bytes: Buffer) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function resolveCleaningSize(width: number | null, height: number | null) {
  if (!width || !height || width <= 0 || height <= 0) {
    return "1600x2848";
  }

  const ratio = width / height;
  return supportedImageSizes.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.ratio - ratio);
    const candidateDistance = Math.abs(candidate.ratio - ratio);
    return candidateDistance < bestDistance ? candidate : best;
  }).value;
}

async function detectResultMetadata(bytes: Buffer) {
  try {
    const metadata = await sharp(bytes).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    };
  } catch {
    return {
      width: null,
      height: null,
      format: null,
    };
  }
}

function getFormatExtension(format: string | null) {
  switch (format) {
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "jpeg":
    case "jpg":
      return "jpg";
    default:
      return "jpg";
  }
}

export async function cleanVideoMaterialImage(input: {
  materialId: string;
  sourceBytes: Buffer;
  sourceMimeType: string;
  width: number | null;
  height: number | null;
}) {
  const runtime = getImageCleaningRuntime();
  const prompt = getEffectiveConstraintPrompt("video_image_cleaning");
  const negativePrompt = getEffectiveConstraintPrompt("video_image_cleaning_negative");

  if (!runtime.liveEnabled) {
    const metadata = await detectResultMetadata(input.sourceBytes);
    return {
      bytes: input.sourceBytes,
      width: metadata.width,
      height: metadata.height,
      extension: getFormatExtension(metadata.format),
      providerLabel: `${runtime.providerLabel}（未启用，返回原图）`,
      modelId: runtime.modelId,
    };
  }

  const response = await withRetry(async () => {
    const requestResponse = await fetch(`${normalizeApiBase(runtime.apiBase)}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: runtime.modelId,
        prompt,
        negative_prompt: negativePrompt,
        image: buildDataUrl(input.sourceMimeType, input.sourceBytes),
        size: resolveCleaningSize(input.width, input.height),
        response_format: "url",
        stream: false,
        watermark: false,
      }),
    });

    const payload = (await requestResponse.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    if (!requestResponse.ok) {
      throw new Error(payload.error?.message ?? payload.message ?? "图片清洗失败");
    }

    const item = payload.data?.[0];
    if (!item) {
      throw new Error("图片清洗结果为空");
    }

    let bytes: Buffer;
    if (item.b64_json) {
      bytes = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const fileResponse = await fetch(item.url);
      if (!fileResponse.ok) {
        throw new Error(`图片清洗结果下载失败 (HTTP ${fileResponse.status})`);
      }
      bytes = Buffer.from(await fileResponse.arrayBuffer());
    } else {
      throw new Error("图片清洗结果缺少可下载内容");
    }

    return bytes;
  });

  const metadata = await detectResultMetadata(response);

  recordModelUsage({
    pricingKey: runtime.modelId.includes("seedream-5-0-lite") ? "doubao.seedream.5.0.lite" : null,
    serviceName: "image.clean",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      imageCount: 1,
      requestCount: 1,
    },
    requestId: crypto.randomUUID(),
    remark: `视频拆解图片清洗：${input.materialId}`,
  });

  return {
    bytes: response,
    width: metadata.width,
    height: metadata.height,
    extension: getFormatExtension(metadata.format),
    providerLabel: runtime.providerLabel,
    modelId: runtime.modelId,
  };
}
