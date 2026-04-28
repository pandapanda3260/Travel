import assert from "node:assert/strict";
import test from "node:test";

import { buildCommercialStrategyPlan } from "./commercial-video-strategy";
import type { ShotPlan, VideoTaskSource } from "./video-task-schema";

function buildSource(overrides?: Partial<VideoTaskSource>): VideoTaskSource {
  return {
    productInfoId: null,
    productInfoTitle: "Club Med 杭州龙坞度假村",
    productInfoSnapshot: "",
    userPrompt:
      "杭州这家全新开业亲子遛娃巨无霸，三天两晚一价全包1000多，早餐、正餐、儿童托管都包含，不约随时可退，刷到先囤。",
    optimizedUserPrompt: "",
    videoMaterialId: null,
    videoMaterialName: null,
    videoTemplatePrompt: "",
    ...overrides,
  };
}

function buildShotPlan(): ShotPlan {
  return {
    shots: [
      {
        shotIndex: 1,
        purpose: "hook",
        location: "杭州",
        hasCharacters: false,
        characters: [],
        action: "度假村全景",
        emotion: "吸引",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "杭州全新开业亲子度假村全景",
        narrationHint: "杭州这家全新开业亲子遛娃巨无霸",
        assetId: "asset-opening",
        commercialPhase: "attention_hook",
      },
      {
        shotIndex: 2,
        purpose: "offer",
        location: "Club Med",
        hasCharacters: false,
        characters: [],
        action: "门头标识",
        emotion: "真实",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "Club Med 度假村入口标识",
        narrationHint: "开业大促，三天两晚一价全包1000多",
        assetId: "asset-brand",
        commercialPhase: "opportunity_offer",
        evidenceTarget: "开业大促与品牌身份",
      },
      {
        shotIndex: 3,
        purpose: "benefit",
        location: "儿童乐园",
        hasCharacters: true,
        characters: ["儿童"],
        action: "儿童玩乐",
        emotion: "活力",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "儿童乐园和托管体验",
        narrationHint: "早餐、正餐、儿童托管、乐园权益都包含",
        assetId: "asset-benefit",
        commercialPhase: "benefit_stack",
        evidenceTarget: "亲子权益密度",
      },
      {
        shotIndex: 4,
        purpose: "closing",
        location: "夜景",
        hasCharacters: false,
        characters: [],
        action: "夜景收尾",
        emotion: "安心",
        cameraMovement: "auto",
        durationSeconds: 3,
        sceneDescription: "度假村夜景",
        narrationHint: "不约随时可退，刷到先囤",
        assetId: "asset-close",
        commercialPhase: "action_close",
        conversionRole: "风险解除和行动引导",
      },
    ],
    globalStyle: "真实本地生活种草",
    totalDurationSeconds: 12,
    validationErrors: [],
  };
}

test("交易型酒店促销素材会识别为交易型种草并生成成交路径", () => {
  const plan = buildCommercialStrategyPlan({
    source: buildSource(),
    videoType: "hotel_explore_voiceover",
    shotPlan: buildShotPlan(),
  });

  assert.equal(plan.strategyKind, "transaction_seed");
  assert.equal(plan.strategyLabel, "交易型种草");
  assert.ok(plan.decisionPath.includes("有什么机会"));
  assert.ok(plan.score.totalScore >= 70);
  assert.ok(plan.beatPlan.some((beat) => beat.phase === "opportunity_offer"));
  assert.ok(plan.beatPlan.some((beat) => beat.phase === "risk_reversal"));
});

test("攻略文案会优先识别为攻略路线型", () => {
  const plan = buildCommercialStrategyPlan({
    source: buildSource({
      productInfoTitle: "北京亲子路线",
      userPrompt: "第一次来北京很多人都没玩对，按这个四天三晚路线走，故宫、长城、国博都能安排好。",
    }),
    videoType: "agency_guide_voiceover",
  });

  assert.equal(plan.strategyKind, "guide_route");
  assert.ok(plan.beatPlan.some((beat) => beat.phase === "route_correction"));
  assert.ok(plan.beatPlan.some((beat) => beat.phase === "itinerary_delivery"));
});
