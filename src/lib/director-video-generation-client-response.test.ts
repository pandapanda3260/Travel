import assert from "node:assert/strict";
import test from "node:test";

import { readDirectorVideoGenerationResponse } from "./director-video-generation-client-response";

test("快速生成接口解析会保留正常 JSON 响应", async () => {
  const data = await readDirectorVideoGenerationResponse<{ error?: string; ok?: boolean }>(
    Response.json({ ok: true }),
    "快速生成失败",
  );

  assert.equal(data.ok, true);
  assert.equal(data.error, undefined);
});

test("快速生成接口解析遇到空响应时返回稳定错误", async () => {
  const data = await readDirectorVideoGenerationResponse<{ error?: string }>(
    new Response("", { status: 500, statusText: "Internal Server Error" }),
    "快速生成记录加载失败",
  );

  assert.match(data.error ?? "", /快速生成记录加载失败/);
  assert.match(data.error ?? "", /服务端没有返回有效内容/);
});

test("快速生成接口解析遇到纯文本 500 时不暴露 JSON 解析错误", async () => {
  const data = await readDirectorVideoGenerationResponse<{ error?: string }>(
    new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    "提示词优化失败",
  );

  assert.equal(data.error, "提示词优化失败：服务端内部错误，请稍后重试（HTTP 500 Internal Server Error）");
  assert.doesNotMatch(data.error ?? "", /Unexpected token|Unexpected end/);
});

test("快速生成接口解析遇到 HTML 错误页时会清洗展示文案", async () => {
  const data = await readDirectorVideoGenerationResponse<{ error?: string }>(
    new Response("<html><body><h1>Bad Gateway</h1></body></html>", { status: 502, statusText: "Bad Gateway" }),
    "提示词优化失败",
  );

  assert.equal(data.error, "提示词优化失败：Bad Gateway（HTTP 502 Bad Gateway）");
});
