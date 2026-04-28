import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { loadOptionalEnvFile, parseBoolean } from "./env-file";
import { assertModelUsagePreflight, recordModelUsage, resolveDefaultModelPricingKey } from "./model-usage-service";

type ProductArchiveVisionRuntime = {
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
};

export type ProductArchiveVisionResult = {
  rawText: string;
  summaryTitle: string;
  packagePersonCount: string;
  tags: string[];
  sellingPoints: string[];
};

type VisionChunkInput = {
  imageDataUrl: string;
  prompt?: string;
};

function normalizeComparableText(value: string) {
  return value.replace(/[\s，。、“”‘’`~!@#$%^&*()+=[\]{}<>《》？?！!：:；;、,./\\|_-]+/g, "").toLowerCase();
}

function isLikelyDuplicateLine(left: string, right: string) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  if (shorter.length >= 6 && longer.includes(shorter)) {
    return true;
  }

  return false;
}

function getVisionRuntime(): ProductArchiveVisionRuntime {
  const localConfig = loadOptionalEnvFile("text.env.local");
  const apiKey =
    process.env.VOLCENGINE_TEXT_API_KEY ??
    localConfig.VOLCENGINE_TEXT_API_KEY ??
    process.env.ARK_API_KEY ??
    localConfig.ARK_API_KEY ??
    "";
  const apiBase =
    process.env.VOLCENGINE_TEXT_API_BASE ??
    localConfig.VOLCENGINE_TEXT_API_BASE ??
    "https://ark.cn-beijing.volces.com";
  const modelId =
    process.env.VOLCENGINE_PRODUCT_VISION_MODEL ??
    localConfig.VOLCENGINE_PRODUCT_VISION_MODEL ??
    "doubao-1-5-vision-pro-32k-250115";
  const liveEnabled = parseBoolean(process.env.VOLCENGINE_TEXT_LIVE_ENABLED ?? localConfig.VOLCENGINE_TEXT_LIVE_ENABLED, false);

  return {
    liveEnabled: liveEnabled && Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    apiBase,
    apiKey,
    modelId,
    providerLabel: "火山引擎",
  };
}

function normalizeApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
}

function stripCodeFence(content: string) {
  const normalized = content.trim();
  if (normalized.startsWith("```")) {
    return normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return normalized;
}

function buildFallbackResult(): ProductArchiveVisionResult {
  return {
    rawText: "",
    summaryTitle: "",
    packagePersonCount: "",
    tags: [],
    sellingPoints: [],
  };
}

function parseResult(content: string): ProductArchiveVisionResult {
  const parsed = JSON.parse(stripCodeFence(content)) as Partial<ProductArchiveVisionResult>;
  return {
    rawText: parsed.rawText?.trim() ?? "",
    summaryTitle: parsed.summaryTitle?.trim() ?? "",
    packagePersonCount: parsed.packagePersonCount?.trim() ?? "",
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [],
    sellingPoints: Array.isArray(parsed.sellingPoints)
      ? parsed.sellingPoints.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
      : [],
  };
}

function dedupeLines(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const uniqueLines: string[] = [];

  for (const line of lines) {
    if (!uniqueLines.length) {
      uniqueLines.push(line);
      continue;
    }

    const lastLine = uniqueLines.at(-1) ?? "";
    if (isLikelyDuplicateLine(lastLine, line)) {
      if (normalizeComparableText(line).length > normalizeComparableText(lastLine).length) {
        uniqueLines[uniqueLines.length - 1] = line;
      }
      continue;
    }

    const duplicateIndex = uniqueLines.findIndex((existing) => isLikelyDuplicateLine(existing, line));
    if (duplicateIndex >= 0) {
      if (normalizeComparableText(line).length > normalizeComparableText(uniqueLines[duplicateIndex]).length) {
        uniqueLines[duplicateIndex] = line;
      }
      continue;
    }

    uniqueLines.push(line);
  }

  return uniqueLines.join("\n");
}

function mergeVisionResults(results: ProductArchiveVisionResult[]) {
  if (!results.length) {
    return buildFallbackResult();
  }

  return {
    rawText: dedupeLines(results.map((item) => item.rawText).filter(Boolean).join("\n")),
    summaryTitle: results.find((item) => item.summaryTitle)?.summaryTitle ?? "",
    packagePersonCount: [...results]
      .sort((left, right) => right.packagePersonCount.length - left.packagePersonCount.length)
      .find((item) => item.packagePersonCount)?.packagePersonCount ?? "",
    tags: Array.from(new Set(results.flatMap((item) => item.tags))).slice(0, 12),
    sellingPoints: Array.from(new Set(results.flatMap((item) => item.sellingPoints))).slice(0, 12),
  };
}

export function getProductArchiveVisionProviderMeta() {
  const runtime = getVisionRuntime();
  return {
    providerLabel: runtime.providerLabel,
    modelId: runtime.modelId,
    apiBase: runtime.apiBase,
    liveEnabled: runtime.liveEnabled,
  };
}

export async function extractProductArchiveFromImageDataUrl(imageDataUrl: string, prompt?: string): Promise<ProductArchiveVisionResult> {
  const runtime = getVisionRuntime();
  if (!runtime.liveEnabled) {
    throw new Error("未配置商品图片解析所需的火山方舟视觉模型凭证。");
  }

  const systemContent = getEffectiveConstraintPrompt("product_vision");
  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "vision.product_archive",
  });

  const response = await fetch(`${normalizeApiBase(runtime.apiBase)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.modelId,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt ?? "请识别这张商品图片中的文字和关键信息，并按指定 JSON 返回。",
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "商品图片解析失败");
  }

  recordModelUsage({
    pricingKey,
    serviceName: "vision.product_archive",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
      outputTokens: Number(payload.usage?.completion_tokens ?? 0),
      cachedInputTokens: Number(payload.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    },
    requestId: response.headers.get("x-request-id") ?? crypto.randomUUID(),
    remark: "商品档案图片解析",
  });

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return buildFallbackResult();
  }

  return parseResult(content);
}

export async function extractProductArchiveFromImageChunks(chunks: VisionChunkInput[]) {
  if (!chunks.length) {
    return buildFallbackResult();
  }

  const results: ProductArchiveVisionResult[] = [];
  for (const chunk of chunks) {
    results.push(await extractProductArchiveFromImageDataUrl(chunk.imageDataUrl, chunk.prompt));
  }

  return mergeVisionResults(results);
}
