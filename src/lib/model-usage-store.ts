import { db, dbGet, dbGetAll, dbGetSingleton, dbSetSingleton, dbUpsert } from "./db";

export type BillingCurrency = "CNY" | "USD";
export type PricingSourceType = "official" | "official_archived" | "official_product" | "inferred" | "manual";
export type PricingMeterType =
  | "input_tokens"
  | "output_tokens"
  | "cached_input_tokens"
  | "image_count"
  | "video_seconds"
  | "audio_seconds"
  | "character_count"
  | "request_count";

export type MeterPricingRule = {
  meter: PricingMeterType;
  unitSize: number;
  unitPrice: number;
  currency: BillingCurrency;
};

export type TokenTierPricingRule = {
  maxInputTokens: number | null;
  inputPricePerKTokens: number;
  outputPricePerKTokens: number;
  cachedInputPricePerKTokens?: number | null;
  currency: BillingCurrency;
};

export type ModelPricingRuleRecord = {
  pricingKey: string;
  label: string;
  serviceName: string;
  provider: string;
  modelId: string | null;
  billingMode: "token_tiered" | "metered";
  tokenTiers: TokenTierPricingRule[];
  meters: MeterPricingRule[];
  enabled: boolean;
  source: PricingSourceType;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ModelBillingConfigRecord = {
  billingEnabled: boolean;
  pointsPerRmb: number;
  usdToCnyRate: number;
  createdAt: string;
  updatedAt: string;
};

export type ModelUsageMetrics = Partial<{
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  imageCount: number;
  videoSeconds: number;
  audioSeconds: number;
  characterCount: number;
  requestCount: number;
}>;

export type ModelUsageBreakdownItem = {
  meter: PricingMeterType;
  quantity: number;
  unitSize: number;
  unitPrice: number;
  currency: BillingCurrency;
  amountRmb: number;
};

export type ModelUsageRecord = {
  usageId: string;
  userId: string;
  routePath: string | null;
  requestId: string | null;
  serviceName: string;
  provider: string | null;
  modelId: string | null;
  objectType: string | null;
  objectId: string | null;
  pricingKey: string | null;
  pricingSource: PricingSourceType | null;
  status: "charged" | "unpriced" | "skipped";
  amountRmb: number;
  pointsCost: number;
  usageSnapshot: ModelUsageMetrics;
  pricingSnapshot: {
    label: string | null;
    billingMode: ModelPricingRuleRecord["billingMode"] | null;
    breakdown: ModelUsageBreakdownItem[];
    notes: string | null;
  };
  idempotentKey: string;
  createdAt: string;
};

const MODEL_PRICING_RULE_COLLECTION = "model-pricing-rules";
const MODEL_BILLING_CONFIG_COLLECTION = "model-billing-config";

let initialized = false;

function nowIso() {
  return new Date().toISOString();
}

function safeList<T>(collection: string) {
  try {
    return dbGetAll<T>(collection);
  } catch {
    return [] as T[];
  }
}

function listPricingRulesRaw() {
  return safeList<ModelPricingRuleRecord>(MODEL_PRICING_RULE_COLLECTION).sort((left, right) =>
    left.pricingKey.localeCompare(right.pricingKey),
  );
}

function buildDefaultModelPricingRules() {
  const timestamp = nowIso();
  return [
    {
      pricingKey: "doubao.seed.2.0.pro",
      label: "Doubao-Seed-2.0-Pro",
      serviceName: "llm.chat",
      provider: "volcengine",
      modelId: "doubao-seed-2.0-pro",
      billingMode: "token_tiered",
      tokenTiers: [
        {
          maxInputTokens: 32_000,
          inputPricePerKTokens: 0.0032,
          outputPricePerKTokens: 0.016,
          cachedInputPricePerKTokens: 0,
          currency: "CNY",
        },
        {
          maxInputTokens: 128_000,
          inputPricePerKTokens: 0.0048,
          outputPricePerKTokens: 0.024,
          cachedInputPricePerKTokens: 0,
          currency: "CNY",
        },
        {
          maxInputTokens: null,
          inputPricePerKTokens: 0.0096,
          outputPricePerKTokens: 0.048,
          cachedInputPricePerKTokens: 0,
          currency: "CNY",
        },
      ],
      meters: [],
      enabled: true,
      source: "official",
      notes: "火山引擎官方模型费用文档：按输入长度分档计费。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.vision.1.5.pro.32k",
      label: "Doubao-1.5-Vision-Pro-32K",
      serviceName: "vision.chat",
      provider: "volcengine",
      modelId: "doubao-1-5-vision-pro-32k-250115",
      billingMode: "metered",
      tokenTiers: [],
      meters: [
        { meter: "input_tokens", unitSize: 1000, unitPrice: 0.003, currency: "CNY" },
        { meter: "output_tokens", unitSize: 1000, unitPrice: 0.009, currency: "CNY" },
      ],
      enabled: true,
      source: "official_archived",
      notes: "沿用火山引擎官方历史资源包/模型费用文档中的 Doubao-1.5-vision-pro-32k 抵扣系数。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "openai.gpt-5.4",
      label: "OpenAI GPT-5.4",
      serviceName: "llm.chat",
      provider: "openai",
      modelId: "gpt-5.4",
      billingMode: "metered",
      tokenTiers: [],
      meters: [
        { meter: "input_tokens", unitSize: 1_000_000, unitPrice: 2.5, currency: "USD" },
        { meter: "output_tokens", unitSize: 1_000_000, unitPrice: 15, currency: "USD" },
        { meter: "cached_input_tokens", unitSize: 1_000_000, unitPrice: 0.25, currency: "USD" },
      ],
      enabled: true,
      source: "official",
      notes: "OpenAI 官方 GPT-5.4 API 价格。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "openai.gpt-4o",
      label: "OpenAI GPT-4o",
      serviceName: "vision.chat",
      provider: "openai",
      modelId: "gpt-4o",
      billingMode: "metered",
      tokenTiers: [],
      meters: [
        { meter: "input_tokens", unitSize: 1_000_000, unitPrice: 5, currency: "USD" },
        { meter: "output_tokens", unitSize: 1_000_000, unitPrice: 15, currency: "USD" },
      ],
      enabled: true,
      source: "official",
      notes: "OpenAI 官方 GPT-4o API 价格。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.seedream.5.0.lite",
      label: "Doubao-Seedream-5.0-Lite",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-5-0-lite-260128",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "image_count", unitSize: 1, unitPrice: 0.22, currency: "CNY" }],
      enabled: true,
      source: "inferred",
      notes: "当前默认按 0.22 元/张结算，可在后台按最新官方账单调整。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.seedance.2.0",
      label: "Doubao-Seedance-2.0",
      serviceName: "video.generate",
      provider: "volcengine",
      modelId: "doubao-seedance-2-0-260128",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "video_seconds", unitSize: 1, unitPrice: 1, currency: "CNY" }],
      enabled: true,
      source: "inferred",
      notes: "当前默认按 1 元/秒结算，可在后台按最新官方账单调整。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.speech.tts.2.0",
      label: "豆包语音合成模型 2.0",
      serviceName: "audio.tts",
      provider: "volcengine",
      modelId: "seed-tts-2.0",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "character_count", unitSize: 1, unitPrice: 0.00028, currency: "CNY" }],
      enabled: true,
      source: "official",
      notes: "火山引擎官方语音计费说明：2.8 元/万字符。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.asr.file.2.0",
      label: "豆包录音文件识别模型 2.0",
      serviceName: "audio.asr",
      provider: "volcengine",
      modelId: "volc.bigasr.auc_turbo",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "audio_seconds", unitSize: 1, unitPrice: 0.75 / 3600, currency: "CNY" }],
      enabled: true,
      source: "official",
      notes: "火山引擎官方语音计费说明：0.75 元/小时。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.voice.clone.2.0",
      label: "豆包声音复刻模型 2.0",
      serviceName: "voice.clone",
      provider: "volcengine",
      modelId: "seed-icl-2.0",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "character_count", unitSize: 1, unitPrice: 0.00028, currency: "CNY" }],
      enabled: true,
      source: "official",
      notes: "火山引擎官方语音计费说明：2.8 元/万字符。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies ModelPricingRuleRecord[];
}

export function getDefaultModelBillingConfig(): ModelBillingConfigRecord {
  const timestamp = nowIso();
  return {
    billingEnabled: true,
    pointsPerRmb: 100,
    usdToCnyRate: 7.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function ensureModelUsageSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_model_usage_records (
      usage_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      route_path TEXT,
      request_id TEXT,
      service_name TEXT NOT NULL,
      provider TEXT,
      model_id TEXT,
      object_type TEXT,
      object_id TEXT,
      pricing_key TEXT,
      pricing_source TEXT,
      status TEXT NOT NULL,
      amount_rmb REAL NOT NULL,
      points_cost REAL NOT NULL,
      usage_snapshot_json TEXT NOT NULL,
      pricing_snapshot_json TEXT NOT NULL,
      idempotent_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_model_usage_idempotent
      ON user_model_usage_records (idempotent_key);

    CREATE INDEX IF NOT EXISTS idx_user_model_usage_user_created
      ON user_model_usage_records (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_model_usage_service_created
      ON user_model_usage_records (service_name, created_at DESC);
  `);

  initialized = true;
}

export function ensureModelUsageDefaults() {
  ensureModelUsageSchema();

  const existingRuleKeys = new Set(listPricingRulesRaw().map((item) => item.pricingKey));
  for (const item of buildDefaultModelPricingRules()) {
    if (!existingRuleKeys.has(item.pricingKey)) {
      dbUpsert(MODEL_PRICING_RULE_COLLECTION, item.pricingKey, item);
    }
  }

  const config = dbGetSingleton<ModelBillingConfigRecord>(MODEL_BILLING_CONFIG_COLLECTION);
  if (!config) {
    dbSetSingleton(MODEL_BILLING_CONFIG_COLLECTION, getDefaultModelBillingConfig());
  }
}

export function listModelPricingRules() {
  ensureModelUsageDefaults();
  return listPricingRulesRaw();
}

export function getModelPricingRule(pricingKey: string) {
  ensureModelUsageDefaults();
  return dbGet<ModelPricingRuleRecord>(MODEL_PRICING_RULE_COLLECTION, pricingKey);
}

export function upsertModelPricingRule(rule: ModelPricingRuleRecord) {
  ensureModelUsageDefaults();
  dbUpsert(MODEL_PRICING_RULE_COLLECTION, rule.pricingKey, rule);
}

export function getModelBillingConfig() {
  ensureModelUsageDefaults();
  return dbGetSingleton<ModelBillingConfigRecord>(MODEL_BILLING_CONFIG_COLLECTION);
}

export function setModelBillingConfig(config: ModelBillingConfigRecord) {
  ensureModelUsageDefaults();
  dbSetSingleton(MODEL_BILLING_CONFIG_COLLECTION, config);
}

function mapUsageRow(row: Record<string, unknown>): ModelUsageRecord {
  return {
    usageId: String(row.usage_id ?? ""),
    userId: String(row.user_id ?? ""),
    routePath: row.route_path ? String(row.route_path) : null,
    requestId: row.request_id ? String(row.request_id) : null,
    serviceName: String(row.service_name ?? ""),
    provider: row.provider ? String(row.provider) : null,
    modelId: row.model_id ? String(row.model_id) : null,
    objectType: row.object_type ? String(row.object_type) : null,
    objectId: row.object_id ? String(row.object_id) : null,
    pricingKey: row.pricing_key ? String(row.pricing_key) : null,
    pricingSource: row.pricing_source ? (String(row.pricing_source) as PricingSourceType) : null,
    status: String(row.status ?? "charged") as ModelUsageRecord["status"],
    amountRmb: Number(row.amount_rmb ?? 0),
    pointsCost: Number(row.points_cost ?? 0),
    usageSnapshot: JSON.parse(String(row.usage_snapshot_json ?? "{}")) as ModelUsageMetrics,
    pricingSnapshot: JSON.parse(String(row.pricing_snapshot_json ?? "{}")) as ModelUsageRecord["pricingSnapshot"],
    idempotentKey: String(row.idempotent_key ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

export function getModelUsageRecordByIdempotentKey(idempotentKey: string) {
  ensureModelUsageDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM user_model_usage_records
        WHERE idempotent_key = ?
        LIMIT 1
      `,
    )
    .get(idempotentKey) as Record<string, unknown> | undefined;

  return row ? mapUsageRow(row) : null;
}

export function insertModelUsageRecord(record: ModelUsageRecord) {
  ensureModelUsageDefaults();
  db.prepare(
    `
      INSERT INTO user_model_usage_records (
        usage_id,
        user_id,
        route_path,
        request_id,
        service_name,
        provider,
        model_id,
        object_type,
        object_id,
        pricing_key,
        pricing_source,
        status,
        amount_rmb,
        points_cost,
        usage_snapshot_json,
        pricing_snapshot_json,
        idempotent_key,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.usageId,
    record.userId,
    record.routePath,
    record.requestId,
    record.serviceName,
    record.provider,
    record.modelId,
    record.objectType,
    record.objectId,
    record.pricingKey,
    record.pricingSource,
    record.status,
    record.amountRmb,
    record.pointsCost,
    JSON.stringify(record.usageSnapshot),
    JSON.stringify(record.pricingSnapshot),
    record.idempotentKey,
    record.createdAt,
  );
}

export function listModelUsageRecords(limit = 50) {
  ensureModelUsageDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM user_model_usage_records
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapUsageRow);
}

export function listModelUsageRecordsByUserId(userId: string, limit = 50) {
  ensureModelUsageDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM user_model_usage_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapUsageRow);
}

export function getModelUsageOverview(days = 30) {
  ensureModelUsageDefaults();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total_calls,
          COUNT(DISTINCT user_id) AS active_users,
          COALESCE(SUM(amount_rmb), 0) AS total_amount_rmb,
          COALESCE(SUM(points_cost), 0) AS total_points,
          COALESCE(SUM(CASE WHEN status = 'charged' THEN 1 ELSE 0 END), 0) AS charged_calls,
          COALESCE(SUM(CASE WHEN status = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced_calls
        FROM user_model_usage_records
        WHERE created_at >= ?
      `,
    )
    .get(since) as
    | {
        total_calls?: number;
        active_users?: number;
        total_amount_rmb?: number;
        total_points?: number;
        charged_calls?: number;
        unpriced_calls?: number;
      }
    | undefined;

  return {
    totalCalls: Number(row?.total_calls ?? 0),
    activeUsers: Number(row?.active_users ?? 0),
    totalAmountRmb: Number(row?.total_amount_rmb ?? 0),
    totalPoints: Number(row?.total_points ?? 0),
    chargedCalls: Number(row?.charged_calls ?? 0),
    unpricedCalls: Number(row?.unpriced_calls ?? 0),
  };
}
