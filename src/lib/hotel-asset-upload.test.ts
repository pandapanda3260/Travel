import assert from "node:assert/strict";
import test from "node:test";

import { buildPendingHotelAssetAnalysis } from "./hotel-asset-upload";

test("buildPendingHotelAssetAnalysis 会保留基础识别信息但先标记为待分析", () => {
  const pending = buildPendingHotelAssetAnalysis({
    width: 1600,
    height: 900,
    fileName: "hotel-exterior.jpg",
    userNote: "酒店门头与到达口",
    preferredSceneType: "exterior",
  });

  assert.equal(pending.reviewStatus, "pending");
  assert.equal(pending.analyzedAt, null);
  assert.equal(pending.sceneType, "exterior");
  assert.equal(pending.subjectSummary, "酒店门头与到达口");
  assert.equal(pending.canDirectI2V, true);
  assert.equal(pending.qualityScore >= 70, true);
  assert.equal(pending.recommendedPosition, "opening");
  assert.ok(pending.sellingPoints.includes("酒店门头与到达口"));
  assert.equal(typeof pending.compositionScore, "number");
  assert.equal(typeof pending.durationSuggestion, "number");
});

test("buildPendingHotelAssetAnalysis 在没有用户说明时会回退到本地推断结果", () => {
  const pending = buildPendingHotelAssetAnalysis({
    width: 720,
    height: 1280,
    fileName: "room-suite.png",
    preferredSceneType: null,
  });

  assert.equal(pending.reviewStatus, "pending");
  assert.equal(pending.sceneType, "room");
  assert.equal(pending.subjectSummary.length > 0, true);
  assert.equal(Array.isArray(pending.tags), true);
  assert.equal(Array.isArray(pending.sellingPoints), true);
  assert.equal(pending.durationSuggestion !== null, true);
});
