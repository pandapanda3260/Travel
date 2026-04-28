import test from "node:test";
import assert from "node:assert/strict";

import {
  hasCriticalSceneRealismMismatch,
  hasCriticalOrientationMismatch,
  hasCriticalTextOrLayoutMismatch,
  hasCriticalTrafficOrTaxiMismatch,
  normalizeTaskVisualImageQualityResult,
} from "./task-visual-image-quality-check";
import { buildImageDimensionQualityCheck, pickRecommendedTaskVisualImageCandidate } from "./task-visual-image-store";

test("右舵或日式出租车问题会被强制收口为失败并建议重生", () => {
  const result = normalizeTaskVisualImageQualityResult({
    status: "warning",
    retrySuggested: false,
    issues: ["出租车外形接近 JPN Taxi，驾驶员被画在车内右侧"],
    summary: "道路呈现也不符合中国大陆右侧通行规则",
    checkedAt: "2026-04-18T00:00:00.000Z",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.retrySuggested, true);
  assert.equal(result.scorePenalty >= 55, true);
});

test("符合中国道路规则的确认性文案不会被误判为严重出租车问题", () => {
  assert.equal(
    hasCriticalTrafficOrTaxiMismatch({
      issues: [],
      summary: "车辆符合中国大陆右侧通行规则，驾驶员位于左侧驾驶位",
    }),
    false,
  );
});

test("长城古迹空间出现现代交通设施会被强制收口为失败", () => {
  const result = normalizeTaskVisualImageQualityResult({
    status: "warning",
    retrySuggested: false,
    issues: ["长城城墙上出现观光车和固定座椅，古迹空间不真实"],
    summary: "敌楼旁还画出了停车位白线",
    checkedAt: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.retrySuggested, true);
  assert.equal(result.scorePenalty >= 55, true);
});

test("普通道路路边接人却出现停车位白线会被识别为严重场景错误", () => {
  assert.equal(
    hasCriticalSceneRealismMismatch({
      issues: ["普通道路路边停靠场景，却画出了停车位白线和停车格"],
      summary: "",
    }),
    true,
  );
  assert.equal(
    hasCriticalSceneRealismMismatch({
      issues: [],
      summary: "这是合法停车场上客区，停车位白线合理",
    }),
    false,
  );
});

test("横向内容塞进竖版或画面整体横着会被强制收口为失败", () => {
  assert.equal(
    hasCriticalOrientationMismatch({
      issues: ["竖版 9:16 画面里主体整体横着，像横图内容塞进竖版画布"],
      summary: "",
    }),
    true,
  );

  const result = normalizeTaskVisualImageQualityResult({
    status: "warning",
    retrySuggested: false,
    issues: ["画面整体横着，建筑和地平线像被旋转了90度"],
    summary: "明显是横向内容塞进竖版构图",
    checkedAt: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.retrySuggested, true);
  assert.equal(result.scorePenalty >= 55, true);
});

test("横版构图不符合竖版要求的常见描述会被识别为方向错误", () => {
  assert.equal(
    hasCriticalOrientationMismatch({
      issues: ["图片实际是横版构图，不符合竖版 9:16 要求"],
      summary: "",
    }),
    true,
  );

  assert.equal(
    hasCriticalOrientationMismatch({
      issues: [],
      summary: "画面为横向 16:9，偏离 portrait 竖图构图要求",
    }),
    true,
  );
});

test("出现文字水印或拼图会被强制收口为失败", () => {
  assert.equal(
    hasCriticalTextOrLayoutMismatch({
      issues: ["画面里有明显招牌文字和水印残留"],
      summary: "",
    }),
    true,
  );

  const result = normalizeTaskVisualImageQualityResult({
    status: "warning",
    retrySuggested: false,
    issues: ["画面中出现清晰文字、logo 和水印"],
    summary: "同时还有分屏拼贴感",
    checkedAt: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.retrySuggested, true);
  assert.equal(result.scorePenalty >= 55, true);
});

test("中文字、英文标识和文本残留会被识别为文字类硬失败", () => {
  assert.equal(
    hasCriticalTextOrLayoutMismatch({
      issues: ["画面中有中文字和英文标识残留"],
      summary: "",
    }),
    true,
  );

  assert.equal(
    hasCriticalTextOrLayoutMismatch({
      issues: [],
      summary: "建筑外墙存在清晰文本，不符合无文字要求",
    }),
    true,
  );
});

test("图片实际宽高与目标竖版相反时会被运行时尺寸兜底标记失败", () => {
  const check = buildImageDimensionQualityCheck({
    size: "1600x2848",
    width: 1920,
    height: 1080,
    checkedAt: "2026-04-29T00:00:00.000Z",
  });

  assert.equal(check?.status, "failed");
  assert.equal(check?.retrySuggested, true);
  assert.equal(check?.scorePenalty, 55);
  assert.match(check?.issues.join("，") ?? "", /目标画幅为竖版.*实际尺寸为横版/u);
});

test("确认无文字且竖版构图正确的说明不会被误判", () => {
  assert.equal(
    hasCriticalTextOrLayoutMismatch({
      issues: [],
      summary: "画面无文字无水印，构图干净",
    }),
    false,
  );
  assert.equal(
    hasCriticalOrientationMismatch({
      issues: [],
      summary: "竖版构图正确，方向正常，没有横图内容塞入",
    }),
    false,
  );
});

test("自动推荐会跳过质量检查失败的候选图", () => {
  const recommended = pickRecommendedTaskVisualImageCandidate([
    {
      candidateId: "failed-best-score",
      score: 92,
      qualityStatus: "failed",
    },
    {
      candidateId: "passed-lower-score",
      score: 81,
      qualityStatus: "passed",
    },
    {
      candidateId: "warning-mid-score",
      score: 86,
      qualityStatus: "warning",
    },
  ]);

  assert.equal(recommended?.candidateId, "warning-mid-score");
  assert.equal(
    pickRecommendedTaskVisualImageCandidate([
      {
        candidateId: "failed-only",
        score: 88,
        qualityStatus: "failed",
      },
    ]),
    null,
  );
});
