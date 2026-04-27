import test from "node:test";
import assert from "node:assert/strict";

import { buildNarrationStandardsPromptBlock, inspectNarrationQuality } from "./narration-standards";

test("inspectNarrationQuality 会识别空泛种草口号", () => {
  const issues = inspectNarrationQuality([
    {
      shotIndex: 1,
      text: "想省心玩北京，这条五天四晚直接抄作业",
      durationSeconds: 5,
      purpose: "hook",
    },
    {
      shotIndex: 9,
      text: "这一段最舒服，颐和园圆明园和名校顺路看",
      durationSeconds: 6,
      purpose: "experience",
    },
    {
      shotIndex: 13,
      text: "经典景点都逛到了，想轻松玩北京可以按这条线路走",
      durationSeconds: 6,
      purpose: "closing",
    },
  ]);

  const hollowIssues = issues.filter((issue) => issue.code === "hollow_recommendation_tone");
  assert.ok(hollowIssues.length >= 3);
});

test("inspectNarrationQuality 会识别酒店探店里的清单式假真人口播", () => {
  const issues = inspectNarrationQuality([
    {
      shotIndex: 1,
      text: "刚到门口就有度假感，大堂也做得敞亮又舒服",
      durationSeconds: 5,
      purpose: "hook",
    },
    {
      shotIndex: 2,
      text: "吃饭和遛娃都安排上了，一家人待着更省心",
      durationSeconds: 5,
      purpose: "experience",
    },
  ]);

  assert.ok(issues.some((issue) => issue.code === "hollow_recommendation_tone"));
});

test("inspectNarrationQuality 不会把有对象和具体理由的口播误判成空泛种草", () => {
  const issues = inspectNarrationQuality([
    {
      shotIndex: 2,
      text: "带孩子去国博看看珍贵藏品，也让他上一堂历史课",
      durationSeconds: 7,
      purpose: "experience",
    },
  ]);

  assert.equal(
    issues.some((issue) => issue.code === "hollow_recommendation_tone"),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.code === "missing_concrete_value"),
    false,
  );
});

test("buildNarrationStandardsPromptBlock 包含跨类型真人推荐标准", () => {
  const prompt = buildNarrationStandardsPromptBlock("hotel_explore_voiceover");

  assert.match(prompt, /真人推荐口播范式/u);
  assert.match(prompt, /所有有台词\/字幕的视频都生效/u);
  assert.match(prompt, /谁适合、解决什么问题、为什么这样安排\/选择/u);
});
