import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { KlingGenerationSettings } from "./prompt";
import type { VideoJobRecord } from "./video-job-store";
import { getProviderRuntime } from "./video-provider-config";
import { withRetry } from "./retry";

type SubmittedLiveVideoJob = {
  jobId: string;
  provider: "kling";
  modelId: string;
  logs: string[];
  message: string;
};

type RefreshedLiveVideoJob = Pick<
  VideoJobRecord,
  "status" | "logs" | "videoUrl" | "remoteVideoUrl" | "error"
>;

function loadOptionalEnvFile(fileName: string) {
  const filePath = join(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce<Record<string, string>>((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        return accumulator;
      }

      accumulator[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
      return accumulator;
    }, {});
}

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
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

  const { response, payload } = await withRetry(async () => {
    const res = await fetch(`${getKlingApiBase()}/v1/videos/text2video`, {
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
    });
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

  return {
    jobId: taskId,
    provider: "kling",
    modelId: runtime.modelId,
    logs: [
      `文生视频任务已提交：${taskId}`,
      `模型：${runtime.modelId}`,
      `模式：${generationSettings.mode}`,
    ],
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

  const payload = await withRetry(async () => {
    const res = await fetch(`${getKlingApiBase()}/v1/videos/image2video`, {
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
        ...(!generationSettings.multiShot && !generationSettings.tailImageBase64 && buildKlingCameraControl(generationSettings.cameraControl)
          ? { camera_control: buildKlingCameraControl(generationSettings.cameraControl) }
          : {}),
        watermark: { enabled: generationSettings.watermark },
        external_task_id: randomUUID(),
      }),
    });
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
  const runtime = getProviderRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(`${runtime.providerLabel} 当前未启用 live 调用`);
  }

  const apiToken = getKlingAuthorizationToken();
  if (!apiToken) {
    throw new Error("未配置 Kling 鉴权信息，无法调用口型同步 API");
  }

  const payload = await withRetry(async () => {
    const res = await fetch(`${getKlingApiBase()}/v1/videos/lip-sync`, {
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
    });
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

  return {
    jobId: taskId,
    provider: "kling",
    modelId: runtime.modelId,
    logs: [
      `口型同步任务已提交：${taskId}`,
      `模型：${runtime.modelId}`,
      `模式：audio2video`,
    ],
    message: "Kling 口型同步任务已提交，正在处理中。",
  };
}

function isLipSyncJob(job: VideoJobRecord) {
  return job.strategy.style === "Kling lip-sync 口型同步";
}

export async function refreshProviderVideoJob(job: VideoJobRecord): Promise<RefreshedLiveVideoJob> {
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
    const response = await fetch(`${getKlingApiBase()}/v1/videos/lip-sync/${job.jobId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      data?: { task_status?: string; task_status_msg?: string; task_result?: unknown };
    };

    if (!response.ok) {
      return {
        status: "FAILED",
        logs: [...job.logs, `Kling 口型同步查询失败：${payload.message ?? "未知错误"}`],
        videoUrl: job.videoUrl,
        remoteVideoUrl: job.remoteVideoUrl,
        error: payload.message ?? "Kling 口型同步查询失败",
      };
    }

    const taskStatus = payload.data?.task_status;
    const mappedStatus = mapKlingStatus(taskStatus);
    const remoteVideoUrl = mappedStatus === "COMPLETED"
      ? extractKlingVideoUrl(payload.data?.task_result ?? payload.data)
      : null;

    return {
      status: mappedStatus,
      logs: [...job.logs, `Kling 口型同步状态更新：${taskStatus ?? "unknown"}`],
      videoUrl: job.videoUrl,
      remoteVideoUrl: remoteVideoUrl ?? job.remoteVideoUrl ?? null,
      error: mappedStatus === "FAILED"
        ? payload.data?.task_status_msg ?? payload.message ?? "口型同步生成失败"
        : null,
    };
  }

  if (job.generationSettings?.sourceImageUrl) {
    const response = await fetch(`${getKlingApiBase()}/v1/videos/image2video/${job.jobId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      data?: { task_status?: string; task_status_msg?: string; task_result?: unknown };
    };

    if (!response.ok) {
      return {
        status: "FAILED",
        logs: [...job.logs, `Kling 查询失败：${payload.message ?? "未知错误"}`],
        videoUrl: job.videoUrl,
        remoteVideoUrl: job.remoteVideoUrl,
        error: payload.message ?? "Kling 查询失败",
      };
    }

    const taskStatus = payload.data?.task_status;
    const mappedStatus = mapKlingStatus(taskStatus);
    const remoteVideoUrl = mappedStatus === "COMPLETED"
      ? extractKlingVideoUrl(payload.data?.task_result ?? payload.data)
      : null;

    return {
      status: mappedStatus,
      logs: [...job.logs, `Kling 状态更新：${taskStatus ?? "unknown"}`],
      videoUrl: job.videoUrl,
      remoteVideoUrl: remoteVideoUrl ?? job.remoteVideoUrl ?? null,
      error: mappedStatus === "FAILED"
        ? payload.data?.task_status_msg ?? payload.message ?? "任务片段生成失败"
        : null,
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
