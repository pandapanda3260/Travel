import assert from "node:assert/strict";
import { existsSync, statSync, unlinkSync } from "node:fs";
import test from "node:test";

import { resolveRuntimeAssetUrlToPath } from "./runtime-storage";
import { saveVideoFile } from "./video-job-store";

function createTestJobId() {
  return `download-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupGeneratedVideo(url: string | null | undefined) {
  if (!url) {
    return;
  }
  const path = resolveRuntimeAssetUrlToPath(url);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

test("saveVideoFile 会重试瞬时下载失败并写入非空本地文件", async () => {
  const jobId = createTestJobId();
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let savedUrl: string | null = null;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("temporary", { status: 503 });
    }
    return new Response(Buffer.from([1, 2, 3]), { status: 200 });
  }) as typeof fetch;

  try {
    savedUrl = await saveVideoFile(jobId, "https://example.com/video.mp4");
    const filePath = resolveRuntimeAssetUrlToPath(savedUrl);
    assert.equal(attempts, 2);
    assert.equal(existsSync(filePath), true);
    assert.equal(statSync(filePath).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupGeneratedVideo(savedUrl);
  }
});

test("saveVideoFile 会复用同一 job 的并发下载", async () => {
  const jobId = createTestJobId();
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let savedUrl: string | null = null;

  globalThis.fetch = (async () => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(Buffer.from([4, 5, 6]), { status: 200 });
  }) as typeof fetch;

  try {
    const [firstUrl, secondUrl] = await Promise.all([
      saveVideoFile(jobId, "https://example.com/video.mp4"),
      saveVideoFile(jobId, "https://example.com/video.mp4"),
    ]);
    savedUrl = firstUrl;

    assert.equal(firstUrl, secondUrl);
    assert.equal(attempts, 1);
    assert.equal(statSync(resolveRuntimeAssetUrlToPath(firstUrl)).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupGeneratedVideo(savedUrl);
  }
});
