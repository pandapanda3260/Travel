import { getEffectiveConstraintPrompt } from "./constraint-prompt-store";
import { getImageGenerationRuntime } from "./image-provider-config";
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
};

export type ImageGenerationResult = {
  url: string | null;
  b64Json: string | null;
};

function normalizeApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
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

  if (guidanceScale >= 8.5) {
    return `${prompt}\n\n补充要求：${high}`;
  }

  if (guidanceScale >= 7.5) {
    return `${prompt}\n\n补充要求：${mid}`;
  }

  return `${prompt}\n\n补充要求：${low}`;
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
      throw new Error(payload.error?.message ?? payload.message ?? "图片生成失败");
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

export async function generateSeedreamImages(input: ImageGenerationRequest) {
  const runtime = getImageGenerationRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(`${runtime.providerLabel} 当前未启用，请先配置图片生成 API Key。`);
  }

  const enhancedPrompt = enhancePromptWithDetailPreset(input.prompt, input.guidanceScale);
  const sanitizedPrompt = sanitizeImagePromptForModeration(enhancedPrompt);
  const outputCount = Math.max(1, Math.min(6, input.outputCount ?? 4));
  const requestBatch = (prompt: string) =>
    Promise.all(
      Array.from({ length: outputCount }, () =>
        requestSingleSeedreamImage(
          runtime.apiBase,
          runtime.apiKey,
          runtime.modelId,
          prompt,
          input.size,
          input.watermark,
          input.referenceImageDataUrl,
        ),
      ),
    );

  try {
    return await requestBatch(sanitizedPrompt);
  } catch (error) {
    if (!isSensitivePromptError(error)) {
      throw error;
    }

    const saferPrompt = await rewriteSensitiveImagePrompt(sanitizedPrompt);

    try {
      return await requestBatch(saferPrompt);
    } catch (retryError) {
      if (!isSensitivePromptError(retryError)) {
        throw retryError;
      }
      const message = retryError instanceof Error ? retryError.message : String(retryError ?? "");
      throw new Error(`图片生成触发安全拦截，系统已自动降敏重试仍失败：${message}`);
    }
  }
}
