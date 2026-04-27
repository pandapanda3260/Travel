import { db, dbGet, dbGetAll, dbGetSingleton, dbSetSingleton, dbUpsert } from "./db";

export type PointSourceType = "system" | "rule" | "campaign" | "manual" | "merge" | "benefit";
export type PointRecordStatus = "effective" | "expired" | "reversed";

export type PointRuleRecord = {
  ruleCode: string;
  eventType: string;
  name: string;
  pointValue: number;
  dailyLimit: number | null;
  enabled: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type UserPointsAccountRecord = {
  userId: string;
  availablePoints: number;
  lifetimePoints: number;
  lastChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PointsConfigRecord = {
  pointsEnabled: boolean;
  defaultExpireDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PointRecord = {
  pointId: string;
  userId: string;
  eventType: string;
  sourceType: PointSourceType;
  sourceBizId: string | null;
  idempotentKey: string;
  changeValue: number;
  status: PointRecordStatus;
  expireAt: string | null;
  reversedPointId: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
};

const POINT_RULE_COLLECTION = "points-rules";
const POINT_ACCOUNT_COLLECTION = "user-points-accounts";
const POINT_CONFIG_COLLECTION = "points-config";

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

function listPointRulesRaw() {
  return safeList<PointRuleRecord>(POINT_RULE_COLLECTION).sort((left, right) => left.ruleCode.localeCompare(right.ruleCode));
}

export function ensurePointsSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_point_records (
      point_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_biz_id TEXT,
      idempotent_key TEXT NOT NULL,
      change_value INTEGER NOT NULL,
      status TEXT NOT NULL,
      expire_at TEXT,
      reversed_point_id TEXT,
      operator_id TEXT,
      remark TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_point_records_idempotent
      ON user_point_records (idempotent_key);

    CREATE INDEX IF NOT EXISTS idx_user_point_records_user_created
      ON user_point_records (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_point_records_user_status_expire
      ON user_point_records (user_id, status, expire_at);
  `);

  initialized = true;
}

function buildDefaultPointRules() {
  const timestamp = nowIso();
  return [
    {
      ruleCode: "register_success",
      eventType: "register_success",
      name: "注册成功",
      pointValue: 100,
      dailyLimit: null,
      enabled: true,
      description: "首次注册成功发放积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "daily_login",
      eventType: "daily_login",
      name: "每日首次登录",
      pointValue: 2,
      dailyLimit: 2,
      enabled: true,
      description: "用户每日首次登录发放积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "product_archive_create",
      eventType: "product_archive_create",
      name: "创建商品档案",
      pointValue: 5,
      dailyLimit: 10,
      enabled: true,
      description: "创建商品档案成功发放积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "video_material_create",
      eventType: "video_material_create",
      name: "创建视频素材",
      pointValue: 8,
      dailyLimit: 24,
      enabled: true,
      description: "创建视频素材成功发放积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "video_task_create",
      eventType: "video_task_create",
      name: "创建视频任务",
      pointValue: 12,
      dailyLimit: 36,
      enabled: true,
      description: "创建视频任务成功发放积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "manual_adjustment",
      eventType: "manual_adjustment",
      name: "人工调整",
      pointValue: 0,
      dailyLimit: null,
      enabled: true,
      description: "后台人工补发或扣减积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "campaign_bonus",
      eventType: "campaign_bonus",
      name: "活动赠送",
      pointValue: 0,
      dailyLimit: null,
      enabled: true,
      description: "运营活动赠送积分",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies PointRuleRecord[];
}

export function getDefaultPointsConfig(): PointsConfigRecord {
  const timestamp = nowIso();
  return {
    pointsEnabled: true,
    defaultExpireDays: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function ensurePointsDefaults() {
  ensurePointsSchema();

  if (listPointRulesRaw().length === 0) {
    for (const item of buildDefaultPointRules()) {
      dbUpsert(POINT_RULE_COLLECTION, item.ruleCode, item);
    }
  }

  const config = dbGetSingleton<PointsConfigRecord>(POINT_CONFIG_COLLECTION);
  if (!config) {
    dbSetSingleton(POINT_CONFIG_COLLECTION, getDefaultPointsConfig());
  } else if (config.pointsEnabled !== true) {
    dbSetSingleton(POINT_CONFIG_COLLECTION, {
      ...config,
      pointsEnabled: true,
      updatedAt: nowIso(),
    });
  }
}

export function listPointRules() {
  ensurePointsDefaults();
  return listPointRulesRaw();
}

export function upsertPointRule(rule: PointRuleRecord) {
  ensurePointsDefaults();
  dbUpsert(POINT_RULE_COLLECTION, rule.ruleCode, rule);
}

export function getPointsConfig() {
  ensurePointsSchema();
  return dbGetSingleton<PointsConfigRecord>(POINT_CONFIG_COLLECTION);
}

export function setPointsConfig(config: PointsConfigRecord) {
  ensurePointsDefaults();
  dbSetSingleton(POINT_CONFIG_COLLECTION, config);
}

export function getUserPointsAccount(userId: string) {
  ensurePointsDefaults();
  return dbGet<UserPointsAccountRecord>(POINT_ACCOUNT_COLLECTION, userId);
}

export function upsertUserPointsAccount(account: UserPointsAccountRecord) {
  ensurePointsDefaults();
  dbUpsert(POINT_ACCOUNT_COLLECTION, account.userId, account);
}

function mapPointRow(row: Record<string, unknown>): PointRecord {
  return {
    pointId: String(row.point_id ?? ""),
    userId: String(row.user_id ?? ""),
    eventType: String(row.event_type ?? ""),
    sourceType: String(row.source_type ?? "rule") as PointSourceType,
    sourceBizId: row.source_biz_id ? String(row.source_biz_id) : null,
    idempotentKey: String(row.idempotent_key ?? ""),
    changeValue: Number(row.change_value ?? 0),
    status: String(row.status ?? "effective") as PointRecordStatus,
    expireAt: row.expire_at ? String(row.expire_at) : null,
    reversedPointId: row.reversed_point_id ? String(row.reversed_point_id) : null,
    operatorId: row.operator_id ? String(row.operator_id) : null,
    remark: row.remark ? String(row.remark) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function getPointRecordByIdempotentKey(idempotentKey: string) {
  ensurePointsDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM user_point_records
        WHERE idempotent_key = ?
        LIMIT 1
      `,
    )
    .get(idempotentKey) as Record<string, unknown> | undefined;

  return row ? mapPointRow(row) : null;
}

export function insertPointRecord(record: PointRecord) {
  ensurePointsDefaults();
  db.prepare(
    `
      INSERT INTO user_point_records (
        point_id,
        user_id,
        event_type,
        source_type,
        source_biz_id,
        idempotent_key,
        change_value,
        status,
        expire_at,
        reversed_point_id,
        operator_id,
        remark,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.pointId,
    record.userId,
    record.eventType,
    record.sourceType,
    record.sourceBizId,
    record.idempotentKey,
    record.changeValue,
    record.status,
    record.expireAt,
    record.reversedPointId,
    record.operatorId,
    record.remark,
    record.createdAt,
  );
}

export function expirePointRecordsForUser(userId: string, nowAt: string) {
  ensurePointsDefaults();
  db.prepare(
    `
      UPDATE user_point_records
      SET status = 'expired'
      WHERE user_id = ?
        AND status = 'effective'
        AND expire_at IS NOT NULL
        AND expire_at <= ?
    `,
  ).run(userId, nowAt);
}

export function getDailyPointTotal(userId: string, eventType: string, startAt: string, endAt: string) {
  ensurePointsDefaults();
  const row = db
    .prepare(
      `
        SELECT COALESCE(SUM(CASE WHEN change_value > 0 THEN change_value ELSE 0 END), 0) AS total
        FROM user_point_records
        WHERE user_id = ?
          AND event_type = ?
          AND created_at >= ?
          AND created_at < ?
          AND status != 'reversed'
      `,
    )
    .get(userId, eventType, startAt, endAt) as { total?: number } | undefined;

  return Number(row?.total ?? 0);
}

export function getUserPointStats(userId: string, nowAt: string) {
  ensurePointsDefaults();
  const row = db
    .prepare(
      `
        SELECT
          COALESCE(SUM(
            CASE
              WHEN status = 'effective' AND (expire_at IS NULL OR expire_at > ?)
                THEN change_value
              ELSE 0
            END
          ), 0) AS available_total,
          COALESCE(SUM(
            CASE
              WHEN status != 'reversed'
                THEN change_value
              ELSE 0
            END
          ), 0) AS lifetime_total
        FROM user_point_records
        WHERE user_id = ?
      `,
    )
    .get(nowAt, userId) as { available_total?: number; lifetime_total?: number } | undefined;

  return {
    availableTotal: Number(row?.available_total ?? 0),
    lifetimeTotal: Number(row?.lifetime_total ?? 0),
  };
}

export function listPointRecordsByUserId(userId: string, limit = 50) {
  ensurePointsDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM user_point_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapPointRow);
}

export function transferPointUserId(sourceUserId: string, targetUserId: string) {
  ensurePointsDefaults();
  db.prepare(
    `
      UPDATE user_point_records
      SET user_id = ?
      WHERE user_id = ?
    `,
  ).run(targetUserId, sourceUserId);
}
