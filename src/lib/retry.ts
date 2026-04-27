/**
 * 通用指数退避重试工具。
 * 调用方只需传入无参异步函数，失败后自动等待后重试。
 *
 * @param fn           - 要执行的异步操作
 * @param maxAttempts  - 最大尝试次数（含首次），默认 3
 * @param baseDelayMs  - 首次重试等待时间（毫秒），后续翻倍，默认 500ms
 */
export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (input: { error: unknown; attempt: number; nextDelayMs: number }) => void;
};

function isExplicitlyNonRetryable(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "retryable" in error &&
    (error as { retryable?: boolean }).retryable === false
  );
}

function normalizeRetryOptions(
  maxAttemptsOrOptions: number | RetryOptions = 3,
  baseDelayMs: number = 500,
): Required<Pick<RetryOptions, "maxAttempts" | "baseDelayMs">> &
  Pick<RetryOptions, "shouldRetry" | "onRetry"> {
  if (typeof maxAttemptsOrOptions === "number") {
    return {
      maxAttempts: Math.max(1, Math.floor(maxAttemptsOrOptions)),
      baseDelayMs: Math.max(0, baseDelayMs),
    };
  }

  return {
    maxAttempts: Math.max(1, Math.floor(maxAttemptsOrOptions.maxAttempts ?? 3)),
    baseDelayMs: Math.max(0, maxAttemptsOrOptions.baseDelayMs ?? 500),
    shouldRetry: maxAttemptsOrOptions.shouldRetry,
    onRetry: maxAttemptsOrOptions.onRetry,
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttemptsOrOptions: number | RetryOptions = 3,
  baseDelayMs: number = 500,
): Promise<T> {
  const options = normalizeRetryOptions(maxAttemptsOrOptions, baseDelayMs);
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (isExplicitlyNonRetryable(error)) {
        break;
      }

      if (options.shouldRetry && !options.shouldRetry(error, attempt)) {
        break;
      }

      if (attempt === options.maxAttempts) {
        break;
      }

      const delayMs = options.baseDelayMs * Math.pow(2, attempt - 1);
      options.onRetry?.({ error, attempt, nextDelayMs: delayMs });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
