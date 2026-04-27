import test from "node:test";
import assert from "node:assert/strict";

import { buildSpeechSynthesisRequestPayload, parseSseTextPayload } from "./audio-provider";
import type { SpeechSynthesisRuntime } from "./audio-provider-config";

const runtime: SpeechSynthesisRuntime = {
  liveEnabled: true,
  hasCredential: true,
  providerLabel: "test",
  apiBase: "https://example.com",
  appId: "app-id",
  accessToken: "token",
  resourceId: "seed-tts-2.0",
  defaultVoiceId: "default-voice",
  defaultSampleRate: 24000,
  configFileName: "test.env",
};

test("buildSpeechSynthesisRequestPayload 会携带口播表达控制参数", () => {
  const payload = buildSpeechSynthesisRequestPayload(
    {
      text: "北京玩五天，有接送住得也舒服",
      voiceId: "voice-a",
      format: "mp3",
      sampleRate: 48000,
      speechRate: 8,
      loudnessRate: 3,
      enableSubtitle: true,
      emotion: "happy",
      emotionScale: 4,
      contextTexts: ["像真实旅行顾问在讲攻略", "  "],
      pitch: 2,
      silenceDuration: 120,
    },
    runtime,
  );
  const additions = JSON.parse(payload.req_params.additions) as {
    context_texts?: string[];
    post_process?: { pitch?: number };
    silence_duration?: number;
  };

  assert.equal(payload.req_params.speaker, "voice-a");
  assert.equal(payload.req_params.audio_params.sample_rate, 48000);
  assert.equal(payload.req_params.audio_params.speech_rate, 8);
  assert.equal(payload.req_params.audio_params.loudness_rate, 3);
  assert.equal(payload.req_params.audio_params.emotion, "happy");
  assert.equal(payload.req_params.audio_params.emotion_scale, 4);
  assert.deepEqual(additions.context_texts, ["像真实旅行顾问在讲攻略"]);
  assert.deepEqual(additions.post_process, { pitch: 2 });
  assert.equal(additions.silence_duration, 120);
});

test("buildSpeechSynthesisRequestPayload 会约束表达参数范围", () => {
  const payload = buildSpeechSynthesisRequestPayload(
    {
      text: "自然一点读",
      emotionScale: 9,
      contextTexts: ["一", "二", "三", "四", "五"],
      pitch: 20,
      silenceDuration: -1,
    },
    runtime,
  );
  const additions = JSON.parse(payload.req_params.additions) as {
    context_texts?: string[];
    post_process?: { pitch?: number };
    silence_duration?: number;
  };

  assert.equal(payload.req_params.speaker, "default-voice");
  assert.equal(payload.req_params.audio_params.emotion_scale, 5);
  assert.deepEqual(additions.context_texts, ["一", "二", "三", "四"]);
  assert.deepEqual(additions.post_process, { pitch: 12 });
  assert.equal(additions.silence_duration, 0);
});

test("parseSseTextPayload 会兼容不同词级时间字段", () => {
  const payload = [
    'data: {"code":0,"data":"YQ==","sentence":{"words":[{"text":"古今","start_time":0.1,"end_time":0.45},{"word":"都看到了","startTime":0.45,"endTime":1.2}]}}',
    'data: {"code":0,"subtitle":{"words":[{"word":"再去","begin_time":1.25,"end_time":1.6},{"text":"什刹海放松","start":1.6,"end":2.4}]}}',
  ].join("\n");

  const result = parseSseTextPayload(payload);

  assert.equal(result.audioBuffer.toString("utf8"), "a");
  assert.deepEqual(result.words, [
    { word: "古今", startTime: 0.1, endTime: 0.45 },
    { word: "都看到了", startTime: 0.45, endTime: 1.2 },
    { word: "再去", startTime: 1.25, endTime: 1.6 },
    { word: "什刹海放松", startTime: 1.6, endTime: 2.4 },
  ]);
});
