import imageGenerationConfig from "../../config/image-generation.json";

export type ImageGenerationAspectRatio = "1:1" | "2:3" | "3:2" | "9:16" | "16:9";
export type VideoGenerationAspectRatio = Extract<ImageGenerationAspectRatio, "1:1" | "9:16" | "16:9">;

export type ImageGenerationSizeRule = {
  aspectRatio: ImageGenerationAspectRatio;
  label: string;
  preferred: string;
  fallbacks: string[];
};

type ImageGenerationProviderId = keyof (typeof imageGenerationConfig)["providers"];

const aspectRatioOrder: ImageGenerationAspectRatio[] = ["1:1", "2:3", "3:2", "9:16", "16:9"];

const defaultSizeRules: Record<ImageGenerationAspectRatio, ImageGenerationSizeRule> = {
  "1:1": { aspectRatio: "1:1", label: "1:1 方图", preferred: "2048x2048", fallbacks: ["1024x1024"] },
  "2:3": { aspectRatio: "2:3", label: "2:3 竖图", preferred: "1664x2496", fallbacks: ["1024x1536"] },
  "3:2": { aspectRatio: "3:2", label: "3:2 横图", preferred: "2496x1664", fallbacks: ["1536x1024"] },
  "9:16": {
    aspectRatio: "9:16",
    label: "9:16 竖版",
    preferred: "1600x2848",
    fallbacks: ["1080x1920", "1024x1824", "1024x1536"],
  },
  "16:9": {
    aspectRatio: "16:9",
    label: "16:9 横版",
    preferred: "2848x1600",
    fallbacks: ["1920x1080", "1824x1024", "1536x1024"],
  },
};

function parseSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { width: 0, height: 0 };
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function uniqueSizes(sizes: string[]) {
  return Array.from(new Set(sizes.map((size) => size.trim()).filter(Boolean)));
}

function getConfiguredModelRule(provider: string | null | undefined, modelId: string | null | undefined) {
  const providerKey = (provider || imageGenerationConfig.defaultProvider) as ImageGenerationProviderId;
  const providerConfig = imageGenerationConfig.providers[providerKey];
  if (!providerConfig) return null;

  const models = providerConfig.models as Record<string, unknown>;
  const configured = modelId ? models[modelId] : null;
  if (configured && typeof configured === "object") return configured as Record<string, unknown>;

  const firstModel = Object.values(models).find((item) => item && typeof item === "object");
  return (firstModel as Record<string, unknown> | undefined) ?? null;
}

function getConfiguredSizeRules(provider?: string | null, modelId?: string | null) {
  const modelRule = getConfiguredModelRule(provider, modelId);
  const sizesByAspectRatio = modelRule?.sizesByAspectRatio;
  if (!sizesByAspectRatio || typeof sizesByAspectRatio !== "object") {
    return defaultSizeRules;
  }

  return aspectRatioOrder.reduce(
    (rules, aspectRatio) => {
      const rawRule = (sizesByAspectRatio as Record<string, unknown>)[aspectRatio];
      if (!rawRule || typeof rawRule !== "object") {
        rules[aspectRatio] = defaultSizeRules[aspectRatio];
        return rules;
      }

      const record = rawRule as Record<string, unknown>;
      const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : defaultSizeRules[aspectRatio].label;
      const preferred =
        typeof record.preferred === "string" && record.preferred.trim()
          ? record.preferred.trim()
          : defaultSizeRules[aspectRatio].preferred;
      const fallbacks = Array.isArray(record.fallbacks)
        ? record.fallbacks.map((item) => String(item)).filter(Boolean)
        : defaultSizeRules[aspectRatio].fallbacks;

      rules[aspectRatio] = {
        aspectRatio,
        label,
        preferred,
        fallbacks: uniqueSizes(fallbacks),
      };
      return rules;
    },
    {} as Record<ImageGenerationAspectRatio, ImageGenerationSizeRule>,
  );
}

export function getImageGenerationSizeRules(provider?: string | null, modelId?: string | null) {
  const rules = getConfiguredSizeRules(provider, modelId);
  return aspectRatioOrder.map((aspectRatio) => rules[aspectRatio]);
}

export function getImageGenerationSizeOptions(provider?: string | null, modelId?: string | null) {
  return getImageGenerationSizeRules(provider, modelId).map((rule) => ({
    label: rule.label,
    value: rule.preferred,
  }));
}

export function getImageGenerationSizeForAspectRatio(
  aspectRatio: VideoGenerationAspectRatio,
  provider?: string | null,
  modelId?: string | null,
) {
  return getConfiguredSizeRules(provider, modelId)[aspectRatio].preferred;
}

export function getImageGenerationSizeCandidates(input: {
  requestedSize: string;
  provider?: string | null;
  modelId?: string | null;
}) {
  const normalizedRequestedSize = normalizeImageGenerationSizeForProvider(input.requestedSize, input.provider, input.modelId);
  const rule = getImageGenerationSizeRules(input.provider, input.modelId).find((item) =>
    [item.preferred, ...item.fallbacks].includes(input.requestedSize),
  );

  if (!rule) {
    return [normalizedRequestedSize];
  }

  const sizes = input.requestedSize === rule.preferred ? [rule.preferred, ...rule.fallbacks] : [input.requestedSize];
  return uniqueSizes(sizes.map((size) => normalizeImageGenerationSizeForProvider(size, input.provider, input.modelId)));
}

export function getImageGenerationSizeRatio(size: string) {
  const { width, height } = parseSize(size);
  return width > 0 && height > 0 ? width / height : null;
}

export function resolveClosestImageGenerationSize(width: number | null, height: number | null) {
  if (!width || !height || width <= 0 || height <= 0) {
    return getImageGenerationSizeForAspectRatio("9:16");
  }

  const ratio = width / height;
  return getImageGenerationSizeRules().reduce((best, candidate) => {
    const bestRatio = getImageGenerationSizeRatio(best.preferred) ?? 0;
    const candidateRatio = getImageGenerationSizeRatio(candidate.preferred) ?? 0;
    return Math.abs(candidateRatio - ratio) < Math.abs(bestRatio - ratio) ? candidate : best;
  }).preferred;
}

export function normalizeImageGenerationSizeForProvider(size: string, provider?: string | null, modelId?: string | null) {
  const modelRule = getConfiguredModelRule(provider, modelId);
  const multiple = Number((modelRule?.normalizeToMultipleOf as number | string | undefined) ?? 1);
  const { width, height } = parseSize(size);
  if (!width || !height || !Number.isFinite(multiple) || multiple <= 1) {
    return size;
  }

  const normalizedWidth = Math.max(multiple, Math.round(width / multiple) * multiple);
  const normalizedHeight = Math.max(multiple, Math.round(height / multiple) * multiple);
  return `${normalizedWidth}x${normalizedHeight}`;
}

export function getImageGenerationOutputFormat(provider?: string | null, modelId?: string | null) {
  const modelRule = getConfiguredModelRule(provider, modelId);
  const outputFormat = modelRule?.outputFormat;
  return typeof outputFormat === "string" && outputFormat.trim() ? outputFormat.trim() : null;
}
