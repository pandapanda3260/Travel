import {
  COMMERCIAL_VIDEO_PRICING,
  calculateVideoFeatureMargin,
  type CommercialMarginResult,
  type CommercialVideoPricingRule,
} from "./commercial-billing-config";
import {
  type CommercialCreditBalanceRecord,
  type CommercialCreditFreezeRecord,
  type CommercialCreditTransactionRecord,
} from "./commercial-credit-ledger";
import {
  CommercialBillingGatewayError,
  confirmCommercialUsageCharge,
  prepareCommercialUsageCharge,
  releaseCommercialUsageCharge,
} from "./commercial-billing-gateway";

export type PrepareVideoUsageChargeInput = {
  userId: string;
  taskId: string;
  durationSeconds: number;
  idempotencyKey: string;
};

export type ConfirmPreparedUsageChargeInput = {
  freezeId: string;
  idempotencyKey: string;
  provider?: string | null;
  modelId?: string | null;
};

export type ReleasePreparedUsageChargeInput = {
  freezeId: string;
  reason: string;
};

export type PreparedVideoUsageCharge = {
  pricingRule: CommercialVideoPricingRule;
  margin: CommercialMarginResult;
  freeze: CommercialCreditFreezeRecord;
  balance: CommercialCreditBalanceRecord;
};

export type ConfirmedUsageCharge = {
  transaction: CommercialCreditTransactionRecord;
  balance: CommercialCreditBalanceRecord;
};

export type ReleasedUsageCharge = {
  freeze: CommercialCreditFreezeRecord;
  balance: CommercialCreditBalanceRecord;
};

export class CommercialUsageChargeError extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_VIDEO_DURATION"
      | "MISSING_USAGE_PRICING_RULE"
      | "FREEZE_NOT_FOUND"
      | "MEMBERSHIP_REQUIRED"
      | "INVALID_USAGE_COST",
    message: string,
  ) {
    super(message);
    this.name = "CommercialUsageChargeError";
  }
}

export function resolveVideoPricingRule(durationSeconds: number) {
  const normalizedDuration = durationSeconds <= 15 ? 15 : durationSeconds <= 30 ? 30 : durationSeconds <= 60 ? 60 : null;
  if (!normalizedDuration) {
    throw new CommercialUsageChargeError("UNSUPPORTED_VIDEO_DURATION", "暂不支持超过 60 秒的视频商业扣费规则。");
  }

  const rule = COMMERCIAL_VIDEO_PRICING.find((item) => item.durationSeconds === normalizedDuration);
  if (!rule) {
    throw new CommercialUsageChargeError("UNSUPPORTED_VIDEO_DURATION", `缺少 ${normalizedDuration} 秒视频扣费规则。`);
  }

  return rule;
}

function resolveVideoPricingRuleByCode(featureCode: string | null) {
  const rule = COMMERCIAL_VIDEO_PRICING.find((item) => item.code === featureCode);
  if (!rule) {
    throw new CommercialUsageChargeError("MISSING_USAGE_PRICING_RULE", "缺少冻结记录对应的视频扣费规则。");
  }

  return rule;
}

function mapGatewayError(error: unknown): never {
  if (error instanceof CommercialBillingGatewayError) {
    const mappedCode =
      error.code === "MISSING_FEATURE_PRICING_RULE"
        ? "MISSING_USAGE_PRICING_RULE"
        : error.code === "UNSUPPORTED_VIDEO_DURATION"
          ? "UNSUPPORTED_VIDEO_DURATION"
          : error.code;
    throw new CommercialUsageChargeError(mappedCode, error.message);
  }

  throw error;
}

export function prepareVideoUsageCharge(input: PrepareVideoUsageChargeInput): PreparedVideoUsageCharge {
  try {
    const prepared = prepareCommercialUsageCharge({
      userId: input.userId,
      taskId: input.taskId,
      featureCode: "video_generation",
      durationSeconds: input.durationSeconds,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      ...prepared,
      pricingRule: prepared.pricingRule as CommercialVideoPricingRule,
    };
  } catch (error) {
    mapGatewayError(error);
  }
}

export function confirmPreparedUsageCharge(input: ConfirmPreparedUsageChargeInput): ConfirmedUsageCharge {
  try {
    return confirmCommercialUsageCharge(input);
  } catch (error) {
    mapGatewayError(error);
  }
}

export function releasePreparedUsageCharge(input: ReleasePreparedUsageChargeInput): ReleasedUsageCharge {
  try {
    return releaseCommercialUsageCharge(input);
  } catch (error) {
    mapGatewayError(error);
  }
}
