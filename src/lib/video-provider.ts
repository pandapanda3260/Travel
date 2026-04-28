import { createHmac, randomUUID } from "node:crypto";

import type { KlingGenerationSettings } from "./prompt";
import type { VideoJobRecord } from "./video-job-store";
import { loadOptionalEnvFile } from "./env-file";
import { assertModelUsagePreflight, recordModelUsage } from "./model-usage-service";
import { getLipSyncProviderRuntime, getProviderRuntime, type LiveVideoProvider } from "./video-provider-config";
import { withRetry } from "./retry";
import { callTaskGenerationLlm } from "./task-generation-runtime";
import { defaultModelPollTimeoutMs, defaultModelRequestTimeoutMs, fetchWithTimeout } from "./timeout";

type SubmittedLiveVideoJob = {
  jobId: string;
  provider: LiveVideoProvider;
  modelId: string;
  logs: string[];
  message: string;
  optimizedPrompt?: string;
};

type RefreshedLiveVideoJob = Pick<VideoJobRecord, "status" | "logs" | "videoUrl" | "remoteVideoUrl" | "error">;
type ProviderJsonResponse<T> = {
  response: Response;
  payload: T;
};

function getKlingApiToken() {
  const localConfig = loadOptionalEnvFile("video.env.local");
  return process.env.KLING_API_TOKEN ?? localConfig.KLING_API_TOKEN ?? "";
}

function getKlingAccessKey() {
  const localConfig = loadOptionalEnvFile("video.env.local");
  return process.env.KLING_ACCESS_KEY ?? localConfig.KLING_ACCESS_KEY ?? "";
}

function getKlingSecretKey() {
  const localConfig = loadOptionalEnvFile("video.env.local");
  return process.env.KLING_SECRET_KEY ?? localConfig.KLING_SECRET_KEY ?? "";
}

function getKlingTokenExpireSeconds() {
  const localConfig = loadOptionalEnvFile("video.env.local");
  const rawValue = process.env.KLING_TOKEN_EXPIRE_SECONDS ?? localConfig.KLING_TOKEN_EXPIRE_SECONDS ?? "1800";
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1800;
}

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateKlingJwtToken(accessKey: string, secretKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + getKlingTokenExpireSeconds(),
    nbf: now - 5,
  };
  const headerSegment = toBase64Url(JSON.stringify(header));
  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createHmac("sha256", secretKey).update(signingInput).digest();
  return `${signingInput}.${toBase64Url(signature)}`;
}

function getKlingAuthorizationToken() {
  const apiToken = getKlingApiToken();
  if (apiToken) {
    return apiToken;
  }

  const accessKey = getKlingAccessKey();
  const secretKey = getKlingSecretKey();
  if (accessKey && secretKey) {
    return generateKlingJwtToken(accessKey, secretKey);
  }

  return "";
}

function getKlingApiBase() {
  const runtime = getProviderRuntime();
  return runtime.apiBase.replace(/\/$/, "");
}

function stripDataUrlPrefix(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "");
}

function buildKlingCameraControl(cameraControl: KlingGenerationSettings["cameraControl"]) {
  if (cameraControl === "auto") {
    return undefined;
  }
  return { type: cameraControl };
}

function buildKlingMultiPrompt(multiPrompt: KlingGenerationSettings["multiPrompt"]) {
  return multiPrompt.map((item) => ({
    index: item.index,
    prompt: item.prompt,
    duration: item.duration,
  }));
}

function mapKlingStatus(status?: string): VideoJobRecord["status"] {
  switch (status) {
    case "submitted":
      return "QUEUED";
    case "processing":
      return "IN_PROGRESS";
    case "succeed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "IN_PROGRESS";
  }
}

function extractKlingVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directUrl = record.video_url;
  if (typeof directUrl === "string" && directUrl) {
    return directUrl;
  }

  const videos = record.videos;
  if (Array.isArray(videos)) {
    const firstVideo = videos[0] as Record<string, unknown> | undefined;
    const firstUrl = firstVideo?.url;
    if (typeof firstUrl === "string" && firstUrl) {
      return firstUrl;
    }
  }

  const taskResult = record.task_result;
  if (taskResult && typeof taskResult === "object") {
    return extractKlingVideoUrl(taskResult);
  }

  const data = record.data;
  if (data && typeof data === "object") {
    return extractKlingVideoUrl(data);
  }

  return null;
}

function extractProviderErrorText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const directMessage = record.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage.trim();
    }
  }

  return "";
}

function buildProviderHttpError(response: Response, payload: unknown, fallbackMessage: string) {
  const message = extractProviderErrorText(payload) || fallbackMessage;
  const error = new Error(`${message}（HTTP ${response.status}）`) as Error & {
    retryable?: boolean;
    status?: number;
  };
  error.status = response.status;
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    error.retryable = false;
  }
  return error;
}

async function fetchProviderJsonWithRetry<T>(
  input: Parameters<typeof fetchWithTimeout>[0],
  init: Parameters<typeof fetchWithTimeout>[1],
  options: {
    timeoutMs: number;
    timeoutMessage: string;
    failureMessage: string;
  },
): Promise<ProviderJsonResponse<T>> {
  return withRetry(
    async () => {
      const response = await fetchWithTimeout(input, init, {
        timeoutMs: options.timeoutMs,
        timeoutMessage: options.timeoutMessage,
      });
      const payload = (await response.json().catch(() => ({}))) as T;
      if (!response.ok) {
        throw buildProviderHttpError(response, payload, options.failureMessage);
      }
      return { response, payload };
    },
    {
      maxAttempts: 3,
      baseDelayMs: 700,
    },
  );
}

export async function submitLiveVideoJob(
  prompt: string,
  generationSettings: KlingGenerationSettings,
): Promise<SubmittedLiveVideoJob> {
  const runtime = getProviderRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(`${runtime.providerLabel} 当前未启用 live 调用`);
  }

  const apiToken = getKlingAuthorizationToken();
  if (!apiToken) {
    throw new Error("未配置 KLING_API_TOKEN（或 KLING_ACCESS_KEY / KLING_SECRET_KEY），无法调用 Kling 文生视频 API");
  }

  const pricingKey = "kling.text2video";
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "video.generate",
    estimatedMetrics: {
      videoSeconds: Math.max(0, generationSettings.durationSeconds),
      requestCount: 1,
    },
  });

  const { response, payload } = await withRetry(async () => {
    const res = await fetchWithTimeout(
      `${getKlingApiBase()}/v1/videos/text2video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getKlingAuthorizationToken()}`,
        },
        body: JSON.stringify({
          model_name: runtime.modelId,
          prompt,
          negative_prompt: generationSettings.negativePrompt,
          cfg_scale: generationSettings.cfgScale,
          mode: generationSettings.mode,
          duration: String(generationSettings.durationSeconds),
          aspect_ratio: generationSettings.aspectRatio,
          ...(buildKlingCameraControl(generationSettings.cameraControl)
            ? { camera_control: buildKlingCameraControl(generationSettings.cameraControl) }
            : {}),
          watermark: { enabled: generationSettings.watermark },
          external_task_id: randomUUID(),
        }),
      },
      {
        timeoutMs: defaultModelRequestTimeoutMs,
        timeoutMessage: "Kling 文生视频任务提交超时，请稍后重试",
      },
    );
    const p = (await res.json().catch(() => ({}))) as {
      code?: number | string;
      message?: string;
      data?: { task_id?: string; id?: string };
    };
    if (!res.ok) throw new Error(p.message ?? "Kling 文生视频任务提交失败");
    return { response: res, payload: p };
  });

  void response;

  const taskId = payload.data?.task_id ?? payload.data?.id;
  if (!taskId) {
    throw new Error("Kling 文生视频返回缺少 task_id");
  }

  recordModelUsage({
    pricingKey,
    serviceName: "video.generate",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      videoSeconds: Math.max(0, generationSettings.durationSeconds),
      requestCount: 1,
    },
    requestId: response.headers.get("x-request-id") ?? taskId,
    remark: "Kling 文生视频（待配置官方单价）",
  });

  return {
    jobId: taskId,
    provider: "kling",
    modelId: runtime.modelId,
    logs: [`文生视频任务已提交：${taskId}`, `模型：${runtime.modelId}`, `模式：${generationSettings.mode}`],
    message: "Kling 文生视频任务已提交，正在生成中。",
  };
}

export async function submitLiveImageToVideoJob(
  prompt: string,
  generationSettings: KlingGenerationSettings & { sourceImageBase64: string; tailImageBase64?: string },
): Promise<SubmittedLiveVideoJob> {
  const runtime = getProviderRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(`${runtime.providerLabel} 当前未启用 live 调用`);
  }

  const apiToken = getKlingAuthorizationToken();
  if (!apiToken) {
    throw new Error("未配置 KLING_API_TOKEN，或未配置 KLING_ACCESS_KEY / KLING_SECRET_KEY，无法调用 Kling 官方 API");
  }

  const pricingKey = "kling.image2video";
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "video.generate",
    estimatedMetrics: {
      videoSeconds: Math.max(0, generationSettings.durationSeconds),
      requestCount: 1,
    },
  });

  const payload = await withRetry(async () => {
    const res = await fetchWithTimeout(
      `${getKlingApiBase()}/v1/videos/image2video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getKlingAuthorizationToken()}`,
        },
        body: JSON.stringify({
          model_name: runtime.modelId,
          image: stripDataUrlPrefix(generationSettings.sourceImageBase64),
          ...(generationSettings.multiShot ? { multi_shot: true, shot_type: generationSettings.shotType } : {}),
          ...(!generationSettings.multiShot || generationSettings.shotType === "intelligence" ? { prompt } : {}),
          ...(generationSettings.multiShot && generationSettings.shotType === "customize"
            ? { multi_prompt: buildKlingMultiPrompt(generationSettings.multiPrompt) }
            : {}),
          ...(!generationSettings.multiShot && generationSettings.tailImageBase64
            ? { image_tail: stripDataUrlPrefix(generationSettings.tailImageBase64) }
            : {}),
          negative_prompt: generationSettings.negativePrompt,
          cfg_scale: generationSettings.cfgScale,
          mode: generationSettings.mode,
          sound: generationSettings.generateAudio ? "on" : "off",
          duration: String(generationSettings.durationSeconds),
          aspect_ratio: generationSettings.aspectRatio,
          ...(!generationSettings.multiShot &&
          !generationSettings.tailImageBase64 &&
          buildKlingCameraControl(generationSettings.cameraControl)
            ? { camera_control: buildKlingCameraControl(generationSettings.cameraControl) }
            : {}),
          watermark: { enabled: generationSettings.watermark },
          external_task_id: randomUUID(),
        }),
      },
      {
        timeoutMs: defaultModelRequestTimeoutMs,
        timeoutMessage: "Kling 图生视频任务提交超时，请稍后重试",
      },
    );
    const p = (await res.json().catch(() => ({}))) as {
      code?: number | string;
      message?: string;
      data?: { task_id?: string; id?: string };
    };
    if (!res.ok) throw new Error(p.message ?? "Kling 任务片段提交失败");
    return p;
  });

  const taskId = payload.data?.task_id ?? payload.data?.id;
  if (!taskId) {
    throw new Error("Kling 任务片段返回缺少 task_id");
  }

  recordModelUsage({
    pricingKey,
    serviceName: "video.generate",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      videoSeconds: Math.max(0, generationSettings.durationSeconds),
      requestCount: 1,
    },
    requestId: taskId,
    remark: "Kling 图生视频（待配置官方单价）",
  });

  return {
    jobId: taskId,
    provider: "kling",
    modelId: runtime.modelId,
    logs: [
      `任务片段已提交：${taskId}`,
      `模型：${runtime.modelId}`,
      `模式：${generationSettings.mode}`,
      `音频：${generationSettings.generateAudio ? "开启" : "关闭"}`,
      `多镜头：${generationSettings.multiShot ? generationSettings.shotType : "关闭"}`,
      `运镜：${generationSettings.cameraControl === "auto" ? "自动匹配" : generationSettings.cameraControl}`,
    ],
    message: "Kling 任务片段已提交，正在生成中。",
  };
}

export async function submitLipSyncJob(input: {
  videoUrl: string;
  audioBase64: string;
}): Promise<SubmittedLiveVideoJob> {
  const runtime = getLipSyncProviderRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(`${runtime.providerLabel} 当前未启用 live 调用`);
  }

  const apiToken = getKlingAuthorizationToken();
  if (!apiToken) {
    throw new Error("未配置 Kling 鉴权信息，无法调用口型同步 API");
  }

  const pricingKey = "kling.lip_sync";
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "video.lip_sync",
    estimatedMetrics: {
      requestCount: 1,
    },
  });

  const payload = await withRetry(async () => {
    const res = await fetchWithTimeout(
      `${getKlingApiBase()}/v1/videos/lip-sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getKlingAuthorizationToken()}`,
        },
        body: JSON.stringify({
          input: {
            video_url: input.videoUrl,
            mode: "audio2video",
            audio_type: "file",
            audio_file: input.audioBase64,
          },
        }),
      },
      {
        timeoutMs: defaultModelRequestTimeoutMs,
        timeoutMessage: "Kling 口型同步任务提交超时，请稍后重试",
      },
    );
    const p = (await res.json().catch(() => ({}))) as {
      code?: number | string;
      message?: string;
      data?: { task_id?: string; id?: string };
    };
    if (!res.ok) throw new Error(p.message ?? "Kling 口型同步任务提交失败");
    return p;
  });

  const taskId = payload.data?.task_id ?? payload.data?.id;
  if (!taskId) {
    throw new Error("Kling 口型同步返回缺少 task_id");
  }

  recordModelUsage({
    pricingKey,
    serviceName: "video.lip_sync",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      requestCount: 1,
    },
    requestId: taskId,
    remark: "Kling 口型同步（待配置官方单价）",
  });

  return {
    jobId: taskId,
    provider: "kling",
    modelId: runtime.modelId,
    logs: [`口型同步任务已提交：${taskId}`, `模型：${runtime.modelId}`, `模式：audio2video`],
    message: "Kling 口型同步任务已提交，正在处理中。",
  };
}

function isLipSyncJob(job: VideoJobRecord) {
  return job.strategy.style === "Kling lip-sync 口型同步";
}

async function refreshKlingVideoJob(job: VideoJobRecord): Promise<RefreshedLiveVideoJob> {
  const apiToken = getKlingAuthorizationToken();
  if (!apiToken) {
    return {
      status: "FAILED",
      logs: [...job.logs, "刷新失败：缺少 Kling 鉴权信息"],
      videoUrl: job.videoUrl,
      remoteVideoUrl: job.remoteVideoUrl,
      error: "缺少 Kling 鉴权信息",
    };
  }

  if (isLipSyncJob(job)) {
    const { payload } = await fetchProviderJsonWithRetry<{
      message?: string;
      data?: { task_status?: string; task_status_msg?: string; task_result?: unknown };
    }>(
      `${getKlingApiBase()}/v1/videos/lip-sync/${job.jobId}`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
      },
      {
        timeoutMs: defaultModelPollTimeoutMs,
        timeoutMessage: "Kling 口型同步状态查询超时",
        failureMessage: "Kling 口型同步查询失败",
      },
    );

    const taskStatus = payload.data?.task_status;
    const mappedStatus = mapKlingStatus(taskStatus);
    const remoteVideoUrl =
      mappedStatus === "COMPLETED" ? extractKlingVideoUrl(payload.data?.task_result ?? payload.data) : null;

    return {
      status: mappedStatus,
      logs: [...job.logs, `Kling 口型同步状态更新：${taskStatus ?? "unknown"}`],
      videoUrl: job.videoUrl,
      remoteVideoUrl: remoteVideoUrl ?? job.remoteVideoUrl ?? null,
      error:
        mappedStatus === "FAILED" ? (payload.data?.task_status_msg ?? payload.message ?? "口型同步生成失败") : null,
    };
  }

  if (job.generationSettings?.sourceImageUrl) {
    const { payload } = await fetchProviderJsonWithRetry<{
      message?: string;
      data?: { task_status?: string; task_status_msg?: string; task_result?: unknown };
    }>(
      `${getKlingApiBase()}/v1/videos/image2video/${job.jobId}`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
      },
      {
        timeoutMs: defaultModelPollTimeoutMs,
        timeoutMessage: "Kling 视频状态查询超时",
        failureMessage: "Kling 查询失败",
      },
    );

    const taskStatus = payload.data?.task_status;
    const mappedStatus = mapKlingStatus(taskStatus);
    const remoteVideoUrl =
      mappedStatus === "COMPLETED" ? extractKlingVideoUrl(payload.data?.task_result ?? payload.data) : null;

    return {
      status: mappedStatus,
      logs: [...job.logs, `Kling 状态更新：${taskStatus ?? "unknown"}`],
      videoUrl: job.videoUrl,
      remoteVideoUrl: remoteVideoUrl ?? job.remoteVideoUrl ?? null,
      error:
        mappedStatus === "FAILED" ? (payload.data?.task_status_msg ?? payload.message ?? "任务片段生成失败") : null,
    };
  }

  return {
    status: job.status,
    logs: job.logs,
    videoUrl: job.videoUrl,
    remoteVideoUrl: job.remoteVideoUrl,
    error: job.error,
  };
}

// ---------------------------------------------------------------------------
// Seedance 2.0 (Volcengine Ark) provider
// ---------------------------------------------------------------------------

function getSeedanceApiKey() {
  const localConfig = loadOptionalEnvFile("video.env.local");
  return process.env.ARK_API_KEY ?? localConfig.ARK_API_KEY ?? "";
}

function getSeedanceApiBase() {
  const runtime = getProviderRuntime("seedance");
  return runtime.apiBase.replace(/\/$/, "");
}

type SeedanceContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role?: string }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "audio_url"; audio_url: { url: string } };

type SeedanceSubmitError = Error & {
  retryable?: boolean;
  status?: number;
  code?: string;
};

export type SeedanceGenerationInput = {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  durationSeconds: number;
  ratio: string;
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
};

const seedancePromptSensitiveReplacements: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /天安门广场|天安门城楼|天安门/giu, replacement: "首都城市中心地标广场" },
  { pattern: /升旗仪式|升旗/giu, replacement: "清晨广场仪式感场景" },
  { pattern: /故宫博物院|故宫/giu, replacement: "皇家宫殿建筑群" },
  { pattern: /祈年殿|天坛/giu, replacement: "古代坛庙建筑" },
  { pattern: /圆明园遗址公园|圆明园/giu, replacement: "皇家园林遗址" },
  { pattern: /人民大会堂/giu, replacement: "大型礼堂建筑" },
  { pattern: /人民英雄纪念碑/giu, replacement: "广场纪念碑" },
  { pattern: /毛主席纪念堂/giu, replacement: "纪念堂建筑" },
  { pattern: /国家博物馆|军事博物馆|国博|军博/giu, replacement: "大型博物馆" },
  { pattern: /清华北大|清华大学|北京大学|清华|北大/giu, replacement: "知名高校门口" },
];

const aggressiveSeedanceSensitiveReplacements: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /首都城市中心地标广场/giu, replacement: "城市中心开阔广场" },
  { pattern: /清晨广场仪式感场景/giu, replacement: "清晨广场人群场景" },
  { pattern: /皇家宫殿建筑群/giu, replacement: "古典宫殿建筑群" },
  { pattern: /古代坛庙建筑/giu, replacement: "古典礼制建筑" },
  { pattern: /皇家园林遗址/giu, replacement: "古典园林遗址" },
  { pattern: /大型礼堂建筑/giu, replacement: "大型公共建筑" },
  { pattern: /广场纪念碑/giu, replacement: "城市纪念碑" },
  { pattern: /纪念堂建筑/giu, replacement: "纪念性建筑" },
  { pattern: /大型博物馆/giu, replacement: "公共展馆" },
  { pattern: /知名高校门口/giu, replacement: "学院风校门外景" },
];

const SEEDANCE_SENSITIVE_REWRITE_SYSTEM_PROMPT = [
  "你是一名视频生成提示词安全改写助手。",
  "请把输入的中文视频提示词改写成更容易通过视频模型安全审核的版本。",
  "只输出一段纯文本提示词，不要解释，不要 markdown。",
  "要求：",
  "1. 保留镜头顺序、人物关系、镜头语言、时间氛围、景别、动作和旅行纪实感。",
  "2. 不要出现敏感公共事件、过于敏感的公共场所、具体机构全名或容易触发审核的地标名称。",
  "3. 可以改为更泛化但仍可拍摄的描述，如“城市中心广场”“古典宫殿建筑群”“大型公共建筑”。",
  "4. 保留画面可执行性，不要改成抽象空话。",
].join("\n");

function normalizeSeedancePromptWhitespace(prompt: string) {
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .trim();
}

function dedupeSeedancePromptClauses(prompt: string) {
  const rawClauses = prompt
    .split(/\n|(?<=[，。])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const clause of rawClauses) {
    const normalized = clause.replace(/[，。:：]/g, "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(clause);
  }

  return deduped.join("\n").trim();
}

export function sanitizeSeedancePromptForModeration(prompt: string, aggressive = false) {
  let result = normalizeSeedancePromptWhitespace(prompt);

  for (const replacement of seedancePromptSensitiveReplacements) {
    result = result.replace(replacement.pattern, replacement.replacement);
  }

  if (aggressive) {
    for (const replacement of aggressiveSeedanceSensitiveReplacements) {
      result = result.replace(replacement.pattern, replacement.replacement);
    }
    result = result
      .replace(/北京中轴线|中轴线/giu, "城市历史文化轴线")
      .replace(/首都/giu, "城市");
  }

  return normalizeSeedancePromptWhitespace(dedupeSeedancePromptClauses(result));
}

export function isSeedanceSensitivePromptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";

  return /InputTextSensitiveContentDetected|sensitive information|敏感|安全拦截|审核/i.test(`${code} ${message}`);
}

async function rewriteSensitiveSeedancePrompt(prompt: string) {
  const deterministicPrompt = sanitizeSeedancePromptForModeration(prompt, true);

  try {
    const rewritten = await callTaskGenerationLlm({
      systemPrompt: SEEDANCE_SENSITIVE_REWRITE_SYSTEM_PROMPT,
      userContent: deterministicPrompt,
      temperature: 0.2,
      maxCompletionTokens: 1400,
    });

    if (!rewritten?.trim()) {
      return deterministicPrompt;
    }

    return sanitizeSeedancePromptForModeration(rewritten, true);
  } catch {
    return deterministicPrompt;
  }
}

function dedupeSeedancePromptVariants(variants: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const variant of variants) {
    const normalized = normalizeSeedancePromptWhitespace(variant ?? "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function extractSeedanceErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedCode = (nestedError as Record<string, unknown>).code;
    if (typeof nestedCode === "string" && nestedCode) {
      return nestedCode;
    }
  }

  const directCode = record.code;
  return typeof directCode === "string" && directCode ? directCode : undefined;
}

function extractSeedanceErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage) {
      return nestedMessage;
    }
  }

  const directMessage = record.message;
  return typeof directMessage === "string" && directMessage ? directMessage : undefined;
}

function buildSeedanceSubmitError(status: number, payload: unknown): SeedanceSubmitError {
  const code = extractSeedanceErrorCode(payload);
  const message = extractSeedanceErrorMessage(payload);
  const detail = message || JSON.stringify(payload).slice(0, 300);
  const error = new Error(
    `Seedance 任务提交失败 (${status})${code ? ` [${code}]` : ""}: ${detail || "未知错误"}`,
  ) as SeedanceSubmitError;
  error.status = status;
  error.code = code;
  if (status >= 400 && status < 500 && status !== 429) {
    error.retryable = false;
  }
  return error;
}

function buildSeedanceContentArray(input: SeedanceGenerationInput): SeedanceContentItem[] {
  const items: SeedanceContentItem[] = [];
  items.push({ type: "text", text: input.prompt });
  const firstImage = (input.imageUrls ?? [])[0];
  if (firstImage) {
    items.push({ type: "image_url", image_url: { url: firstImage }, role: "first_frame" });
  }
  for (const url of input.videoUrls ?? []) {
    items.push({ type: "video_url", video_url: { url } });
  }
  for (const url of input.audioUrls ?? []) {
    items.push({ type: "audio_url", audio_url: { url } });
  }
  return items;
}

function mapSeedanceStatus(status?: string): VideoJobRecord["status"] {
  switch (status) {
    case "queued":
    case "Pending":
    case "Staged":
      return "QUEUED";
    case "running":
    case "Processing":
      return "IN_PROGRESS";
    case "succeeded":
    case "Completed":
      return "COMPLETED";
    case "failed":
    case "Failed":
    case "expired":
    case "cancelled":
      return "FAILED";
    default:
      return "IN_PROGRESS";
  }
}

function extractSeedanceVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  // Volcengine Ark format: { content: { video_url: "..." } }
  const content = record.content;
  if (content && typeof content === "object") {
    const videoUrl = (content as Record<string, unknown>).video_url;
    if (typeof videoUrl === "string" && videoUrl) return videoUrl;
  }

  // Direct video_url
  if (typeof record.video_url === "string" && record.video_url) return record.video_url;

  // PiAPI format: { output: { video: "..." } }
  const output = record.output;
  if (output && typeof output === "object") {
    const video = (output as Record<string, unknown>).video;
    if (typeof video === "string" && video) return video;
  }

  // Nested data wrapper
  const data = record.data;
  if (data && typeof data === "object") return extractSeedanceVideoUrl(data);

  return null;
}

async function submitSeedanceVideoJobOnce(
  input: SeedanceGenerationInput,
): Promise<{ payload: { id?: string; data?: { task_id?: string } }; optimizedPrompt: string }> {
  const apiKey = getSeedanceApiKey();

  const contentArray = buildSeedanceContentArray(input);

  const { payload } = await withRetry(async () => {
    const res = await fetchWithTimeout(
      `${getSeedanceApiBase()}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: getProviderRuntime("seedance").modelId,
          content: contentArray,
          duration: Math.max(4, Math.min(10, input.durationSeconds)),
          ratio: input.ratio,
          ...(!input.imageUrls?.length ? { resolution: input.resolution ?? "1080p" } : {}),
          generate_audio: input.generateAudio ?? false,
          watermark: input.watermark ?? false,
        }),
      },
      {
        timeoutMs: defaultModelRequestTimeoutMs,
        timeoutMessage: "Seedance 任务提交超时，请稍后重试",
      },
    );
    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      code?: number | string;
      message?: string;
      error?: { code?: string; message?: string };
      data?: { task_id?: string };
    };
    if (!res.ok) {
      throw buildSeedanceSubmitError(res.status, payload);
    }
    return { payload };
  });

  return { payload, optimizedPrompt: input.prompt };
}

export async function submitSeedanceVideoJob(input: SeedanceGenerationInput): Promise<SubmittedLiveVideoJob> {
  const runtime = getProviderRuntime("seedance");

  if (!runtime.liveEnabled) {
    throw new Error("Seedance 2.0 当前未启用，请检查 ARK_API_KEY 配置");
  }

  const apiKey = getSeedanceApiKey();
  if (!apiKey) {
    throw new Error("未配置 ARK_API_KEY，无法调用 Seedance 2.0 API");
  }

  const pricingKey = "doubao.seedance.2.0";
  assertModelUsagePreflight({
    pricingKey,
    serviceName: "video.generate",
    estimatedMetrics: {
      videoSeconds: Math.max(0, input.durationSeconds),
      requestCount: 1,
    },
  });

  const promptVariants = dedupeSeedancePromptVariants([
    input.prompt,
    sanitizeSeedancePromptForModeration(input.prompt),
    sanitizeSeedancePromptForModeration(input.prompt, true),
  ]);

  let lastError: unknown = null;
  let successfulSubmission:
    | { payload: { id?: string; data?: { task_id?: string } }; optimizedPrompt: string }
    | null = null;

  for (const variant of promptVariants) {
    try {
      successfulSubmission = await submitSeedanceVideoJobOnce({
        ...input,
        prompt: variant,
      });
      break;
    } catch (error) {
      lastError = error;
      if (!isSeedanceSensitivePromptError(error)) {
        throw error;
      }
    }
  }

  if (!successfulSubmission && isSeedanceSensitivePromptError(lastError)) {
    const rewrittenPrompt = await rewriteSensitiveSeedancePrompt(input.prompt);
    const retryCandidates = dedupeSeedancePromptVariants([rewrittenPrompt, sanitizeSeedancePromptForModeration(rewrittenPrompt, true)]);

    for (const variant of retryCandidates) {
      if (promptVariants.includes(variant)) {
        continue;
      }
      try {
        successfulSubmission = await submitSeedanceVideoJobOnce({
          ...input,
          prompt: variant,
        });
        break;
      } catch (error) {
        lastError = error;
        if (!isSeedanceSensitivePromptError(error)) {
          throw error;
        }
      }
    }
  }

  if (!successfulSubmission) {
    throw lastError instanceof Error ? lastError : new Error("Seedance 任务提交失败");
  }

  const { payload, optimizedPrompt } = successfulSubmission;

  const taskId = payload.id ?? payload.data?.task_id;
  if (!taskId) {
    throw new Error("Seedance 返回缺少 task_id");
  }

  const imageCount = input.imageUrls?.length ?? 0;
  recordModelUsage({
    pricingKey,
    serviceName: "video.generate",
    provider: runtime.providerLabel,
    modelId: runtime.modelId,
    metrics: {
      videoSeconds: Math.max(0, input.durationSeconds),
      requestCount: 1,
    },
    requestId: taskId,
    remark: "Seedance 视频生成",
  });
  return {
    jobId: taskId,
    provider: "seedance",
    modelId: runtime.modelId,
    logs: [
      `Seedance 任务已提交：${taskId}`,
      `模型：${runtime.modelId}`,
      `时长：${input.durationSeconds}s`,
      `比例：${input.ratio}`,
      `图片数量：${imageCount}`,
      `原生音频：${input.generateAudio ? "开启" : "关闭"}`,
      ...(optimizedPrompt !== normalizeSeedancePromptWhitespace(input.prompt) ? ["提示词已自动做安全泛化处理"] : []),
    ],
    message: "Seedance 2.0 任务已提交，正在生成中。",
    optimizedPrompt,
  };
}

export async function refreshSeedanceVideoJob(job: VideoJobRecord): Promise<RefreshedLiveVideoJob> {
  const apiKey = getSeedanceApiKey();
  if (!apiKey) {
    return {
      status: "FAILED",
      logs: [...job.logs, "刷新失败：缺少 ARK_API_KEY"],
      videoUrl: job.videoUrl,
      remoteVideoUrl: job.remoteVideoUrl,
      error: "缺少 ARK_API_KEY",
    };
  }

  const { payload } = await fetchProviderJsonWithRetry<Record<string, unknown>>(
    `${getSeedanceApiBase()}/contents/generations/tasks/${job.jobId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    {
      timeoutMs: defaultModelPollTimeoutMs,
      timeoutMessage: "Seedance 状态查询超时",
      failureMessage: "Seedance 查询失败",
    },
  );

  const taskStatus = (payload.status as string) ?? "";
  const mappedStatus = mapSeedanceStatus(taskStatus);
  const remoteVideoUrl = mappedStatus === "COMPLETED" ? extractSeedanceVideoUrl(payload) : null;

  return {
    status: mappedStatus,
    logs: [...job.logs, `Seedance 状态更新：${taskStatus || "unknown"}`],
    videoUrl: job.videoUrl,
    remoteVideoUrl: remoteVideoUrl ?? job.remoteVideoUrl ?? null,
    error:
      mappedStatus === "FAILED"
        ? (((payload.error as Record<string, unknown>)?.message as string) ??
          (payload.message as string) ??
          "Seedance 生成失败")
        : null,
  };
}

// ---------------------------------------------------------------------------
// Unified dispatch: routes provider calls to the right implementation
// ---------------------------------------------------------------------------

export async function refreshProviderVideoJob(job: VideoJobRecord): Promise<RefreshedLiveVideoJob> {
  if (job.provider === "seedance") {
    return refreshSeedanceVideoJob(job);
  }
  return refreshKlingVideoJob(job);
}
