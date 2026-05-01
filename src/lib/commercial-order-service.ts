import { randomUUID } from "node:crypto";

import {
  COMMERCIAL_CREDIT_PACKAGES,
  COMMERCIAL_MEMBERSHIP_PLANS,
  type CommercialCreditPackage,
  type CommercialMembershipPlan,
} from "./commercial-billing-config";
import { grantCredits } from "./commercial-credit-ledger";
import { getAuthUser, type AuthUserRecord } from "./auth-store";
import { db } from "./db";

export type CommercialOrderStatus = "pending_payment" | "paid" | "fulfilled" | "closed" | "failed" | "refunded";
export type CommercialOrderProductKind = "membership" | "credit_package";

export type CommercialPaymentOrderRecord = {
  orderId: string;
  userId: string;
  productKind: CommercialOrderProductKind;
  productCode: string;
  productName: string;
  originalAmountRmb: number;
  amountRmb: number;
  credits: number;
  validityMonths: number;
  status: CommercialOrderStatus;
  idempotencyKey: string;
  fulfilledTransactionId: string | null;
  operatorId: string | null;
  createdAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  updatedAt: string;
};

export type UserCommercialMembershipRecord = {
  userId: string;
  planCode: string;
  planName: string;
  status: "active" | "expired" | "frozen";
  startAt: string;
  endAt: string;
  orderId: string;
  monthlyCredits: number;
  createdAt: string;
  updatedAt: string;
};

export type ActiveUserCommercialEntitlement =
  | {
      source: "commercial_membership";
      userId: string;
      planCode: string;
      planName: string;
      status: "active";
      startAt: string;
      endAt: string;
      monthlyCredits: number;
      membership: UserCommercialMembershipRecord;
      authPlanLevel: null;
      quotaScope: null;
      certificationLabel: null;
    }
  | {
      source: "legacy_auth_user";
      userId: string;
      planCode: string;
      planName: string;
      status: "active";
      startAt: string;
      endAt: null;
      monthlyCredits: 0;
      membership: null;
      authPlanLevel: number | null;
      quotaScope: AuthUserRecord["quotaScope"];
      certificationLabel: string | null;
    };

export type CreateCommercialOrderInput = {
  userId: string;
  productCode: string;
  idempotencyKey: string;
};

export type FulfillCommercialOrderInput = {
  orderId: string;
  idempotencyKey: string;
  operatorId?: string | null;
};

export class CommercialOrderError extends Error {
  constructor(
    public readonly code: "PRODUCT_NOT_FOUND" | "ORDER_NOT_FOUND" | "ORDER_CLOSED" | "ORDER_REFUNDED",
    message: string,
  ) {
    super(message);
    this.name = "CommercialOrderError";
  }
}

let initialized = false;

function nowIso() {
  return new Date().toISOString();
}

function addMonths(iso: string, months: number) {
  const date = new Date(iso);
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}

function resolveCommercialProduct(code: string): CommercialMembershipPlan | CommercialCreditPackage {
  const product = [...COMMERCIAL_MEMBERSHIP_PLANS, ...COMMERCIAL_CREDIT_PACKAGES].find((item) => item.code === code);
  if (!product) {
    throw new CommercialOrderError("PRODUCT_NOT_FOUND", "未找到商业产品配置。");
  }
  return product;
}

export function ensureCommercialOrderSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS commercial_payment_orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_kind TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      original_amount_rmb REAL NOT NULL,
      amount_rmb REAL NOT NULL,
      credits INTEGER NOT NULL,
      validity_months INTEGER NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      fulfilled_transaction_id TEXT,
      operator_id TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      fulfilled_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_payment_orders_idempotent
      ON commercial_payment_orders (idempotency_key);

    CREATE INDEX IF NOT EXISTS idx_commercial_payment_orders_user_created
      ON commercial_payment_orders (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS commercial_user_memberships (
      user_id TEXT PRIMARY KEY,
      plan_code TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      status TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      order_id TEXT NOT NULL,
      monthly_credits INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  initialized = true;
}

function mapOrderRow(row: Record<string, unknown>): CommercialPaymentOrderRecord {
  return {
    orderId: String(row.order_id ?? ""),
    userId: String(row.user_id ?? ""),
    productKind: String(row.product_kind ?? "credit_package") as CommercialOrderProductKind,
    productCode: String(row.product_code ?? ""),
    productName: String(row.product_name ?? ""),
    originalAmountRmb: Number(row.original_amount_rmb ?? 0),
    amountRmb: Number(row.amount_rmb ?? 0),
    credits: Number(row.credits ?? 0),
    validityMonths: Number(row.validity_months ?? 0),
    status: String(row.status ?? "pending_payment") as CommercialOrderStatus,
    idempotencyKey: String(row.idempotency_key ?? ""),
    fulfilledTransactionId: row.fulfilled_transaction_id ? String(row.fulfilled_transaction_id) : null,
    operatorId: row.operator_id ? String(row.operator_id) : null,
    createdAt: String(row.created_at ?? ""),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    fulfilledAt: row.fulfilled_at ? String(row.fulfilled_at) : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapMembershipRow(row: Record<string, unknown>): UserCommercialMembershipRecord {
  return {
    userId: String(row.user_id ?? ""),
    planCode: String(row.plan_code ?? ""),
    planName: String(row.plan_name ?? ""),
    status: String(row.status ?? "active") as UserCommercialMembershipRecord["status"],
    startAt: String(row.start_at ?? ""),
    endAt: String(row.end_at ?? ""),
    orderId: String(row.order_id ?? ""),
    monthlyCredits: Number(row.monthly_credits ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function getOrderByIdempotencyKey(idempotencyKey: string) {
  ensureCommercialOrderSchema();
  const row = db
    .prepare("SELECT * FROM commercial_payment_orders WHERE idempotency_key = ? LIMIT 1")
    .get(idempotencyKey) as Record<string, unknown> | undefined;
  return row ? mapOrderRow(row) : null;
}

function getOrderById(orderId: string) {
  ensureCommercialOrderSchema();
  const row = db
    .prepare("SELECT * FROM commercial_payment_orders WHERE order_id = ? LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  return row ? mapOrderRow(row) : null;
}

export function getUserCommercialMembership(userId: string) {
  ensureCommercialOrderSchema();
  const row = db
    .prepare("SELECT * FROM commercial_user_memberships WHERE user_id = ? LIMIT 1")
    .get(userId) as Record<string, unknown> | undefined;
  return row ? mapMembershipRow(row) : null;
}

export function getActiveUserCommercialMembership(userId: string, at = new Date()) {
  const membership = getUserCommercialMembership(userId);
  if (!membership || membership.status !== "active") {
    return null;
  }

  const endAt = new Date(membership.endAt).getTime();
  if (!Number.isFinite(endAt) || endAt <= at.getTime()) {
    return null;
  }

  return membership;
}

function buildLegacyCommercialEntitlement(user: AuthUserRecord): ActiveUserCommercialEntitlement | null {
  if (user.status !== "normal") {
    return null;
  }

  const authPlanLevel = typeof user.planLevel === "number" && Number.isFinite(user.planLevel) ? user.planLevel : null;
  const certificationLabel = user.certificationLabel?.trim() || null;
  const hasLegacyCommercialAccess =
    (authPlanLevel !== null && authPlanLevel > 0) || user.quotaScope === "unlimited" || Boolean(certificationLabel);

  if (!hasLegacyCommercialAccess) {
    return null;
  }

  const planCode =
    authPlanLevel !== null && authPlanLevel > 0
      ? `legacy_auth_l${authPlanLevel}`
      : user.quotaScope === "unlimited"
        ? "legacy_auth_unlimited"
        : "legacy_auth_certified";

  return {
    source: "legacy_auth_user",
    userId: user.userId,
    planCode,
    planName: certificationLabel ?? (authPlanLevel !== null ? `L${authPlanLevel} 会员` : "历史会员"),
    status: "active",
    startAt: user.createdAt,
    endAt: null,
    monthlyCredits: 0,
    membership: null,
    authPlanLevel,
    quotaScope: user.quotaScope,
    certificationLabel,
  };
}

export function getActiveUserCommercialEntitlement(userId: string, at = new Date()): ActiveUserCommercialEntitlement | null {
  const membership = getActiveUserCommercialMembership(userId, at);
  if (membership) {
    return {
      source: "commercial_membership",
      userId: membership.userId,
      planCode: membership.planCode,
      planName: membership.planName,
      status: "active",
      startAt: membership.startAt,
      endAt: membership.endAt,
      monthlyCredits: membership.monthlyCredits,
      membership,
      authPlanLevel: null,
      quotaScope: null,
      certificationLabel: null,
    };
  }

  const user = getAuthUser(userId);
  return user ? buildLegacyCommercialEntitlement(user) : null;
}

export function listCommercialOrdersByUserId(userId: string, limit = 50) {
  ensureCommercialOrderSchema();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM commercial_payment_orders
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapOrderRow);
}

export function listCommercialOrders(limit = 100) {
  ensureCommercialOrderSchema();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM commercial_payment_orders
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapOrderRow);
}

export function getCommercialOrderById(orderId: string) {
  return getOrderById(orderId);
}

export function createCommercialOrder(input: CreateCommercialOrderInput) {
  ensureCommercialOrderSchema();

  const existing = getOrderByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { order: existing };
  }

  const product = resolveCommercialProduct(input.productCode);
  const timestamp = nowIso();
  const order: CommercialPaymentOrderRecord = {
    orderId: randomUUID(),
    userId: input.userId,
    productKind: product.kind,
    productCode: product.code,
    productName: product.name,
    originalAmountRmb: product.originalPriceRmb,
    amountRmb: product.priceRmb,
    credits: product.credits,
    validityMonths: product.validityMonths,
    status: "pending_payment",
    idempotencyKey: input.idempotencyKey,
    fulfilledTransactionId: null,
    operatorId: null,
    createdAt: timestamp,
    paidAt: null,
    fulfilledAt: null,
    updatedAt: timestamp,
  };

  db.prepare(
    `
      INSERT INTO commercial_payment_orders (
        order_id,
        user_id,
        product_kind,
        product_code,
        product_name,
        original_amount_rmb,
        amount_rmb,
        credits,
        validity_months,
        status,
        idempotency_key,
        fulfilled_transaction_id,
        operator_id,
        created_at,
        paid_at,
        fulfilled_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    order.orderId,
    order.userId,
    order.productKind,
    order.productCode,
    order.productName,
    order.originalAmountRmb,
    order.amountRmb,
    order.credits,
    order.validityMonths,
    order.status,
    order.idempotencyKey,
    order.fulfilledTransactionId,
    order.operatorId,
    order.createdAt,
    order.paidAt,
    order.fulfilledAt,
    order.updatedAt,
  );

  return { order };
}

function upsertCommercialMembership(order: CommercialPaymentOrderRecord, timestamp: string) {
  const product = resolveCommercialProduct(order.productCode);
  if (product.kind !== "membership") {
    return null;
  }

  const existing = getUserCommercialMembership(order.userId);
  const membership: UserCommercialMembershipRecord = {
    userId: order.userId,
    planCode: product.code,
    planName: product.name,
    status: "active",
    startAt: timestamp,
    endAt: addMonths(timestamp, product.validityMonths),
    orderId: order.orderId,
    monthlyCredits: product.monthlyCredits,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    `
      INSERT INTO commercial_user_memberships (
        user_id,
        plan_code,
        plan_name,
        status,
        start_at,
        end_at,
        order_id,
        monthly_credits,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan_code = excluded.plan_code,
        plan_name = excluded.plan_name,
        status = excluded.status,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        order_id = excluded.order_id,
        monthly_credits = excluded.monthly_credits,
        updated_at = excluded.updated_at
    `,
  ).run(
    membership.userId,
    membership.planCode,
    membership.planName,
    membership.status,
    membership.startAt,
    membership.endAt,
    membership.orderId,
    membership.monthlyCredits,
    membership.createdAt,
    membership.updatedAt,
  );

  return getUserCommercialMembership(order.userId);
}

export function fulfillCommercialOrder(input: FulfillCommercialOrderInput) {
  ensureCommercialOrderSchema();

  return db.transaction(() => {
    const current = getOrderById(input.orderId);
    if (!current) {
      throw new CommercialOrderError("ORDER_NOT_FOUND", "未找到商业订单。");
    }
    if (current.status === "closed" || current.status === "failed") {
      throw new CommercialOrderError("ORDER_CLOSED", "订单已关闭，不能履约。");
    }
    if (current.status === "refunded") {
      throw new CommercialOrderError("ORDER_REFUNDED", "订单已退款，不能履约。");
    }
    if (current.status === "fulfilled") {
      return {
        order: current,
        membership: getUserCommercialMembership(current.userId),
      };
    }

    const timestamp = nowIso();
    const sourceType = current.productKind === "membership" ? "membership_grant" : "credit_package_grant";
    const granted = grantCredits({
      userId: current.userId,
      credits: current.credits,
      sourceType,
      sourceBizId: current.orderId,
      idempotencyKey: input.idempotencyKey,
      expireAt: addMonths(timestamp, current.validityMonths),
      operatorId: input.operatorId ?? null,
      remark: `${current.productName} 到账`,
    });

    const membership = current.productKind === "membership" ? upsertCommercialMembership(current, timestamp) : null;

    db.prepare(
      `
        UPDATE commercial_payment_orders
        SET status = 'fulfilled',
            fulfilled_transaction_id = ?,
            operator_id = ?,
            paid_at = COALESCE(paid_at, ?),
            fulfilled_at = ?,
            updated_at = ?
        WHERE order_id = ?
      `,
    ).run(granted.transaction.transactionId, input.operatorId ?? null, timestamp, timestamp, timestamp, current.orderId);

    return {
      order: getOrderById(current.orderId) as CommercialPaymentOrderRecord,
      membership,
    };
  })();
}
