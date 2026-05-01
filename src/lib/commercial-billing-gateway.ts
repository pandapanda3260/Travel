import {
  COMMERCIAL_BILLING_BASELINE,
  COMMERCIAL_VIDEO_PRICING,
  calculateCommercialUsageFeatureMargin,
  resolveCommercialUsagePricingRuleByCode,
  type CommercialBillableFeatureCode,
  type CommercialMarginResult,
  type CommercialUsagePricingRule,
} from "./commercial-billing-config";
import {
  confirmCreditFreeze,
  freezeCredits,
  getCommercialCreditFreezeById,
  releaseCreditFreeze,
  type CommercialCreditBalanceRecord,
  type CommercialCreditFreezeRecord,
  type CommercialCreditTransactionRecord,
} from "./commercial-credit-ledger";

export type PrepareCommercialUsageChargeInput = {
  userId: string;
  taskId: string;
  featureCode: CommercialBillableFeatureCode | string;
  durationSeconds?: number | null;
  pricingCode?: string | null;
  idempotencyKey: string;
};

export type PrepareCommercialMeteredUsageChargeInput = {
  userId: string;
  taskId: string;
  featureCode: CommercialBillableFeatureCode;
  estimatedApiCostRmb: number;
  idempotencyKey: string;
  name?: string | null;
};

export type ConfirmCommercialUsageChargeInput = {
  freezeId: string;
  idempotencyKey: string;
  provider?: string | null;
  modelId?: string | null;
  actualCostRmb?: number | null;
};

export type ConfirmCommercialMeteredUsageChargeInput = {
  freezeId: string;
  idempotencyKey: string;
  actualCostRmb: number;
  provider?: string | null;
  modelId?: string | null;
};

export type ReleaseCommercialUsageChargeInput = {
  freezeId: string;
  reason: string;
};

export type PreparedCommercialUsageCharge = {
  pricingRule: CommercialUsagePricingRule;
  margin: CommercialMarginResult;
  freeze: CommercialCreditFreezeRecord;
  balance: CommercialCreditBalanceRecord;
};

export type ConfirmedCommercialUsageCharge = {
  transaction: CommercialCreditTransactionRecord;
  balance: CommercialCreditBalanceRecord;
};

export type ReleasedCommercialUsageCharge = {
  freeze: CommercialCreditFreezeRecord;
  balance: CommercialCreditBalanceRecord;
};

export class CommercialBillingGatewayError extends Error {
  constructor(
    public readonly code:
      | "MISSING_FEATURE_PRICING_RULE"
      | "UNSUPPORTED_VIDEO_DURATION"
      | "FREEZE_NOT_FOUND"
      | "MEMBERSHIP_REQUIRED"
      | "INVALID_USAGE_COST",
    message: string,
  ) {
    super(message);
    this.name = "CommercialBillingGatewayError";
  }
}

export function calculateCommercialCreditsForApiCost(apiCostRmb: number) {
  if (!Number.isFinite(apiCostRmb) || apiCostRmb < 0) {
    throw new CommercialBillingGatewayError("INVALID_USAGE_COST", "API 成本必须是非负有效数字。");
  }
  if (apiCostRmb === 0) {
    return 0;
  }
  return Math.ceil(apiCostRmb / COMMERCIAL_BILLING_BASELINE.maxApiCostRmbPerPoint);
}

function buildMeteredPricingRule(input: PrepareCommercialMeteredUsageChargeInput): CommercialUsagePricingRule {
  const chargedCredits = calculateCommercialCreditsForApiCost(input.estimatedApiCostRmb);
  return {
    code: `metered_${input.featureCode}`,
    featureCode: input.featureCode,
    name: input.name?.trim() || "按量模型调用",
    chargedCredits,
    estimatedApiCostRmb: input.estimatedApiCostRmb,
    requiresMembership: false,
  };
}

function resolveVideoPricingRuleByDuration(durationSeconds: number | null | undefined) {
  const normalizedDuration =
    typeof durationSeconds === "number" && durationSeconds <= 15
      ? 15
      : typeof durationSeconds === "number" && durationSeconds <= 30
        ? 30
        : typeof durationSeconds === "number" && durationSeconds <= 60
          ? 60
          : null;

  if (!normalizedDuration) {
    throw new CommercialBillingGatewayError("UNSUPPORTED_VIDEO_DURATION", "暂不支持超过 60 秒的视频商业扣费规则。");
  }

  const rule = COMMERCIAL_VIDEO_PRICING.find((item) => item.durationSeconds === normalizedDuration);
  if (!rule) {
    throw new CommercialBillingGatewayError("MISSING_FEATURE_PRICING_RULE", `缺少 ${normalizedDuration} 秒视频扣费规则。`);
  }

  return rule;
}

function resolveUsagePricingRule(input: PrepareCommercialUsageChargeInput) {
  if (input.pricingCode) {
    const rule = resolveCommercialUsagePricingRuleByCode(input.pricingCode);
    if (!rule || rule.featureCode !== input.featureCode) {
      throw new CommercialBillingGatewayError("MISSING_FEATURE_PRICING_RULE", "缺少匹配的功能扣费配置。");
    }
    return rule;
  }

  if (input.featureCode === "video_generation") {
    return resolveVideoPricingRuleByDuration(input.durationSeconds);
  }

  throw new CommercialBillingGatewayError("MISSING_FEATURE_PRICING_RULE", "该功能尚未配置商业扣费规则，不能直接调用付费 API。");
}

function resolveUsagePricingRuleByFreeze(freeze: CommercialCreditFreezeRecord) {
  if (!freeze.featureCode) {
    throw new CommercialBillingGatewayError("MISSING_FEATURE_PRICING_RULE", "冻结记录缺少功能扣费配置编码。");
  }

  const rule = resolveCommercialUsagePricingRuleByCode(freeze.featureCode);
  if (!rule) {
    throw new CommercialBillingGatewayError("MISSING_FEATURE_PRICING_RULE", "缺少冻结记录对应的功能扣费配置。");
  }

  return rule;
}

export function prepareCommercialUsageCharge(input: PrepareCommercialUsageChargeInput): PreparedCommercialUsageCharge {
  const pricingRule = resolveUsagePricingRule(input);

  const margin = calculateCommercialUsageFeatureMargin(pricingRule);
  const { freeze, balance } = freezeCredits({
    userId: input.userId,
    credits: pricingRule.chargedCredits,
    sourceType: "usage_charge",
    sourceBizId: input.taskId,
    idempotencyKey: input.idempotencyKey,
    taskId: input.taskId,
    featureCode: pricingRule.code,
  });

  return {
    pricingRule,
    margin,
    freeze,
    balance,
  };
}

export function prepareCommercialMeteredUsageCharge(
  input: PrepareCommercialMeteredUsageChargeInput,
): PreparedCommercialUsageCharge {
  const pricingRule = buildMeteredPricingRule(input);
  const margin = calculateCommercialUsageFeatureMargin(pricingRule);

  if (pricingRule.chargedCredits <= 0) {
    throw new CommercialBillingGatewayError("INVALID_USAGE_COST", "按量模型调用成本必须大于 0 才能扣费。");
  }

  const { freeze, balance } = freezeCredits({
    userId: input.userId,
    credits: pricingRule.chargedCredits,
    sourceType: "usage_charge",
    sourceBizId: input.taskId,
    idempotencyKey: input.idempotencyKey,
    taskId: input.taskId,
    featureCode: pricingRule.code,
  });

  return {
    pricingRule,
    margin,
    freeze,
    balance,
  };
}

export function confirmCommercialUsageCharge(input: ConfirmCommercialUsageChargeInput): ConfirmedCommercialUsageCharge {
  const freeze = getCommercialCreditFreezeById(input.freezeId);
  if (!freeze) {
    throw new CommercialBillingGatewayError("FREEZE_NOT_FOUND", "未找到待确认的积分冻结记录。");
  }

  const pricingRule = resolveUsagePricingRuleByFreeze(freeze);
  const actualCostRmb = input.actualCostRmb ?? pricingRule.estimatedApiCostRmb;
  const margin = calculateCommercialUsageFeatureMargin(pricingRule, actualCostRmb);
  const { transaction, balance } = confirmCreditFreeze({
    freezeId: input.freezeId,
    idempotencyKey: input.idempotencyKey,
    realCostRmb: actualCostRmb,
    chargedRevenueRmb: margin.revenueRmb,
    grossMarginRate: margin.grossMarginRate,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
  });

  return { transaction, balance };
}

export function confirmCommercialMeteredUsageCharge(
  input: ConfirmCommercialMeteredUsageChargeInput,
): ConfirmedCommercialUsageCharge {
  if (!Number.isFinite(input.actualCostRmb) || input.actualCostRmb < 0) {
    throw new CommercialBillingGatewayError("INVALID_USAGE_COST", "API 实际成本必须是非负有效数字。");
  }

  const freeze = getCommercialCreditFreezeById(input.freezeId);
  if (!freeze) {
    throw new CommercialBillingGatewayError("FREEZE_NOT_FOUND", "未找到待确认的积分冻结记录。");
  }

  const chargedRevenueRmb = freeze.frozenCredits / COMMERCIAL_BILLING_BASELINE.pointsPerRmb;
  const grossMarginRate =
    chargedRevenueRmb > 0 ? (chargedRevenueRmb - input.actualCostRmb) / chargedRevenueRmb : 0;
  const { transaction, balance } = confirmCreditFreeze({
    freezeId: input.freezeId,
    idempotencyKey: input.idempotencyKey,
    realCostRmb: input.actualCostRmb,
    chargedRevenueRmb,
    grossMarginRate,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
  });

  return { transaction, balance };
}

export function releaseCommercialUsageCharge(input: ReleaseCommercialUsageChargeInput): ReleasedCommercialUsageCharge {
  return releaseCreditFreeze({
    freezeId: input.freezeId,
    reason: input.reason,
  });
}
