/**
 * Server-side utility for creating SSE progress streams.
 * Used by API routes to push real-time progress events to the frontend.
 */

export type ProgressEvent = {
  step: string;
  percent: number;
  message: string;
  [key: string]: unknown;
};

export type ProgressCallback = (
  step: string,
  percent: number,
  message: string,
  extra?: Record<string, unknown>,
) => void;

export function createProgressStream(execute: (send: ProgressCallback) => Promise<Record<string, unknown>>) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller may be closed if client disconnected
        }
      };

      const onProgress: ProgressCallback = (step, percent, message, extra) => {
        send({ step, percent, message, ...(extra ?? {}) });
      };

      try {
        const result = await execute(onProgress);
        send({ step: "result", percent: 100, ...result });
      } catch (error) {
        send({
          step: "error",
          percent: -1,
          error: error instanceof Error ? error.message : "执行失败",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
