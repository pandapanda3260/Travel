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
  strictModeEnabled: boolean;
  requirePricingRule: boolean;
  enforceSufficientBalance: boolean;
  minimumBalancePoints: number;
  dailyUserPointLimit: number | null;
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

export type ModelUsageUserSummary = {
  userId: string;
  totalCalls: number;
  chargedCalls: number;
  unpricedCalls: number;
  skippedCalls: number;
  totalAmountRmb: number;
  totalPoints: number;
  lastUsedAt: string | null;
};

export type ModelUsageUserDetailSummary = Omit<ModelUsageUserSummary, "userId">;

export type ModelUsageProviderBillStatus = "matched" | "unmatched" | "mismatch";

export type ModelUsageProviderBillRecord = {
  billId: string;
  provider: string;
  pricingKey: string | null;
  externalUsageId: string | null;
  requestId: string | null;
  usageId: string | null;
  userId: string | null;
  serviceName: string;
  modelId: string | null;
  amountRmb: number;
  pointsCost: number;
  usageSnapshot: ModelUsageMetrics;
  providerPayload: Record<string, unknown>;
  status: ModelUsageProviderBillStatus;
  mismatchReason: string | null;
  idempotentKey: string;
  importedAt: string;
  updatedAt: string;
};

export type ModelUsageReconciliationOverview = {
  totalBills: number;
  matchedBills: number;
  unmatchedBills: number;
  mismatchBills: number;
  totalAmountRmb: number;
  totalPoints: number;
};

export type ModelUsageRiskEventSeverity = "warning" | "critical";
export type ModelUsageRiskEventStatus = "open" | "resolved";

export type ModelUsageRiskEventRecord = {
  eventId: string;
  severity: ModelUsageRiskEventSeverity;
  code: string;
  userId: string | null;
  serviceName: string;
  pricingKey: string | null;
  routePath: string | null;
  objectType: string | null;
  objectId: string | null;
  message: string;
  metadata: Record<string, unknown>;
  status: ModelUsageRiskEventStatus;
  createdAt: string;
};

export type ModelUsageRiskEventOverview = {
  totalEvents: number;
  openEvents: number;
  criticalEvents: number;
  warningEvents: number;
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
      pricingKey: "openai.gpt-5.5",
      label: "OpenAI GPT-5.5",
      serviceName: "llm.chat",
      provider: "openai",
      modelId: "gpt-5.5",
      billingMode: "metered",
      tokenTiers: [],
      meters: [
        { meter: "input_tokens", unitSize: 1_000_000, unitPrice: 5, currency: "USD" },
        { meter: "output_tokens", unitSize: 1_000_000, unitPrice: 30, currency: "USD" },
        { meter: "cached_input_tokens", unitSize: 1_000_000, unitPrice: 0.5, currency: "USD" },
      ],
      enabled: true,
      source: "official",
      notes: "OpenAI 官方 GPT-5.5 API 标准处理价格。",
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
      pricingKey: "doubao.seedream.4.5",
      label: "Doubao-Seedream-4.5",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-4-5-251128",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "image_count", unitSize: 1, unitPrice: 0.22, currency: "CNY" }],
      enabled: true,
      source: "inferred",
      notes: "当前按项目原有估算价 0.22 元/张占位，可在后台按火山官方账单调整。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "doubao.seedream.5.0",
      label: "Doubao-Seedream-5.0",
      serviceName: "image.generate",
      provider: "volcengine",
      modelId: "doubao-seedream-5-0-260128",
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "image_count", unitSize: 1, unitPrice: 0.22, currency: "CNY" }],
      enabled: true,
      source: "inferred",
      notes: "当前按项目原有估算价 0.22 元/张占位，可在后台按火山官方账单调整。",
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
    {
      pricingKey: "kling.text2video",
      label: "Kling 文生视频",
      serviceName: "video.generate",
      provider: "kling",
      modelId: null,
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "video_seconds", unitSize: 1, unitPrice: 0, currency: "CNY" }],
      enabled: false,
      source: "manual",
      notes: "占位规则：生产上线前需按供应商合同价录入单价并启用，否则严格模式会阻止调用。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "kling.image2video",
      label: "Kling 图生视频",
      serviceName: "video.generate",
      provider: "kling",
      modelId: null,
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "video_seconds", unitSize: 1, unitPrice: 0, currency: "CNY" }],
      enabled: false,
      source: "manual",
      notes: "占位规则：生产上线前需按供应商合同价录入单价并启用，否则严格模式会阻止调用。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      pricingKey: "kling.lip_sync",
      label: "Kling 对口型",
      serviceName: "video.lip_sync",
      provider: "kling",
      modelId: null,
      billingMode: "metered",
      tokenTiers: [],
      meters: [{ meter: "video_seconds", unitSize: 1, unitPrice: 0, currency: "CNY" }],
      enabled: false,
      source: "manual",
      notes: "占位规则：生产上线前需按供应商合同价录入单价并启用，否则严格模式会阻止调用。",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies ModelPricingRuleRecord[];
}

export function getDefaultModelBillingConfig(): ModelBillingConfigRecord {
  const timestamp = nowIso();
  return {
    billingEnabled: true,
    strictModeEnabled: false,
    requirePricingRule: false,
    enforceSufficientBalance: false,
    minimumBalancePoints: 0,
    dailyUserPointLimit: null,
    pointsPerRmb: 108,
    usdToCnyRate: 7.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeModelBillingConfig(config: Partial<ModelBillingConfigRecord> | null): ModelBillingConfigRecord {
  const defaults = getDefaultModelBillingConfig();
  if (!config) {
    return defaults;
  }

  return {
    ...defaults,
    ...config,
    billingEnabled: config.billingEnabled ?? defaults.billingEnabled,
    strictModeEnabled: config.strictModeEnabled ?? defaults.strictModeEnabled,
    requirePricingRule: config.requirePricingRule ?? defaults.requirePricingRule,
    enforceSufficientBalance: config.enforceSufficientBalance ?? defaults.enforceSufficientBalance,
    minimumBalancePoints: Number.isFinite(config.minimumBalancePoints)
      ? Number(config.minimumBalancePoints)
      : defaults.minimumBalancePoints,
    dailyUserPointLimit:
      config.dailyUserPointLimit == null
        ? defaults.dailyUserPointLimit
        : Number.isFinite(config.dailyUserPointLimit) && Number(config.dailyUserPointLimit) > 0
          ? Number(config.dailyUserPointLimit)
          : null,
    pointsPerRmb: Number.isFinite(config.pointsPerRmb) ? Number(config.pointsPerRmb) : defaults.pointsPerRmb,
    usdToCnyRate: Number.isFinite(config.usdToCnyRate) ? Number(config.usdToCnyRate) : defaults.usdToCnyRate,
    createdAt: config.createdAt ?? defaults.createdAt,
    updatedAt: config.updatedAt ?? defaults.updatedAt,
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

    CREATE TABLE IF NOT EXISTS provider_model_usage_bill_records (
      bill_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      pricing_key TEXT,
      external_usage_id TEXT,
      request_id TEXT,
      usage_id TEXT,
      user_id TEXT,
      service_name TEXT NOT NULL,
      model_id TEXT,
      amount_rmb REAL NOT NULL,
      points_cost REAL NOT NULL,
      usage_snapshot_json TEXT NOT NULL,
      provider_payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      mismatch_reason TEXT,
      idempotent_key TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_model_usage_bill_idempotent
      ON provider_model_usage_bill_records (idempotent_key);

    CREATE INDEX IF NOT EXISTS idx_provider_model_usage_bill_status
      ON provider_model_usage_bill_records (status, imported_at DESC);

    CREATE INDEX IF NOT EXISTS idx_provider_model_usage_bill_usage
      ON provider_model_usage_bill_records (usage_id);

    CREATE TABLE IF NOT EXISTS model_usage_risk_events (
      event_id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      user_id TEXT,
      service_name TEXT NOT NULL,
      pricing_key TEXT,
      route_path TEXT,
      object_type TEXT,
      object_id TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_model_usage_risk_events_status_created
      ON model_usage_risk_events (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_model_usage_risk_events_user_created
      ON model_usage_risk_events (user_id, created_at DESC);
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
  } else if (
    config.strictModeEnabled === undefined ||
    config.requirePricingRule === undefined ||
    config.enforceSufficientBalance === undefined ||
    config.minimumBalancePoints === undefined ||
    config.dailyUserPointLimit === undefined ||
    !Number.isFinite(config.pointsPerRmb) ||
    !Number.isFinite(config.usdToCnyRate)
  ) {
    dbSetSingleton(MODEL_BILLING_CONFIG_COLLECTION, normalizeModelBillingConfig(config));
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
  return normalizeModelBillingConfig(dbGetSingleton<ModelBillingConfigRecord>(MODEL_BILLING_CONFIG_COLLECTION));
}

export function setModelBillingConfig(config: ModelBillingConfigRecord) {
  ensureModelUsageDefaults();
  dbSetSingleton(MODEL_BILLING_CONFIG_COLLECTION, normalizeModelBillingConfig(config));
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

export function getModelUsageRecordByUsageId(usageId: string) {
  ensureModelUsageDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM user_model_usage_records
        WHERE usage_id = ?
        LIMIT 1
      `,
    )
    .get(usageId) as Record<string, unknown> | undefined;

  return row ? mapUsageRow(row) : null;
}

export function findModelUsageRecordForProviderBill(input: {
  usageId?: string | null;
  requestId?: string | null;
  pricingKey?: string | null;
  provider?: string | null;
  serviceName?: string | null;
}) {
  ensureModelUsageDefaults();

  if (input.usageId) {
    return getModelUsageRecordByUsageId(input.usageId);
  }

  if (!input.requestId) {
    return null;
  }

  const rows = db
    .prepare(
      `
        SELECT *
        FROM user_model_usage_records
        WHERE request_id = ?
          AND (? IS NULL OR pricing_key = ?)
          AND (? IS NULL OR provider = ?)
          AND (? IS NULL OR service_name = ?)
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .all(
      input.requestId,
      input.pricingKey ?? null,
      input.pricingKey ?? null,
      input.provider ?? null,
      input.provider ?? null,
      input.serviceName ?? null,
      input.serviceName ?? null,
    ) as Record<string, unknown>[];

  return rows[0] ? mapUsageRow(rows[0]) : null;
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
          COALESCE(SUM(CASE WHEN status = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced_calls,
          COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_calls
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
        skipped_calls?: number;
      }
    | undefined;

  return {
    totalCalls: Number(row?.total_calls ?? 0),
    activeUsers: Number(row?.active_users ?? 0),
    totalAmountRmb: Number(row?.total_amount_rmb ?? 0),
    totalPoints: Number(row?.total_points ?? 0),
    chargedCalls: Number(row?.charged_calls ?? 0),
    unpricedCalls: Number(row?.unpriced_calls ?? 0),
    skippedCalls: Number(row?.skipped_calls ?? 0),
  };
}

export function listModelUsageUserSummaries(days = 30, limit = 20): ModelUsageUserSummary[] {
  ensureModelUsageDefaults();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `
        SELECT
          user_id,
          COUNT(*) AS total_calls,
          COALESCE(SUM(CASE WHEN status = 'charged' THEN 1 ELSE 0 END), 0) AS charged_calls,
          COALESCE(SUM(CASE WHEN status = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced_calls,
          COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_calls,
          COALESCE(SUM(amount_rmb), 0) AS total_amount_rmb,
          COALESCE(SUM(points_cost), 0) AS total_points,
          MAX(created_at) AS last_used_at
        FROM user_model_usage_records
        WHERE created_at >= ?
        GROUP BY user_id
        ORDER BY total_points DESC, total_calls DESC
        LIMIT ?
      `,
    )
    .all(since, limit) as Array<{
    user_id?: string;
    total_calls?: number;
    charged_calls?: number;
    unpriced_calls?: number;
    skipped_calls?: number;
    total_amount_rmb?: number;
    total_points?: number;
    last_used_at?: string | null;
  }>;

  return rows.map((row) => ({
    userId: String(row.user_id ?? ""),
    totalCalls: Number(row.total_calls ?? 0),
    chargedCalls: Number(row.charged_calls ?? 0),
    unpricedCalls: Number(row.unpriced_calls ?? 0),
    skippedCalls: Number(row.skipped_calls ?? 0),
    totalAmountRmb: Number(row.total_amount_rmb ?? 0),
    totalPoints: Number(row.total_points ?? 0),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  }));
}

export function getUserModelUsagePointsSince(userId: string, since: string) {
  ensureModelUsageDefaults();
  const row = db
    .prepare(
      `
        SELECT COALESCE(SUM(points_cost), 0) AS total_points
        FROM user_model_usage_records
        WHERE user_id = ?
          AND created_at >= ?
      `,
    )
    .get(userId, since) as { total_points?: number } | undefined;

  return Number(row?.total_points ?? 0);
}

export function getModelUsageSummaryByUserId(userId: string, days = 30): ModelUsageUserDetailSummary {
  ensureModelUsageDefaults();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total_calls,
          COALESCE(SUM(CASE WHEN status = 'charged' THEN 1 ELSE 0 END), 0) AS charged_calls,
          COALESCE(SUM(CASE WHEN status = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced_calls,
          COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_calls,
          COALESCE(SUM(amount_rmb), 0) AS total_amount_rmb,
          COALESCE(SUM(points_cost), 0) AS total_points,
          MAX(created_at) AS last_used_at
        FROM user_model_usage_records
        WHERE user_id = ?
          AND created_at >= ?
      `,
    )
    .get(userId, since) as
    | {
        total_calls?: number;
        charged_calls?: number;
        unpriced_calls?: number;
        skipped_calls?: number;
        total_amount_rmb?: number;
        total_points?: number;
        last_used_at?: string | null;
      }
    | undefined;

  return {
    totalCalls: Number(row?.total_calls ?? 0),
    chargedCalls: Number(row?.charged_calls ?? 0),
    unpricedCalls: Number(row?.unpriced_calls ?? 0),
    skippedCalls: Number(row?.skipped_calls ?? 0),
    totalAmountRmb: Number(row?.total_amount_rmb ?? 0),
    totalPoints: Number(row?.total_points ?? 0),
    lastUsedAt: row?.last_used_at ? String(row.last_used_at) : null,
  };
}

function mapProviderBillRow(row: Record<string, unknown>): ModelUsageProviderBillRecord {
  return {
    billId: String(row.bill_id ?? ""),
    provider: String(row.provider ?? ""),
    pricingKey: row.pricing_key ? String(row.pricing_key) : null,
    externalUsageId: row.external_usage_id ? String(row.external_usage_id) : null,
    requestId: row.request_id ? String(row.request_id) : null,
    usageId: row.usage_id ? String(row.usage_id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    serviceName: String(row.service_name ?? ""),
    modelId: row.model_id ? String(row.model_id) : null,
    amountRmb: Number(row.amount_rmb ?? 0),
    pointsCost: Number(row.points_cost ?? 0),
    usageSnapshot: JSON.parse(String(row.usage_snapshot_json ?? "{}")) as ModelUsageMetrics,
    providerPayload: JSON.parse(String(row.provider_payload_json ?? "{}")) as Record<string, unknown>,
    status: String(row.status ?? "unmatched") as ModelUsageProviderBillStatus,
    mismatchReason: row.mismatch_reason ? String(row.mismatch_reason) : null,
    idempotentKey: String(row.idempotent_key ?? ""),
    importedAt: String(row.imported_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function upsertModelUsageProviderBillRecord(record: ModelUsageProviderBillRecord) {
  ensureModelUsageDefaults();
  db.prepare(
    `
      INSERT INTO provider_model_usage_bill_records (
        bill_id,
        provider,
        pricing_key,
        external_usage_id,
        request_id,
        usage_id,
        user_id,
        service_name,
        model_id,
        amount_rmb,
        points_cost,
        usage_snapshot_json,
        provider_payload_json,
        status,
        mismatch_reason,
        idempotent_key,
        imported_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotent_key) DO UPDATE SET
        pricing_key = excluded.pricing_key,
        request_id = excluded.request_id,
        usage_id = excluded.usage_id,
        user_id = excluded.user_id,
        service_name = excluded.service_name,
        model_id = excluded.model_id,
        amount_rmb = excluded.amount_rmb,
        points_cost = excluded.points_cost,
        usage_snapshot_json = excluded.usage_snapshot_json,
        provider_payload_json = excluded.provider_payload_json,
        status = excluded.status,
        mismatch_reason = excluded.mismatch_reason,
        updated_at = excluded.updated_at
    `,
  ).run(
    record.billId,
    record.provider,
    record.pricingKey,
    record.externalUsageId,
    record.requestId,
    record.usageId,
    record.userId,
    record.serviceName,
    record.modelId,
    record.amountRmb,
    record.pointsCost,
    JSON.stringify(record.usageSnapshot),
    JSON.stringify(record.providerPayload),
    record.status,
    record.mismatchReason,
    record.idempotentKey,
    record.importedAt,
    record.updatedAt,
  );
}

export function listModelUsageProviderBillRecords(limit = 50) {
  ensureModelUsageDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM provider_model_usage_bill_records
        ORDER BY imported_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapProviderBillRow);
}

export function getModelUsageReconciliationOverview(days = 30): ModelUsageReconciliationOverview {
  ensureModelUsageDefaults();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total_bills,
          COALESCE(SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END), 0) AS matched_bills,
          COALESCE(SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched_bills,
          COALESCE(SUM(CASE WHEN status = 'mismatch' THEN 1 ELSE 0 END), 0) AS mismatch_bills,
          COALESCE(SUM(amount_rmb), 0) AS total_amount_rmb,
          COALESCE(SUM(points_cost), 0) AS total_points
        FROM provider_model_usage_bill_records
        WHERE imported_at >= ?
      `,
    )
    .get(since) as
    | {
        total_bills?: number;
        matched_bills?: number;
        unmatched_bills?: number;
        mismatch_bills?: number;
        total_amount_rmb?: number;
        total_points?: number;
      }
    | undefined;

  return {
    totalBills: Number(row?.total_bills ?? 0),
    matchedBills: Number(row?.matched_bills ?? 0),
    unmatchedBills: Number(row?.unmatched_bills ?? 0),
    mismatchBills: Number(row?.mismatch_bills ?? 0),
    totalAmountRmb: Number(row?.total_amount_rmb ?? 0),
    totalPoints: Number(row?.total_points ?? 0),
  };
}

function mapRiskEventRow(row: Record<string, unknown>): ModelUsageRiskEventRecord {
  return {
    eventId: String(row.event_id ?? ""),
    severity: String(row.severity ?? "warning") as ModelUsageRiskEventSeverity,
    code: String(row.code ?? ""),
    userId: row.user_id ? String(row.user_id) : null,
    serviceName: String(row.service_name ?? ""),
    pricingKey: row.pricing_key ? String(row.pricing_key) : null,
    routePath: row.route_path ? String(row.route_path) : null,
    objectType: row.object_type ? String(row.object_type) : null,
    objectId: row.object_id ? String(row.object_id) : null,
    message: String(row.message ?? ""),
    metadata: JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>,
    status: String(row.status ?? "open") as ModelUsageRiskEventStatus,
    createdAt: String(row.created_at ?? ""),
  };
}

export function insertModelUsageRiskEvent(record: ModelUsageRiskEventRecord) {
  ensureModelUsageDefaults();
  db.prepare(
    `
      INSERT INTO model_usage_risk_events (
        event_id,
        severity,
        code,
        user_id,
        service_name,
        pricing_key,
        route_path,
        object_type,
        object_id,
        message,
        metadata_json,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.eventId,
    record.severity,
    record.code,
    record.userId,
    record.serviceName,
    record.pricingKey,
    record.routePath,
    record.objectType,
    record.objectId,
    record.message,
    JSON.stringify(record.metadata),
    record.status,
    record.createdAt,
  );
}

export function listModelUsageRiskEvents(limit = 50) {
  ensureModelUsageDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM model_usage_risk_events
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapRiskEventRow);
}

export function getModelUsageRiskEventOverview(days = 30): ModelUsageRiskEventOverview {
  ensureModelUsageDefaults();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total_events,
          COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_events,
          COALESCE(SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END), 0) AS critical_events,
          COALESCE(SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END), 0) AS warning_events
        FROM model_usage_risk_events
        WHERE created_at >= ?
      `,
    )
    .get(since) as
    | {
        total_events?: number;
        open_events?: number;
        critical_events?: number;
        warning_events?: number;
      }
    | undefined;

  return {
    totalEvents: Number(row?.total_events ?? 0),
    openEvents: Number(row?.open_events ?? 0),
    criticalEvents: Number(row?.critical_events ?? 0),
    warningEvents: Number(row?.warning_events ?? 0),
  };
}
