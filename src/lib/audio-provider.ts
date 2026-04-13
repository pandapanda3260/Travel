import { execFile } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import { getSpeechSynthesisRuntime } from "./audio-provider-config";
import { withRetry } from "./retry";

const execFileAsync = promisify(execFile);
const packageRequire = createRequire(process.cwd() + "/package.json");

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
  return join(process.cwd(), "public", "generated-audio", taskId?.trim() || "_unassigned", "narration");
}

function getAudioOutputUrl(taskId: string | null | undefined, fileName: string) {
  return `/generated-audio/${taskId?.trim() || "_unassigned"}/narration/${fileName}`;
}

function resolveFfmpegPath() {
  const runtimePath = packageRequire("ffmpeg-static") as string | null;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error("当前环境缺少可用的 FFmpeg 可执行文件");
  }

  return runtimePath;
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

function parseSseTextPayload(source: string) {
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

    const payload = JSON.parse(payloadText) as {
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

    if (typeof payload.code === "number") {
      lastCode = payload.code;
    }

    if (typeof payload.message === "string" && payload.message) {
      lastMessage = payload.message;
    }

    if (typeof payload.data === "string" && payload.data) {
      audioChunks.push(Buffer.from(payload.data, "base64"));
    }

    if (Array.isArray(payload.sentence?.words)) {
      words.push(
        ...payload.sentence.words
          .filter((item) => item.word)
          .map((item) => ({
            word: item.word!,
            startTime: Number(item.startTime) || 0,
            endTime: Number(item.endTime) || 0,
          })),
      );
    }

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

export async function synthesizeSpeech(input: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
  const runtime = getSpeechSynthesisRuntime();

  if (!runtime.liveEnabled) {
    throw new Error("火山引擎豆包语音合成 2.0 当前未启用，请先配置音频服务凭证。");
  }

  const format = input.format ?? "mp3";
  const parsed = await withRetry(async () => {
    const res = await fetch(`${normalizeApiBase(runtime.apiBase)}/api/v3/tts/unidirectional/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Id": runtime.appId,
        "X-Api-Access-Key": runtime.accessToken,
        "X-Api-Resource-Id": input.resourceId ?? runtime.resourceId,
        "X-Api-Request-Id": crypto.randomUUID(),
        "X-Control-Require-Usage-Tokens-Return": "*",
      },
      body: JSON.stringify({
        user: {
          uid: "travel-studio",
        },
        req_params: {
          text: input.text,
          speaker: input.voiceId ?? runtime.defaultVoiceId,
          audio_params: {
            format,
            sample_rate: input.sampleRate ?? runtime.defaultSampleRate,
            speech_rate: input.speechRate ?? 0,
            loudness_rate: input.loudnessRate ?? 0,
            enable_subtitle: input.enableSubtitle ?? true,
          },
          additions: JSON.stringify({
            disable_markdown_filter: true,
            cache_config: {
              text_type: 1,
              use_cache: true,
            },
          }),
        },
      }),
    });

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
  const wordTimelineDurationSeconds = parsed.words.length
    ? (parsed.words[parsed.words.length - 1]?.endTime ?? null)
    : null;

  return {
    audioUrl: getAudioOutputUrl(input.taskId, fileName),
    audioDurationSeconds: probedDurationSeconds ?? wordTimelineDurationSeconds,
    words: parsed.words,
    usageTextWords: parsed.usageTextWords,
  };
}
