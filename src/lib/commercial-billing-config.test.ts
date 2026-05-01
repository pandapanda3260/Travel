import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCIAL_BILLING_BASELINE,
  COMMERCIAL_CREDIT_PACKAGES,
  COMMERCIAL_MEMBERSHIP_PLANS,
  COMMERCIAL_VIDEO_PRICING,
  calculateCreditProductMargin,
  calculateVideoFeatureMargin,
  validateCommercialBillingConfig,
} from "./commercial-billing-config";

test("商业计费基准按企业会员最低利润口径计算", () => {
  assert.equal(COMMERCIAL_BILLING_BASELINE.pointsPerRmb, 108);
  assert.equal(COMMERCIAL_BILLING_BASELINE.minimumGrossMarginRate, 0.3);
  assert.equal(Number(COMMERCIAL_BILLING_BASELINE.maxApiCostRmbPerPoint.toFixed(6)), 0.006481);
});

test("会员套餐价格和月度积分按新规则落地", () => {
  assert.deepEqual(
    COMMERCIAL_MEMBERSHIP_PLANS.map((plan) => ({
      code: plan.code,
      priceRmb: plan.priceRmb,
      monthlyCredits: plan.monthlyCredits,
    })),
    [
      { code: "travel_light_monthly", priceRmb: 99, monthlyCredits: 10_000 },
      { code: "travel_standard_monthly", priceRmb: 999, monthlyCredits: 102_000 },
      { code: "travel_pro_monthly", priceRmb: 4_999, monthlyCredits: 525_000 },
      { code: "travel_enterprise_monthly", priceRmb: 19_999, monthlyCredits: 2_160_000 },
    ],
  );
});

test("月度和年度积分包只作为补量产品且不改变会员等级", () => {
  assert.deepEqual(
    COMMERCIAL_CREDIT_PACKAGES.map((item) => ({
      code: item.code,
      packageKind: item.packageKind,
      priceRmb: item.priceRmb,
      credits: item.credits,
      changesMembership: item.changesMembership,
    })),
    [
      { code: "monthly_standard_pack", packageKind: "monthly", priceRmb: 499, credits: 45_000, changesMembership: false },
      { code: "monthly_high_volume_pack", packageKind: "monthly", priceRmb: 999, credits: 92_000, changesMembership: false },
      { code: "monthly_team_pack", packageKind: "monthly", priceRmb: 4_999, credits: 480_000, changesMembership: false },
      { code: "annual_standard_pack", packageKind: "annual", priceRmb: 11_999, credits: 1_200_000, changesMembership: false },
      { code: "annual_pro_pack", packageKind: "annual", priceRmb: 59_999, credits: 6_240_000, changesMembership: false },
      { code: "annual_enterprise_pack", packageKind: "annual", priceRmb: 239_999, credits: 25_920_000, changesMembership: false },
    ],
  );
});

test("所有积分产品按满额消耗测算毛利率不低于 30%", () => {
  const products = [...COMMERCIAL_MEMBERSHIP_PLANS, ...COMMERCIAL_CREDIT_PACKAGES];
  const margins = products.map((product) => calculateCreditProductMargin(product));

  assert.equal(margins.every((item) => item.grossMarginRate >= COMMERCIAL_BILLING_BASELINE.minimumGrossMarginRate), true);
  assert.ok(margins.find((item) => item.code === "travel_enterprise_monthly"));
  assert.equal(Number(margins.find((item) => item.code === "travel_enterprise_monthly")?.grossMarginRate.toFixed(4)), 0.3);
});

test("视频固定扣费覆盖 15/30/60 秒且利润不低于 30%", () => {
  assert.deepEqual(
    COMMERCIAL_VIDEO_PRICING.map((item) => ({
      durationSeconds: item.durationSeconds,
      chargedCredits: item.chargedCredits,
      estimatedApiCostRmb: item.estimatedApiCostRmb,
      requiresMembership: item.requiresMembership,
    })),
    [
      { durationSeconds: 15, chargedCredits: 2_400, estimatedApiCostRmb: 15.15, requiresMembership: false },
      { durationSeconds: 30, chargedCredits: 4_700, estimatedApiCostRmb: 30.25, requiresMembership: false },
      { durationSeconds: 60, chargedCredits: 9_400, estimatedApiCostRmb: 60.6, requiresMembership: false },
    ],
  );

  const margins = COMMERCIAL_VIDEO_PRICING.map((item) => calculateVideoFeatureMargin(item));
  assert.equal(margins.every((item) => item.grossMarginRate >= COMMERCIAL_BILLING_BASELINE.minimumGrossMarginRate), true);
});

test("商业计费配置校验能发现低毛利或缺失规则", () => {
  assert.deepEqual(validateCommercialBillingConfig(), []);
});
