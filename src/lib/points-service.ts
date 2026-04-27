import { getAuthUser } from "./auth-store";
import {
  ensurePointsDefaults,
  expirePointRecordsForUser,
  getDailyPointTotal,
  getDefaultPointsConfig,
  getPointRecordByIdempotentKey,
  getPointsConfig,
  getUserPointStats,
  getUserPointsAccount,
  insertPointRecord,
  listPointRecordsByUserId,
  listPointRules,
  transferPointUserId,
  upsertUserPointsAccount,
  type PointRecord,
  type PointSourceType,
  type UserPointsAccountRecord,
} from "./points-store";

function nowIso() {
  return new Date().toISOString();
}

function addDays(iso: string, days: number) {
  const base = new Date(iso);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDateWindow(iso: string) {
  const source = new Date(iso);
  const start = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function getPointsConfigOrDefault() {
  ensurePointsDefaults();
  return getPointsConfig() ?? getDefaultPointsConfig();
}

export function ensureUserPointsAccount(userId: string) {
  ensurePointsDefaults();
  const user = getAuthUser(userId);
  if (!user) {
    return null;
  }

  const existing = getUserPointsAccount(userId);
  if (existing) {
    return existing;
  }

  const timestamp = nowIso();
  const account: UserPointsAccountRecord = {
    userId,
    availablePoints: 0,
    lifetimePoints: 0,
    lastChangedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  upsertUserPointsAccount(account);
  return account;
}

export function recalculateUserPointsAccount(userId: string) {
  ensurePointsDefaults();
  const user = getAuthUser(userId);
  if (!user) {
    return null;
  }

  const previousAccount = ensureUserPointsAccount(userId);
  if (!previousAccount) {
    return null;
  }

  const timestamp = nowIso();
  expirePointRecordsForUser(userId, timestamp);
  const stats = getUserPointStats(userId, timestamp);

  const nextAccount: UserPointsAccountRecord = {
    ...previousAccount,
    availablePoints: stats.availableTotal,
    lifetimePoints: stats.lifetimeTotal,
    lastChangedAt: timestamp,
    updatedAt: timestamp,
  };

  upsertUserPointsAccount(nextAccount);
  return nextAccount;
}

type GrantPointsInput = {
  userId: string;
  eventType: string;
  sourceType?: PointSourceType;
  sourceBizId?: string | null;
  idempotentKey: string;
  changeValue?: number;
  expireDays?: number | null;
  operatorId?: string | null;
  remark?: string | null;
};

type ApplyPointChangeInput = GrantPointsInput & {
  bypassPointsEnabled?: boolean;
};

function roundPoints(value: number) {
  return Math.round(value * 100) / 100;
}

function applyPointChange(input: ApplyPointChangeInput) {
  ensurePointsDefaults();
  const config = getPointsConfigOrDefault();
  if (!config.pointsEnabled && !input.bypassPointsEnabled && input.sourceType !== "manual") {
    return {
      skipped: true,
      reason: "points_disabled",
      account: ensureUserPointsAccount(input.userId),
      record: null,
    };
  }

  const existing = getPointRecordByIdempotentKey(input.idempotentKey);
  if (existing) {
    return {
      skipped: false,
      reason: "duplicate",
      account: recalculateUserPointsAccount(input.userId),
      record: existing,
    };
  }

  const rule = listPointRules().find((item) => item.eventType === input.eventType && item.enabled);
  const basePointValue = input.changeValue ?? rule?.pointValue ?? 0;
  const sourceType = input.sourceType ?? (input.eventType === "manual_adjustment" ? "manual" : "rule");
  const timestamp = nowIso();
  const { startAt, endAt } = getDateWindow(timestamp);
  const dailyLimit = rule?.dailyLimit ?? null;
  const dailyTotal = dailyLimit !== null ? getDailyPointTotal(input.userId, input.eventType, startAt, endAt) : 0;

  let grantedValue = roundPoints(basePointValue);
  if (dailyLimit !== null && basePointValue > 0) {
    grantedValue = roundPoints(Math.max(Math.min(basePointValue, dailyLimit - dailyTotal), 0));
  }

  const hasExplicitExpireDays = Object.prototype.hasOwnProperty.call(input, "expireDays");
  const expireDays =
    grantedValue <= 0 ? null : hasExplicitExpireDays ? (input.expireDays ?? null) : config.defaultExpireDays;
  const record: PointRecord = {
    pointId: createId("pt"),
    userId: input.userId,
    eventType: input.eventType,
    sourceType,
    sourceBizId: input.sourceBizId ?? null,
    idempotentKey: input.idempotentKey,
    changeValue: grantedValue,
    status: "effective",
    expireAt: expireDays ? addDays(timestamp, expireDays) : null,
    reversedPointId: null,
    operatorId: input.operatorId ?? null,
    remark:
      grantedValue === 0 && dailyLimit !== null
        ? `${input.remark ?? ""}${input.remark ? "；" : ""}达到当日积分上限`
        : (input.remark ?? null),
    createdAt: timestamp,
  };

  insertPointRecord(record);
  return {
    skipped: false,
    reason: grantedValue === 0 ? "daily_limit_reached" : "granted",
    account: recalculateUserPointsAccount(input.userId),
    record,
  };
}

export function grantPointsForEvent(input: GrantPointsInput) {
  return applyPointChange(input);
}

export function chargePointsForUsage(input: {
  userId: string;
  serviceName: string;
  modelId?: string | null;
  sourceBizId?: string | null;
  idempotentKey: string;
  pointsCost: number;
  remark?: string | null;
}) {
  const normalizedPointsCost = roundPoints(Math.max(input.pointsCost, 0));
  return applyPointChange({
    userId: input.userId,
    eventType: "model_usage_charge",
    sourceType: "system",
    sourceBizId: input.sourceBizId ?? null,
    idempotentKey: input.idempotentKey,
    changeValue: -normalizedPointsCost,
    expireDays: null,
    remark:
      input.remark ??
      `模型调用扣费${input.serviceName ? ` · ${input.serviceName}` : ""}${input.modelId ? ` · ${input.modelId}` : ""}`,
    bypassPointsEnabled: true,
  });
}

export function adjustPointsForAdmin(
  userId: string,
  input: { changeValue: number; reason: string },
  actor: { adminId: string },
) {
  return grantPointsForEvent({
    userId,
    eventType: "manual_adjustment",
    sourceType: "manual",
    changeValue: input.changeValue,
    idempotentKey: `points_manual:${actor.adminId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    operatorId: actor.adminId,
    remark: input.reason,
  }).account;
}

export function getPointsPayload(userId: string) {
  return {
    account: recalculateUserPointsAccount(userId),
    rules: listPointRules().filter((item) => item.enabled),
    records: listPointRecordsByUserId(userId, 20),
  };
}

export function transferPointsOnMerge(sourceUserId: string, targetUserId: string) {
  ensurePointsDefaults();
  transferPointUserId(sourceUserId, targetUserId);
  recalculateUserPointsAccount(sourceUserId);
  return recalculateUserPointsAccount(targetUserId);
}
