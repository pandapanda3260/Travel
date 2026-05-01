export type CommercialProductKind = "membership" | "credit_package";
export type CommercialCreditPackageKind = "monthly" | "annual";
export type CommercialBillableFeatureCode =
  | "video_generation"
  | "text_generation"
  | "image_generation"
  | "audio_generation"
  | "subtitle_generation"
  | "video_composition";

export type CommercialBillingBaseline = {
  pointsPerRmb: number;
  apiCostBudgetRatio: number;
  minimumGrossMarginRate: number;
  enterpriseReferencePriceRmb: number;
  enterpriseReferenceCredits: number;
  maxApiCostRmbPerPoint: number;
};

export type CommercialCreditProduct = {
  code: string;
  kind: CommercialProductKind;
  name: string;
  originalPriceRmb: number;
  priceRmb: number;
  credits: number;
  validityMonths: number;
  changesMembership: boolean;
};

export type CommercialMembershipPlan = CommercialCreditProduct & {
  kind: "membership";
  monthlyCredits: number;
};

export type CommercialCreditPackage = CommercialCreditProduct & {
  kind: "credit_package";
  packageKind: CommercialCreditPackageKind;
};

export type CommercialUsagePricingRule = {
  code: string;
  featureCode: CommercialBillableFeatureCode;
  name: string;
  chargedCredits: number;
  estimatedApiCostRmb: number;
  requiresMembership: boolean;
};

export type CommercialVideoPricingRule = CommercialUsagePricingRule & {
  featureCode: "video_generation";
  durationSeconds: 15 | 30 | 60;
};

export type CommercialMarginResult = {
  code: string;
  revenueRmb: number;
  maxApiCostRmb: number;
  grossProfitRmb: number;
  grossMarginRate: number;
};

const ENTERPRISE_REFERENCE_PRICE_RMB = 19_999;
const ENTERPRISE_REFERENCE_CREDITS = 2_160_000;

export const COMMERCIAL_BILLING_BASELINE: CommercialBillingBaseline = {
  pointsPerRmb: 108,
  apiCostBudgetRatio: 0.7,
  minimumGrossMarginRate: 0.3,
  enterpriseReferencePriceRmb: ENTERPRISE_REFERENCE_PRICE_RMB,
  enterpriseReferenceCredits: ENTERPRISE_REFERENCE_CREDITS,
  maxApiCostRmbPerPoint: (ENTERPRISE_REFERENCE_PRICE_RMB / ENTERPRISE_REFERENCE_CREDITS) * 0.7,
};

export const COMMERCIAL_MEMBERSHIP_PLANS: CommercialMembershipPlan[] = [
  {
    code: "travel_light_monthly",
    kind: "membership",
    name: "Travel 轻量版",
    originalPriceRmb: 125,
    priceRmb: 99,
    credits: 10_000,
    monthlyCredits: 10_000,
    validityMonths: 1,
    changesMembership: true,
  },
  {
    code: "travel_standard_monthly",
    kind: "membership",
    name: "Travel 标准版",
    originalPriceRmb: 1_250,
    priceRmb: 999,
    credits: 102_000,
    monthlyCredits: 102_000,
    validityMonths: 1,
    changesMembership: true,
  },
  {
    code: "travel_pro_monthly",
    kind: "membership",
    name: "Travel 专业版",
    originalPriceRmb: 6_250,
    priceRmb: 4_999,
    credits: 525_000,
    monthlyCredits: 525_000,
    validityMonths: 1,
    changesMembership: true,
  },
  {
    code: "travel_enterprise_monthly",
    kind: "membership",
    name: "Travel 企业版",
    originalPriceRmb: 25_000,
    priceRmb: 19_999,
    credits: 2_160_000,
    monthlyCredits: 2_160_000,
    validityMonths: 1,
    changesMembership: true,
  },
];

export const COMMERCIAL_CREDIT_PACKAGES: CommercialCreditPackage[] = [
  {
    code: "monthly_standard_pack",
    kind: "credit_package",
    packageKind: "monthly",
    name: "标准月包",
    originalPriceRmb: 625,
    priceRmb: 499,
    credits: 45_000,
    validityMonths: 1,
    changesMembership: false,
  },
  {
    code: "monthly_high_volume_pack",
    kind: "credit_package",
    packageKind: "monthly",
    name: "高量月包",
    originalPriceRmb: 1_250,
    priceRmb: 999,
    credits: 92_000,
    validityMonths: 1,
    changesMembership: false,
  },
  {
    code: "monthly_team_pack",
    kind: "credit_package",
    packageKind: "monthly",
    name: "团队月包",
    originalPriceRmb: 6_250,
    priceRmb: 4_999,
    credits: 480_000,
    validityMonths: 1,
    changesMembership: false,
  },
  {
    code: "annual_standard_pack",
    kind: "credit_package",
    packageKind: "annual",
    name: "年度标准包",
    originalPriceRmb: 15_000,
    priceRmb: 11_999,
    credits: 1_200_000,
    validityMonths: 12,
    changesMembership: false,
  },
  {
    code: "annual_pro_pack",
    kind: "credit_package",
    packageKind: "annual",
    name: "年度专业包",
    originalPriceRmb: 75_000,
    priceRmb: 59_999,
    credits: 6_240_000,
    validityMonths: 12,
    changesMembership: false,
  },
  {
    code: "annual_enterprise_pack",
    kind: "credit_package",
    packageKind: "annual",
    name: "年度企业包",
    originalPriceRmb: 300_000,
    priceRmb: 239_999,
    credits: 25_920_000,
    validityMonths: 12,
    changesMembership: false,
  },
];

export const COMMERCIAL_VIDEO_PRICING: CommercialVideoPricingRule[] = [
  {
    code: "video_generation_15s",
    featureCode: "video_generation",
    name: "15 秒视频生成",
    durationSeconds: 15,
    chargedCredits: 2_400,
    estimatedApiCostRmb: 15.15,
    requiresMembership: false,
  },
  {
    code: "video_generation_30s",
    featureCode: "video_generation",
    name: "30 秒视频生成",
    durationSeconds: 30,
    chargedCredits: 4_700,
    estimatedApiCostRmb: 30.25,
    requiresMembership: false,
  },
  {
    code: "video_generation_60s",
    featureCode: "video_generation",
    name: "60 秒视频生成",
    durationSeconds: 60,
    chargedCredits: 9_400,
    estimatedApiCostRmb: 60.6,
    requiresMembership: false,
  },
];

export const COMMERCIAL_USAGE_PRICING_RULES: CommercialUsagePricingRule[] = [...COMMERCIAL_VIDEO_PRICING];

export function calculateCreditProductMargin(product: CommercialCreditProduct): CommercialMarginResult {
  const maxApiCostRmb = product.credits * COMMERCIAL_BILLING_BASELINE.maxApiCostRmbPerPoint;
  const grossProfitRmb = product.priceRmb - maxApiCostRmb;

  return {
    code: product.code,
    revenueRmb: product.priceRmb,
    maxApiCostRmb,
    grossProfitRmb,
    grossMarginRate: grossProfitRmb / product.priceRmb,
  };
}

export function calculateVideoFeatureMargin(rule: CommercialVideoPricingRule): CommercialMarginResult {
  return calculateCommercialUsageFeatureMargin(rule);
}

export function calculateCommercialUsageFeatureMargin(
  rule: CommercialUsagePricingRule,
  actualCostRmb = rule.estimatedApiCostRmb,
): CommercialMarginResult {
  const revenueRmb = rule.chargedCredits / COMMERCIAL_BILLING_BASELINE.pointsPerRmb;
  const grossProfitRmb = revenueRmb - actualCostRmb;

  return {
    code: rule.code,
    revenueRmb,
    maxApiCostRmb: actualCostRmb,
    grossProfitRmb,
    grossMarginRate: grossProfitRmb / revenueRmb,
  };
}

export function resolveCommercialUsagePricingRuleByCode(code: string) {
  return COMMERCIAL_USAGE_PRICING_RULES.find((item) => item.code === code) ?? null;
}

export function listCommercialUsagePricingRules(featureCode?: CommercialBillableFeatureCode) {
  return featureCode
    ? COMMERCIAL_USAGE_PRICING_RULES.filter((item) => item.featureCode === featureCode)
    : [...COMMERCIAL_USAGE_PRICING_RULES];
}

export function validateCommercialBillingConfig() {
  const issues: string[] = [];
  const productCodes = new Set<string>();

  for (const product of [...COMMERCIAL_MEMBERSHIP_PLANS, ...COMMERCIAL_CREDIT_PACKAGES]) {
    if (productCodes.has(product.code)) {
      issues.push(`商业产品编码重复：${product.code}`);
    }
    productCodes.add(product.code);

    if (calculateCreditProductMargin(product).grossMarginRate < COMMERCIAL_BILLING_BASELINE.minimumGrossMarginRate) {
      issues.push(`商业产品毛利率低于 30%：${product.code}`);
    }
  }

  const videoDurations = new Set<number>();
  for (const rule of COMMERCIAL_VIDEO_PRICING) {
    if (videoDurations.has(rule.durationSeconds)) {
      issues.push(`视频扣费时长重复：${rule.durationSeconds}`);
    }
    videoDurations.add(rule.durationSeconds);

    if (calculateVideoFeatureMargin(rule).grossMarginRate < COMMERCIAL_BILLING_BASELINE.minimumGrossMarginRate) {
      issues.push(`视频扣费毛利率低于 30%：${rule.code}`);
    }
  }

  for (const duration of [15, 30, 60]) {
    if (!videoDurations.has(duration)) {
      issues.push(`缺少 ${duration} 秒视频扣费规则`);
    }
  }

  return issues;
}
