import { createHash, createHmac } from "node:crypto";

import { getVoiceManagementRuntime } from "./voice-management-config";

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function hmac(key: Buffer | string, content: string) {
  return createHmac("sha256", key).update(content).digest();
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return {
    dateStamp: `${year}${month}${day}`,
    amzDate: `${year}${month}${day}T${hours}${minutes}${seconds}Z`,
  };
}

export async function callSpeechOpenApi<ResultType>(action: string, version: string, payload: Record<string, unknown>) {
  const runtime = getVoiceManagementRuntime();
  if (!runtime.timbreApiEnabled) {
    throw new Error("当前未配置豆包语音 OpenAPI AK/SK，无法直接拉取在线音色列表。");
  }

  const method = "POST";
  const path = "/";
  const query = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`;
  const host = runtime.openApiHost;
  const region = runtime.openApiRegion;
  const service = runtime.openApiService;
  const contentType = "application/json; charset=UTF-8";
  const body = JSON.stringify(payload ?? {});
  const bodyHash = sha256(body);
  const { dateStamp, amzDate } = formatDate(new Date());

  const canonicalHeaders = `host:${host}\nx-content-sha256:${bodyHash}\nx-date:${amzDate}\n`;
  const signedHeaders = "host;x-content-sha256;x-date";
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = ["HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");

  const kDate = hmac(runtime.openApiSecretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `HMAC-SHA256 Credential=${runtime.openApiAccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 4000);

  let response: Response;
  try {
    response = await fetch(`https://${host}/?${query}`, {
      method,
      headers: {
        Host: host,
        "Content-Type": contentType,
        "X-Date": amzDate,
        "X-Content-Sha256": bodyHash,
        Authorization: authorization,
      },
      body,
      signal: abortController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("豆包语音 OpenAPI 拉取超时");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = (await response.json().catch(() => ({}))) as {
    ResponseMetadata?: { Error?: { Message?: string } };
    Result?: ResultType;
  };

  if (!response.ok) {
    throw new Error(data.ResponseMetadata?.Error?.Message ?? "豆包语音 OpenAPI 调用失败");
  }

  return data.Result as ResultType;
}
