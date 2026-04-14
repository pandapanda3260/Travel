import { getVoiceManagementRuntime } from "./voice-management-config";

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

  const response = await fetch("https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload", {
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
  });

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

  return {
    speakerId: payload.speaker_id ?? input.speakerId,
  };
}

export async function queryVoiceCloneStatus(speakerId: string): Promise<VoiceCloneStatusResult> {
  const runtime = getVoiceManagementRuntime();
  if (!runtime.cloneEnabled) {
    throw new Error("当前未配置豆包语音克隆所需 AppId / AccessToken。");
  }

  const response = await fetch("https://openspeech.bytedance.com/api/v1/mega_tts/status", {
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
  });

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
