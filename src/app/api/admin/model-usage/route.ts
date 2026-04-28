import { NextRequest, NextResponse } from "next/server";

import { adminApiUnauthorizedResponse, requireAdminApiSession } from "../../../../lib/auth-session";
import {
  getModelUsageAdminSnapshot,
  importModelUsageProviderBillsForAdmin,
  updateModelBillingConfigForAdmin,
  updateModelPricingRuleForAdmin,
} from "../../../../lib/model-usage-service";
import type {
  BillingCurrency,
  MeterPricingRule,
  PricingMeterType,
  PricingSourceType,
  TokenTierPricingRule,
} from "../../../../lib/model-usage-store";

export const dynamic = "force-dynamic";

const pricingSources = new Set<PricingSourceType>(["official", "official_archived", "official_product", "inferred", "manual"]);
const currencies = new Set<BillingCurrency>(["CNY", "USD"]);
const meterTypes = new Set<PricingMeterType>([
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "image_count",
  "video_seconds",
  "audio_seconds",
  "character_count",
  "request_count",
]);

function parseBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function parseFiniteNumber(value: unknown, fieldName: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} 必须是有效数字。`);
  }
  return parsed;
}

function parseOptionalPositiveLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = parseFiniteNumber(value, "每日额度");
  return parsed > 0 ? parsed : null;
}

function parseSource(value: unknown) {
  if (typeof value === "string" && pricingSources.has(value as PricingSourceType)) {
    return value as PricingSourceType;
  }
  throw new Error("定价来源无效。");
}

function parseCurrency(value: unknown) {
  if (typeof value === "string" && currencies.has(value as BillingCurrency)) {
    return value as BillingCurrency;
  }
  throw new Error("币种无效。");
}

function parseMeterType(value: unknown) {
  if (typeof value === "string" && meterTypes.has(value as PricingMeterType)) {
    return value as PricingMeterType;
  }
  throw new Error("计费指标无效。");
}

function parseMeters(value: unknown): MeterPricingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const record = item as Record<string, unknown>;
    return {
      meter: parseMeterType(record.meter),
      unitSize: parseFiniteNumber(record.unitSize, `第 ${index + 1} 个计费单位`),
      unitPrice: parseFiniteNumber(record.unitPrice, `第 ${index + 1} 个计费单价`),
      currency: parseCurrency(record.currency),
    };
  });
}

function parseTokenTiers(value: unknown): TokenTierPricingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const record = item as Record<string, unknown>;
    return {
      maxInputTokens:
        record.maxInputTokens === null || record.maxInputTokens === undefined || record.maxInputTokens === ""
          ? null
          : parseFiniteNumber(record.maxInputTokens, `第 ${index + 1} 个 Token 分档上限`),
      inputPricePerKTokens: parseFiniteNumber(record.inputPricePerKTokens, `第 ${index + 1} 个输入 Token 单价`),
      outputPricePerKTokens: parseFiniteNumber(record.outputPricePerKTokens, `第 ${index + 1} 个输出 Token 单价`),
      cachedInputPricePerKTokens:
        record.cachedInputPricePerKTokens === null ||
        record.cachedInputPricePerKTokens === undefined ||
        record.cachedInputPricePerKTokens === ""
          ? 0
          : parseFiniteNumber(record.cachedInputPricePerKTokens, `第 ${index + 1} 个缓存输入 Token 单价`),
      currency: parseCurrency(record.currency),
    };
  });
}

function parseProviderBillRows(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("缺少供应商账单行。");
  }
  return value.map((item, index) => {
    const record = item as Record<string, unknown>;
    if (typeof record.provider !== "string" || !record.provider.trim()) {
      throw new Error(`第 ${index + 1} 行缺少供应商。`);
    }
    if (typeof record.serviceName !== "string" || !record.serviceName.trim()) {
      throw new Error(`第 ${index + 1} 行缺少服务名称。`);
    }
    return {
      provider: record.provider,
      serviceName: record.serviceName,
      amountRmb: parseFiniteNumber(record.amountRmb, `第 ${index + 1} 行金额`),
      pricingKey: typeof record.pricingKey === "string" ? record.pricingKey : null,
      externalUsageId: typeof record.externalUsageId === "string" ? record.externalUsageId : null,
      requestId: typeof record.requestId === "string" ? record.requestId : null,
      usageId: typeof record.usageId === "string" ? record.usageId : null,
      modelId: typeof record.modelId === "string" ? record.modelId : null,
      pointsCost:
        record.pointsCost === null || record.pointsCost === undefined
          ? null
          : parseFiniteNumber(record.pointsCost, `第 ${index + 1} 行积分`),
      usageSnapshot:
        record.usageSnapshot && typeof record.usageSnapshot === "object"
          ? (record.usageSnapshot as Record<string, number>)
          : null,
      providerPayload:
        record.providerPayload && typeof record.providerPayload === "object"
          ? (record.providerPayload as Record<string, unknown>)
          : record,
    };
  });
}

function assertSuperAdmin(session: NonNullable<ReturnType<typeof requireAdminApiSession>>) {
  if (session.admin.role !== "super_admin") {
    return NextResponse.json({ error: "仅超级管理员可修改计费与定价规则。", code: "FORBIDDEN" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  return NextResponse.json({ snapshot: getModelUsageAdminSnapshot() });
}

export async function POST(request: NextRequest) {
  const session = requireAdminApiSession(request);
  if (!session) {
    return adminApiUnauthorizedResponse();
  }
  const forbidden = assertSuperAdmin(session);
  if (forbidden) {
    return forbidden;
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "update_config") {
      updateModelBillingConfigForAdmin({
        billingEnabled: parseBoolean(body.billingEnabled),
        strictModeEnabled: parseBoolean(body.strictModeEnabled),
        requirePricingRule: parseBoolean(body.requirePricingRule),
        enforceSufficientBalance: parseBoolean(body.enforceSufficientBalance),
        minimumBalancePoints: parseFiniteNumber(body.minimumBalancePoints, "最低余额"),
        dailyUserPointLimit: parseOptionalPositiveLimit(body.dailyUserPointLimit),
        pointsPerRmb: parseFiniteNumber(body.pointsPerRmb, "积分兑换比例"),
        usdToCnyRate: parseFiniteNumber(body.usdToCnyRate, "美元汇率"),
      });
      return NextResponse.json({ snapshot: getModelUsageAdminSnapshot() });
    }

    if (body.action === "update_pricing_rule") {
      if (typeof body.pricingKey !== "string" || !body.pricingKey.trim()) {
        return NextResponse.json({ error: "缺少定价规则 Key", code: "PRICING_KEY_REQUIRED" }, { status: 400 });
      }
      updateModelPricingRuleForAdmin({
        pricingKey: body.pricingKey,
        label: typeof body.label === "string" ? body.label : undefined,
        serviceName: typeof body.serviceName === "string" ? body.serviceName : undefined,
        provider: typeof body.provider === "string" ? body.provider : undefined,
        modelId: typeof body.modelId === "string" ? body.modelId : body.modelId === null ? null : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        source: body.source ? parseSource(body.source) : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        meters: Object.prototype.hasOwnProperty.call(body, "meters") ? parseMeters(body.meters) : undefined,
        tokenTiers: Object.prototype.hasOwnProperty.call(body, "tokenTiers") ? parseTokenTiers(body.tokenTiers) : undefined,
      });
      return NextResponse.json({ snapshot: getModelUsageAdminSnapshot() });
    }

    if (body.action === "import_provider_bills") {
      const result = importModelUsageProviderBillsForAdmin(parseProviderBillRows(body.rows));
      return NextResponse.json({ snapshot: getModelUsageAdminSnapshot(), reconciliation: result.reconciliation });
    }

    return NextResponse.json({ error: "不支持的动作", code: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "计费配置保存失败",
        code: "MODEL_USAGE_CONFIG_INVALID",
      },
      { status: 400 },
    );
  }
}
