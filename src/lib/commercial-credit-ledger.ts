import { randomUUID } from "node:crypto";

import { db } from "./db";

export type CommercialCreditSourceType =
  | "membership_grant"
  | "credit_package_grant"
  | "usage_charge"
  | "manual_adjustment"
  | "campaign_bonus"
  | "refund"
  | "system_migration";

export type CommercialCreditTransactionStatus = "effective" | "reversed";
export type CommercialCreditFreezeStatus = "frozen" | "confirmed" | "released" | "expired";

export type CommercialCreditBalanceRecord = {
  userId: string;
  availableCredits: number;
  frozenCredits: number;
  lifetimePurchasedCredits: number;
  lifetimeUsedCredits: number;
  lastChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommercialCreditTransactionRecord = {
  transactionId: string;
  userId: string;
  eventType: string;
  sourceType: CommercialCreditSourceType;
  sourceBizId: string | null;
  idempotencyKey: string;
  changeCredits: number;
  balanceAfter: number;
  frozenAfter: number;
  status: CommercialCreditTransactionStatus;
  expireAt: string | null;
  relatedFreezeId: string | null;
  taskId: string | null;
  featureCode: string | null;
  provider: string | null;
  modelId: string | null;
  realCostRmb: number | null;
  chargedRevenueRmb: number | null;
  grossMarginRate: number | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
};

export type CommercialCreditFreezeRecord = {
  freezeId: string;
  userId: string;
  sourceType: CommercialCreditSourceType;
  sourceBizId: string | null;
  idempotencyKey: string;
  frozenCredits: number;
  status: CommercialCreditFreezeStatus;
  taskId: string | null;
  featureCode: string | null;
  expiresAt: string | null;
  confirmedTransactionId: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GrantCreditsInput = {
  userId: string;
  credits: number;
  sourceType: CommercialCreditSourceType;
  sourceBizId?: string | null;
  idempotencyKey: string;
  expireAt?: string | null;
  operatorId?: string | null;
  remark?: string | null;
};

export type FreezeCreditsInput = {
  userId: string;
  credits: number;
  sourceType: CommercialCreditSourceType;
  sourceBizId?: string | null;
  idempotencyKey: string;
  taskId?: string | null;
  featureCode?: string | null;
  expiresAt?: string | null;
};

export type ConfirmCreditFreezeInput = {
  freezeId: string;
  idempotencyKey: string;
  realCostRmb?: number | null;
  chargedRevenueRmb?: number | null;
  grossMarginRate?: number | null;
  provider?: string | null;
  modelId?: string | null;
  operatorId?: string | null;
  remark?: string | null;
};

export type ReleaseCreditFreezeInput = {
  freezeId: string;
  reason: string;
};

export class CommercialCreditLedgerError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CREDITS"
      | "INSUFFICIENT_CREDITS"
      | "FREEZE_NOT_FOUND"
      | "FREEZE_NOT_ACTIVE"
      | "FREEZE_ALREADY_CONFIRMED",
    message: string,
  ) {
    super(message);
    this.name = "CommercialCreditLedgerError";
  }
}

let initialized = false;

function nowIso() {
  return new Date().toISOString();
}

function assertPositiveIntegerCredits(credits: number) {
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new CommercialCreditLedgerError("INVALID_CREDITS", "积分数量必须是正整数。");
  }
}

function shouldCountAsPurchasedCredits(sourceType: CommercialCreditSourceType) {
  return sourceType === "membership_grant" || sourceType === "credit_package_grant";
}

export function ensureCommercialCreditLedgerSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS commercial_user_credit_balances (
      user_id TEXT PRIMARY KEY,
      available_credits INTEGER NOT NULL DEFAULT 0,
      frozen_credits INTEGER NOT NULL DEFAULT 0,
      lifetime_purchased_credits INTEGER NOT NULL DEFAULT 0,
      lifetime_used_credits INTEGER NOT NULL DEFAULT 0,
      last_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commercial_credit_transactions (
      transaction_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_biz_id TEXT,
      idempotency_key TEXT NOT NULL,
      change_credits INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      frozen_after INTEGER NOT NULL,
      status TEXT NOT NULL,
      expire_at TEXT,
      related_freeze_id TEXT,
      task_id TEXT,
      feature_code TEXT,
      provider TEXT,
      model_id TEXT,
      real_cost_rmb REAL,
      charged_revenue_rmb REAL,
      gross_margin_rate REAL,
      operator_id TEXT,
      remark TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_credit_transactions_idempotent
      ON commercial_credit_transactions (idempotency_key);

    CREATE INDEX IF NOT EXISTS idx_commercial_credit_transactions_user_created
      ON commercial_credit_transactions (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS commercial_credit_freeze_records (
      freeze_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_biz_id TEXT,
      idempotency_key TEXT NOT NULL,
      frozen_credits INTEGER NOT NULL,
      status TEXT NOT NULL,
      task_id TEXT,
      feature_code TEXT,
      expires_at TEXT,
      confirmed_transaction_id TEXT,
      released_at TEXT,
      released_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_credit_freeze_idempotent
      ON commercial_credit_freeze_records (idempotency_key);

    CREATE INDEX IF NOT EXISTS idx_commercial_credit_freeze_user_status
      ON commercial_credit_freeze_records (user_id, status, created_at DESC);
  `);

  initialized = true;
}

function mapBalanceRow(row: Record<string, unknown>): CommercialCreditBalanceRecord {
  return {
    userId: String(row.user_id ?? ""),
    availableCredits: Number(row.available_credits ?? 0),
    frozenCredits: Number(row.frozen_credits ?? 0),
    lifetimePurchasedCredits: Number(row.lifetime_purchased_credits ?? 0),
    lifetimeUsedCredits: Number(row.lifetime_used_credits ?? 0),
    lastChangedAt: row.last_changed_at ? String(row.last_changed_at) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapTransactionRow(row: Record<string, unknown>): CommercialCreditTransactionRecord {
  return {
    transactionId: String(row.transaction_id ?? ""),
    userId: String(row.user_id ?? ""),
    eventType: String(row.event_type ?? ""),
    sourceType: String(row.source_type ?? "manual_adjustment") as CommercialCreditSourceType,
    sourceBizId: row.source_biz_id ? String(row.source_biz_id) : null,
    idempotencyKey: String(row.idempotency_key ?? ""),
    changeCredits: Number(row.change_credits ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    frozenAfter: Number(row.frozen_after ?? 0),
    status: String(row.status ?? "effective") as CommercialCreditTransactionStatus,
    expireAt: row.expire_at ? String(row.expire_at) : null,
    relatedFreezeId: row.related_freeze_id ? String(row.related_freeze_id) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    featureCode: row.feature_code ? String(row.feature_code) : null,
    provider: row.provider ? String(row.provider) : null,
    modelId: row.model_id ? String(row.model_id) : null,
    realCostRmb: row.real_cost_rmb === null || row.real_cost_rmb === undefined ? null : Number(row.real_cost_rmb),
    chargedRevenueRmb:
      row.charged_revenue_rmb === null || row.charged_revenue_rmb === undefined ? null : Number(row.charged_revenue_rmb),
    grossMarginRate:
      row.gross_margin_rate === null || row.gross_margin_rate === undefined ? null : Number(row.gross_margin_rate),
    operatorId: row.operator_id ? String(row.operator_id) : null,
    remark: row.remark ? String(row.remark) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapFreezeRow(row: Record<string, unknown>): CommercialCreditFreezeRecord {
  return {
    freezeId: String(row.freeze_id ?? ""),
    userId: String(row.user_id ?? ""),
    sourceType: String(row.source_type ?? "usage_charge") as CommercialCreditSourceType,
    sourceBizId: row.source_biz_id ? String(row.source_biz_id) : null,
    idempotencyKey: String(row.idempotency_key ?? ""),
    frozenCredits: Number(row.frozen_credits ?? 0),
    status: String(row.status ?? "frozen") as CommercialCreditFreezeStatus,
    taskId: row.task_id ? String(row.task_id) : null,
    featureCode: row.feature_code ? String(row.feature_code) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    confirmedTransactionId: row.confirmed_transaction_id ? String(row.confirmed_transaction_id) : null,
    releasedAt: row.released_at ? String(row.released_at) : null,
    releasedReason: row.released_reason ? String(row.released_reason) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function getBalanceRow(userId: string) {
  ensureCommercialCreditLedgerSchema();
  const row = db
    .prepare("SELECT * FROM commercial_user_credit_balances WHERE user_id = ? LIMIT 1")
    .get(userId) as Record<string, unknown> | undefined;

  return row ? mapBalanceRow(row) : null;
}

function createEmptyBalance(userId: string, timestamp: string) {
  db.prepare(
    `
      INSERT INTO commercial_user_credit_balances (
        user_id,
        available_credits,
        frozen_credits,
        lifetime_purchased_credits,
        lifetime_used_credits,
        last_changed_at,
        created_at,
        updated_at
      ) VALUES (?, 0, 0, 0, 0, NULL, ?, ?)
    `,
  ).run(userId, timestamp, timestamp);
}

function getOrCreateBalance(userId: string, timestamp = nowIso()) {
  const current = getBalanceRow(userId);
  if (current) {
    return current;
  }

  createEmptyBalance(userId, timestamp);
  return getBalanceRow(userId) as CommercialCreditBalanceRecord;
}

function getTransactionByIdempotencyKey(idempotencyKey: string) {
  ensureCommercialCreditLedgerSchema();
  const row = db
    .prepare("SELECT * FROM commercial_credit_transactions WHERE idempotency_key = ? LIMIT 1")
    .get(idempotencyKey) as Record<string, unknown> | undefined;

  return row ? mapTransactionRow(row) : null;
}

function getTransactionById(transactionId: string) {
  ensureCommercialCreditLedgerSchema();
  const row = db
    .prepare("SELECT * FROM commercial_credit_transactions WHERE transaction_id = ? LIMIT 1")
    .get(transactionId) as Record<string, unknown> | undefined;

  return row ? mapTransactionRow(row) : null;
}

function getFreezeByIdempotencyKey(idempotencyKey: string) {
  ensureCommercialCreditLedgerSchema();
  const row = db
    .prepare("SELECT * FROM commercial_credit_freeze_records WHERE idempotency_key = ? LIMIT 1")
    .get(idempotencyKey) as Record<string, unknown> | undefined;

  return row ? mapFreezeRow(row) : null;
}

function getFreezeById(freezeId: string) {
  ensureCommercialCreditLedgerSchema();
  const row = db
    .prepare("SELECT * FROM commercial_credit_freeze_records WHERE freeze_id = ? LIMIT 1")
    .get(freezeId) as Record<string, unknown> | undefined;

  return row ? mapFreezeRow(row) : null;
}

export function getCommercialCreditFreezeById(freezeId: string) {
  return getFreezeById(freezeId);
}

function insertCreditTransaction(record: CommercialCreditTransactionRecord) {
  db.prepare(
    `
      INSERT INTO commercial_credit_transactions (
        transaction_id,
        user_id,
        event_type,
        source_type,
        source_biz_id,
        idempotency_key,
        change_credits,
        balance_after,
        frozen_after,
        status,
        expire_at,
        related_freeze_id,
        task_id,
        feature_code,
        provider,
        model_id,
        real_cost_rmb,
        charged_revenue_rmb,
        gross_margin_rate,
        operator_id,
        remark,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.transactionId,
    record.userId,
    record.eventType,
    record.sourceType,
    record.sourceBizId,
    record.idempotencyKey,
    record.changeCredits,
    record.balanceAfter,
    record.frozenAfter,
    record.status,
    record.expireAt,
    record.relatedFreezeId,
    record.taskId,
    record.featureCode,
    record.provider,
    record.modelId,
    record.realCostRmb,
    record.chargedRevenueRmb,
    record.grossMarginRate,
    record.operatorId,
    record.remark,
    record.createdAt,
  );
}

export function getCommercialCreditBalance(userId: string) {
  ensureCommercialCreditLedgerSchema();
  return getOrCreateBalance(userId);
}

export function listCommercialCreditBalances(limit = 100) {
  ensureCommercialCreditLedgerSchema();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM commercial_user_credit_balances
        ORDER BY available_credits DESC, updated_at DESC
        LIMIT ?
      `,
    )
    .all(Math.max(1, limit)) as Record<string, unknown>[];

  return rows.map(mapBalanceRow);
}

export function grantCredits(input: GrantCreditsInput) {
  assertPositiveIntegerCredits(input.credits);
  ensureCommercialCreditLedgerSchema();

  const existing = getTransactionByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return {
      transaction: existing,
      balance: getCommercialCreditBalance(existing.userId),
    };
  }

  return db.transaction(() => {
    const timestamp = nowIso();
    const current = getOrCreateBalance(input.userId, timestamp);
    const availableCredits = current.availableCredits + input.credits;
    const lifetimePurchasedCredits =
      current.lifetimePurchasedCredits + (shouldCountAsPurchasedCredits(input.sourceType) ? input.credits : 0);

    db.prepare(
      `
        UPDATE commercial_user_credit_balances
        SET available_credits = ?,
            lifetime_purchased_credits = ?,
            last_changed_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `,
    ).run(availableCredits, lifetimePurchasedCredits, timestamp, timestamp, input.userId);

    const balance = getCommercialCreditBalance(input.userId);
    const transaction: CommercialCreditTransactionRecord = {
      transactionId: randomUUID(),
      userId: input.userId,
      eventType: input.sourceType,
      sourceType: input.sourceType,
      sourceBizId: input.sourceBizId ?? null,
      idempotencyKey: input.idempotencyKey,
      changeCredits: input.credits,
      balanceAfter: balance.availableCredits,
      frozenAfter: balance.frozenCredits,
      status: "effective",
      expireAt: input.expireAt ?? null,
      relatedFreezeId: null,
      taskId: null,
      featureCode: null,
      provider: null,
      modelId: null,
      realCostRmb: null,
      chargedRevenueRmb: null,
      grossMarginRate: null,
      operatorId: input.operatorId ?? null,
      remark: input.remark ?? null,
      createdAt: timestamp,
    };

    insertCreditTransaction(transaction);

    return { transaction, balance };
  })();
}

function reactivateReleasedFreeze(released: CommercialCreditFreezeRecord, input: FreezeCreditsInput) {
  return db.transaction(() => {
    const timestamp = nowIso();
    const current = getOrCreateBalance(released.userId, timestamp);
    if (current.availableCredits <= 0) {
      throw new CommercialCreditLedgerError(
        "INSUFFICIENT_CREDITS",
        `可用积分已用尽，当前 ${current.availableCredits}，请先充值后再使用。`,
      );
    }

    const availableCredits = current.availableCredits - input.credits;
    const frozenCredits = current.frozenCredits + input.credits;

    db.prepare(
      `
        UPDATE commercial_user_credit_balances
        SET available_credits = ?,
            frozen_credits = ?,
            last_changed_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `,
    ).run(availableCredits, frozenCredits, timestamp, timestamp, released.userId);

    db.prepare(
      `
        UPDATE commercial_credit_freeze_records
        SET status = 'frozen',
            frozen_credits = ?,
            released_at = NULL,
            released_reason = NULL,
            updated_at = ?
        WHERE freeze_id = ?
      `,
    ).run(input.credits, timestamp, released.freezeId);

    const freeze: CommercialCreditFreezeRecord = {
      ...released,
      frozenCredits: input.credits,
      status: "frozen",
      releasedAt: null,
      releasedReason: null,
      updatedAt: timestamp,
    };

    return {
      freeze,
      balance: getCommercialCreditBalance(released.userId),
    };
  })();
}

export function freezeCredits(input: FreezeCreditsInput) {
  assertPositiveIntegerCredits(input.credits);
  ensureCommercialCreditLedgerSchema();

  const existing = getFreezeByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    if (existing.status === "frozen" || existing.status === "confirmed") {
      return {
        freeze: existing,
        balance: getCommercialCreditBalance(existing.userId),
      };
    }

    if (existing.status === "released") {
      return reactivateReleasedFreeze(existing, input);
    }
  }

  return db.transaction(() => {
    const timestamp = nowIso();
    const current = getOrCreateBalance(input.userId, timestamp);
    if (current.availableCredits <= 0) {
      throw new CommercialCreditLedgerError(
        "INSUFFICIENT_CREDITS",
        `可用积分已用尽，当前 ${current.availableCredits}，请先充值后再使用。`,
      );
    }

    const availableCredits = current.availableCredits - input.credits;
    const frozenCredits = current.frozenCredits + input.credits;

    db.prepare(
      `
        UPDATE commercial_user_credit_balances
        SET available_credits = ?,
            frozen_credits = ?,
            last_changed_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `,
    ).run(availableCredits, frozenCredits, timestamp, timestamp, input.userId);

    const freeze: CommercialCreditFreezeRecord = {
      freezeId: randomUUID(),
      userId: input.userId,
      sourceType: input.sourceType,
      sourceBizId: input.sourceBizId ?? null,
      idempotencyKey: input.idempotencyKey,
      frozenCredits: input.credits,
      status: "frozen",
      taskId: input.taskId ?? null,
      featureCode: input.featureCode ?? null,
      expiresAt: input.expiresAt ?? null,
      confirmedTransactionId: null,
      releasedAt: null,
      releasedReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.prepare(
      `
        INSERT INTO commercial_credit_freeze_records (
          freeze_id,
          user_id,
          source_type,
          source_biz_id,
          idempotency_key,
          frozen_credits,
          status,
          task_id,
          feature_code,
          expires_at,
          confirmed_transaction_id,
          released_at,
          released_reason,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      freeze.freezeId,
      freeze.userId,
      freeze.sourceType,
      freeze.sourceBizId,
      freeze.idempotencyKey,
      freeze.frozenCredits,
      freeze.status,
      freeze.taskId,
      freeze.featureCode,
      freeze.expiresAt,
      freeze.confirmedTransactionId,
      freeze.releasedAt,
      freeze.releasedReason,
      freeze.createdAt,
      freeze.updatedAt,
    );

    return {
      freeze,
      balance: getCommercialCreditBalance(input.userId),
    };
  })();
}

export function confirmCreditFreeze(input: ConfirmCreditFreezeInput) {
  ensureCommercialCreditLedgerSchema();

  const existing = getTransactionByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return {
      transaction: existing,
      balance: getCommercialCreditBalance(existing.userId),
    };
  }

  return db.transaction(() => {
    const timestamp = nowIso();
    const freeze = getFreezeById(input.freezeId);
    if (!freeze) {
      throw new CommercialCreditLedgerError("FREEZE_NOT_FOUND", "未找到积分冻结记录。");
    }
    if (freeze.status === "confirmed" && freeze.confirmedTransactionId) {
      const transaction = getTransactionById(freeze.confirmedTransactionId);
      if (transaction) {
        return {
          transaction,
          balance: getCommercialCreditBalance(freeze.userId),
        };
      }
    }
    if (freeze.status === "released") {
      throw new CommercialCreditLedgerError("FREEZE_NOT_ACTIVE", "积分冻结已释放，不能确认扣费。");
    }
    if (freeze.status !== "frozen") {
      throw new CommercialCreditLedgerError("FREEZE_NOT_ACTIVE", "积分冻结状态不可确认扣费。");
    }

    const current = getCommercialCreditBalance(freeze.userId);
    const frozenCredits = Math.max(0, current.frozenCredits - freeze.frozenCredits);
    const lifetimeUsedCredits = current.lifetimeUsedCredits + freeze.frozenCredits;

    db.prepare(
      `
        UPDATE commercial_user_credit_balances
        SET frozen_credits = ?,
            lifetime_used_credits = ?,
            last_changed_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `,
    ).run(frozenCredits, lifetimeUsedCredits, timestamp, timestamp, freeze.userId);

    const balance = getCommercialCreditBalance(freeze.userId);
    const transaction: CommercialCreditTransactionRecord = {
      transactionId: randomUUID(),
      userId: freeze.userId,
      eventType: "usage_charge",
      sourceType: freeze.sourceType,
      sourceBizId: freeze.sourceBizId,
      idempotencyKey: input.idempotencyKey,
      changeCredits: -freeze.frozenCredits,
      balanceAfter: balance.availableCredits,
      frozenAfter: balance.frozenCredits,
      status: "effective",
      expireAt: null,
      relatedFreezeId: freeze.freezeId,
      taskId: freeze.taskId,
      featureCode: freeze.featureCode,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      realCostRmb: input.realCostRmb ?? null,
      chargedRevenueRmb: input.chargedRevenueRmb ?? null,
      grossMarginRate: input.grossMarginRate ?? null,
      operatorId: input.operatorId ?? null,
      remark: input.remark ?? null,
      createdAt: timestamp,
    };

    insertCreditTransaction(transaction);

    db.prepare(
      `
        UPDATE commercial_credit_freeze_records
        SET status = 'confirmed',
            confirmed_transaction_id = ?,
            updated_at = ?
        WHERE freeze_id = ?
      `,
    ).run(transaction.transactionId, timestamp, freeze.freezeId);

    return { transaction, balance };
  })();
}

export function releaseCreditFreeze(input: ReleaseCreditFreezeInput) {
  ensureCommercialCreditLedgerSchema();

  return db.transaction(() => {
    const timestamp = nowIso();
    const freeze = getFreezeById(input.freezeId);
    if (!freeze) {
      throw new CommercialCreditLedgerError("FREEZE_NOT_FOUND", "未找到积分冻结记录。");
    }
    if (freeze.status === "released") {
      return {
        freeze,
        balance: getCommercialCreditBalance(freeze.userId),
      };
    }
    if (freeze.status === "confirmed") {
      throw new CommercialCreditLedgerError("FREEZE_ALREADY_CONFIRMED", "积分冻结已确认扣费，不能释放。");
    }
    if (freeze.status !== "frozen") {
      throw new CommercialCreditLedgerError("FREEZE_NOT_ACTIVE", "积分冻结状态不可释放。");
    }

    const current = getCommercialCreditBalance(freeze.userId);
    const availableCredits = current.availableCredits + freeze.frozenCredits;
    const frozenCredits = Math.max(0, current.frozenCredits - freeze.frozenCredits);

    db.prepare(
      `
        UPDATE commercial_user_credit_balances
        SET available_credits = ?,
            frozen_credits = ?,
            last_changed_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `,
    ).run(availableCredits, frozenCredits, timestamp, timestamp, freeze.userId);

    db.prepare(
      `
        UPDATE commercial_credit_freeze_records
        SET status = 'released',
            released_at = ?,
            released_reason = ?,
            updated_at = ?
        WHERE freeze_id = ?
      `,
    ).run(timestamp, input.reason, timestamp, freeze.freezeId);

    return {
      freeze: getFreezeById(freeze.freezeId) as CommercialCreditFreezeRecord,
      balance: getCommercialCreditBalance(freeze.userId),
    };
  })();
}

export function listCreditTransactionsByUserId(userId: string, limit = 50) {
  ensureCommercialCreditLedgerSchema();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM commercial_credit_transactions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapTransactionRow);
}
