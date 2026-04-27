import test from "node:test";
import assert from "node:assert/strict";

import { inspectNarrationAudioQuality } from "./generation-validator";

test("inspectNarrationAudioQuality 会提示异常偏快的口播", () => {
  const issues = inspectNarrationAudioQuality({
    unitLabel: "片段",
    clipIndex: 1,
    narrationText: "北京五天行程接送住宿早餐夜宵都安排好了",
    targetDurationSeconds: 4,
    audioDurationSeconds: 1.6,
    words: [],
  });

  assert.equal(
    issues.some((issue) => issue.severity === "error" && /语速异常偏快/u.test(issue.message)),
    true,
  );
});

test("inspectNarrationAudioQuality 会提示长句缺少自然停顿", () => {
  const issues = inspectNarrationAudioQuality({
    unitLabel: "片段",
    clipIndex: 2,
    narrationText: "北京玩五天有接送住得舒服早餐夜宵也都安排好",
    targetDurationSeconds: 5,
    audioDurationSeconds: 4,
    words: [
      { word: "北京", startTime: 0, endTime: 0.3 },
      { word: "玩", startTime: 0.31, endTime: 0.45 },
      { word: "五天", startTime: 0.46, endTime: 0.8 },
      { word: "有接送", startTime: 0.81, endTime: 1.2 },
      { word: "住得舒服", startTime: 1.21, endTime: 1.7 },
      { word: "早餐夜宵", startTime: 1.71, endTime: 2.2 },
      { word: "也都安排好", startTime: 2.21, endTime: 2.8 },
    ],
  });

  assert.equal(
    issues.some((issue) => /缺少明显停顿/u.test(issue.message)),
    true,
  );
});

test("inspectNarrationAudioQuality 会提示尾音余量不足", () => {
  const issues = inspectNarrationAudioQuality({
    unitLabel: "片段",
    clipIndex: 3,
    narrationText: "落地就能安心入住",
    targetDurationSeconds: 2.8,
    audioDurationSeconds: 2.8,
    words: [
      { word: "落地", startTime: 0, endTime: 0.5 },
      { word: "就能", startTime: 0.62, endTime: 1 },
      { word: "安心入住", startTime: 1.1, endTime: 2.72 },
    ],
  });

  assert.equal(
    issues.some((issue) => /尾音余量不足/u.test(issue.message)),
    true,
  );
});
