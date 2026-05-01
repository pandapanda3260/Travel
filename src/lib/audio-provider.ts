import { execFile } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getSpeechSynthesisRuntime, type SpeechSynthesisRuntime } from "./audio-provider-config";
import { getFfmpegBinaryPath } from "./ffmpeg-runtime";
import { createMockSpeechResult } from "./mock-aigc-assets";
import {
  confirmCommercialModelUsageCharge,
  prepareCommercialModelUsageCharge,
  releaseCommercialModelUsageCharge,
} from "./model-usage-service";
import { joinRuntimePublicStoragePath } from "./runtime-storage";
import { withRetry } from "./retry";
import { defaultModelRequestTimeoutMs, fetchWithTimeout } from "./timeout";

const execFileAsync = promisify(execFile);

export type SpeechSynthesisRequest = {
  text: string;
  voiceId?: string;
  taskId?: string | null;
  resourceId?: string;
  format?: "mp3" | "ogg_opus" | "pcm";
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  speechRate?: number;
  loudnessRate?: number;
  enableSubtitle?: boolean;
  emotion?: string | null;
  emotionScale?: number | null;
  contextTexts?: string[];
  pitch?: number | null;
  silenceDuration?: number | null;
};

export type SpeechSynthesisResult = {
  audioUrl: string;
  audioDurationSeconds: number | null;
  words: Array<{
    word: string;
    startTime: number;
    endTime: number;
  }>;
  usageTextWords: number | null;
};

export type SpeechSynthesisResultWithResource = SpeechSynthesisResult & {
  resolvedResourceId: string | undefined;
};

function normalizeApiBase(apiBase: string) {
  return apiBase.replace(/\/$/, "");
}

function getOutputExtension(format: SpeechSynthesisRequest["format"]) {
  switch (format) {
    case "ogg_opus":
      return "ogg";
    case "pcm":
      return "pcm";
    default:
      return "mp3";
  }
}

function getAudioOutputDir(taskId?: string | null) {
  return joinRuntimePublicStoragePath("generated-audio", taskId?.trim() || "_unassigned", "narration");
}

function getAudioOutputUrl(taskId: string | null | undefined, fileName: string) {
  return `/generated-audio/${taskId?.trim() || "_unassigned"}/narration/${fileName}`;
}

function resolveFfmpegPath() {
  return getFfmpegBinaryPath();
}

async function probeMediaDurationSeconds(inputPath: string) {
  const ffmpegPath = resolveFfmpegPath();

  try {
    const { stderr } = await execFileAsync(ffmpegPath, ["-i", inputPath, "-f", "null", "-"]);
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 100) / 100;
  } catch (error) {
    const text =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : "";
    const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);

    if (!match) {
      return null;
    }

    const [, hours, minutes, seconds] = match;
    return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 100) / 100;
  }
}

function readTimedWordNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value == null || value === "") {
      continue;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function normalizeTimedWordPayload(item: unknown) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const word = String(record.word ?? record.text ?? record.value ?? "").trim();
  if (!word) {
    return null;
  }

  const startTime = readTimedWordNumber(record, ["startTime", "start_time", "beginTime", "begin_time", "start", "begin"]);
  const endTime = readTimedWordNumber(record, ["endTime", "end_time", "finishTime", "finish_time", "end", "stop"]);
  if (startTime == null || endTime == null) {
    return null;
  }

  return {
    word,
    startTime,
    endTime: Math.max(startTime, endTime),
  };
}

function collectTimedWordPayloads(value: unknown, depth = 0): Array<{ word: string; startTime: number; endTime: number }> {
  if (depth > 5) {
    return [];
  }

  const normalized = normalizeTimedWordPayload(value);
  if (normalized) {
    return [normalized];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTimedWordPayloads(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase();
    if (
      typeof nestedValue === "string" &&
      ["audio", "audio_data", "binary", "buffer", "data"].includes(normalizedKey)
    ) {
      return [];
    }

    return collectTimedWordPayloads(nestedValue, depth + 1);
  });
}

export function parseSseTextPayload(source: string) {
  const lines = source.split(/\r?\n/);
  const audioChunks: Buffer[] = [];
  const words: Array<{ word: string; startTime: number; endTime: number }> = [];
  let usageTextWords: number | null = null;
  let lastCode: number | null = null;
  let lastMessage: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) {
      continue;
    }

    const payloadText = trimmed.slice(6);
    if (!payloadText) {
      continue;
    }

    let payload: {
      code?: number;
      message?: string;
      data?: string | null;
      sentence?: {
        words?: Array<{
          word?: string;
          startTime?: number;
          endTime?: number;
        }>;
      };
      usage?: {
        text_words?: number;
      };
    };

    try {
      payload = JSON.parse(payloadText) as typeof payload;
    } catch {
      continue;
    }

    if (typeof payload.code === "number") {
      lastCode = payload.code;
    }

    if (typeof payload.message === "string" && payload.message) {
      lastMessage = payload.message;
    }

    if (typeof payload.data === "string" && payload.data) {
      audioChunks.push(Buffer.from(payload.data, "base64"));
    }

    words.push(...collectTimedWordPayloads(payload));

    if (typeof payload.usage?.text_words === "number") {
      usageTextWords = payload.usage.text_words;
    }
  }

  return {
    audioBuffer: Buffer.concat(audioChunks),
    words,
    usageTextWords,
    lastCode,
    lastMessage,
  };
}

function normalizeTimedWords(
  words: SpeechSynthesisResult["words"],
  audioDurationSeconds: number | null,
): SpeechSynthesisResult["words"] {
  if (words.length === 0) {
    return words;
  }

  const maxEndTime = Math.max(...words.map((word) => Number(word.endTime) || 0));
  const shouldConvertMilliseconds = audioDurationSeconds != null && maxEndTime > Math.max(audioDurationSeconds * 4, 60);
  const divisor = shouldConvertMilliseconds ? 1000 : 1;

  return words.map((word) => {
    const startTime = Math.max(0, (Number(word.startTime) || 0) / divisor);
    const endTime = Math.max(startTime, (Number(word.endTime) || 0) / divisor);
    return {
      word: word.word,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
    };
  });
}

function normalizeContextTexts(contextTexts: SpeechSynthesisRequest["contextTexts"]) {
  if (!Array.isArray(contextTexts)) {
    return [];
  }

  return contextTexts
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function getBoundedNumber(value: number | null | undefined, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(min, Math.min(max, value));
}

export function buildSpeechSynthesisRequestPayload(input: SpeechSynthesisRequest, runtime: SpeechSynthesisRuntime) {
  const format = input.format ?? "mp3";
  const emotion = input.emotion?.trim();
  const emotionScale = getBoundedNumber(input.emotionScale, 1, 5);
  const pitch = getBoundedNumber(input.pitch, -12, 12);
  const silenceDuration = getBoundedNumber(input.silenceDuration, 0, 10_000);
  const contextTexts = normalizeContextTexts(input.contextTexts);
  const audioParams: Record<string, unknown> = {
    format,
    sample_rate: input.sampleRate ?? runtime.defaultSampleRate,
    speech_rate: input.speechRate ?? 0,
    loudness_rate: input.loudnessRate ?? 0,
    enable_subtitle: input.enableSubtitle ?? true,
  };
  const additions: Record<string, unknown> = {
    disable_markdown_filter: true,
    disable_emoji_filter: true,
    cache_config: {
      text_type: 1,
      use_cache: true,
    },
  };

  if (emotion) {
    audioParams.emotion = emotion;
  }
  if (emotionScale != null) {
    audioParams.emotion_scale = emotionScale;
  }
  if (contextTexts.length > 0) {
    additions.context_texts = contextTexts;
  }
  if (pitch != null) {
    additions.post_process = { pitch };
  }
  if (silenceDuration != null) {
    additions.silence_duration = silenceDuration;
  }

  return {
    user: {
      uid: "travel-studio",
    },
    req_params: {
      text: input.text,
      speaker: input.voiceId ?? runtime.defaultVoiceId,
      audio_params: audioParams,
      additions: JSON.stringify(additions),
    },
  };
}

export async function synthesizeSpeech(input: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
  const runtime = getSpeechSynthesisRuntime();

  if (!runtime.liveEnabled) {
    return createMockSpeechResult({
      text: input.text,
      taskId: input.taskId,
      sampleRate: input.sampleRate ?? runtime.defaultSampleRate,
    });
  }

  const format = input.format ?? "mp3";
  const pricingKey = "doubao.speech.tts.2.0";
  const commercialCharge = prepareCommercialModelUsageCharge({
    pricingKey,
    serviceName: "audio.tts",
    estimatedMetrics: {
      characterCount: Array.from(input.text).length,
      requestCount: 1,
    },
  });
  try {
    const parsed = await withRetry(async () => {
      const res = await fetchWithTimeout(
        `${normalizeApiBase(runtime.apiBase)}/api/v3/tts/unidirectional/sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-App-Id": runtime.appId,
            "X-Api-Access-Key": runtime.accessToken,
            "X-Api-Resource-Id": input.resourceId ?? runtime.resourceId,
            "X-Api-Request-Id": crypto.randomUUID(),
            "X-Control-Require-Usage-Tokens-Return": "*",
          },
          body: JSON.stringify(buildSpeechSynthesisRequestPayload(input, runtime)),
        },
        {
          timeoutMs: defaultModelRequestTimeoutMs,
          timeoutMessage: "语音合成请求超时，请稍后重试",
        },
      );

      const rawText = await res.text();
      if (!res.ok) throw new Error(rawText || "语音合成失败");

      const result = parseSseTextPayload(rawText);
      if (result.audioBuffer.length === 0) {
        throw new Error(result.lastMessage ?? `语音合成结果为空${result.lastCode ? `（code: ${result.lastCode}）` : ""}`);
      }
      return result;
    });

    const outputDir = getAudioOutputDir(input.taskId);
    mkdirSync(outputDir, { recursive: true });
    const extension = getOutputExtension(format);
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const absolutePath = join(outputDir, fileName);
    writeFileSync(absolutePath, parsed.audioBuffer);
    const probedDurationSeconds = await probeMediaDurationSeconds(absolutePath).catch(() => null);
    const words = normalizeTimedWords(parsed.words, probedDurationSeconds);
    const wordTimelineDurationSeconds = words.length ? (words[words.length - 1]?.endTime ?? null) : null;

    confirmCommercialModelUsageCharge(commercialCharge, {
      pricingKey,
      serviceName: "audio.tts",
      provider: runtime.providerLabel,
      modelId: input.resourceId ?? runtime.resourceId,
      metrics: {
        characterCount: Array.from(input.text).length,
        requestCount: 1,
      },
      requestId: crypto.randomUUID(),
      remark: "语音合成",
    });

    return {
      audioUrl: getAudioOutputUrl(input.taskId, fileName),
      audioDurationSeconds: probedDurationSeconds ?? wordTimelineDurationSeconds,
      words,
      usageTextWords: parsed.usageTextWords,
    };
  } catch (error) {
    releaseCommercialModelUsageCharge(commercialCharge, "provider_failed");
    throw error;
  }
}

export async function synthesizeSpeechWithResourceFallbacks(
  input: SpeechSynthesisRequest & {
    fallbackResourceIds?: string[];
  },
): Promise<SpeechSynthesisResultWithResource> {
  const candidateResourceIds = Array.from(
    new Set([input.resourceId, ...(input.fallbackResourceIds ?? [])].filter((item): item is string => Boolean(item))),
  );

  if (candidateResourceIds.length === 0) {
    const result = await synthesizeSpeech(input);
    return {
      ...result,
      resolvedResourceId: input.resourceId,
    };
  }

  let lastError: unknown = null;

  for (const [candidateIndex, candidateResourceId] of candidateResourceIds.entries()) {
    try {
      const result = await synthesizeSpeech({
        ...input,
        resourceId: candidateResourceId,
      });

      return {
        ...result,
        resolvedResourceId: candidateResourceId,
      };
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isLastCandidate = candidateIndex === candidateResourceIds.length - 1;

      if (errorMessage.includes("resource ID is mismatched") && !isLastCandidate) {
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("语音合成失败");
}
