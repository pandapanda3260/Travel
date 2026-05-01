import { statSync } from "node:fs";
import { readFileSync } from "node:fs";

import { getAsrRuntime } from "./asr-provider-config";
import {
  confirmCommercialModelUsageCharge,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
} from "./model-usage-service";

export type AsrResult = {
  text: string;
  utterances: Array<{
    text: string;
    startTime: number;
    endTime: number;
  }>;
};

function normalizeApiBase(apiBase: string) {
  return apiBase.replace(/\/$/, "");
}

function estimateAudioSeconds(audioFilePath: string, format: string) {
  if (format !== "wav") {
    return 0;
  }

  try {
    const fileSize = statSync(audioFilePath).size;
    const pcmBytes = Math.max(fileSize - 44, 0);
    return Math.max(pcmBytes / 32000, 0);
  } catch {
    return 0;
  }
}

/**
 * Transcribe an audio file using Doubao BigModel ASR (flash/turbo mode).
 * Reads the file from local disk, encodes to base64, and sends directly.
 * No public URL needed; result is returned synchronously.
 */
export async function transcribeAudioFile(audioFilePath: string, format: string = "wav"): Promise<AsrResult> {
  const runtime = getAsrRuntime();

  if (!runtime.liveEnabled) {
    throw new Error(
      `火山方舟 Doubao-录音文件识别2.0 当前未启用，请检查 ${runtime.configFileName} 中的 VOLCENGINE_AUDIO_APP_ID 和 VOLCENGINE_AUDIO_ACCESS_TOKEN 是否已配置。`,
    );
  }

  const audioBuffer = readFileSync(audioFilePath);
  const audioBase64 = audioBuffer.toString("base64");
  const requestId = crypto.randomUUID();
  const apiBase = normalizeApiBase(runtime.apiBase);
  const pricingKey = "doubao.asr.file.2.0";
  const estimatedMetrics = {
    audioSeconds: estimateAudioSeconds(audioFilePath, format),
    requestCount: 1,
  };
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "audio.asr",
    estimatedMetrics,
  });

  try {
    const response = await fetch(`${apiBase}/api/v3/auc/bigmodel/recognize/flash`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Key": runtime.appId,
        "X-Api-Access-Key": runtime.accessToken,
        "X-Api-Resource-Id": runtime.resourceId,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({
        audio: {
          data: audioBase64,
          format: format,
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
        },
      }),
    });

    const responseData = (await response.json()) as {
      resp?: { code?: number; message?: string };
      result?: {
        text?: string;
        utterances?: Array<{
          text?: string;
          start_time?: number;
          end_time?: number;
        }>;
      };
    };

    if (!response.ok) {
      throw new Error(responseData.resp?.message ?? `语音识别请求失败 (HTTP ${response.status})`);
    }

    if (responseData.resp?.code && responseData.resp.code !== 0) {
      throw new Error(responseData.resp.message ?? `语音识别失败 (code: ${responseData.resp.code})`);
    }

    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
      serviceName: "audio.asr",
      provider: runtime.providerLabel,
      modelId: runtime.resourceId,
      metrics: estimatedMetrics,
      requestId,
      remark: "录音文件识别",
    });

    return {
      text: responseData.result?.text ?? "",
      utterances: (responseData.result?.utterances ?? []).map((u) => ({
        text: u.text ?? "",
        startTime: u.start_time ?? 0,
        endTime: u.end_time ?? 0,
      })),
    };
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }
}
