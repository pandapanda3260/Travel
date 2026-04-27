import assert from "node:assert/strict";
import test from "node:test";

import {
  convertSubtitleFontSizeDisplayToRatio,
  getDefaultSubtitleConfig,
  getSubtitleFontSizeDisplayValue,
  getSubtitleFontSizeInputRange,
  getSubtitleOutputTypographyMetrics,
  getSubtitlePreviewTypographyMetrics,
} from "./subtitle-style-config";

test("竖版字幕默认字号为前端 17 号字", () => {
  const typography = getSubtitleOutputTypographyMetrics(getDefaultSubtitleConfig(), "9:16");

  assert.equal(typography.fontSizePx, 31);
  assert.equal(getSubtitleFontSizeDisplayValue(typography.fontSizePx), 17);
  assert.equal(typography.outlineWidthPx, 0.5);
  assert.equal(typography.shadowPx, 4);
});

test("超小字幕比例会落到新的最小真实字号 10px", () => {
  const typography = getSubtitleOutputTypographyMetrics(
    {
      ...getDefaultSubtitleConfig(),
      fontSizeRatio: 0.002,
    },
    "9:16",
  );

  assert.equal(typography.fontSizePx, 10);
});

test("字幕预览字号会按预览高度同比例缩放", () => {
  const previewTypography = getSubtitlePreviewTypographyMetrics(getDefaultSubtitleConfig(), "9:16", 320);

  assert.equal(previewTypography.fontSizePx, 7.75);
  assert.equal(previewTypography.outlineWidthPx, 0.13);
  assert.equal(previewTypography.previewScale, 0.25);
});

test("前端字号 10-20 会稳定换算为成片 10px-40px", () => {
  const ratio = convertSubtitleFontSizeDisplayToRatio(17, "9:16");
  const typography = getSubtitleOutputTypographyMetrics(
    {
      ...getDefaultSubtitleConfig(),
      fontSizeRatio: ratio,
    },
    "9:16",
  );

  assert.equal(typography.fontSizePx, 31);
  assert.equal(getSubtitleFontSizeDisplayValue(typography.fontSizePx), 17);
});

test("字幕字号输入范围按前端显示字号返回", () => {
  const range = getSubtitleFontSizeInputRange("9:16");

  assert.deepEqual(range, {
    min: 10,
    max: 20,
    step: 1,
  });
});
