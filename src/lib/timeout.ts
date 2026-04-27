export const defaultModelRequestTimeoutMs = 2 * 60 * 1000;
export const defaultModelPollTimeoutMs = 60 * 1000;
export const defaultMediaDownloadTimeoutMs = 2 * 60 * 1000;

type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  timeoutMessage?: string;
};

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  options: FetchWithTimeoutOptions = {},
) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? defaultModelRequestTimeoutMs);
  const timeoutMessage = options.timeoutMessage ?? `请求超时（${Math.round(timeoutMs / 1000)} 秒）`;
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  let timedOut = false;

  const abortFromUpstream = () => {
    controller.abort();
  };
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
