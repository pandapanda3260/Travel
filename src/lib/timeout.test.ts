import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "./timeout";

test("fetchWithTimeout returns the fetch response before timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ ok: true })) as typeof fetch;

  try {
    const response = await fetchWithTimeout("https://example.test/ok", {}, { timeoutMs: 50 });
    const payload = (await response.json()) as { ok?: boolean };
    assert.equal(payload.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout aborts stalled requests with the configured message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchWithTimeout("https://example.test/slow", {}, { timeoutMs: 20, timeoutMessage: "请求已经超时" }),
      /请求已经超时/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
