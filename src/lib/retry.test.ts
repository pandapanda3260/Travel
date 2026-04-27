import assert from "node:assert/strict";
import test from "node:test";

import { withRetry } from "./retry";

test("withRetry 保持旧参数调用方式并最终返回成功结果", async () => {
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("temporary");
      }
      return "ok";
    },
    3,
    1,
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("withRetry 支持 shouldRetry 和 onRetry 控制重试", async () => {
  let attempts = 0;
  const retryEvents: Array<{ attempt: number; nextDelayMs: number }> = [];

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error(`failed-${attempts}`);
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1,
          shouldRetry: (_error, attempt) => attempt < 2,
          onRetry: ({ attempt, nextDelayMs }) => retryEvents.push({ attempt, nextDelayMs }),
        },
      ),
    /failed-2/,
  );

  assert.equal(attempts, 2);
  assert.deepEqual(retryEvents, [{ attempt: 1, nextDelayMs: 1 }]);
});

test("withRetry 遇到 retryable=false 会立即停止", async () => {
  let attempts = 0;
  const error = new Error("invalid request") as Error & { retryable?: boolean };
  error.retryable = false;

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw error;
        },
        { maxAttempts: 3, baseDelayMs: 1 },
      ),
    /invalid request/,
  );

  assert.equal(attempts, 1);
});
