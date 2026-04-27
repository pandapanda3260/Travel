import assert from "node:assert/strict";
import test from "node:test";

import { refreshSeedanceVideoJob } from "./video-provider";
import type { VideoJobRecord } from "./video-job-store";

function buildSeedanceJob(): VideoJobRecord {
  const now = "2026-04-26T00:00:00.000Z";
  return {
    jobId: `seedance-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTaskId: "task-1",
    taskName: "测试任务",
    originalPrompt: "测试提示词",
    optimizedPrompt: "测试提示词",
    strategy: {
      angle: "片段 1",
      hook: "测试",
      style: "Seedance 片段生成",
    },
    submittedAt: now,
    updatedAt: now,
    status: "IN_PROGRESS",
    mode: "live",
    logs: ["已提交"],
    videoUrl: null,
    remoteVideoUrl: null,
    error: null,
    provider: "seedance",
    modelId: "seedance-test",
    generationSettings: null,
    resolvedDurationSeconds: null,
    deletedAt: null,
  };
}

function setupSeedanceEnv() {
  const originalEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    SEEDANCE_API_BASE: process.env.SEEDANCE_API_BASE,
  };
  process.env.ARK_API_KEY = "test-key";
  process.env.SEEDANCE_API_BASE = "https://example.com/api/v3";
  return () => {
    if (originalEnv.ARK_API_KEY == null) {
      delete process.env.ARK_API_KEY;
    } else {
      process.env.ARK_API_KEY = originalEnv.ARK_API_KEY;
    }
    if (originalEnv.SEEDANCE_API_BASE == null) {
      delete process.env.SEEDANCE_API_BASE;
    } else {
      process.env.SEEDANCE_API_BASE = originalEnv.SEEDANCE_API_BASE;
    }
  };
}

test("refreshSeedanceVideoJob 会重试 5xx 瞬时状态查询失败", async () => {
  const restoreEnv = setupSeedanceEnv();
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ message: "temporary busy" }), { status: 503 });
    }
    return new Response(JSON.stringify({ status: "Completed", content: { video_url: "https://cdn.example.com/video.mp4" } }), {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const refreshed = await refreshSeedanceVideoJob(buildSeedanceJob());
    assert.equal(attempts, 2);
    assert.equal(refreshed.status, "COMPLETED");
    assert.equal(refreshed.remoteVideoUrl, "https://cdn.example.com/video.mp4");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("refreshSeedanceVideoJob 遇到 4xx 非 429 不盲目重试", async () => {
  const restoreEnv = setupSeedanceEnv();
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ message: "invalid job" }), { status: 404 });
  }) as typeof fetch;

  try {
    await assert.rejects(() => refreshSeedanceVideoJob(buildSeedanceJob()), /invalid job/);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
