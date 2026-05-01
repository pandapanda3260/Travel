import test from "node:test";
import assert from "node:assert/strict";

import { buildAudioAlignment, resolveNarrationClipWordTimestamps } from "./audio-alignment";

test("buildAudioAlignment 有 TTS 词级时间时标记为供应商词级时间轴", () => {
  const alignment = buildAudioAlignment({
    audioDurationSeconds: 2.4,
    words: [
      { word: "杭州", startTime: 0.1, endTime: 0.6 },
      { word: "亲子", startTime: 0.7, endTime: 1.1 },
    ],
  });

  assert.equal(alignment.source, "provider_word");
  assert.equal(alignment.confidence, "high");
  assert.equal(alignment.audioDurationSeconds, 2.4);
  assert.deepEqual(alignment.wordTimestamps?.map((word) => word.word), ["杭州", "亲子"]);
});

test("buildAudioAlignment 没有词级时间时明确降级为估算时间轴", () => {
  const alignment = buildAudioAlignment({
    audioDurationSeconds: 3.2,
    words: [],
    fallbackDurationSeconds: 5,
  });

  assert.equal(alignment.source, "estimated");
  assert.equal(alignment.confidence, "low");
  assert.equal(alignment.audioDurationSeconds, 3.2);
  assert.deepEqual(alignment.wordTimestamps, []);
});

test("resolveNarrationClipWordTimestamps 优先使用结构化音频时间轴", () => {
  const words = resolveNarrationClipWordTimestamps({
    audioAlignment: {
      audioDurationSeconds: 2,
      source: "provider_word",
      confidence: "high",
      wordTimestamps: [{ word: "结构化", startTime: 0, endTime: 0.8 }],
    },
    words: [{ word: "旧字段", startTime: 0, endTime: 1 }],
  });

  assert.deepEqual(words.map((word) => word.word), ["结构化"]);
});
