import test from "node:test";
import assert from "node:assert/strict";

import { applyImagePromptHardRequirements, SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE } from "./image-provider";

test("送图模型前会统一补竖版构图和无文字硬约束", () => {
  const prompt = applyImagePromptHardRequirements("海边酒店夜景，大堂暖光，真实摄影风格", "1600x2848");

  assert.match(prompt, /竖构图9:16|portrait orientation/u);
  assert.match(prompt, /不要横图内容塞进竖版画布|不要画面横着或旋转90度/u);
  assert.match(prompt, /no text, no letters, no words, no numbers, no watermark/u);
});

test("已带基础约束的提示词不会重复堆叠同一条硬约束", () => {
  const prompt = applyImagePromptHardRequirements(
    "海边酒店夜景，竖构图9:16，no text, no letters, no words, no numbers, no watermark, no logo, no signage text, no caption, no subtitle, no collage, no split screen, single continuous image",
    "1600x2848",
  );

  const noTextMatches = prompt.match(/no text, no letters, no words, no numbers, no watermark/gu) ?? [];
  const orientationMatches = prompt.match(/竖构图9:16/gu) ?? [];

  assert.equal(noTextMatches.length, 1);
  assert.equal(orientationMatches.length, 1);
});

test("安全拦截降敏重试失败文案提示用户手动上传且不透出供应商原始错误", () => {
  assert.equal(
    SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE,
    "图片生成触发安全拦截，系统已自动降敏重试仍失败，请手动上传图片",
  );
  assert.doesNotMatch(SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE, /request id|sensitive information/i);
});
