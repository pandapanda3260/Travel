export const subtitleStylePresetOptions = [
  { value: "clean", label: "简洁白字" },
  { value: "bold", label: "高对比描边" },
  { value: "outline", label: "氛围描边" },
  { value: "shadow", label: "底条字幕" },
] as const;

export const subtitleDisplayModeOptions = [
  { value: "word_by_word", label: "逐字显示" },
  { value: "full_sentence", label: "整句显示" },
] as const;

export const subtitlePositionOptions = [
  { value: "bottom", label: "底部" },
  { value: "center", label: "居中" },
  { value: "top", label: "顶部" },
] as const;

export type SubtitleRenderAspectRatio = "16:9" | "9:16" | "1:1";

export const subtitleFontFamilyOptions = [
  {
    value: "pingfang_sc",
    label: "苹方",
    assFontName: "PingFang SC",
    previewFontFamily: '"PingFang SC", "Hiragino Sans GB", sans-serif',
  },
  {
    value: "hiragino_sans_gb",
    label: "冬青黑体",
    assFontName: "Hiragino Sans GB",
    previewFontFamily: '"Hiragino Sans GB", "PingFang SC", sans-serif',
  },
  {
    value: "songti_sc",
    label: "宋体",
    assFontName: "Songti SC",
    previewFontFamily: '"Songti SC", serif',
  },
  {
    value: "heiti_sc",
    label: "黑体",
    assFontName: "STHeiti",
    previewFontFamily: '"STHeiti", "PingFang SC", sans-serif',
  },
  {
    value: "kaiti_sc",
    label: "楷体",
    assFontName: "Kaiti SC",
    previewFontFamily: '"Kaiti SC", serif',
  },
] as const;

export const subtitleFontSizeRatioOptions = [
  { value: 0.018, label: "小" },
  { value: 0.022, label: "中" },
  { value: 0.026, label: "大" },
  { value: 0.03, label: "特大" },
] as const;

export const subtitleMaxCharsOptions = [8, 10, 12, 14, 16] as const;

export const subtitleTextColorSwatches = [
  "#FFFFFF",
  "#C9D2E8",
  "#E5554F",
  "#F28B1A",
  "#E8B117",
  "#31B957",
  "#4A7CFF",
  "#7C45E8",
] as const;

export const subtitleOutlineColorSwatches = [
  "#000000",
  "#ECEFF6",
  "#F7B1AF",
  "#FFD8AF",
  "#FFF0A8",
  "#C9EDBE",
  "#D5E0FF",
  "#D8C5FF",
  "#D9DEE8",
  "#AEB6C3",
  "#FA6767",
  "#FFA640",
  "#FFE033",
  "#62CE4D",
  "#90ADF3",
  "#AC8CE9",
] as const;

export const subtitleFontSizeRatioRange = {
  min: 0.002,
  max: 0.04,
  step: 0.0005,
} as const;

export const subtitlePositionOffsetRatioRange = {
  min: 0.02,
  max: 0.98,
  step: 0.005,
} as const;

export const subtitleHorizontalPositionRatioRange = {
  min: 0.1,
  max: 0.9,
  step: 0.005,
} as const;

export const subtitleOutlineWidthRange = {
  min: 0,
  max: 3,
  step: 0.1,
} as const;

export type SubtitleStylePreset = (typeof subtitleStylePresetOptions)[number]["value"];
export type SubtitleDisplayMode = (typeof subtitleDisplayModeOptions)[number]["value"];
export type SubtitlePosition = (typeof subtitlePositionOptions)[number]["value"];
export type SubtitleFontFamilyId = (typeof subtitleFontFamilyOptions)[number]["value"];

export type SubtitleConfig = {
  enabled: boolean;
  stylePreset: SubtitleStylePreset;
  fontFamily: SubtitleFontFamilyId;
  fontSizeRatio: number;
  position: SubtitlePosition;
  positionOffsetRatio: number;
  horizontalPositionRatio: number;
  maxCharsPerLine: number;
  displayMode: SubtitleDisplayMode;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
};

export type SubtitlePresetDecoration = {
  borderStyle: 1 | 3;
  outlineScale: number;
  shadowScale: number;
  backgroundOpacity: number;
  bold: boolean;
};

export type SubtitleToneStyle = {
  shadowColor: string;
  shadowOpacity: number;
  backgroundColor: string;
  backgroundOpacity: number;
};

export type SubtitleTypographyMetrics = {
  frameWidth: number;
  frameHeight: number;
  fontSizePx: number;
  outlineWidthPx: number;
  shadowPx: number;
  previewScale: number;
};

export type SubtitleFontSizeInputRange = {
  min: number;
  max: number;
  step: number;
};

const subtitleBaseFontScale = 1.5;
const subtitleVerticalFontCompensation = 0.74;
const subtitleRenderedFontPxRange = {
  min: 10,
  max: 40,
} as const;
const subtitleDisplayFontSizeRange = {
  min: 10,
  max: 20,
  step: 1,
} as const;

const defaultSubtitleConfig: SubtitleConfig = {
  enabled: true,
  stylePreset: "bold",
  fontFamily: "heiti_sc",
  fontSizeRatio: 0.0218,
  position: "bottom",
  positionOffsetRatio: 0.3,
  horizontalPositionRatio: 0.5,
  maxCharsPerLine: 16,
  displayMode: "full_sentence",
  textColor: "#FFFFFF",
  outlineColor: "#FFA640",
  outlineWidth: 0.5,
};

export function getDefaultSubtitleConfig(): SubtitleConfig {
  return { ...defaultSubtitleConfig };
}

export function getSubtitleRenderFrameSize(aspectRatio: SubtitleRenderAspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1280, height: 720 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default:
      return { width: 720, height: 1280 };
  }
}

export function normalizeSubtitleHexColor(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeSubtitleNumber(
  value: unknown,
  fallback: number,
  range: {
    min: number;
    max: number;
  },
) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(range.max, Math.max(range.min, numeric));
}

export function hydrateSubtitleConfig(rawDraft: unknown, fallback = getDefaultSubtitleConfig()): SubtitleConfig {
  const draft = typeof rawDraft === "object" && rawDraft ? (rawDraft as Partial<SubtitleConfig>) : {};

  return {
    enabled: draft.enabled !== false,
    stylePreset: subtitleStylePresetOptions.some((item) => item.value === draft.stylePreset)
      ? (draft.stylePreset as SubtitleConfig["stylePreset"])
      : fallback.stylePreset,
    fontFamily: subtitleFontFamilyOptions.some((item) => item.value === draft.fontFamily)
      ? (draft.fontFamily as SubtitleConfig["fontFamily"])
      : fallback.fontFamily,
    fontSizeRatio: normalizeSubtitleNumber(draft.fontSizeRatio, fallback.fontSizeRatio, subtitleFontSizeRatioRange),
    position: subtitlePositionOptions.some((item) => item.value === draft.position)
      ? (draft.position as SubtitleConfig["position"])
      : fallback.position,
    positionOffsetRatio: normalizeSubtitleNumber(
      draft.positionOffsetRatio,
      fallback.positionOffsetRatio,
      subtitlePositionOffsetRatioRange,
    ),
    horizontalPositionRatio: normalizeSubtitleNumber(
      (draft as Partial<SubtitleConfig> & { horizontalPositionRatio?: unknown }).horizontalPositionRatio,
      fallback.horizontalPositionRatio,
      subtitleHorizontalPositionRatioRange,
    ),
    maxCharsPerLine: Math.round(
      normalizeSubtitleNumber(draft.maxCharsPerLine, fallback.maxCharsPerLine, { min: 6, max: 24 }),
    ),
    displayMode: subtitleDisplayModeOptions.some((item) => item.value === draft.displayMode)
      ? (draft.displayMode as SubtitleConfig["displayMode"])
      : fallback.displayMode,
    textColor: normalizeSubtitleHexColor(draft.textColor, fallback.textColor),
    outlineColor: normalizeSubtitleHexColor(draft.outlineColor, fallback.outlineColor),
    outlineWidth: normalizeSubtitleNumber(draft.outlineWidth, fallback.outlineWidth, subtitleOutlineWidthRange),
  };
}

export function getSubtitleFontFamilyNames(fontFamily: SubtitleFontFamilyId) {
  return subtitleFontFamilyOptions.find((item) => item.value === fontFamily) ?? subtitleFontFamilyOptions[0];
}

function getSubtitleAspectFontScale(aspectRatio: SubtitleRenderAspectRatio) {
  return aspectRatio === "9:16" ? subtitleVerticalFontCompensation : 1;
}

function getSubtitleFontSizeDenominator(aspectRatio: SubtitleRenderAspectRatio) {
  const { height } = getSubtitleRenderFrameSize(aspectRatio);
  return height * getSubtitleAspectFontScale(aspectRatio) * subtitleBaseFontScale;
}

function clampSubtitleRenderedFontPx(fontSizePx: number) {
  return Math.max(
    subtitleRenderedFontPxRange.min,
    Math.min(subtitleRenderedFontPxRange.max, Math.round(fontSizePx)),
  );
}

function scalePxForPreview(outputPx: number, previewScale: number, minimum = 0) {
  return Math.max(minimum, Number((outputPx * previewScale).toFixed(2)));
}

export function getSubtitleOutputTypographyMetrics(
  subtitleConfig: Pick<SubtitleConfig, "fontSizeRatio" | "outlineWidth" | "stylePreset">,
  aspectRatio: SubtitleRenderAspectRatio,
): SubtitleTypographyMetrics {
  const { width, height } = getSubtitleRenderFrameSize(aspectRatio);
  const decoration = getSubtitlePresetDecoration(subtitleConfig.stylePreset);
  const fontSizePx = clampSubtitleRenderedFontPx(
    getSubtitleFontSizeDenominator(aspectRatio) * subtitleConfig.fontSizeRatio,
  );
  const outlineWidthPx = Math.max(0, Number((subtitleConfig.outlineWidth ?? fontSizePx * decoration.outlineScale).toFixed(1)));
  const shadowPx = Math.max(0, Math.round(fontSizePx * decoration.shadowScale));

  return {
    frameWidth: width,
    frameHeight: height,
    fontSizePx,
    outlineWidthPx,
    shadowPx,
    previewScale: 1,
  };
}

export function getSubtitleFontSizeInputRange(aspectRatio: SubtitleRenderAspectRatio): SubtitleFontSizeInputRange {
  return {
    ...subtitleDisplayFontSizeRange,
  };
}

export function getSubtitleFontSizeDisplayValue(fontSizePx: number) {
  const normalizedFontSizePx = clampSubtitleRenderedFontPx(fontSizePx);
  const renderedSpan = subtitleRenderedFontPxRange.max - subtitleRenderedFontPxRange.min;
  const displaySpan = subtitleDisplayFontSizeRange.max - subtitleDisplayFontSizeRange.min;
  const displayFontSize =
    subtitleDisplayFontSizeRange.min +
    ((normalizedFontSizePx - subtitleRenderedFontPxRange.min) / renderedSpan) * displaySpan;
  return Math.round(displayFontSize);
}

export function convertSubtitleFontSizeDisplayToRatio(
  displayFontSize: number,
  aspectRatio: SubtitleRenderAspectRatio,
) {
  const denominator = getSubtitleFontSizeDenominator(aspectRatio);
  const roundedDisplayFontSize = Math.max(
    subtitleDisplayFontSizeRange.min,
    Math.min(subtitleDisplayFontSizeRange.max, Math.round(displayFontSize)),
  );
  const displaySpan = subtitleDisplayFontSizeRange.max - subtitleDisplayFontSizeRange.min;
  const renderedSpan = subtitleRenderedFontPxRange.max - subtitleRenderedFontPxRange.min;
  const renderedFontSizePx = clampSubtitleRenderedFontPx(
    subtitleRenderedFontPxRange.min +
      ((roundedDisplayFontSize - subtitleDisplayFontSizeRange.min) / displaySpan) * renderedSpan,
  );
  const ratio = renderedFontSizePx / denominator;
  return Number(
    normalizeSubtitleNumber(ratio, getDefaultSubtitleConfig().fontSizeRatio, subtitleFontSizeRatioRange).toFixed(4),
  );
}

export function getSubtitlePreviewTypographyMetrics(
  subtitleConfig: Pick<SubtitleConfig, "fontSizeRatio" | "outlineWidth" | "stylePreset">,
  aspectRatio: SubtitleRenderAspectRatio,
  previewHeight: number,
): SubtitleTypographyMetrics {
  const outputMetrics = getSubtitleOutputTypographyMetrics(subtitleConfig, aspectRatio);
  const previewScale =
    previewHeight > 0 && Number.isFinite(previewHeight) ? previewHeight / outputMetrics.frameHeight : 1;

  return {
    ...outputMetrics,
    fontSizePx: scalePxForPreview(outputMetrics.fontSizePx, previewScale, 1),
    outlineWidthPx: scalePxForPreview(outputMetrics.outlineWidthPx, previewScale),
    shadowPx: scalePxForPreview(outputMetrics.shadowPx, previewScale),
    previewScale,
  };
}

export function getSubtitlePresetDecoration(stylePreset: SubtitleStylePreset): SubtitlePresetDecoration {
  switch (stylePreset) {
    case "clean":
      return {
        borderStyle: 1,
        outlineScale: 0.06,
        shadowScale: 0.08,
        backgroundOpacity: 0,
        bold: false,
      };
    case "outline":
      return {
        borderStyle: 1,
        outlineScale: 0.16,
        shadowScale: 0.04,
        backgroundOpacity: 0,
        bold: true,
      };
    case "shadow":
      return {
        borderStyle: 3,
        outlineScale: 0.1,
        shadowScale: 0,
        backgroundOpacity: 0.62,
        bold: true,
      };
    case "bold":
    default:
      return {
        borderStyle: 1,
        outlineScale: 0.12,
        shadowScale: 0.12,
        backgroundOpacity: 0,
        bold: true,
      };
  }
}

export function getSubtitleToneStyle(
  subtitleConfig: Pick<SubtitleConfig, "stylePreset" | "outlineColor">,
): SubtitleToneStyle {
  switch (subtitleConfig.stylePreset) {
    case "outline":
      return {
        shadowColor: subtitleConfig.outlineColor,
        shadowOpacity: 0.4,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
      };
    case "shadow":
      return {
        shadowColor: "#000000",
        shadowOpacity: 0,
        backgroundColor: "#000000",
        backgroundOpacity: 0.62,
      };
    case "clean":
    case "bold":
    default:
      return {
        shadowColor: "#000000",
        shadowOpacity: 0.45,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
      };
  }
}

export function convertCssOpacityToAssAlpha(opacity: number) {
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255);
}

export function convertHexToAssColor(hexColor: string, alpha = 0) {
  const normalized = normalizeSubtitleHexColor(hexColor, "#FFFFFF").replace("#", "");
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  const alphaHex = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
  return `&H${alphaHex}${blue}${green}${red}`;
}
