import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import {
  getImageGenerationOutputFormat,
  getImageGenerationSizeCandidates,
  normalizeImageGenerationSizeForProvider,
} from "./image-generation-size-config";
import { getImageGenerationRuntime, type ImageGenerationRuntime } from "./image-provider-config";
import { createMockImageResults } from "./mock-aigc-assets";
import {
  confirmCommercialModelUsageCharge,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
  resolveDefaultModelPricingKey,
} from "./model-usage-service";
import { withRetry } from "./retry";
import { callTaskGenerationLlm } from "./task-generation-runtime";

export type ImageGenerationRequest = {
  prompt: string;
  size: string;
  guidanceScale: number;
  watermark: boolean;
  seed: number | null;
  outputCount?: number;
  referenceImageDataUrl?: string | null;
  runtimeOverride?: ImageGenerationRuntime;
};

export type ImageGenerationResult = {
  url: string | null;
  b64Json: string | null;
};

type ProviderRequestError = Error & { retryable?: boolean };

export const SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE =
  "图片生成触发安全拦截，系统已自动降敏重试仍失败，请手动上传图片";

function normalizeApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
}

function resolveLiangxinImageGenerationEndpoint(apiBase: string) {
  const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(normalizedApiBase)) {
    return normalizedApiBase;
  }
  if (/\/(?:v1|api\/v3)$/i.test(normalizedApiBase)) {
    return `${normalizedApiBase}/images/generations`;
  }
  return `${normalizedApiBase}/v1/images/generations`;
}

export function resolveLiangxinImageEditsEndpoint(apiBase: string) {
  const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
  if (/\/images\/edits$/i.test(normalizedApiBase)) {
    return normalizedApiBase;
  }
  if (/\/(?:v1|api\/v3)$/i.test(normalizedApiBase)) {
    return `${normalizedApiBase}/images/edits`;
  }
  return `${normalizedApiBase}/v1/images/edits`;
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { mimeType: "image/jpeg", bytes: Buffer.from(dataUrl, "base64") };
  }
  return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
}

const IMAGE_POSITIVE_SUFFIX =
  "photorealistic, real photograph, shot on DSLR camera, natural lighting, single continuous image, realistic perspective and proportions, natural human anatomy, realistic limb count, no extra or missing arms, legs, hands or feet";

const IMAGE_NEGATIVE_PROMPT = [
  "text, letters, numbers, words, watermark, logo, signage text, caption, subtitle",
  "collage, split screen, multi-panel, grid, side by side, montage, diptych, triptych, multiple frames, border, picture frame",
  "rotated scene, rotated 90 degrees, sideways composition, turned sideways, tilted horizon, horizontal scene squeezed into portrait frame, landscape content inside portrait canvas, landscape photo rotated into portrait frame, vertical scene squeezed into landscape frame",
  "cartoon, anime, illustration, painting, sketch, drawing, CG render, 3D render, digital art, comic, manga",
  "deformed face, distorted hands, extra fingers, extra limbs, extra arms, extra hands, extra legs, extra feet, third hand, third arm, missing limbs, fused fingers, mutated hands, duplicate limbs, broken anatomy, malformed body",
  "extra people, wrong number of people, duplicate person, clone",
  "blurry, low resolution, pixelated, overexposed, underexposed, oversaturated",
  "unrealistic proportions, physically impossible, floating objects, gravity defying",
].join(", ");

function parseRequestedSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { width: 0, height: 0 };
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function normalizeSizeForLiangxin(runtime: ImageGenerationRuntime, size: string) {
  return normalizeImageGenerationSizeForProvider(size, runtime.provider, runtime.modelId);
}

function isUnsupportedImageSizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /size|resolution|dimension|width|height|unsupported|invalid|尺寸|分辨率|宽高|大小/i.test(message);
}

function buildProviderRequestError(status: number, message: string): ProviderRequestError {
  const error = new Error(message) as ProviderRequestError;
  if (status >= 400 && status < 500 && status !== 429) {
    error.retryable = false;
  }
  return error;
}

async function runWithLiangxinImageSizeFallback<T>(
  runtime: ImageGenerationRuntime,
  requestedSize: string,
  action: (size: string) => Promise<T>,
) {
  const sizeCandidates = getImageGenerationSizeCandidates({
    requestedSize,
    provider: runtime.provider,
    modelId: runtime.modelId,
  });
  let lastError: unknown = null;

  for (const [index, size] of sizeCandidates.entries()) {
    try {
      return await action(size);
    } catch (error) {
      lastError = error;
      const canTryNext = index < sizeCandidates.length - 1 && isUnsupportedImageSizeError(error);
      if (!canTryNext) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("图片生成尺寸降级后仍失败");
}

function buildOrientationGuardClause(size: string, includeOrientationLabel = true) {
  const { width, height } = parseRequestedSize(size);

  if (!width || !height) {
    return includeOrientationLabel
      ? "竖构图9:16，portrait orientation，画面内容必须天然竖向拍摄和竖向观看，主体与地平线保持正常方向，不要横图内容塞进竖版画布，不要把横版照片旋转90度，不要画面横着或侧着"
      : "画面内容必须天然竖向拍摄和竖向观看，主体与地平线保持正常方向，不要横图内容塞进竖版画布，不要把横版照片旋转90度，不要画面横着或侧着";
  }

  if (width === height) {
    return includeOrientationLabel
      ? "方构图1:1，square composition，主体必须完整适配方图画幅，不要把横图或竖图内容硬塞进方图画布"
      : "主体必须完整适配方图画幅，不要把横图或竖图内容硬塞进方图画布";
  }

  if (width > height) {
    return includeOrientationLabel
      ? "横构图16:9，landscape orientation，画面内容必须天然横向拍摄和横向观看，主体与地平线保持正常方向，不要把竖图内容硬塞进横版画布，不要把竖版照片旋转90度，不要画面侧着"
      : "画面内容必须天然横向拍摄和横向观看，主体与地平线保持正常方向，不要把竖图内容硬塞进横版画布，不要把竖版照片旋转90度，不要画面侧着";
  }

  return includeOrientationLabel
    ? "竖构图9:16，portrait orientation，画面内容必须天然竖向拍摄和竖向观看，主体与地平线保持正常方向，不要横图内容塞进竖版画布，不要把横版照片旋转90度，不要画面横着或侧着"
    : "画面内容必须天然竖向拍摄和竖向观看，主体与地平线保持正常方向，不要横图内容塞进竖版画布，不要把横版照片旋转90度，不要画面横着或侧着";
}

const IMAGE_TEXT_AND_LAYOUT_GUARD_CLAUSE =
  "no text, no letters, no words, no numbers, no watermark, no logo, no signage text, no caption, no subtitle, no collage, no split screen, single continuous image";

function appendUniqueClause(baseText: string, clause: string) {
  const normalizedBase = normalizePromptWhitespace(baseText);
  const normalizedClause = normalizePromptWhitespace(clause);
  if (!normalizedClause) {
    return normalizedBase;
  }

  const compactBase = normalizedBase.replace(/[，。；,\s]+/g, "").toLowerCase();
  const compactClause = normalizedClause.replace(/[，。；,\s]+/g, "").toLowerCase();
  if (compactBase.includes(compactClause)) {
    return normalizedBase;
  }

  if (!normalizedBase) {
    return normalizedClause;
  }

  return normalizePromptWhitespace(`${normalizedBase}，${normalizedClause}`);
}

export function applyImagePromptHardRequirements(prompt: string, size: string) {
  let result = normalizePromptWhitespace(prompt);
  const compactPrompt = result.replace(/[，。；,\s]+/g, "").toLowerCase();
  const orientationAlreadyPresent =
    compactPrompt.includes("竖构图9:16") ||
    compactPrompt.includes("横构图16:9") ||
    compactPrompt.includes("方构图1:1") ||
    compactPrompt.includes("portraitorientation") ||
    compactPrompt.includes("landscapeorientation") ||
    compactPrompt.includes("squarecomposition");
  result = appendUniqueClause(result, buildOrientationGuardClause(size, !orientationAlreadyPresent));
  result = appendUniqueClause(result, IMAGE_TEXT_AND_LAYOUT_GUARD_CLAUSE);
  return result;
}

function enhancePromptWithDetailPreset(prompt: string, guidanceScale: number) {
  const override = getEffectiveConstraintPrompt("image_enhancement");
  const lines = override
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const high = lines[0] || "强化主体细节、材质质感、光影层次和高级美感，避免模糊、塌陷和低质纹理。";
  const mid = lines[1] || "保持构图稳定、细节完整和画面自然，兼顾真实度与美观度。";
  const low = lines[2] || "整体风格自然写实，避免过度锐化、过度饱和和夸张变形。";

  const base = prompt.includes("photorealistic") ? prompt : `${prompt}, ${IMAGE_POSITIVE_SUFFIX}`;

  if (guidanceScale >= 8.5) {
    return `${base}\n\n补充要求：${high}`;
  }

  if (guidanceScale >= 7.5) {
    return `${base}\n\n补充要求：${mid}`;
  }

  return `${base}\n\n补充要求：${low}`;
}

const imagePromptSensitiveReplacements: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /天安门广场|天安门/giu, replacement: "首都城市中心地标广场" },
  { pattern: /升旗仪式|升旗/giu, replacement: "清晨广场仪式感场景" },
  { pattern: /故宫博物院|故宫/giu, replacement: "皇家宫殿建筑群" },
  { pattern: /祈年殿|天坛/giu, replacement: "古代坛庙建筑" },
  { pattern: /圆明园遗址公园|圆明园/giu, replacement: "皇家园林遗址" },
  { pattern: /清华北大|清华大学|北京大学|清华|北大/giu, replacement: "知名高校门口" },
  { pattern: /国家博物馆|军事博物馆|国博|军博/giu, replacement: "大型博物馆" },
];

const aggressiveSensitiveReplacements: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /首都城市中心地标广场/giu, replacement: "城市中心开阔广场" },
  { pattern: /清晨广场仪式感场景/giu, replacement: "清晨广场人群场景" },
  { pattern: /皇家宫殿建筑群/giu, replacement: "古典宫殿建筑群" },
  { pattern: /古代坛庙建筑/giu, replacement: "古典礼制建筑" },
  { pattern: /皇家园林遗址/giu, replacement: "古典园林遗址" },
  { pattern: /知名高校门口/giu, replacement: "学院风校门外景" },
];

const IMAGE_SENSITIVE_REWRITE_SYSTEM_PROMPT = [
  "你是一名图片生成提示词安全改写助手。",
  "请把输入的中文生图提示词改写成更容易通过图片模型安全审核的版本。",
  "只输出一段纯文本提示词，不要解释，不要 markdown。",
  "要求：",
  "1. 保留原本的构图、人物关系、旅行氛围、光影、镜头感和纪实质感。",
  "2. 不要出现具体政治公共事件、敏感公共场所、具体机构全名或过于敏感的地标名称。",
  "3. 可用更泛化的描述替代，如“城市中心广场”“古典宫殿建筑群”“知名高校门口”。",
  "4. 不要改成抽象空话，仍要保证画面可以直接生成。",
].join("\n");

function normalizePromptWhitespace(prompt: string) {
  return prompt
    .replace(/\s+/g, " ")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .trim();
}

function dedupePromptClauses(prompt: string) {
  const rawClauses = prompt
    .split(/(?<=[，。])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const clause of rawClauses) {
    const normalized = clause.replace(/[，。]/g, "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(clause);
  }

  return deduped.join(" ").trim();
}

function sanitizeImagePromptForModeration(prompt: string, aggressive = false) {
  let result = normalizePromptWhitespace(prompt);
  result = result.replace(/(?:竖屏9:16[，,\s]*){2,}/giu, "竖屏9:16，");

  for (const replacement of imagePromptSensitiveReplacements) {
    result = result.replace(replacement.pattern, replacement.replacement);
  }

  if (aggressive) {
    for (const replacement of aggressiveSensitiveReplacements) {
      result = result.replace(replacement.pattern, replacement.replacement);
    }
  }

  return normalizePromptWhitespace(dedupePromptClauses(result));
}

function isSensitivePromptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /sensitive information|敏感|安全拦截|审核/i.test(message);
}

async function rewriteSensitiveImagePrompt(prompt: string) {
  const deterministicPrompt = sanitizeImagePromptForModeration(prompt, true);

  try {
    const rewritten = await callTaskGenerationLlm({
      systemPrompt: IMAGE_SENSITIVE_REWRITE_SYSTEM_PROMPT,
      userContent: deterministicPrompt,
      temperature: 0.2,
      maxCompletionTokens: 1200,
    });

    if (!rewritten?.trim()) {
      return deterministicPrompt;
    }

    return sanitizeImagePromptForModeration(rewritten, true);
  } catch {
    return deterministicPrompt;
  }
}

async function requestSingleSeedreamImage(
  apiBase: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  negativePrompt: string,
  size: string,
  watermark: boolean,
  referenceImageDataUrl?: string | null,
) {
  return withRetry(async () => {
    const response = await fetch(`${normalizeApiBase(apiBase)}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        prompt,
        negative_prompt: negativePrompt,
        ...(referenceImageDataUrl ? { image: referenceImageDataUrl } : {}),
        size,
        response_format: "url",
        stream: false,
        watermark,
        optimize_prompt_options: {
          mode: "standard",
        },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    if (!response.ok) {
      throw buildProviderRequestError(response.status, payload.error?.message ?? payload.message ?? "图片生成失败");
    }

    const item = payload.data?.[0];
    if (!item) {
      throw new Error("图片生成结果为空");
    }

    return {
      url: item.url ?? null,
      b64Json: item.b64_json ?? null,
    } satisfies ImageGenerationResult;
  });
}

async function requestLiangxinImages(
  runtime: ImageGenerationRuntime,
  prompt: string,
  size: string,
  outputCount: number,
) {
  return runWithLiangxinImageSizeFallback(runtime, size, (requestSize) => withRetry(async () => {
    const outputFormat = getImageGenerationOutputFormat(runtime.provider, runtime.modelId);
    const response = await fetch(resolveLiangxinImageGenerationEndpoint(runtime.apiBase), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: runtime.modelId,
        prompt,
        size: normalizeSizeForLiangxin(runtime, requestSize),
        n: outputCount,
        ...(outputFormat ? { output_format: outputFormat } : {}),
        ...(runtime.quality ? { quality: runtime.quality } : {}),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
      data?: Array<{ url?: string; b64_json?: string; b64Json?: string }>;
      images?: Array<{ url?: string; b64_json?: string; b64Json?: string }>;
    };

    if (!response.ok) {
      throw buildProviderRequestError(response.status, payload.error?.message ?? payload.message ?? "图片生成失败");
    }

    const items = payload.data ?? payload.images ?? [];
    const results = items
      .map((item) => ({
        url: item.url ?? null,
        b64Json: item.b64_json ?? item.b64Json ?? null,
      }))
      .filter((item) => item.url || item.b64Json);

    if (!results.length) {
      throw new Error("图片生成结果为空");
    }

    return results.slice(0, outputCount) satisfies ImageGenerationResult[];
  }));
}

async function requestLiangxinImageEdits(
  runtime: ImageGenerationRuntime,
  prompt: string,
  size: string,
  outputCount: number,
  referenceImageDataUrl: string,
) {
  return runWithLiangxinImageSizeFallback(runtime, size, (requestSize) => withRetry(async () => {
    const { mimeType, bytes } = parseDataUrl(referenceImageDataUrl);
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const formData = new FormData();
    formData.append("model", runtime.modelId);
    formData.append("prompt", prompt);
    formData.append("image", new Blob([new Uint8Array(bytes)], { type: mimeType }), `reference.${extension}`);
    formData.append("size", normalizeSizeForLiangxin(runtime, requestSize));
    formData.append("n", String(outputCount));
    if (runtime.quality) {
      formData.append("quality", runtime.quality);
    }

    const response = await fetch(resolveLiangxinImageEditsEndpoint(runtime.apiBase), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: formData,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
      data?: Array<{ url?: string; b64_json?: string; b64Json?: string }>;
      images?: Array<{ url?: string; b64_json?: string; b64Json?: string }>;
    };

    if (!response.ok) {
      throw buildProviderRequestError(response.status, payload.error?.message ?? payload.message ?? "图片编辑失败");
    }

    const items = payload.data ?? payload.images ?? [];
    const results = items
      .map((item) => ({
        url: item.url ?? null,
        b64Json: item.b64_json ?? item.b64Json ?? null,
      }))
      .filter((item) => item.url || item.b64Json);

    if (!results.length) {
      throw new Error("图片编辑结果为空");
    }

    return results.slice(0, outputCount) satisfies ImageGenerationResult[];
  }));
}

export async function generateSeedreamImages(input: ImageGenerationRequest) {
  const runtime = input.runtimeOverride ?? getImageGenerationRuntime();

  if (!runtime.liveEnabled) {
    return createMockImageResults({
      prompt: input.prompt,
      size: input.size,
      outputCount: input.outputCount ?? 4,
    });
  }

  const hardenedPrompt = applyImagePromptHardRequirements(input.prompt, input.size);
  const enhancedPrompt = enhancePromptWithDetailPreset(hardenedPrompt, input.guidanceScale);
  const sanitizedPrompt = sanitizeImagePromptForModeration(enhancedPrompt);
  const outputCount = Math.max(1, Math.min(10, input.outputCount ?? 4));
  const pricingKey = resolveDefaultModelPricingKey(runtime.modelId);
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "image.generate",
    estimatedMetrics: {
      imageCount: outputCount,
      requestCount: 1,
    },
  });
  const requestBatch =
    runtime.provider === "liangxin"
      ? (prompt: string) =>
          input.referenceImageDataUrl
            ? requestLiangxinImageEdits(runtime, prompt, input.size, outputCount, input.referenceImageDataUrl)
            : requestLiangxinImages(runtime, prompt, input.size, outputCount)
      : (prompt: string) =>
          Promise.all(
            Array.from({ length: outputCount }, () =>
              requestSingleSeedreamImage(
                runtime.apiBase,
                runtime.apiKey,
                runtime.modelId,
                prompt,
                IMAGE_NEGATIVE_PROMPT,
                input.size,
                input.watermark,
                input.referenceImageDataUrl,
              ),
            ),
          );

  try {
    const results = await requestBatch(sanitizedPrompt);
    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
      serviceName: "image.generate",
      provider: runtime.providerLabel,
      modelId: runtime.modelId,
      metrics: {
        imageCount: results.length,
        requestCount: 1,
      },
      requestId: crypto.randomUUID(),
      remark: "图片生成",
    });
    return results;
  } catch (error) {
    if (!isSensitivePromptError(error)) {
      releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
      throw error;
    }

    const saferPrompt = await rewriteSensitiveImagePrompt(sanitizedPrompt);

    try {
      const results = await requestBatch(saferPrompt);
      confirmCommercialModelUsageCharge(commercialCharge, {
        pricingKey,
        serviceName: "image.generate",
        provider: runtime.providerLabel,
        modelId: runtime.modelId,
        metrics: {
          imageCount: results.length,
          requestCount: 1,
        },
        requestId: crypto.randomUUID(),
        remark: "图片生成（安全改写后重试）",
      });
      return results;
    } catch (retryError) {
      if (!isSensitivePromptError(retryError)) {
        releaseCommercialModelUsageCharge(commercialCharge, "provider_retry_failed");
        throw retryError;
      }
      releaseCommercialModelUsageCharge(commercialCharge, "provider_safety_retry_failed");
      throw new Error(SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE);
    }
  }
}
