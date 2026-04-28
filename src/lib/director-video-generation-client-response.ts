type ErrorEnvelope = {
  error?: string | null;
};

function getHttpStatusLabel(response: Response) {
  const statusText = response.statusText.trim();
  return statusText ? `${response.status} ${statusText}` : String(response.status);
}

function sanitizeNonJsonResponseText(text: string) {
  const normalized = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "服务端返回了非 JSON 内容";
  }
  if (/^internal server error$/i.test(normalized)) {
    return "服务端内部错误，请稍后重试";
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

export async function readDirectorVideoGenerationResponse<T extends ErrorEnvelope>(
  response: Response,
  fallback: string,
): Promise<T> {
  const rawText = await response.text().catch(() => "");
  const text = rawText.trim();

  if (!text) {
    return (
      response.ok
        ? {}
        : {
            error: `${fallback}：服务端没有返回有效内容（HTTP ${getHttpStatusLabel(response)}）`,
          }
    ) as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: `${fallback}：${sanitizeNonJsonResponseText(text)}（HTTP ${getHttpStatusLabel(response)}）`,
    } as T;
  }
}
