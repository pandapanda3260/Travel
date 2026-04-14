/**
 * 通用指数退避重试工具。
 * 调用方只需传入无参异步函数，失败后自动等待后重试。
 *
 * @param fn           - 要执行的异步操作
 * @param maxAttempts  - 最大尝试次数（含首次），默认 3
 * @param baseDelayMs  - 首次重试等待时间（毫秒），后续翻倍，默认 500ms
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
