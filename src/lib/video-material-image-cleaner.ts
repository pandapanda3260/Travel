import sharp from "sharp";

import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { resolveClosestImageGenerationSize } from "./image-generation-size-config";
import { getImageCleaningRuntime } from "./image-provider-config";
import { resolveLiangxinImageEditsEndpoint } from "./image-provider";
import {
  confirmCommercialModelUsageCharge,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";
import { withRetry } from "./retry";

function normalizeApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
}

function buildDataUrl(contentType: string, bytes: Buffer) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function resolveCleaningSize(width: number | null, height: number | null) {
  return resolveClosestImageGenerationSize(width, height);
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

async function fetchSeedreamCleaningResult(
  runtime: ReturnType<typeof getImageCleaningRuntime>,
  prompt: string,
  negativePrompt: string,
  sourceBytes: Buffer,
  sourceMimeType: string,
  size: string,
) {
  return fetch(`${normalizeApiBase(runtime.apiBase)}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.modelId,
      prompt,
      negative_prompt: negativePrompt,
      image: buildDataUrl(sourceMimeType, sourceBytes),
      size,
      response_format: "url",
      stream: false,
      watermark: false,
    }),
  });
}

async function fetchLiangxinCleaningResult(
  runtime: ReturnType<typeof getImageCleaningRuntime>,
  prompt: string,
  negativePrompt: string,
  sourceBytes: Buffer,
  sourceMimeType: string,
  size: string,
) {
  const combinedPrompt = negativePrompt
    ? `${prompt}\n\nAvoid: ${negativePrompt}`
    : prompt;
  const extension = sourceMimeType.includes("png") ? "png" : sourceMimeType.includes("webp") ? "webp" : "jpg";
  const formData = new FormData();
  formData.append("model", runtime.modelId);
  formData.append("prompt", combinedPrompt);
  formData.append("image", new Blob([new Uint8Array(sourceBytes)], { type: sourceMimeType }), `source.${extension}`);
  formData.append("size", size);
  formData.append("n", "1");
  if (runtime.quality) {
    formData.append("quality", runtime.quality);
  }

  return fetch(resolveLiangxinImageEditsEndpoint(runtime.apiBase), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: formData,
  });
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

  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "image.clean",
    estimatedMetrics: {
      imageCount: 1,
      requestCount: 1,
    },
  });

  try {
    const response = await withRetry(async () => {
      const size = resolveCleaningSize(input.width, input.height);
      const requestResponse =
        runtime.provider === "liangxin"
          ? await fetchLiangxinCleaningResult(runtime, prompt, negativePrompt, input.sourceBytes, input.sourceMimeType, size)
          : await fetchSeedreamCleaningResult(runtime, prompt, negativePrompt, input.sourceBytes, input.sourceMimeType, size);

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

    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
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
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }
}
