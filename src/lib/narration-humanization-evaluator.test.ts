import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateNarrationHumanizationTarget,
  scoreNarrationHumanization,
  shouldRewriteNarrationForHumanization,
} from "./narration-humanization-evaluator";

test("真人样本评分高于空泛系统台词", () => {
  const humanScript =
    "我发现很多人第一次去北京都没玩对。如果您想带孩子来北京玩得好又有意义，可以按照这个路线走。带孩子去国博看看珍贵藏品，也让孩子在博物馆里上一次历史课。第三天早起去天安门看一次升旗，让他感受中国人独有的浪漫。";
  const machineScript =
    "想省心玩北京，这条五天四晚直接抄作业。一落地就有人接，能让您快速住进酒店去休息。故宫看底蕴，到了什刹海，人也跟着慢下来。经典景点都逛到了，想轻松玩北京可以按这条线路走。";

  const humanScore = scoreNarrationHumanization(humanScript);
  const machineScore = scoreNarrationHumanization(machineScript);

  assert.ok(humanScore.score > machineScore.score + 12);
  assert.equal(machineScore.issues.includes("存在空泛种草口号"), true);
});

test("有具体对象和证据的改写能显著提升真人化评分", () => {
  const weakScript = "这一段最舒服，颐和园圆明园和名校顺路看。送站也接得稳，最后一天照样轻松。";
  const improvedScript =
    "第四天适合放慢一点，先带孩子去颐和园吹吹昆明湖的风，再到圆明园看西洋楼遗址，把风景和历史一起补上。返程当天按你的车次送站，不用拖着行李来回折腾。";

  const weakScore = scoreNarrationHumanization(weakScript);
  const improvedScore = scoreNarrationHumanization(improvedScript);

  assert.ok(improvedScore.score > weakScore.score + 20);
  assert.ok(improvedScore.metrics.specificity > weakScore.metrics.specificity);
  assert.ok(improvedScore.metrics.imagery > weakScore.metrics.imagery);
});

test("自然动作和使用场景会计入真人化画面推进", () => {
  const sceneScript =
    "带娃来北京，最怕一路换车排队把孩子先耗没电。落地后不用拖着箱子找车，先住进酒店安顿下来。第二天再走进故宫慢慢看，逛出来转到什刹海，节奏正好松一点。";

  const score = scoreNarrationHumanization(sceneScript);

  assert.ok(score.metrics.audience >= 55);
  assert.ok(score.metrics.trust >= 55);
  assert.ok(score.metrics.imagery >= 55);
});

test("evaluateNarrationHumanizationTarget 会明确拦截未达到 65 分目标的系统样本", () => {
  const weakScores = [
    scoreNarrationHumanization(
      "想省心玩北京，这条五天四晚直接抄作业。经典景点都逛到了，想轻松玩北京可以按这条线路走。",
    ),
    scoreNarrationHumanization("刚到门口就有度假感，大堂也做得敞亮又舒服。整套体验都挺完整。"),
  ];
  const result = evaluateNarrationHumanizationTarget(weakScores);

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("平均分")));
  assert.ok(result.failures.some((failure) => failure.includes("最低单条分")));
  assert.equal(shouldRewriteNarrationForHumanization(weakScores[0]!), true);
});
