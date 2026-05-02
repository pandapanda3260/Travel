import { createHash, randomUUID } from "node:crypto";

import { getCommercialCreditBalance } from "./commercial-credit-ledger";
import { getModelUsageContext } from "./model-usage-context";
import {
  confirmCommercialMeteredUsageCharge,
  prepareCommercialMeteredUsageCharge,
  releaseCommercialUsageCharge,
  type PreparedCommercialUsageCharge,
} from "./commercial-billing-gateway";
import {
  ensureModelUsageDefaults,
  findModelUsageRecordForProviderBill,
  getDefaultModelBillingConfig,
  getModelBillingConfig,
  getModelPricingRule,
  getModelUsageReconciliationOverview,
  getModelUsageOverview,
  getModelUsageRecordByIdempotentKey,
  getModelUsageRiskEventOverview,
  getModelUsageSummaryByUserId,
  insertModelUsageRecord,
  insertModelUsageRiskEvent,
  listModelPricingRules,
  listModelUsageRiskEvents,
  listModelUsageProviderBillRecords,
  listModelUsageRecords,
  listModelUsageRecordsByUserId,
  listModelUsageUserSummaries,
  setModelBillingConfig,
  upsertModelUsageProviderBillRecord,
  upsertModelPricingRule,
  type BillingCurrency,
  type MeterPricingRule,
  type ModelBillingConfigRecord,
  type ModelUsageProviderBillRecord,
  type ModelUsageRiskEventSeverity,
  type ModelPricingRuleRecord,
  type ModelUsageBreakdownItem,
  type ModelUsageMetrics,
  type ModelUsageRecord,
  type PricingMeterType,
  type PricingSourceType,
  type TokenTierPricingRule,
} from "./model-usage-store";

export { runWithModelUsageContext } from "./model-usage-context";

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

type PreparedCommercialModelUsageCharge = PreparedCommercialUsageCharge & {
  confirmIdempotencyKey: string;
};

type ModelBillingConfigUpdateInput = Partial<
  Pick<
    ModelBillingConfigRecord,
    | "billingEnabled"
    | "strictModeEnabled"
    | "requirePricingRule"
    | "enforceSufficientBalance"
    | "minimumBalancePoints"
    | "dailyUserPointLimit"
    | "pointsPerRmb"
    | "usdToCnyRate"
  >
>;

type ModelPricingRuleUpdateInput = {
  pricingKey: string;
  label?: string;
  serviceName?: string;
  provider?: string;
  modelId?: string | null;
  enabled?: boolean;
  source?: PricingSourceType;
  notes?: string;
  meters?: MeterPricingRule[];
  tokenTiers?: TokenTierPricingRule[];
};

type ModelUsageProviderBillImportInput = {
  provider: string;
  serviceName: string;
  amountRmb: number;
  pricingKey?: string | null;
  externalUsageId?: string | null;
  requestId?: string | null;
  usageId?: string | null;
  modelId?: string | null;
  pointsCost?: number | null;
  usageSnapshot?: ModelUsageMetrics | null;
  providerPayload?: Record<string, unknown> | null;
};

export class ModelUsageBillingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MISSING_USAGE_CONTEXT"
      | "MISSING_PRICING_RULE"
      | "DISABLED_PRICING_RULE"
      | "INSUFFICIENT_POINTS_BALANCE"
      | "DAILY_USAGE_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "ModelUsageBillingError";
  }
}

type ModelUsageBillingPolicy = {
  billingEnabled: boolean;
  strictModeEnabled: boolean;
  requirePricingRule: boolean;
  enforceSufficientBalance: boolean;
  minimumBalancePoints: number;
  dailyUserPointLimit: number | null;
  strictModeSource: "env" | "config" | "off";
};

function roundCurrency(value: number) {
  return Math.round(value * 10000) / 10000;
}

function roundPoints(value: number) {
  return Math.round(value * 100) / 100;
}

function assertFiniteNumber(value: number, message: string) {
  if (!Number.isFinite(value)) {
    throw new Error(message);
  }
}

function normalizeOptionalPositiveLimit(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0) {
    return null;
  }
  return Number.isFinite(value) && value > 0 ? value : null;
}

function recordUsageRiskEvent(input: {
  code: string;
  serviceName: string;
  pricingKey?: string | null;
  message: string;
  severity?: ModelUsageRiskEventSeverity;
  metadata?: Record<string, unknown>;
}) {
  const context = getModelUsageContext();
  insertModelUsageRiskEvent({
    eventId: `risk-${randomUUID()}`,
    severity: input.severity ?? "critical",
    code: input.code,
    userId: context?.userId ?? null,
    serviceName: input.serviceName,
    pricingKey: input.pricingKey ?? null,
    routePath: context?.routePath ?? null,
    objectType: context?.objectType ?? null,
    objectId: context?.objectId ?? null,
    message: input.message,
    metadata: input.metadata ?? {},
    status: "open",
    createdAt: new Date().toISOString(),
  });
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

function readBooleanEnv(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return null;
}

function resolveModelUsageBillingPolicy(config: ModelBillingConfigRecord): ModelUsageBillingPolicy {
  const strictEnv = readBooleanEnv("USAGE_BILLING_STRICT_MODE");
  const requirePricingEnv = readBooleanEnv("USAGE_BILLING_REQUIRE_PRICING");
  const strictModeEnabled = strictEnv ?? config.strictModeEnabled;
  const strictModeSource = strictEnv !== null ? "env" : config.strictModeEnabled ? "config" : "off";
  const configuredRequirePricing = requirePricingEnv ?? config.requirePricingRule;

  return {
    billingEnabled: config.billingEnabled,
    strictModeEnabled,
    requirePricingRule: configuredRequirePricing,
    enforceSufficientBalance: false,
    minimumBalancePoints: 0,
    dailyUserPointLimit: null,
    strictModeSource,
  };
}

function resolvePricingRuleForUsage(input: Pick<RecordModelUsageInput, "pricingKey" | "serviceName">, policy: ModelUsageBillingPolicy) {
  if (!input.pricingKey) {
    if (policy.requirePricingRule) {
      const message = `模型调用 ${input.serviceName} 缺少定价规则，已阻止以避免生产用量无法计费。`;
      recordUsageRiskEvent({
        code: "MISSING_PRICING_RULE",
        serviceName: input.serviceName,
        pricingKey: null,
        message,
      });
      throw new ModelUsageBillingError(
        message,
        "MISSING_PRICING_RULE",
      );
    }
    return null;
  }

  const pricingRule = getModelPricingRule(input.pricingKey);
  if (!pricingRule?.enabled) {
    if (policy.requirePricingRule) {
      const message = `模型调用 ${input.serviceName} 的定价规则 ${input.pricingKey} 未配置或未启用，已阻止以避免生产用量无法计费。`;
      const code = pricingRule ? "DISABLED_PRICING_RULE" : "MISSING_PRICING_RULE";
      recordUsageRiskEvent({
        code,
        serviceName: input.serviceName,
        pricingKey: input.pricingKey,
        message,
        metadata: { pricingRuleExists: Boolean(pricingRule) },
      });
      throw new ModelUsageBillingError(
        message,
        code,
      );
    }
    return null;
  }

  return pricingRule;
}

function normalizeMeters(meters: MeterPricingRule[]) {
  return meters.map((item) => {
    assertFiniteNumber(item.unitSize, "计费单位必须是有效数字。");
    assertFiniteNumber(item.unitPrice, "计费单价必须是有效数字。");
    if (item.unitSize <= 0) {
      throw new Error("计费单位必须大于 0。");
    }
    if (item.unitPrice < 0) {
      throw new Error("计费单价不能小于 0。");
    }
    return {
      meter: item.meter,
      unitSize: item.unitSize,
      unitPrice: item.unitPrice,
      currency: item.currency,
    };
  });
}

function normalizeTokenTiers(tokenTiers: TokenTierPricingRule[]) {
  return tokenTiers.map((item) => {
    assertFiniteNumber(item.inputPricePerKTokens, "输入 Token 单价必须是有效数字。");
    assertFiniteNumber(item.outputPricePerKTokens, "输出 Token 单价必须是有效数字。");
    const cachedPrice = item.cachedInputPricePerKTokens ?? 0;
    assertFiniteNumber(cachedPrice, "缓存输入 Token 单价必须是有效数字。");
    if (item.maxInputTokens !== null && (!Number.isFinite(item.maxInputTokens) || item.maxInputTokens <= 0)) {
      throw new Error("Token 分档上限必须为空或大于 0。");
    }
    if (item.inputPricePerKTokens < 0 || item.outputPricePerKTokens < 0 || cachedPrice < 0) {
      throw new Error("Token 单价不能小于 0。");
    }
    return {
      maxInputTokens: item.maxInputTokens,
      inputPricePerKTokens: item.inputPricePerKTokens,
      outputPricePerKTokens: item.outputPricePerKTokens,
      cachedInputPricePerKTokens: cachedPrice,
      currency: item.currency,
    };
  });
}

function hasPositivePricing(rule: ModelPricingRuleRecord) {
  if (rule.billingMode === "metered") {
    return rule.meters.some((item) => item.unitSize > 0 && item.unitPrice > 0);
  }
  return rule.tokenTiers.some(
    (item) =>
      item.inputPricePerKTokens > 0 ||
      item.outputPricePerKTokens > 0 ||
      Number(item.cachedInputPricePerKTokens ?? 0) > 0,
  );
}

export function updateModelBillingConfigForAdmin(input: ModelBillingConfigUpdateInput) {
  ensureModelUsageDefaults();
  const current = getModelBillingConfig() ?? getDefaultModelBillingConfig();
  const pointsPerRmb = input.pointsPerRmb ?? current.pointsPerRmb;
  const usdToCnyRate = input.usdToCnyRate ?? current.usdToCnyRate;
  const minimumBalancePoints = input.minimumBalancePoints ?? current.minimumBalancePoints;

  assertFiniteNumber(pointsPerRmb, "积分兑换比例必须是有效数字。");
  assertFiniteNumber(usdToCnyRate, "美元汇率必须是有效数字。");
  assertFiniteNumber(minimumBalancePoints, "最低余额必须是有效数字。");
  if (pointsPerRmb <= 0) {
    throw new Error("积分兑换比例必须大于 0。");
  }
  if (usdToCnyRate <= 0) {
    throw new Error("美元汇率必须大于 0。");
  }
  if (minimumBalancePoints < 0) {
    throw new Error("最低余额不能小于 0。");
  }

  const next: ModelBillingConfigRecord = {
    ...current,
    ...input,
    minimumBalancePoints,
    dailyUserPointLimit: normalizeOptionalPositiveLimit(input.dailyUserPointLimit ?? current.dailyUserPointLimit),
    pointsPerRmb,
    usdToCnyRate,
    updatedAt: new Date().toISOString(),
  };
  setModelBillingConfig(next);
  return next;
}

export function updateModelPricingRuleForAdmin(input: ModelPricingRuleUpdateInput) {
  ensureModelUsageDefaults();
  const pricingKey = input.pricingKey.trim();
  const current = getModelPricingRule(pricingKey);
  if (!current) {
    throw new Error("定价规则不存在。");
  }

  const next: ModelPricingRuleRecord = {
    ...current,
    label: input.label?.trim() || current.label,
    serviceName: input.serviceName?.trim() || current.serviceName,
    provider: input.provider?.trim() || current.provider,
    modelId: Object.prototype.hasOwnProperty.call(input, "modelId") ? (input.modelId?.trim() || null) : current.modelId,
    enabled: input.enabled ?? current.enabled,
    source: input.source ?? current.source,
    notes: input.notes?.trim() ?? current.notes,
    meters: input.meters ? normalizeMeters(input.meters) : current.meters,
    tokenTiers: input.tokenTiers ? normalizeTokenTiers(input.tokenTiers) : current.tokenTiers,
    updatedAt: new Date().toISOString(),
  };

  if (next.billingMode === "metered" && next.meters.length === 0) {
    throw new Error("启用按量定价规则前必须配置至少一个计费项。");
  }
  if (next.billingMode === "token_tiered" && next.tokenTiers.length === 0) {
    throw new Error("启用 Token 分档定价规则前必须配置至少一个分档。");
  }
  if (next.enabled && !hasPositivePricing(next)) {
    throw new Error("启用定价规则前必须配置大于 0 的单价。");
  }

  upsertModelPricingRule(next);
  return next;
}

export function getModelUsageBillingPolicy() {
  ensureModelUsageDefaults();
  return resolveModelUsageBillingPolicy(getModelBillingConfig() ?? getDefaultModelBillingConfig());
}

export function assertModelUsagePreflight(
  input: Pick<RecordModelUsageInput, "pricingKey" | "serviceName"> & {
    estimatedMetrics?: ModelUsageMetrics | null;
  },
) {
  ensureModelUsageDefaults();
  const billingConfig = getModelBillingConfig() ?? getDefaultModelBillingConfig();
  const policy = resolveModelUsageBillingPolicy(billingConfig);

  if (!policy.billingEnabled) {
    return { policy, context: getModelUsageContext(), pricingRule: null };
  }

  const context = getModelUsageContext();
  if (!context?.userId && policy.strictModeEnabled) {
    const message = `模型调用 ${input.serviceName} 缺少用户用量上下文，已阻止以避免生产漏记。`;
    recordUsageRiskEvent({
      code: "MISSING_USAGE_CONTEXT",
      serviceName: input.serviceName,
      pricingKey: input.pricingKey,
      message,
    });
    throw new ModelUsageBillingError(message, "MISSING_USAGE_CONTEXT");
  }

  const pricingRule = resolvePricingRuleForUsage(input, policy);
  const estimated =
    pricingRule && input.estimatedMetrics ? computePricedUsage(pricingRule, input.estimatedMetrics, billingConfig) : null;

  return {
    policy,
    context,
    pricingRule,
    estimated,
  };
}

export function resolveDefaultModelPricingKey(modelId: string | null | undefined) {
  const normalizedModelId = modelId?.trim().toLowerCase() ?? "";
  if (!normalizedModelId) {
    return null;
  }
  if (normalizedModelId.startsWith("gpt-5.5")) {
    return "openai.gpt-5.5";
  }
  if (normalizedModelId.startsWith("gpt-4o")) {
    return "openai.gpt-4o";
  }
  if (normalizedModelId === "gpt-image-2" || normalizedModelId === "image2") {
    return "liangxin.gpt-image-2";
  }
  if (normalizedModelId.includes("doubao-seed-2.0-pro")) {
    return "doubao.seed.2.0.pro";
  }
  if (normalizedModelId.includes("vision-pro")) {
    return "doubao.vision.1.5.pro.32k";
  }
  if (normalizedModelId.includes("seedream-4-5")) {
    return "doubao.seedream.4.5";
  }
  if (normalizedModelId.includes("seedream-5-0")) {
    return "doubao.seedream.5.0";
  }
  if (normalizedModelId.includes("seedance")) {
    return "doubao.seedance.2.0";
  }
  if (normalizedModelId === "seed-tts-2.0") {
    return "doubao.speech.tts.2.0";
  }
  if (normalizedModelId === "volc.bigasr.auc_turbo") {
    return "doubao.asr.file.2.0";
  }
  if (normalizedModelId === "seed-icl-2.0") {
    return "doubao.voice.clone.2.0";
  }
  return null;
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

function resolveCommercialFeatureCodeForModelUsage(serviceName: string) {
  if (serviceName.startsWith("image.")) {
    return "image_generation" as const;
  }
  if (serviceName.startsWith("audio.") || serviceName.startsWith("voice.")) {
    return "audio_generation" as const;
  }
  if (serviceName.includes("subtitle")) {
    return "subtitle_generation" as const;
  }
  if (serviceName.includes("composition")) {
    return "video_composition" as const;
  }
  return "text_generation" as const;
}

export function estimateTextModelUsageMetrics(input: {
  inputText: string;
  maxOutputTokens?: number | null;
  cachedInputTokens?: number | null;
}): ModelUsageMetrics {
  const inputTokens = Math.max(1, Array.from(input.inputText).length);
  const outputTokens = Math.max(1, Math.ceil(input.maxOutputTokens ?? 2_000));
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.max(0, Math.ceil(input.cachedInputTokens ?? 0)),
    requestCount: 1,
  };
}

function buildCommercialModelUsageIdempotencyKey(input: {
  phase: "freeze" | "confirm";
  userId: string;
  serviceName: string;
  pricingKey?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  requestId?: string | null;
  idempotentSeed?: string | null;
  metrics?: ModelUsageMetrics | null;
}) {
  const seed = [
    input.phase,
    input.userId,
    input.serviceName,
    input.pricingKey ?? "",
    input.objectType ?? "",
    input.objectId ?? "",
    input.requestId ?? "",
    input.idempotentSeed ?? "",
    JSON.stringify(input.metrics ?? {}),
  ].join("|");

  return `commercial:model_usage:${input.phase}:${createHash("sha256").update(seed).digest("hex")}`;
}

export function prepareCommercialModelUsageCharge(
  input: Pick<RecordModelUsageInput, "pricingKey" | "serviceName" | "idempotentSeed" | "remark"> & {
    estimatedMetrics: ModelUsageMetrics;
  },
): PreparedCommercialModelUsageCharge | null {
  const preflight = assertModelUsagePreflight({
    pricingKey: input.pricingKey,
    serviceName: input.serviceName,
    estimatedMetrics: input.estimatedMetrics,
  });
  const context = preflight.context;
  if (!context?.userId || !preflight.pricingRule || !preflight.estimated || preflight.estimated.amountRmb <= 0) {
    return null;
  }

  const featureCode = resolveCommercialFeatureCodeForModelUsage(input.serviceName);
  const taskId = context.objectId ?? context.requestId ?? `${input.serviceName}:${input.pricingKey ?? "unpriced"}`;
  const freezeIdempotencyKey = buildCommercialModelUsageIdempotencyKey({
    phase: "freeze",
    userId: context.userId,
    serviceName: input.serviceName,
    pricingKey: preflight.pricingRule.pricingKey,
    objectType: context.objectType,
    objectId: context.objectId,
    requestId: context.requestId,
    idempotentSeed: input.idempotentSeed,
    metrics: input.estimatedMetrics,
  });
  const confirmIdempotencyKey = buildCommercialModelUsageIdempotencyKey({
    phase: "confirm",
    userId: context.userId,
    serviceName: input.serviceName,
    pricingKey: preflight.pricingRule.pricingKey,
    objectType: context.objectType,
    objectId: context.objectId,
    requestId: context.requestId,
    idempotentSeed: input.idempotentSeed,
    metrics: input.estimatedMetrics,
  });

  const prepared = prepareCommercialMeteredUsageCharge({
    userId: context.userId,
    taskId,
    featureCode,
    estimatedApiCostRmb: preflight.estimated.amountRmb,
    idempotencyKey: freezeIdempotencyKey,
    name: preflight.pricingRule.label,
  });

  return {
    ...prepared,
    confirmIdempotencyKey,
  };
}

export function confirmCommercialModelUsageCharge(
  prepared: PreparedCommercialModelUsageCharge | null,
  input: RecordModelUsageInput,
) {
  const record = recordModelUsage(input);
  if (prepared && record?.status === "charged" && record.amountRmb > 0) {
    confirmCommercialMeteredUsageCharge({
      freezeId: prepared.freeze.freezeId,
      idempotencyKey: prepared.confirmIdempotencyKey,
      actualCostRmb: record.amountRmb,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
    });
  }
  return record;
}

export function releaseCommercialModelUsageCharge(prepared: PreparedCommercialModelUsageCharge | null, reason: string) {
  if (!prepared) {
    return null;
  }
  return releaseCommercialUsageCharge({
    freezeId: prepared.freeze.freezeId,
    reason,
  });
}

export function recordModelUsage(input: RecordModelUsageInput) {
  ensureModelUsageDefaults();
  const billingConfig = getModelBillingConfig() ?? getDefaultModelBillingConfig();
  const policy = resolveModelUsageBillingPolicy(billingConfig);

  if (!policy.billingEnabled) {
    return null;
  }

  const context = getModelUsageContext();
  if (!context?.userId) {
    if (policy.strictModeEnabled) {
      const message = `模型调用 ${input.serviceName} 缺少用户用量上下文，已阻止以避免生产漏记。`;
      recordUsageRiskEvent({
        code: "MISSING_USAGE_CONTEXT",
        serviceName: input.serviceName,
        pricingKey: input.pricingKey,
        message,
      });
      throw new ModelUsageBillingError(message, "MISSING_USAGE_CONTEXT");
    }
    return null;
  }

  const requestId = input.requestId ?? context.requestId ?? null;
  const idempotentKey = buildUsageIdempotentKey(input, context.userId, requestId);
  const existing = getModelUsageRecordByIdempotentKey(idempotentKey);
  if (existing) {
    return existing;
  }

  const pricingRule = resolvePricingRuleForUsage(input, policy);
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

function buildProviderBillIdempotentKey(input: ModelUsageProviderBillImportInput) {
  if (input.externalUsageId?.trim()) {
    return `provider_bill:${input.provider}:${input.externalUsageId.trim()}`;
  }
  if (input.usageId?.trim()) {
    return `provider_bill:${input.provider}:usage:${input.usageId.trim()}`;
  }
  const seed = [
    input.provider,
    input.requestId ?? "",
    input.pricingKey ?? "",
    input.serviceName,
    input.modelId ?? "",
    input.amountRmb,
  ].join("|");
  return `provider_bill:${createHash("sha256").update(seed).digest("hex")}`;
}

function resolveProviderBillStatus(input: {
  billAmountRmb: number;
  billPointsCost: number;
  usage: ModelUsageRecord | null;
}) {
  if (!input.usage) {
    return {
      status: "unmatched" as const,
      mismatchReason: "未匹配到本地用量流水",
    };
  }

  const reasons: string[] = [];
  if (Math.abs(input.billAmountRmb - input.usage.amountRmb) > 0.01) {
    reasons.push(`金额差异：供应商 ${input.billAmountRmb} 元，本地 ${input.usage.amountRmb} 元`);
  }
  if (Math.abs(input.billPointsCost - input.usage.pointsCost) > 0.5) {
    reasons.push(`积分差异：供应商 ${input.billPointsCost}，本地 ${input.usage.pointsCost}`);
  }

  return reasons.length > 0
    ? { status: "mismatch" as const, mismatchReason: reasons.join("；") }
    : { status: "matched" as const, mismatchReason: null };
}

export function importModelUsageProviderBillsForAdmin(rows: ModelUsageProviderBillImportInput[]) {
  ensureModelUsageDefaults();
  const billingConfig = getModelBillingConfig() ?? getDefaultModelBillingConfig();
  const timestamp = new Date().toISOString();
  const imported: ModelUsageProviderBillRecord[] = [];

  for (const row of rows) {
    const provider = row.provider.trim();
    const serviceName = row.serviceName.trim();
    if (!provider || !serviceName) {
      throw new Error("供应商和服务名称不能为空。");
    }
    assertFiniteNumber(row.amountRmb, "供应商账单金额必须是有效数字。");
    if (row.amountRmb < 0) {
      throw new Error("供应商账单金额不能小于 0。");
    }

    const usage = findModelUsageRecordForProviderBill({
      usageId: row.usageId ?? null,
      requestId: row.requestId ?? null,
      pricingKey: row.pricingKey ?? null,
      provider,
      serviceName,
    });
    const pointsCost = roundPoints(row.pointsCost ?? row.amountRmb * billingConfig.pointsPerRmb);
    const status = resolveProviderBillStatus({
      billAmountRmb: row.amountRmb,
      billPointsCost: pointsCost,
      usage,
    });
    const idempotentKey = buildProviderBillIdempotentKey({ ...row, provider, serviceName });
    const record: ModelUsageProviderBillRecord = {
      billId: `bill-${randomUUID()}`,
      provider,
      pricingKey: row.pricingKey?.trim() || usage?.pricingKey || null,
      externalUsageId: row.externalUsageId?.trim() || null,
      requestId: row.requestId?.trim() || usage?.requestId || null,
      usageId: usage?.usageId ?? row.usageId?.trim() ?? null,
      userId: usage?.userId ?? null,
      serviceName,
      modelId: row.modelId?.trim() || usage?.modelId || null,
      amountRmb: roundCurrency(row.amountRmb),
      pointsCost,
      usageSnapshot: row.usageSnapshot ?? usage?.usageSnapshot ?? {},
      providerPayload: row.providerPayload ?? {},
      status: status.status,
      mismatchReason: status.mismatchReason,
      idempotentKey,
      importedAt: timestamp,
      updatedAt: timestamp,
    };
    upsertModelUsageProviderBillRecord(record);
    imported.push(record);
  }

  return {
    imported,
    reconciliation: getModelUsageReconciliationSnapshot(),
  };
}

export function getModelUsageReconciliationSnapshot() {
  return {
    overview: getModelUsageReconciliationOverview(30),
    recentBills: listModelUsageProviderBillRecords(30),
  };
}

export function getModelUsageRiskEventSnapshot() {
  return {
    overview: getModelUsageRiskEventOverview(30),
    recentEvents: listModelUsageRiskEvents(30),
  };
}

export function getModelUsageAdminSnapshot() {
  const recentUsage = listModelUsageRecords(50);
  const recentByService = new Map<string, { calls: number; amountRmb: number; pointsCost: number }>();
  const overview = getModelUsageOverview(30);

  for (const item of recentUsage) {
    const current = recentByService.get(item.serviceName) ?? { calls: 0, amountRmb: 0, pointsCost: 0 };
    current.calls += 1;
    current.amountRmb += item.amountRmb;
    current.pointsCost += item.pointsCost;
    recentByService.set(item.serviceName, current);
  }

  return {
    billingConfig: getModelBillingConfig() ?? getDefaultModelBillingConfig(),
    billingPolicy: getModelUsageBillingPolicy(),
    overview,
    riskOverview: {
      unpricedCalls: overview.unpricedCalls,
      skippedCalls: overview.skippedCalls,
      riskyCalls: overview.unpricedCalls + overview.skippedCalls,
    },
    pricingRules: listModelPricingRules(),
    userSummaries: listModelUsageUserSummaries(30, 20),
    reconciliation: getModelUsageReconciliationSnapshot(),
    riskEvents: getModelUsageRiskEventSnapshot(),
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
    summary: getModelUsageSummaryByUserId(userId, 30),
    commercialBalance: getCommercialCreditBalance(userId),
    records: listModelUsageRecordsByUserId(userId, 80),
  };
}
