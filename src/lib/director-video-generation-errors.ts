function collectErrorHints(error: unknown, depth = 0): string[] {
  if (!error || depth > 3) {
    return [];
  }

  if (typeof error === "string") {
    return [error];
  }

  if (error instanceof Error) {
    const hints = [error.message, error.name];
    const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    return [...hints, ...collectErrorHints(cause, depth + 1)];
  }

  if (typeof error !== "object") {
    return [String(error)];
  }

  const record = error as Record<string, unknown>;
  const hints: string[] = [];
  for (const key of ["message", "name", "code"]) {
    const value = record[key];
    if (typeof value === "string") {
      hints.push(value);
    }
  }
  hints.push(...collectErrorHints(record.cause, depth + 1));
  return hints;
}

function getPrimaryErrorMessage(error: unknown) {
  return collectErrorHints(error)
    .map((hint) => hint.trim())
    .find((hint) => hint.length > 0 && !["Error", "TypeError", "AbortError"].includes(hint));
}

const interruptedErrorPatterns = [
  /^terminated$/i,
  /\bterminated\b/i,
  /\baborted\b/i,
  /\baborterror\b/i,
  /\bfetch failed\b/i,
  /\bund_err_/i,
  /\beconnreset\b/i,
  /\bsocket hang up\b/i,
  /\bother side closed\b/i,
];

export function isDirectorVideoGenerationInterruptedError(error: unknown) {
  const hints = collectErrorHints(error).filter(Boolean);
  return hints.some((hint) => interruptedErrorPatterns.some((pattern) => pattern.test(hint)));
}

export function formatDirectorVideoGenerationError(error: unknown, fallback: string) {
  if (isDirectorVideoGenerationInterruptedError(error)) {
    return `${fallback}：请求连接被中断，请稍后重试。`;
  }
  return getPrimaryErrorMessage(error) ?? fallback;
}

export function normalizeDirectorVideoGenerationStoredError(message: string | null | undefined, fallback: string) {
  if (!message) {
    return null;
  }
  return formatDirectorVideoGenerationError(message, fallback);
}
