export async function parseApiResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  if (!rawText) {
    throw new Error(`接口返回为空，状态码 ${response.status}`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    const normalizedText = rawText.trim().slice(0, 180);
    throw new Error(
      response.ok
        ? `接口返回了非 JSON 内容：${normalizedText}`
        : `接口请求失败，状态码 ${response.status}：${normalizedText}`,
    );
  }
}
