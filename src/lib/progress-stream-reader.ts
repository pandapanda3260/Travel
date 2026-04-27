type JsonProgressStreamReaderOptions<T extends Record<string, unknown>> = {
  response: Response;
  defaultErrorMessage: string;
  missingBodyMessage: string;
  missingResultMessage: string;
  onEvent?: (event: Record<string, unknown>) => void;
  idleTimeoutMs?: number;
};

const defaultIdleTimeoutMs = 15 * 60 * 1000;

function parseProgressEventLine(line: string) {
  if (!line.startsWith("data:")) {
    return null;
  }

  const rawPayload = line.slice(line.startsWith("data: ") ? 6 : 5).trim();
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  timeoutMessage: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        void reader.cancel(timeoutMessage).catch(() => undefined);
        reject(new Error(timeoutMessage));
      }, idleTimeoutMs);

      reader.read().then(resolve, reject);
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function readJsonProgressStream<T extends Record<string, unknown>>({
  response,
  defaultErrorMessage,
  missingBodyMessage,
  missingResultMessage,
  onEvent,
  idleTimeoutMs = defaultIdleTimeoutMs,
}: JsonProgressStreamReaderOptions<T>): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const fallback = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(fallback.error ?? defaultErrorMessage);
    }
    return fallback;
  }

  if (!response.body) {
    throw new Error(missingBodyMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let resultPayload: T | null = null;

  try {
    while (true) {
      const { done, value } = await readStreamChunkWithTimeout(reader, idleTimeoutMs, defaultErrorMessage);
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseProgressEventLine(line);
        if (!event) {
          continue;
        }

        const step = String(event.step ?? "");
        if (step === "result") {
          resultPayload = event as T;
          continue;
        }
        if (step === "error") {
          throw new Error((event.error as string) ?? defaultErrorMessage);
        }
        onEvent?.(event);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const trailingEvent = parseProgressEventLine(buffer);
  if (trailingEvent?.step === "result") {
    resultPayload = trailingEvent as T;
  } else if (trailingEvent?.step === "error") {
    throw new Error((trailingEvent.error as string) ?? defaultErrorMessage);
  } else if (trailingEvent) {
    onEvent?.(trailingEvent);
  }

  if (!resultPayload) {
    throw new Error(missingResultMessage);
  }

  return resultPayload;
}
