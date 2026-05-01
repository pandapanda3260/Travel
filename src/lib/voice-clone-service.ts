import { withAdminProviderCallTracking } from "./admin-data-flow-tracking";
import { getVoiceManagementRuntime } from "./voice-management-config";
import {
  confirmCommercialModelUsageCharge,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
} from "./model-usage-service";
import { callSpeechOpenApi } from "./volc-speech-openapi";

export const supportedCloneFormats = ["wav", "mp3", "ogg", "m4a", "aac", "pcm"] as const;
export type SupportedCloneFormat = (typeof supportedCloneFormats)[number];

export type VoiceCloneUploadInput = {
  speakerId: string;
  title: string;
  audioBuffer: Buffer;
  fileFormat: SupportedCloneFormat;
  transcript: string;
  language: "cn" | "en";
  modelType: 4 | 5;
  enableDenoise?: boolean;
};

export type VoiceCloneStatusResult = {
  speakerId: string;
  status: "PENDING" | "TRAINING" | "SUCCESS" | "ACTIVE" | "FAILED";
  version: string | null;
  demoAudioUrl: string | null;
  alias?: string | null;
  availableTrainingTimes?: number | null;
};

type BatchMegaTTSTrainStatusItem = {
  SpeakerID?: string;
  SpeakerId?: string;
  speaker_id?: string;
  Alias?: string;
  State?: string | number;
  Status?: string | number;
  Version?: string;
  DemoAudio?: string;
  DemoAudioURL?: string;
  DemoURL?: string;
  AvailableTrainingTimes?: number;
};

type BatchMegaTTSTrainStatusResult = {
  Statuses?: BatchMegaTTSTrainStatusItem[];
};

function mapCloneStatus(status: number) {
  switch (status) {
    case 1:
      return "TRAINING";
    case 2:
      return "SUCCESS";
    case 4:
      return "ACTIVE";
    case 3:
      return "FAILED";
    default:
      return "PENDING";
  }
}

function mapCloneStatusValue(value: unknown): VoiceCloneStatusResult["status"] {
  if (typeof value === "number") {
    return mapCloneStatus(value);
  }

  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    return "PENDING";
  }
  if (normalized.includes("FAIL")) {
    return "FAILED";
  }
  if (normalized.includes("TRAIN")) {
    return "TRAINING";
  }
  if (normalized.includes("SUCCESS")) {
    return "SUCCESS";
  }
  if (normalized.includes("ACTIVE") || normalized.includes("VALID")) {
    return "ACTIVE";
  }
  return "PENDING";
}

function normalizeBatchStatusItem(item: BatchMegaTTSTrainStatusItem): VoiceCloneStatusResult | null {
  const speakerId = item.SpeakerID ?? item.SpeakerId ?? item.speaker_id;
  if (!speakerId) {
    return null;
  }

  return {
    speakerId,
    status: mapCloneStatusValue(item.State ?? item.Status),
    version: item.Version ?? null,
    demoAudioUrl: item.DemoAudio ?? item.DemoAudioURL ?? item.DemoURL ?? null,
    alias: item.Alias?.trim() || null,
    availableTrainingTimes:
      typeof item.AvailableTrainingTimes === "number" ? item.AvailableTrainingTimes : null,
  };
}

async function callBatchMegaTTSTrainStatus(speakerIds: string[]) {
  const runtime = getVoiceManagementRuntime();
  const basePayload: Record<string, unknown> = {
    SpeakerIDs: speakerIds,
    PageNumber: 1,
    PageSize: Math.max(10, speakerIds.length),
  };
  if (runtime.openApiProjectName) {
    basePayload.ProjectName = runtime.openApiProjectName;
  }

  const attempts: Array<{ version: string; payload: Record<string, unknown> }> = [
    { version: "2025-05-21", payload: basePayload },
    {
      version: "2023-11-07",
      payload: {
        ...basePayload,
        ...(runtime.appId ? { AppID: runtime.appId } : {}),
      },
    },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      return await withAdminProviderCallTracking(
        {
          enabled: runtime.cloneEnabled,
          serviceName: "voice.clone.status_batch",
          provider: "火山引擎 · 声音复刻",
          modelId: runtime.cloneResourceId,
          objectType: "voice_clone_batch",
          objectId: speakerIds.join(",").slice(0, 180),
        },
        () =>
          callSpeechOpenApi<BatchMegaTTSTrainStatusResult>(
            "BatchListMegaTTSTrainStatus",
            attempt.version,
            attempt.payload,
          ),
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("声音复刻批量状态查询失败");
      if (!lastError.message.includes("InvalidActionOrVersion")) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("声音复刻批量状态查询失败");
}

export async function queryVoiceCloneStatuses(speakerIds: string[]) {
  const uniqueSpeakerIds = Array.from(new Set(speakerIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueSpeakerIds.length === 0) {
    return new Map<string, VoiceCloneStatusResult>();
  }

  const result = await callBatchMegaTTSTrainStatus(uniqueSpeakerIds);
  const statuses = new Map<string, VoiceCloneStatusResult>();
  for (const item of result.Statuses ?? []) {
    const normalized = normalizeBatchStatusItem(item);
    if (normalized) {
      statuses.set(normalized.speakerId, normalized);
    }
  }

  return statuses;
}

export async function queryVoiceCloneStatusesWithFallback(speakerIds: string[]) {
  try {
    return await queryVoiceCloneStatuses(speakerIds);
  } catch {
    const results = await Promise.allSettled(speakerIds.map((speakerId) => queryVoiceCloneStatus(speakerId)));
    const statuses = new Map<string, VoiceCloneStatusResult>();
    for (const result of results) {
      if (result.status === "fulfilled") {
        statuses.set(result.value.speakerId, result.value);
      }
    }
    return statuses;
  }
}

/**
 * Upload audio for voice clone training (V1 API).
 *
 * speaker_id MUST be a pre-allocated slot from the Volcengine console (format: S_xxxxxxx).
 * Purchase slots at: 控制台 → 语音技术 → 声音复刻 → 下单
 */
export async function uploadVoiceClone(input: VoiceCloneUploadInput) {
  const runtime = getVoiceManagementRuntime();
  if (!runtime.cloneEnabled) {
    throw new Error("当前未配置豆包语音克隆所需 AppId / AccessToken。");
  }

  if (!input.speakerId) {
    throw new Error(
      "缺少音色槽位 ID（speaker_id）。请在火山引擎控制台「语音技术 → 声音复刻」中购买槽位后，将分配的 S_xxxxxxx 格式 ID 填入。",
    );
  }

  const pricingKey = "doubao.voice.clone.2.0";
  const estimatedMetrics = {
    characterCount: Array.from(input.transcript).length,
    requestCount: 1,
  };
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "voice.clone",
    estimatedMetrics,
  });

  try {
    const response = await withAdminProviderCallTracking(
      {
        enabled: runtime.cloneEnabled,
        serviceName: "voice.clone.upload",
        provider: "火山引擎 · 声音复刻",
        modelId: runtime.cloneResourceId,
        objectType: "voice_clone",
        objectId: input.speakerId,
      },
      () =>
        fetch("https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer;${runtime.accessToken}`,
            "Content-Type": "application/json",
            "Resource-Id": runtime.cloneResourceId,
          },
          body: JSON.stringify({
            appid: runtime.appId,
            speaker_id: input.speakerId,
            audios: [
              {
                audio_bytes: input.audioBuffer.toString("base64"),
                audio_format: input.fileFormat,
                text: input.transcript,
              },
            ],
            source: 2,
            language: input.language === "en" ? 1 : 0,
            model_type: input.modelType,
            extra_params: JSON.stringify({
              demo_text: input.transcript.slice(0, 80),
              enable_audio_denoise: input.enableDenoise ?? false,
            }),
          }),
        }),
    );

    const payload = (await response.json().catch(() => ({}))) as {
      BaseResp?: {
        StatusCode?: number;
        StatusMessage?: string;
      };
      speaker_id?: string;
    };

    if (!response.ok || payload.BaseResp?.StatusCode !== 0) {
      const apiMsg = payload.BaseResp?.StatusMessage ?? "";
      const code = payload.BaseResp?.StatusCode;

      if (apiMsg.includes("mismatched") || code === 1107) {
        throw new Error(
          `音色槽位 ID「${input.speakerId}」无法使用（${apiMsg}）。` +
          "请确认该 ID 是从火山引擎控制台「声音复刻」中获取的有效槽位，且与当前 Resource-Id（" +
          runtime.cloneResourceId +
          "）匹配。",
        );
      }

      throw new Error(apiMsg || "声音复刻提交失败");
    }

    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
      serviceName: "voice.clone",
      provider: "火山引擎 · 声音复刻",
      modelId: runtime.cloneResourceId,
      metrics: estimatedMetrics,
      requestId: payload.speaker_id ?? input.speakerId,
      objectType: "voice_clone",
      objectId: input.speakerId,
      remark: "声音复刻训练提交",
    });

    return {
      speakerId: payload.speaker_id ?? input.speakerId,
    };
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }
}

export async function queryVoiceCloneStatus(speakerId: string): Promise<VoiceCloneStatusResult> {
  const runtime = getVoiceManagementRuntime();
  if (!runtime.cloneEnabled) {
    throw new Error("当前未配置豆包语音克隆所需 AppId / AccessToken。");
  }

  const response = await withAdminProviderCallTracking(
    {
      enabled: runtime.cloneEnabled,
      serviceName: "voice.clone.status",
      provider: "火山引擎 · 声音复刻",
      modelId: runtime.cloneResourceId,
      objectType: "voice_clone",
      objectId: speakerId,
    },
    () =>
      fetch("https://openspeech.bytedance.com/api/v1/mega_tts/status", {
        method: "POST",
        headers: {
          Authorization: `Bearer;${runtime.accessToken}`,
          "Content-Type": "application/json",
          "Resource-Id": runtime.cloneResourceId,
        },
        body: JSON.stringify({
          appid: runtime.appId,
          speaker_id: speakerId,
        }),
      }),
  );

  const payload = (await response.json().catch(() => ({}))) as {
    BaseResp?: {
      StatusCode?: number;
      StatusMessage?: string;
    };
    speaker_id?: string;
    status?: number;
    version?: string;
    demo_audio?: string;
  };

  if (!response.ok || payload.BaseResp?.StatusCode !== 0) {
    throw new Error(payload.BaseResp?.StatusMessage ?? "声音复刻状态查询失败");
  }

  return {
    speakerId: payload.speaker_id ?? speakerId,
    status: mapCloneStatus(payload.status ?? 0),
    version: payload.version ?? null,
    demoAudioUrl: payload.demo_audio ?? null,
  };
}
