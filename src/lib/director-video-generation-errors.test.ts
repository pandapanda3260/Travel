import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDirectorVideoGenerationError,
  isDirectorVideoGenerationInterruptedError,
  normalizeDirectorVideoGenerationStoredError,
} from "./director-video-generation-errors";

test("导演模式错误规整会隐藏底层 terminated 文案", () => {
  assert.equal(formatDirectorVideoGenerationError(new TypeError("terminated"), "视频生成失败"), "视频生成失败：请求连接被中断，请稍后重试。");
  assert.equal(normalizeDirectorVideoGenerationStoredError("terminated", "图片生成失败"), "图片生成失败：请求连接被中断，请稍后重试。");
});

test("导演模式错误规整会识别 undici/fetch 中断原因", () => {
  const error = {
    name: "TypeError",
    message: "fetch failed",
    cause: {
      code: "UND_ERR_SOCKET",
      message: "other side closed",
    },
  };

  assert.equal(isDirectorVideoGenerationInterruptedError(error), true);
  assert.equal(formatDirectorVideoGenerationError(error, "提示词优化失败"), "提示词优化失败：请求连接被中断，请稍后重试。");
});

test("导演模式错误规整保留明确业务错误", () => {
  assert.equal(formatDirectorVideoGenerationError(new Error("请先生成并选择图片"), "视频生成失败"), "请先生成并选择图片");
  assert.equal(normalizeDirectorVideoGenerationStoredError(null, "视频生成失败"), null);
});
