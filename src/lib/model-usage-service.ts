import { createHash, randomUUID } from "node:crypto";

import { chargePointsForUsage, ensureUserPointsAccount, recalculateUserPointsAccount } from "./points-service";
import { getModelUsageContext } from "./model-usage-context";
import {
  ensureModelUsageDefaults,
  getDefaultModelBillingConfig,
  getModelBillingConfig,
  getModelPricingRule,
  getModelUsageOverview,
  getModelUsageRecordByIdempotentKey,
  insertModelUsageRecord,
  listModelPricingRules,
  listModelUsageRecords,
  listModelUsageRecordsByUserId,
  type BillingCurrency,
  type ModelPricingRuleRecord,
  type ModelUsageBreakdownItem,
  type ModelUsageMetrics,
  type ModelUsageRecord,
  type PricingMeterType,
} from "./model-usage-store";

type RecordModelUsageInput = {
  pricingKey?: string | null;
  serviceName: string;
  provider?: string | null;
  modelId?: string | null;
  metrics: ModelUsageMetrics;
  objectType?: string | null;
  objectId?: string | null;
  requestId?: string | null;
  idempotentSeed?: string | null;
  remark?: string | null;
};

type PricedUsageComputation = {
  amountRmb: number;
  pointsCost: number;
  breakdown: ModelUsageBreakdownItem[];
};

function roundCurrency(value: number) {
  return Math.round(value * 10000) / 10000;
}

function roundPoints(value: number) {
  return Math.round(value * 100) / 100;
}

function toRmb(value: number, currency: BillingCurrency, usdToCnyRate: number) {
  if (currency === "USD") {
    return value * usdToCnyRate;
  }
  return value;
}

function metricValue(metrics: ModelUsageMetrics, meter: PricingMeterType) {
  switch (meter) {
    case "input_tokens":
      return Number(metrics.inputTokens ?? 0);
    case "output_tokens":
      return Number(metrics.outputTokens ?? 0);
    case "cached_input_tokens":
      return Number(metrics.cachedInputTokens ?? 0);
    case "image_count":
      return Number(metrics.imageCount ?? 0);
    case "video_seconds":
      return Number(metrics.videoSeconds ?? 0);
    case "audio_seconds":
      return Number(metrics.audioSeconds ?? 0);
    case "character_count":
      return Number(metrics.characterCount ?? 0);
    case "request_count":
      return Number(metrics.requestCount ?? 0);
    default:
      return 0;
  }
}

function findTokenTier(rule: ModelPricingRuleRecord, inputTokens: number) {
  return (
    rule.tokenTiers.find((item) => item.maxInputTokens === null || inputTokens <= item.maxInputTokens) ??
    rule.tokenTiers.at(-1) ??
    null
  );
}

function computePricedUsage(
  rule: ModelPricingRuleRecord,
  metrics: ModelUsageMetrics,
  billingConfig: ReturnType<typeof getDefaultModelBillingConfig>,
): PricedUsageComputation {
  const breakdown: ModelUsageBreakdownItem[] = [];

  if (rule.billingMode === "token_tiered") {
    const inputTokens = Number(metrics.inputTokens ?? 0);
    const outputTokens = Number(metrics.outputTokens ?? 0);
    const cachedInputTokens = Number(metrics.cachedInputTokens ?? 0);
    const tier = findTokenTier(rule, inputTokens);

    if (!tier) {
      return { amountRmb: 0, pointsCost: 0, breakdown };
    }

    const addTierBreakdown = (
      meter: PricingMeterType,
      quantity: number,
      unitPricePerKTokens: number | null | undefined,
      currency: BillingCurrency,
    ) => {
      if (!quantity || !unitPricePerKTokens) {
        return;
      }
      const amountRmb = roundCurrency(
        toRmb((quantity / 1000) * unitPricePerKTokens, currency, billingConfig.usdToCnyRate),
      );
      breakdown.push({
        meter,
        quantity,
        unitSize: 1000,
        unitPrice: unitPricePerKTokens,
        currency,
        amountRmb,
      });
    };

    addTierBreakdown("input_tokens", inputTokens, tier.inputPricePerKTokens, tier.currency);
    addTierBreakdown("output_tokens", outputTokens, tier.outputPricePerKTokens, tier.currency);
    addTierBreakdown("cached_input_tokens", cachedInputTokens, tier.cachedInputPricePerKTokens ?? 0, tier.currency);
  } else {
    for (const meterRule of rule.meters) {
      const quantity = metricValue(metrics, meterRule.meter);
      if (!quantity) {
        continue;
      }
      const amountRmb = roundCurrency(
        toRmb((quantity / meterRule.unitSize) * meterRule.unitPrice, meterRule.currency, billingConfig.usdToCnyRate),
      );
      breakdown.push({
        meter: meterRule.meter,
        quantity,
        unitSize: meterRule.unitSize,
        unitPrice: meterRule.unitPrice,
        currency: meterRule.currency,
        amountRmb,
      });
    }
  }

  const amountRmb = roundCurrency(breakdown.reduce((sum, item) => sum + item.amountRmb, 0));
  return {
    amountRmb,
    pointsCost: roundPoints(amountRmb * billingConfig.pointsPerRmb),
    breakdown,
  };
}

function buildUsageIdempotentKey(input: RecordModelUsageInput, userId: string, requestId: string | null) {
  const seed = [
    userId,
    input.serviceName,
    input.provider ?? "",
    input.modelId ?? "",
    input.idempotentSeed ?? requestId ?? "",
    JSON.stringify(input.metrics),
    input.objectType ?? "",
    input.objectId ?? "",
  ].join("|");

  return `model_usage:${createHash("sha256").update(seed).digest("hex")}`;
}

export function recordModelUsage(input: RecordModelUsageInput) {
  ensureModelUsageDefaults();
  const context = getModelUsageContext();
  if (!context?.userId) {
    return null;
  }

  const billingConfig = getModelBillingConfig() ?? getDefaultModelBillingConfig();
  if (!billingConfig.billingEnabled) {
    return null;
  }

  const requestId = input.requestId ?? context.requestId ?? null;
  const idempotentKey = buildUsageIdempotentKey(input, context.userId, requestId);
  const existing = getModelUsageRecordByIdempotentKey(idempotentKey);
  if (existing) {
    return existing;
  }

  const pricingRule = input.pricingKey ? getModelPricingRule(input.pricingKey) : null;
  const priced =
    pricingRule && pricingRule.enabled ? computePricedUsage(pricingRule, input.metrics, billingConfig) : null;
  const amountRmb = priced?.amountRmb ?? 0;
  const pointsCost = priced?.pointsCost ?? 0;
  const usageId = `usage-${randomUUID()}`;

  const record: ModelUsageRecord = {
    usageId,
    userId: context.userId,
    routePath: context.routePath ?? null,
    requestId,
    serviceName: input.serviceName,
    provider: input.provider ?? null,
    modelId: input.modelId ?? null,
    objectType: input.objectType ?? context.objectType ?? null,
    objectId: input.objectId ?? context.objectId ?? null,
    pricingKey: pricingRule?.pricingKey ?? input.pricingKey ?? null,
    pricingSource: pricingRule?.source ?? null,
    status: pricingRule?.enabled ? "charged" : input.pricingKey ? "unpriced" : "skipped",
    amountRmb,
    pointsCost,
    usageSnapshot: input.metrics,
    pricingSnapshot: {
      label: pricingRule?.label ?? input.pricingKey ?? null,
      billingMode: pricingRule?.billingMode ?? null,
      breakdown: priced?.breakdown ?? [],
      notes: pricingRule?.notes ?? input.remark ?? null,
    },
    idempotentKey,
    createdAt: new Date().toISOString(),
  };

  insertModelUsageRecord(record);

  if (pricingRule?.enabled && pointsCost > 0) {
    chargePointsForUsage({
      userId: context.userId,
      serviceName: input.serviceName,
      modelId: input.modelId ?? pricingRule.modelId,
      sourceBizId: record.usageId,
      idempotentKey: `${idempotentKey}:points`,
      pointsCost,
      remark: input.remark ?? `${pricingRule.label} 调用扣费`,
    });
  } else {
    ensureUserPointsAccount(context.userId);
    recalculateUserPointsAccount(context.userId);
  }

  return record;
}

export function buildIdempotentSeed(input: {
  requestId?: string | null;
  serviceName: string;
  modelId?: string | null;
  objectId?: string | null;
}) {
  return [input.requestId ?? "", input.serviceName, input.modelId ?? "", input.objectId ?? ""].join("|");
}

export function getModelUsageAdminSnapshot() {
  const recentUsage = listModelUsageRecords(50);
  const recentByService = new Map<string, { calls: number; amountRmb: number; pointsCost: number }>();

  for (const item of recentUsage) {
    const current = recentByService.get(item.serviceName) ?? { calls: 0, amountRmb: 0, pointsCost: 0 };
    current.calls += 1;
    current.amountRmb += item.amountRmb;
    current.pointsCost += item.pointsCost;
    recentByService.set(item.serviceName, current);
  }

  return {
    billingConfig: getModelBillingConfig() ?? getDefaultModelBillingConfig(),
    overview: getModelUsageOverview(30),
    pricingRules: listModelPricingRules(),
    recentUsage,
    recentByService: Array.from(recentByService.entries()).map(([serviceName, value]) => ({
      serviceName,
      calls: value.calls,
      amountRmb: roundCurrency(value.amountRmb),
      pointsCost: roundPoints(value.pointsCost),
    })),
  };
}

export function getUserModelUsagePayload(userId: string) {
  return {
    records: listModelUsageRecordsByUserId(userId, 30),
  };
}
