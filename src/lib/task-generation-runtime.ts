import { getTextGenerationRuntime } from "./text-provider-config";
import { getGenerationRuntime as getOpenAiGenerationRuntime } from "./vision-provider-config";

export type TaskGenerationRuntime = {
  provider: "openai" | "ark";
  liveEnabled: boolean;
  hasApiKey: boolean;
  apiBase: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
  configFileName: string;
  chatEndpoint: string;
};

function normalizeArkApiBase(apiBase: string) {
  return apiBase.endsWith("/api/v3") ? apiBase : `${apiBase.replace(/\/$/, "")}/api/v3`;
}

export function getTaskGenerationRuntime(): TaskGenerationRuntime {
  const openAiRuntime = getOpenAiGenerationRuntime();
  if (openAiRuntime.liveEnabled) {
    return {
      provider: "openai",
      liveEnabled: true,
      hasApiKey: openAiRuntime.hasApiKey,
      apiBase: openAiRuntime.apiBase,
      apiKey: openAiRuntime.apiKey,
      modelId: openAiRuntime.modelId,
      providerLabel: openAiRuntime.providerLabel,
      configFileName: openAiRuntime.configFileName,
      chatEndpoint: openAiRuntime.chatEndpoint,
    };
  }

  const arkRuntime = getTextGenerationRuntime();
  return {
    provider: "ark",
    liveEnabled: arkRuntime.liveEnabled,
    hasApiKey: arkRuntime.hasApiKey,
    apiBase: normalizeArkApiBase(arkRuntime.apiBase),
    apiKey: arkRuntime.apiKey,
    modelId: arkRuntime.modelId,
    providerLabel: arkRuntime.providerLabel,
    configFileName: arkRuntime.configFileName,
    chatEndpoint: "/chat/completions",
  };
}

export async function callTaskGenerationLlm(input: {
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxCompletionTokens?: number;
}) {
  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    return null;
  }

  const response = await fetch(`${runtime.apiBase}${runtime.chatEndpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify({
      model: runtime.modelId,
      temperature: input.temperature ?? 0.35,
      ...(runtime.provider === "openai" && input.maxCompletionTokens
        ? { max_completion_tokens: input.maxCompletionTokens }
        : {}),
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userContent },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `${runtime.providerLabel} 调用失败`);
  }

  return payload.choices?.[0]?.message?.content ?? null;
}
