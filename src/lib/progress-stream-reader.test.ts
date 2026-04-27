import assert from "node:assert/strict";
import test from "node:test";

import { readJsonProgressStream } from "./progress-stream-reader";

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

test("readJsonProgressStream skips malformed progress events and returns the result event", async () => {
  const events: Record<string, unknown>[] = [];
  const result = await readJsonProgressStream<{ step: string; percent: number; value: string }>({
    response: createSseResponse([
      "data: not-json\n\n",
      'data: {"step":"clip","percent":20,"message":"running"}\n\n',
      'data: {"step":"result","percent":100,"value":"ok"}\n\n',
    ]),
    defaultErrorMessage: "子任务失败",
    missingBodyMessage: "没有进度流",
    missingResultMessage: "没有结果",
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.value, "ok");
  assert.deepEqual(events, [{ step: "clip", percent: 20, message: "running" }]);
});

test("readJsonProgressStream fails clearly when an SSE stream ends without a result event", async () => {
  await assert.rejects(
    () =>
      readJsonProgressStream({
        response: createSseResponse(['data: {"step":"clip","percent":20}\n\n']),
        defaultErrorMessage: "子任务失败",
        missingBodyMessage: "没有进度流",
        missingResultMessage: "没有结果",
      }),
    /没有结果/,
  );
});

test("readJsonProgressStream times out when an SSE stream stops producing chunks", async () => {
  const response = new Response(new ReadableStream<Uint8Array>(), {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });

  await assert.rejects(
    () =>
      readJsonProgressStream({
        response,
        defaultErrorMessage: "子任务超时",
        missingBodyMessage: "没有进度流",
        missingResultMessage: "没有结果",
        idleTimeoutMs: 20,
      }),
    /子任务超时/,
  );
});

test("readJsonProgressStream surfaces JSON errors for non-SSE responses", async () => {
  await assert.rejects(
    () =>
      readJsonProgressStream({
        response: Response.json({ error: "明确失败" }, { status: 500 }),
        defaultErrorMessage: "子任务失败",
        missingBodyMessage: "没有进度流",
        missingResultMessage: "没有结果",
      }),
    /明确失败/,
  );
});
