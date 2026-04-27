import { getAuthUser, listAuthUsers, listUserPhones, upsertAuthUser, type AuthUserRecord } from "./auth-store";
import { maskPhone } from "./auth-security";
import {
  type MemberCampaignGrantType,
  type MemberCampaignRecord,
  type MemberCampaignTargetType,
  type MemberCampaignExecutionResultRecord,
  type MemberConfigRecord,
  deleteMemberCampaign,
  ensureMemberDefaults,
  expireBenefitGrantsForUser,
  expireGrowthRecordsForUser,
  getMemberBenefitGrant,
  getMemberCampaign,
  getDailyGrowthTotal,
  getDefaultMemberConfig,
  getMemberConfig,
  getMemberCampaignExecutionBatch,
  getMemberGrowthRecordByIdempotentKey,
  getMemberGrowthStats,
  getMemberProfile,
  insertMemberBenefitGrant,
  insertMemberBenefitUsageRecord,
  insertMemberCampaignExecutionBatch,
  insertMemberCampaignExecutionResult,
  insertMemberGrowthRecord,
  insertMemberLevelChangeLog,
  insertMemberOperationLog,
  listActiveMemberBenefitGrantsByUserId,
  listMemberBenefitDefinitions,
  listMemberBenefitGrantsByUserId,
  listMemberBenefitUsageRecordsByUserId,
  listMemberCampaigns,
  listMemberCampaignExecutionBatches,
  listMemberCampaignExecutionResults,
  listMemberCampaignExecutionResultsByBatchId,
  listMemberGrowthRecordsByUserId,
  listMemberGrowthRules,
  type MemberGrowthRuleRecord,
  listMemberLevelBenefitMaps,
  listMemberLevelChangeLogsByUserId,
  listMemberLevels,
  listMemberOperationLogsByUserId,
  revokeMemberBenefitGrant,
  setMemberConfig,
  transferMemberUserId,
  type MemberLevelBenefitMapRecord,
  upsertMemberProfile,
  upsertMemberGrowthRule,
  upsertMemberLevel,
  upsertMemberLevelBenefitMap,
  upsertMemberCampaign,
  type BenefitValueType,
  type MemberBenefitDefinitionRecord,
  type MemberBenefitGrantRecord,
  type MemberBenefitUsageRecord,
  type MemberGrowthRecord,
  type MemberGrowthSourceType,
  type MemberLevelChangeReasonType,
  type MemberLevelCode,
  type MemberLevelRecord,
  type MemberStatus,
  type MemberUserProfileRecord,
} from "./member-store";
import {
  adjustPointsForAdmin,
  getPointsPayload,
  grantPointsForEvent,
  recalculateUserPointsAccount,
} from "./points-service";
import {
  getDefaultPointsConfig,
  getPointsConfig,
  listPointRules,
  setPointsConfig,
  type PointRecord,
  type PointRuleRecord,
  type PointsConfigRecord,
  type UserPointsAccountRecord,
  upsertPointRule,
} from "./points-store";
import { db } from "./db";

type MemberRecalculateOptions = {
  reasonType?: MemberLevelChangeReasonType;
  reasonDetail?: string;
  operatorId?: string | null;
};

type EffectiveBenefitItem = {
  benefitKey: string;
  name: string;
  category: MemberBenefitDefinitionRecord["category"];
  valueType: BenefitValueType;
  unit: string | null;
  value: string | number | boolean;
  description: string;
  sourceType: "level" | "grant";
};

export type MemberUserListItem = {
  userId: string;
  nickname: string;
  maskedPhone: string | null;
  status: AuthUserRecord["status"];
  memberStatus: MemberStatus;
  currentLevelCode: MemberLevelCode;
  currentLevelNumber: number;
  currentLevelName: string;
  effectiveGrowthValue: number;
  lifetimeGrowthValue: number;
  availablePoints: number;
  nextLevelGap: number;
  quotaScopeSnapshot: "limited" | "unlimited";
  excludeFromMetrics: boolean;
  lastLevelChangedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type MemberUserDetail = {
  summary: MemberUserListItem;
  profile: MemberUserProfileRecord;
  level: MemberLevelRecord;
  pointsAccount: UserPointsAccountRecord | null;
  pointRecords: PointRecord[];
  effectiveBenefits: EffectiveBenefitItem[];
  grantedBenefits: MemberBenefitGrantRecord[];
  benefitUsageRecords: MemberBenefitUsageRecord[];
  growthRecords: MemberGrowthRecord[];
  levelChanges: ReturnType<typeof listMemberLevelChangeLogsByUserId>;
  operationLogs: ReturnType<typeof listMemberOperationLogsByUserId>;
};

export type MemberUserListPage = {
  users: MemberUserListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type MemberCampaignExecutionResult = {
  campaign: MemberCampaignRecord;
  affectedUserCount: number;
  failedUserCount: number;
  batchId: string;
};

export type MemberCampaignExecutionDetail = {
  batch: {
    batchId: string;
    campaignId: string;
    campaignName: string;
    grantType: MemberCampaignGrantType;
    targetSummary: string;
    plannedUserCount: number;
    successUserCount: number;
    failedUserCount: number;
    operatorId: string | null;
    startedAt: string;
    finishedAt: string | null;
    createdAt: string;
  };
  campaign: MemberCampaignRecord | null;
  results: Array<{
    resultId: string;
    userId: string;
    nickname: string;
    maskedPhone: string | null;
    status: "success" | "failed" | "skipped";
    detail: string;
    createdAt: string;
  }>;
};

export type MemberExportLogType = "growth" | "points" | "benefit_grants" | "benefit_usage" | "campaign_results";

type MemberBenefitUsageStat = {
  benefitKey: string;
  benefitName: string;
  eligibleUserCount: number;
  usedUserCount30d: number;
  usageRate30d: number;
  hitCount30d: number;
  allowedHitCount30d: number;
  blockedHitCount30d: number;
};

export class MemberBenefitAccessError extends Error {
  code: string;
  status: number;
  data?: Record<string, unknown>;

  constructor(message: string, options?: { code?: string; status?: number; data?: Record<string, unknown> }) {
    super(message);
    this.name = "MemberBenefitAccessError";
    this.code = options?.code ?? "MEMBER_BENEFIT_ACCESS_ERROR";
    this.status = options?.status ?? 403;
    this.data = options?.data;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendBatchMarker(detail: string, batchId: string) {
  return `${detail} [batch:${batchId}]`;
}

function toCsvCell(value: string | number | boolean | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function normalizeDateBoundary(value: string | null | undefined, boundary: "start" | "end") {
  if (!value) {
    return null;
  }
  const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const iso = value.includes("T") ? value : `${value}${suffix}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addDays(iso: string, days: number) {
  const base = new Date(iso);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getDateWindow(iso: string) {
  const source = new Date(iso);
  const start = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function getMemberConfigOrDefault() {
  ensureMemberDefaults();
  return getMemberConfig() ?? getDefaultMemberConfig();
}

function getPointsConfigOrDefault() {
  return getPointsConfig() ?? getDefaultPointsConfig();
}

function querySingleNumber(sql: string, params: Array<string | number | null>) {
  const row = db.prepare(sql).get(...params) as { value?: number } | undefined;
  return Number(row?.value ?? 0);
}

function queryDistinctUserCount(sql: string, params: Array<string | number | null>) {
  return querySingleNumber(sql, params);
}

function getEnabledLevels() {
  return listMemberLevels().filter((item) => item.enabled);
}

function recalculateAllMemberProfiles(reasonDetail: string, operatorId?: string | null) {
  for (const user of listAuthUsers()) {
    recalculateMemberProfile(user.userId, {
      reasonDetail,
      operatorId: operatorId ?? null,
    });
  }
}

function findLevelByCode(levelCode: MemberLevelCode | null | undefined) {
  if (!levelCode) {
    return null;
  }
  return getEnabledLevels().find((item) => item.levelCode === levelCode) ?? null;
}

function findLevelByNumber(levelNumber: number | null | undefined) {
  if (!levelNumber) {
    return null;
  }
  return getEnabledLevels().find((item) => item.levelNumber === levelNumber) ?? null;
}

function getLevelForGrowthValue(growthValue: number) {
  const levels = getEnabledLevels();
  return [...levels].reverse().find((item) => growthValue >= item.upgradeThreshold) ?? levels[0];
}

function getPrimaryPhone(userId: string) {
  const phone = listUserPhones()
    .filter((item) => item.userId === userId)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
  return phone?.phone ?? null;
}

function valueToComparable(value: string | number | boolean) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (value === "unlimited") {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBenefitValue(definition: MemberBenefitDefinitionRecord, rawValue: string | number | boolean) {
  if (definition.valueType === "number") {
    return typeof rawValue === "number" ? rawValue : Number(rawValue);
  }
  if (definition.valueType === "boolean") {
    return typeof rawValue === "boolean" ? rawValue : String(rawValue) === "true";
  }
  return String(rawValue);
}

function pickPreferredBenefitValue(
  definition: MemberBenefitDefinitionRecord,
  currentValue: string | number | boolean,
  nextValue: string | number | boolean,
) {
  if (definition.conflictPolicy === "or") {
    return Boolean(currentValue) || Boolean(nextValue);
  }
  if (definition.conflictPolicy === "manual_first") {
    return nextValue;
  }
  return valueToComparable(nextValue) >= valueToComparable(currentValue) ? nextValue : currentValue;
}

function buildInitialProfile(user: AuthUserRecord): MemberUserProfileRecord {
  const timestamp = nowIso();
  const compatLevel = findLevelByNumber(user.planLevel) ?? findLevelByCode("L1");
  const currentLevel = compatLevel ?? getEnabledLevels()[0];
  const config = getMemberConfigOrDefault();
  const isExcluded = config.excludedUserIds.includes(user.userId);

  return {
    userId: user.userId,
    currentLevelCode: currentLevel.levelCode,
    currentLevelNumber: currentLevel.levelNumber,
    memberStatus: user.status === "banned" ? "frozen" : user.status === "merged" ? "merged" : "active",
    effectiveGrowthValue: 0,
    lifetimeGrowthValue: 0,
    nextLevelCode: null,
    nextLevelGap: 0,
    lastLevelChangedAt: timestamp,
    graceStartAt: null,
    graceExpireAt: null,
    manualLevelCode: null,
    manualLevelExpireAt: null,
    quotaScopeSnapshot: "limited",
    benefitSnapshotVersion: "v1",
    excludeFromMetrics: isExcluded,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function ensureMemberProfile(userId: string) {
  ensureMemberDefaults();
  const user = getAuthUser(userId);
  if (!user) {
    return null;
  }

  const existing = getMemberProfile(userId);
  if (existing) {
    return existing;
  }

  const profile = buildInitialProfile(user);
  upsertMemberProfile(profile);
  return profile;
}

function syncMemberCompatFields(userId: string, profile: MemberUserProfileRecord) {
  const user = getAuthUser(userId);
  if (!user) {
    return;
  }

  const nextQuotaScope = profile.quotaScopeSnapshot;
  if (user.planLevel === profile.currentLevelNumber && user.quotaScope === nextQuotaScope) {
    return;
  }

  upsertAuthUser({
    ...user,
    planLevel: profile.currentLevelNumber,
    quotaScope: nextQuotaScope,
    updatedAt: nowIso(),
  });
}

function getLevelMapsByLevelCode(levelCode: MemberLevelCode) {
  return listMemberLevelBenefitMaps().filter((item) => item.levelCode === levelCode && item.enabled);
}

export function listEffectiveBenefitsForUser(userId: string) {
  ensureMemberDefaults();
  const profile = ensureMemberProfile(userId);
  if (!profile) {
    return [] as EffectiveBenefitItem[];
  }

  expireBenefitGrantsForUser(userId, nowIso());

  const definitions = new Map(listMemberBenefitDefinitions().map((item) => [item.benefitKey, item]));
  const results = new Map<string, EffectiveBenefitItem>();

  for (const mapRecord of getLevelMapsByLevelCode(profile.currentLevelCode)) {
    const definition = definitions.get(mapRecord.benefitKey);
    if (!definition || !definition.enabled) {
      continue;
    }

    results.set(mapRecord.benefitKey, {
      benefitKey: mapRecord.benefitKey,
      name: definition.name,
      category: definition.category,
      valueType: definition.valueType,
      unit: definition.unit,
      value: parseBenefitValue(definition, mapRecord.benefitValue),
      description: definition.description,
      sourceType: "level",
    });
  }

  for (const grant of listActiveMemberBenefitGrantsByUserId(userId, nowIso())) {
    const definition = definitions.get(grant.benefitKey);
    if (!definition || !definition.enabled) {
      continue;
    }
    const nextValue = parseBenefitValue(definition, grant.benefitValue);
    const current = results.get(grant.benefitKey);
    if (!current) {
      results.set(grant.benefitKey, {
        benefitKey: grant.benefitKey,
        name: definition.name,
        category: definition.category,
        valueType: definition.valueType,
        unit: definition.unit,
        value: nextValue,
        description: definition.description,
        sourceType: "grant",
      });
      continue;
    }

    results.set(grant.benefitKey, {
      ...current,
      value: pickPreferredBenefitValue(definition, current.value, nextValue),
      sourceType: definition.conflictPolicy === "manual_first" ? "grant" : current.sourceType,
    });
  }

  return [...results.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function getGrowthMultiplierForUser(userId: string) {
  const benefit = listEffectiveBenefitsForUser(userId).find((item) => item.benefitKey === "growth_multiplier");
  return benefit && typeof benefit.value === "number" && benefit.value > 0 ? benefit.value : 1;
}

export function getEffectiveBenefitByKey(userId: string, benefitKey: string) {
  return listEffectiveBenefitsForUser(userId).find((item) => item.benefitKey === benefitKey) ?? null;
}

function resolveQuotaLimitValue(userId: string, benefitKey: string) {
  const benefit = getEffectiveBenefitByKey(userId, benefitKey);
  if (!benefit) {
    return null;
  }
  if (typeof benefit.value === "number") {
    return benefit.value;
  }
  if (benefit.value === "unlimited") {
    return "unlimited" as const;
  }
  const parsed = Number(benefit.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assertMemberQuotaAccess(input: {
  userId: string;
  benefitKey: string;
  currentCount: number;
  increment?: number;
  sourceBizType?: string | null;
  sourceBizId?: string | null;
  detail?: string | null;
  logUsage?: boolean;
}) {
  const config = getMemberConfigOrDefault();
  const increment = input.increment ?? 1;
  const benefit = getEffectiveBenefitByKey(input.userId, input.benefitKey);
  const limitValue = resolveQuotaLimitValue(input.userId, input.benefitKey);
  const usageTimestamp = nowIso();
  const nextCount = input.currentCount + increment;
  const benefitName = benefit?.name ?? input.benefitKey;

  const recordUsage = (resultStatus: "allowed" | "blocked", detailSuffix?: string | null) => {
    if (input.logUsage === false) {
      return;
    }
    insertMemberBenefitUsageRecord({
      usageId: createId("muse"),
      userId: input.userId,
      benefitKey: input.benefitKey,
      benefitName,
      usageType: "quota_check",
      sourceBizType: input.sourceBizType ?? null,
      sourceBizId: input.sourceBizId ?? null,
      currentCount: input.currentCount,
      increment,
      nextCount,
      limitValue: limitValue === null ? null : String(limitValue),
      resultStatus,
      detail: detailSuffix ?? input.detail ?? null,
      createdAt: usageTimestamp,
    });
  };

  if (!config.memberBenefitEnforcementEnabled || !benefit || limitValue === null || limitValue === "unlimited") {
    const bypassReason = !config.memberBenefitEnforcementEnabled
      ? "权益控制已关闭"
      : !benefit
        ? "未命中权益定义"
        : limitValue === "unlimited"
          ? "当前权益不限量"
          : "未配置有效上限";
    recordUsage("allowed", `${input.detail ? `${input.detail}；` : ""}${bypassReason}`);
    return {
      allowed: true,
      benefit,
      limitValue,
      currentCount: input.currentCount,
      nextCount,
    };
  }

  if (nextCount > limitValue) {
    recordUsage("blocked", `${input.detail ? `${input.detail}；` : ""}超过当前权益上限`);
    throw new MemberBenefitAccessError(`${benefit.name}已达当前会员上限`, {
      code: "MEMBER_BENEFIT_QUOTA_EXCEEDED",
      status: 403,
      data: {
        benefitKey: input.benefitKey,
        benefitName: benefit.name,
        currentCount: input.currentCount,
        limitValue,
      },
    });
  }

  recordUsage("allowed");
  return {
    allowed: true,
    benefit,
    limitValue,
    currentCount: input.currentCount,
    nextCount,
  };
}

function resolveQuotaScopeFromBenefits(userId: string, levelCode: MemberLevelCode) {
  void userId;
  void levelCode;
  return "limited" as const;
}

function resolveReasonType(
  previousProfile: MemberUserProfileRecord,
  nextLevelCode: MemberLevelCode,
  fallbackReason?: MemberLevelChangeReasonType,
) {
  if (fallbackReason) {
    return fallbackReason;
  }

  const previousLevel = findLevelByCode(previousProfile.currentLevelCode);
  const nextLevel = findLevelByCode(nextLevelCode);
  if (!previousLevel || !nextLevel) {
    return "manual";
  }
  if (nextLevel.levelNumber > previousLevel.levelNumber) {
    return "upgrade";
  }
  if (nextLevel.levelNumber < previousLevel.levelNumber) {
    return "downgrade";
  }
  return "manual";
}

export function recalculateMemberProfile(userId: string, options?: MemberRecalculateOptions) {
  ensureMemberDefaults();
  const user = getAuthUser(userId);
  if (!user) {
    return null;
  }

  const previousProfile = ensureMemberProfile(userId);
  if (!previousProfile) {
    return null;
  }

  const timestamp = nowIso();
  expireGrowthRecordsForUser(userId, timestamp);
  expireBenefitGrantsForUser(userId, timestamp);

  const stats = getMemberGrowthStats(userId, timestamp);
  const rawLevel = getLevelForGrowthValue(stats.effectiveTotal);
  const previousLevel = findLevelByCode(previousProfile.currentLevelCode) ?? rawLevel;
  const config = getMemberConfigOrDefault();

  let manualLevelCode = previousProfile.manualLevelCode;
  let manualLevelExpireAt = previousProfile.manualLevelExpireAt;
  if (manualLevelCode && manualLevelExpireAt && manualLevelExpireAt <= timestamp) {
    manualLevelCode = null;
    manualLevelExpireAt = null;
  }

  let currentLevel = rawLevel;
  let memberStatus: MemberStatus = user.status === "banned" ? "frozen" : user.status === "merged" ? "merged" : "active";
  let graceStartAt: string | null = previousProfile.graceStartAt;
  let graceExpireAt: string | null = previousProfile.graceExpireAt;

  if (manualLevelCode) {
    currentLevel = findLevelByCode(manualLevelCode) ?? rawLevel;
    graceStartAt = null;
    graceExpireAt = null;
  } else if (previousLevel.levelNumber > rawLevel.levelNumber) {
    if (stats.effectiveTotal >= previousLevel.retainThreshold) {
      currentLevel = previousLevel;
      graceStartAt = null;
      graceExpireAt = null;
    } else {
      if (!graceStartAt || !graceExpireAt || graceExpireAt <= timestamp) {
        graceStartAt = timestamp;
        graceExpireAt = addDays(timestamp, config.gracePeriodDays);
      }
      if (graceExpireAt > timestamp) {
        currentLevel = previousLevel;
        memberStatus = user.status === "normal" ? "grace" : memberStatus;
      } else {
        currentLevel = rawLevel;
        graceStartAt = null;
        graceExpireAt = null;
      }
    }
  } else {
    currentLevel = rawLevel;
    graceStartAt = null;
    graceExpireAt = null;
  }

  const nextLevel = getEnabledLevels().find((item) => item.levelNumber === currentLevel.levelNumber + 1) ?? null;
  const nextProfile: MemberUserProfileRecord = {
    ...previousProfile,
    currentLevelCode: currentLevel.levelCode,
    currentLevelNumber: currentLevel.levelNumber,
    memberStatus,
    effectiveGrowthValue: stats.effectiveTotal,
    lifetimeGrowthValue: stats.lifetimeTotal,
    nextLevelCode: nextLevel?.levelCode ?? null,
    nextLevelGap: nextLevel ? Math.max(nextLevel.upgradeThreshold - stats.effectiveTotal, 0) : 0,
    lastLevelChangedAt:
      previousProfile.currentLevelCode !== currentLevel.levelCode ? timestamp : previousProfile.lastLevelChangedAt,
    graceStartAt,
    graceExpireAt,
    manualLevelCode,
    manualLevelExpireAt,
    quotaScopeSnapshot: resolveQuotaScopeFromBenefits(userId, currentLevel.levelCode),
    benefitSnapshotVersion: "v1",
    updatedAt: timestamp,
  };

  upsertMemberProfile(nextProfile);

  if (previousProfile.currentLevelCode !== nextProfile.currentLevelCode) {
    insertMemberLevelChangeLog({
      changeId: createId("mchg"),
      userId,
      fromLevelCode: previousProfile.currentLevelCode,
      toLevelCode: nextProfile.currentLevelCode,
      reasonType: resolveReasonType(previousProfile, nextProfile.currentLevelCode, options?.reasonType),
      reasonDetail: options?.reasonDetail ?? "等级自动重算",
      operatorId: options?.operatorId ?? null,
      createdAt: timestamp,
    });
  }

  syncMemberCompatFields(userId, nextProfile);
  return nextProfile;
}

export function ensureMemberSeedUser(userId: string) {
  const config = getMemberConfigOrDefault();
  const shouldAppendSeed = !config.seedUserIds.includes(userId);
  if (shouldAppendSeed) {
    setMemberConfig({
      ...config,
      seedUserIds: [...config.seedUserIds, userId],
      updatedAt: nowIso(),
    });
  }

  const profile = ensureMemberProfile(userId);
  if (!profile) {
    return null;
  }

  const shouldUpdateProfile =
    profile.manualLevelCode !== "L5" || profile.manualLevelExpireAt !== null || !profile.excludeFromMetrics;
  if (shouldUpdateProfile) {
    upsertMemberProfile({
      ...profile,
      manualLevelCode: "L5",
      manualLevelExpireAt: null,
      excludeFromMetrics: true,
      updatedAt: nowIso(),
    });

    insertMemberOperationLog({
      operateId: createId("mop"),
      userId,
      actionType: "seed_member_profile",
      detail: "标记为种子工作台用户并固定为 L5",
      operatorId: "system-seed",
      createdAt: nowIso(),
    });
  }

  return recalculateMemberProfile(userId, {
    reasonType: "seed",
    reasonDetail: "种子工作台用户初始化",
    operatorId: "system-seed",
  });
}

type GrantGrowthInput = {
  userId: string;
  eventType: string;
  sourceType?: MemberGrowthSourceType;
  sourceBizId?: string | null;
  idempotentKey: string;
  changeValue?: number;
  expireDays?: number | null;
  operatorId?: string | null;
  remark?: string | null;
};

export function grantGrowthForEvent(input: GrantGrowthInput) {
  ensureMemberDefaults();
  const config = getMemberConfigOrDefault();
  if (!config.memberGrowthEnabled && input.sourceType !== "manual" && input.sourceType !== "seed") {
    return {
      skipped: true,
      reason: "growth_disabled",
      profile: ensureMemberProfile(input.userId),
      record: null,
    };
  }

  const existing = getMemberGrowthRecordByIdempotentKey(input.idempotentKey);
  if (existing) {
    return {
      skipped: false,
      reason: "duplicate",
      profile: recalculateMemberProfile(input.userId),
      record: existing,
    };
  }

  const rule = listMemberGrowthRules().find((item) => item.eventType === input.eventType);
  const baseGrowthValue = input.changeValue ?? rule?.growthValue ?? 0;
  const sourceType = input.sourceType ?? (input.eventType === "manual_adjustment" ? "manual" : "rule");
  const timestamp = nowIso();
  const { startAt, endAt } = getDateWindow(timestamp);
  const dailyLimit = rule?.dailyLimit ?? null;
  const dailyTotal = dailyLimit !== null ? getDailyGrowthTotal(input.userId, input.eventType, startAt, endAt) : 0;

  let grantedValue = baseGrowthValue;
  if (dailyLimit !== null && baseGrowthValue > 0) {
    grantedValue = Math.max(Math.min(baseGrowthValue, dailyLimit - dailyTotal), 0);
  }

  const multiplier = grantedValue > 0 ? getGrowthMultiplierForUser(input.userId) : 1;
  const effectiveValue = grantedValue > 0 ? Math.round(grantedValue * multiplier) : grantedValue;
  const expireDays = input.expireDays ?? (grantedValue > 0 ? config.growthExpireDays : null);
  const record: MemberGrowthRecord = {
    growthId: createId("mg"),
    userId: input.userId,
    eventType: input.eventType,
    sourceType,
    sourceBizId: input.sourceBizId ?? null,
    idempotentKey: input.idempotentKey,
    changeValue: grantedValue,
    baseValue: baseGrowthValue,
    appliedMultiplier: multiplier,
    effectiveValue,
    status: "effective",
    expireAt: expireDays ? addDays(timestamp, expireDays) : null,
    reversedGrowthId: null,
    operatorId: input.operatorId ?? null,
    remark:
      grantedValue === 0 && dailyLimit !== null
        ? `${input.remark ?? ""}${input.remark ? "；" : ""}达到当日成长值上限`
        : (input.remark ?? null),
    createdAt: timestamp,
  };

  insertMemberGrowthRecord(record);
  const profile = recalculateMemberProfile(input.userId, {
    reasonType: sourceType === "seed" ? "seed" : undefined,
    reasonDetail: input.remark ?? rule?.name ?? "成长值结算",
    operatorId: input.operatorId ?? null,
  });

  return {
    skipped: false,
    reason: grantedValue === 0 ? "daily_limit_reached" : "granted",
    profile,
    record,
  };
}

export function getMemberCenterPayload(userId: string) {
  const profile = recalculateMemberProfile(userId);
  if (!profile) {
    return null;
  }

  const user = getAuthUser(userId);
  if (!user) {
    return null;
  }

  const level = findLevelByCode(profile.currentLevelCode) ?? getEnabledLevels()[0];
  const nextLevel = profile.nextLevelCode ? findLevelByCode(profile.nextLevelCode) : null;
  const effectiveBenefits = listEffectiveBenefitsForUser(userId);
  const pointsPayload = getPointsPayload(userId);

  return {
    user: {
      userId: user.userId,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      maskedPhone: getPrimaryPhone(userId) ? maskPhone(getPrimaryPhone(userId) ?? "") : null,
      certificationLabel: user.certificationLabel,
    },
    profile,
    level,
    nextLevel,
    levels: getEnabledLevels(),
    growthRules: listMemberGrowthRules().filter((item) => item.enabled),
    pointRules: listPointRules().filter((item) => item.enabled),
    pointsAccount: pointsPayload.account,
    pointRecords: pointsPayload.records,
    benefits: effectiveBenefits,
    grantedBenefits: listMemberBenefitGrantsByUserId(userId, 20),
    growthRecords: listMemberGrowthRecordsByUserId(userId, 20),
    levelChanges: listMemberLevelChangeLogsByUserId(userId, 20),
  };
}

function buildMemberUsersForAdmin(input?: {
  keyword?: string;
  levelCode?: MemberLevelCode | "";
  memberStatus?: MemberStatus | "";
}) {
  const keyword = input?.keyword?.trim().toLowerCase() || "";
  const levelCode = input?.levelCode?.trim() || "";
  const memberStatus = input?.memberStatus?.trim() || "";

  return listAuthUsers()
    .filter((user) => user.status !== "merged")
    .map((user) => {
      const profile = recalculateMemberProfile(user.userId) ?? ensureMemberProfile(user.userId);
      const level = profile ? findLevelByCode(profile.currentLevelCode) : null;
      const phone = getPrimaryPhone(user.userId);

      return {
        userId: user.userId,
        nickname: user.nickname,
        maskedPhone: phone ? maskPhone(phone) : null,
        status: user.status,
        memberStatus: profile?.memberStatus ?? "active",
        currentLevelCode: profile?.currentLevelCode ?? "L1",
        currentLevelNumber: profile?.currentLevelNumber ?? 1,
        currentLevelName: level?.name ?? "标准会员",
        effectiveGrowthValue: profile?.effectiveGrowthValue ?? 0,
        lifetimeGrowthValue: profile?.lifetimeGrowthValue ?? 0,
        availablePoints: recalculateUserPointsAccount(user.userId)?.availablePoints ?? 0,
        nextLevelGap: profile?.nextLevelGap ?? 0,
        quotaScopeSnapshot: profile?.quotaScopeSnapshot ?? "limited",
        excludeFromMetrics: profile?.excludeFromMetrics ?? false,
        lastLevelChangedAt: profile?.lastLevelChangedAt ?? null,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      } satisfies MemberUserListItem;
    })
    .filter((item) => (levelCode ? item.currentLevelCode === levelCode : true))
    .filter((item) => (memberStatus ? item.memberStatus === memberStatus : true))
    .filter((item) => {
      if (!keyword) {
        return true;
      }
      return (
        item.userId.toLowerCase().includes(keyword) ||
        item.nickname.toLowerCase().includes(keyword) ||
        (item.maskedPhone ?? "").toLowerCase().includes(keyword)
      );
    })
    .sort((left, right) => {
      if (right.currentLevelNumber !== left.currentLevelNumber) {
        return right.currentLevelNumber - left.currentLevelNumber;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
}

export function listMemberUsersForAdmin(input?: {
  keyword?: string;
  levelCode?: MemberLevelCode | "";
  memberStatus?: MemberStatus | "";
}) {
  return buildMemberUsersForAdmin(input);
}

export function listMemberUsersPageForAdmin(input?: {
  keyword?: string;
  levelCode?: MemberLevelCode | "";
  memberStatus?: MemberStatus | "";
  page?: number;
  pageSize?: number;
}): MemberUserListPage {
  const users = buildMemberUsersForAdmin(input);
  const pageSize = Math.min(Math.max(Math.trunc(input?.pageSize ?? 20), 1), 100);
  const total = users.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Math.max(Math.trunc(input?.page ?? 1), 1);
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    users: users.slice(startIndex, startIndex + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

export function getMemberUserDetailForAdmin(userId: string) {
  const summary = listMemberUsersForAdmin().find((item) => item.userId === userId);
  const profile = recalculateMemberProfile(userId) ?? ensureMemberProfile(userId);
  if (!summary || !profile) {
    return null;
  }

  return {
    summary,
    profile,
    level: findLevelByCode(profile.currentLevelCode) ?? getEnabledLevels()[0],
    pointsAccount: recalculateUserPointsAccount(userId),
    pointRecords: getPointsPayload(userId).records,
    effectiveBenefits: listEffectiveBenefitsForUser(userId),
    grantedBenefits: listMemberBenefitGrantsByUserId(userId, 20),
    benefitUsageRecords: listMemberBenefitUsageRecordsByUserId(userId, 20),
    growthRecords: listMemberGrowthRecordsByUserId(userId, 20),
    levelChanges: listMemberLevelChangeLogsByUserId(userId, 20),
    operationLogs: listMemberOperationLogsByUserId(userId, 20),
  } satisfies MemberUserDetail;
}

function resolveMemberCampaignTargetUsers(campaign: MemberCampaignRecord) {
  const users = listMemberUsersForAdmin().filter((item) => item.status === "normal");

  if (campaign.targetType === "all_metric_users") {
    return users.filter((item) => !item.excludeFromMetrics);
  }
  if (campaign.targetType === "levels") {
    const allowedLevels = new Set(campaign.targetLevelCodes);
    return users.filter((item) => allowedLevels.has(item.currentLevelCode));
  }
  const allowedUsers = new Set(campaign.targetUserIds);
  return users.filter((item) => allowedUsers.has(item.userId));
}

function formatCampaignGrantLabel(grantType: MemberCampaignGrantType) {
  switch (grantType) {
    case "growth":
      return "成长值";
    case "points":
      return "积分";
    case "benefit":
      return "权益";
    case "level":
      return "等级";
    default:
      return grantType;
  }
}

export function listMemberCampaignsForAdmin() {
  return listMemberCampaigns();
}

function formatCampaignTargetSummary(campaign: MemberCampaignRecord) {
  if (campaign.targetType === "all_metric_users") {
    return "全部统计用户";
  }
  if (campaign.targetType === "levels") {
    return `等级：${campaign.targetLevelCodes.join(" / ")}`;
  }
  return `指定用户：${campaign.targetUserIds.length} 人`;
}

function buildBenefitUsageStats(metricUsers: MemberUserListItem[], sinceAt: string) {
  const rows = db
    .prepare(
      `
        SELECT
          benefit_key,
          benefit_name,
          COUNT(*) AS hit_count,
          SUM(CASE WHEN result_status = 'allowed' THEN 1 ELSE 0 END) AS allowed_hit_count,
          SUM(CASE WHEN result_status = 'blocked' THEN 1 ELSE 0 END) AS blocked_hit_count,
          COUNT(DISTINCT CASE WHEN result_status = 'allowed' THEN user_id END) AS used_user_count
        FROM member_benefit_usage_records
        WHERE created_at >= ?
        GROUP BY benefit_key, benefit_name
        ORDER BY hit_count DESC, benefit_key ASC
        LIMIT 8
      `,
    )
    .all(sinceAt) as Array<{
    benefit_key?: string;
    benefit_name?: string;
    hit_count?: number;
    allowed_hit_count?: number;
    blocked_hit_count?: number;
    used_user_count?: number;
  }>;

  if (rows.length === 0) {
    return [] as MemberBenefitUsageStat[];
  }

  const eligibilityCounts = new Map<string, number>();
  const benefitKeys = new Set(rows.map((row) => String(row.benefit_key ?? "")));

  for (const user of metricUsers) {
    const effectiveBenefits = new Set(listEffectiveBenefitsForUser(user.userId).map((item) => item.benefitKey));
    for (const benefitKey of benefitKeys) {
      if (!effectiveBenefits.has(benefitKey)) {
        continue;
      }
      eligibilityCounts.set(benefitKey, (eligibilityCounts.get(benefitKey) ?? 0) + 1);
    }
  }

  return rows.map((row) => {
    const benefitKey = String(row.benefit_key ?? "");
    const eligibleUserCount = eligibilityCounts.get(benefitKey) ?? 0;
    const usedUserCount30d = Number(row.used_user_count ?? 0);
    return {
      benefitKey,
      benefitName: String(row.benefit_name ?? benefitKey),
      eligibleUserCount,
      usedUserCount30d,
      usageRate30d: eligibleUserCount > 0 ? Number((usedUserCount30d / eligibleUserCount).toFixed(4)) : 0,
      hitCount30d: Number(row.hit_count ?? 0),
      allowedHitCount30d: Number(row.allowed_hit_count ?? 0),
      blockedHitCount30d: Number(row.blocked_hit_count ?? 0),
    } satisfies MemberBenefitUsageStat;
  });
}

export function getMemberAdminDashboard() {
  const users = listMemberUsersForAdmin();
  const metricUsers = users.filter((item) => !item.excludeFromMetrics);
  const now = nowIso();
  const since7d = addDays(now, -7);
  const since30d = addDays(now, -30);
  const highLevelUsers = metricUsers.filter((item) => item.currentLevelNumber >= 4);
  const highLevelActiveUsers30d = highLevelUsers.filter(
    (item) => item.lastLoginAt && item.lastLoginAt >= since30d,
  ).length;
  const recentCampaigns = listMemberCampaigns().slice(0, 5);
  const recentExecutions = listMemberCampaignExecutionBatches(6);
  const recentExecutionResults = listMemberCampaignExecutionResults(12);
  const benefitUsage = buildBenefitUsageStats(metricUsers, since30d);

  return {
    overview: {
      totalUsers: users.length,
      metricUsers: metricUsers.length,
      memberPenetrationRate: users.length > 0 ? Number((metricUsers.length / users.length).toFixed(4)) : 0,
      highLevelUsers: highLevelUsers.length,
      frozenUsers: metricUsers.filter((item) => item.memberStatus === "frozen").length,
      graceUsers: metricUsers.filter((item) => item.memberStatus === "grace").length,
      unlimitedUsers: metricUsers.filter((item) => item.quotaScopeSnapshot === "unlimited").length,
      totalAvailablePoints: metricUsers.reduce((sum, item) => sum + item.availablePoints, 0),
      upgradeUsers7d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM member_level_change_logs
          WHERE reason_type = 'upgrade'
            AND created_at >= ?
        `,
        [since7d],
      ),
      downgradeUsers7d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM member_level_change_logs
          WHERE reason_type = 'downgrade'
            AND created_at >= ?
        `,
        [since7d],
      ),
      benefitGrantCount7d: querySingleNumber(
        `
          SELECT COUNT(*) AS value
          FROM member_benefit_grants
          WHERE created_at >= ?
        `,
        [since7d],
      ),
      benefitGrantUsers7d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM member_benefit_grants
          WHERE created_at >= ?
        `,
        [since7d],
      ),
      growthUsers30d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM member_growth_records
          WHERE created_at >= ?
            AND effective_value > 0
        `,
        [since30d],
      ),
      pointUsers30d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM user_point_records
          WHERE created_at >= ?
            AND change_value > 0
        `,
        [since30d],
      ),
      highLevelActiveUsers30d,
      highLevelActiveRate30d:
        highLevelUsers.length > 0 ? Number((highLevelActiveUsers30d / highLevelUsers.length).toFixed(4)) : 0,
      campaignExecutions7d: querySingleNumber(
        `
          SELECT COUNT(*) AS value
          FROM member_campaign_execution_batches
          WHERE created_at >= ?
        `,
        [since7d],
      ),
      totalBenefitHits30d: querySingleNumber(
        `
          SELECT COUNT(*) AS value
          FROM member_benefit_usage_records
          WHERE created_at >= ?
        `,
        [since30d],
      ),
      blockedBenefitHits30d: querySingleNumber(
        `
          SELECT COUNT(*) AS value
          FROM member_benefit_usage_records
          WHERE created_at >= ?
            AND result_status = 'blocked'
        `,
        [since30d],
      ),
      benefitUsedUsers30d: queryDistinctUserCount(
        `
          SELECT COUNT(DISTINCT user_id) AS value
          FROM member_benefit_usage_records
          WHERE created_at >= ?
            AND result_status = 'allowed'
        `,
        [since30d],
      ),
    },
    distribution: getEnabledLevels().map((level) => ({
      levelCode: level.levelCode,
      levelName: level.name,
      userCount: metricUsers.filter((item) => item.currentLevelCode === level.levelCode).length,
    })),
    recentCampaigns: recentCampaigns.map((item) => ({
      campaignId: item.campaignId,
      name: item.name,
      grantType: item.grantType,
      executionCount: item.executionCount,
      lastExecutedAt: item.lastExecutedAt,
      lastExecutedUserCount: item.lastExecutedUserCount,
      enabled: item.enabled,
    })),
    recentExecutions: recentExecutions.map((item) => ({
      batchId: item.batchId,
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      grantType: item.grantType,
      targetSummary: item.targetSummary,
      plannedUserCount: item.plannedUserCount,
      successUserCount: item.successUserCount,
      failedUserCount: item.failedUserCount,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      createdAt: item.createdAt,
    })),
    recentExecutionResults: recentExecutionResults.map((item) => ({
      resultId: item.resultId,
      batchId: item.batchId,
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      userId: item.userId,
      status: item.status,
      detail: item.detail,
      createdAt: item.createdAt,
    })),
    benefitUsage,
    levels: getEnabledLevels(),
    growthRules: listMemberGrowthRules().filter((item) => item.enabled),
    benefitDefinitions: listMemberBenefitDefinitions().filter((item) => item.enabled),
  };
}

export function adjustMemberLevelForAdmin(
  userId: string,
  input: { levelCode: MemberLevelCode | "auto"; effectiveDays?: number | null; reason: string },
  actor: { adminId: string },
) {
  const profile = ensureMemberProfile(userId);
  if (!profile) {
    return null;
  }

  upsertMemberProfile({
    ...profile,
    manualLevelCode: input.levelCode === "auto" ? null : input.levelCode,
    manualLevelExpireAt:
      input.levelCode === "auto" || !input.effectiveDays ? null : addDays(nowIso(), input.effectiveDays),
    updatedAt: nowIso(),
  });

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "adjust_member_level",
    detail:
      input.levelCode === "auto"
        ? `恢复规则等级：${input.reason}`
        : `手动调整等级为 ${input.levelCode}${input.effectiveDays ? `（${input.effectiveDays} 天）` : ""}：${input.reason}`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });

  return recalculateMemberProfile(userId, {
    reasonType: "manual",
    reasonDetail: input.reason,
    operatorId: actor.adminId,
  });
}

export function adjustMemberGrowthForAdmin(
  userId: string,
  input: { changeValue: number; reason: string },
  actor: { adminId: string },
) {
  const result = grantGrowthForEvent({
    userId,
    eventType: "manual_adjustment",
    sourceType: "manual",
    changeValue: input.changeValue,
    idempotentKey: `manual:${actor.adminId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    operatorId: actor.adminId,
    remark: input.reason,
  });

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "adjust_member_growth",
    detail: `手动调整成长值 ${input.changeValue > 0 ? "+" : ""}${input.changeValue}：${input.reason}`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });

  return result.profile;
}

export function adjustMemberPointsForAdmin(
  userId: string,
  input: { changeValue: number; reason: string },
  actor: { adminId: string },
) {
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "adjust_member_points",
    detail: `手动调整积分 ${input.changeValue > 0 ? "+" : ""}${input.changeValue}：${input.reason}`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });

  return adjustPointsForAdmin(userId, input, actor);
}

export function updateMemberSystemConfigForAdmin(
  input: {
    memberConfig: Pick<
      MemberConfigRecord,
      | "memberCenterEnabled"
      | "memberGrowthEnabled"
      | "memberBenefitEnforcementEnabled"
      | "memberAdminEnabled"
      | "growthExpireDays"
      | "gracePeriodDays"
    >;
    pointsConfig: Pick<PointsConfigRecord, "pointsEnabled" | "defaultExpireDays">;
  },
  actor: { adminId: string },
) {
  const timestamp = nowIso();
  const nextMemberConfig: MemberConfigRecord = {
    ...getMemberConfigOrDefault(),
    ...input.memberConfig,
    updatedAt: timestamp,
  };
  const nextPointsConfig: PointsConfigRecord = {
    ...getPointsConfigOrDefault(),
    ...input.pointsConfig,
    updatedAt: timestamp,
  };

  setMemberConfig(nextMemberConfig);
  setPointsConfig(nextPointsConfig);
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "update_member_system_config",
    detail: "更新会员与积分系统配置",
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  recalculateAllMemberProfiles("会员系统配置更新", actor.adminId);
  return listMemberRulesPayload();
}

export function updateMemberLevelsForAdmin(
  input: Array<
    Pick<MemberLevelRecord, "levelCode" | "name" | "upgradeThreshold" | "retainThreshold" | "badgeLabel" | "enabled">
  >,
  actor: { adminId: string },
) {
  const currentLevels = new Map(listMemberLevels().map((item) => [item.levelCode, item]));
  const timestamp = nowIso();

  for (const item of input) {
    const current = currentLevels.get(item.levelCode);
    if (!current) {
      continue;
    }
    upsertMemberLevel({
      ...current,
      ...item,
      updatedAt: timestamp,
    });
  }

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "update_member_levels",
    detail: `更新 ${input.length} 条会员等级规则`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  recalculateAllMemberProfiles("会员等级规则更新", actor.adminId);
  return listMemberRulesPayload();
}

export function updateMemberGrowthRulesForAdmin(
  input: Array<Pick<MemberGrowthRuleRecord, "ruleCode" | "growthValue" | "dailyLimit" | "enabled">>,
  actor: { adminId: string },
) {
  const currentRules = new Map(listMemberGrowthRules().map((item) => [item.ruleCode, item]));
  const timestamp = nowIso();

  for (const item of input) {
    const current = currentRules.get(item.ruleCode);
    if (!current) {
      continue;
    }
    upsertMemberGrowthRule({
      ...current,
      ...item,
      updatedAt: timestamp,
    });
  }

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "update_member_growth_rules",
    detail: `更新 ${input.length} 条成长规则`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  return listMemberRulesPayload();
}

export function updatePointRulesForAdmin(
  input: Array<Pick<PointRuleRecord, "ruleCode" | "pointValue" | "dailyLimit" | "enabled">>,
  actor: { adminId: string },
) {
  const currentRules = new Map(listPointRules().map((item) => [item.ruleCode, item]));
  const timestamp = nowIso();

  for (const item of input) {
    const current = currentRules.get(item.ruleCode);
    if (!current) {
      continue;
    }
    upsertPointRule({
      ...current,
      ...item,
      updatedAt: timestamp,
    });
  }

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "update_member_point_rules",
    detail: `更新 ${input.length} 条积分规则`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  return listMemberRulesPayload();
}

export function updateMemberBenefitMapsForAdmin(
  input: Array<Pick<MemberLevelBenefitMapRecord, "mapId" | "benefitValue" | "enabled">>,
  actor: { adminId: string },
) {
  const currentMaps = new Map(listMemberLevelBenefitMaps().map((item) => [item.mapId, item]));
  const timestamp = nowIso();

  for (const item of input) {
    const current = currentMaps.get(item.mapId);
    if (!current) {
      continue;
    }
    upsertMemberLevelBenefitMap({
      ...current,
      ...item,
      updatedAt: timestamp,
    });
  }

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "update_member_benefit_maps",
    detail: `更新 ${input.length} 条等级权益映射`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  recalculateAllMemberProfiles("会员权益规则更新", actor.adminId);
  return listMemberRulesPayload();
}

export function saveMemberCampaignForAdmin(
  input: Omit<
    MemberCampaignRecord,
    "campaignId" | "executionCount" | "lastExecutedAt" | "lastExecutedUserCount" | "createdAt" | "updatedAt"
  > & { campaignId?: string | null },
  actor: { adminId: string },
) {
  const timestamp = nowIso();
  const existing = input.campaignId ? getMemberCampaign(input.campaignId) : null;
  const campaign: MemberCampaignRecord = {
    campaignId: existing?.campaignId ?? createId("mcp"),
    name: input.name,
    enabled: input.enabled,
    targetType: input.targetType,
    targetLevelCodes: input.targetLevelCodes,
    targetUserIds: input.targetUserIds,
    grantType: input.grantType,
    growthValue: input.growthValue,
    pointsValue: input.pointsValue,
    benefitKey: input.benefitKey,
    benefitValue: input.benefitValue,
    levelCode: input.levelCode,
    effectiveDays: input.effectiveDays,
    remark: input.remark,
    executionCount: existing?.executionCount ?? 0,
    lastExecutedAt: existing?.lastExecutedAt ?? null,
    lastExecutedUserCount: existing?.lastExecutedUserCount ?? 0,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  upsertMemberCampaign(campaign);
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "save_member_campaign",
    detail: `保存活动「${campaign.name}」`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  return campaign;
}

function executeMemberCampaignForTargets(
  campaign: MemberCampaignRecord,
  targets: Array<Pick<MemberUserListItem, "userId">>,
  actor: { adminId: string },
  options?: { targetSummary?: string; batchId?: string; timestamp?: string },
) {
  const benefitDefinition =
    campaign.grantType === "benefit" && campaign.benefitKey
      ? listMemberBenefitDefinitions().find((item) => item.benefitKey === campaign.benefitKey)
      : null;
  const timestamp = options?.timestamp ?? nowIso();
  const batchId = options?.batchId ?? createId("mcex");
  let successUserCount = 0;
  let failedUserCount = 0;

  for (const target of targets) {
    let status: MemberCampaignExecutionResultRecord["status"] = "success";
    let detail = "";

    try {
      if (campaign.grantType === "growth" && campaign.growthValue) {
        grantGrowthForEvent({
          userId: target.userId,
          eventType: "campaign_bonus",
          sourceType: "campaign",
          sourceBizId: batchId,
          changeValue: campaign.growthValue,
          idempotentKey: `campaign:${campaign.campaignId}:${batchId}:growth:${target.userId}`,
          operatorId: actor.adminId,
          remark: appendBatchMarker(campaign.remark || campaign.name, batchId),
        });
        detail = `发放成长值 ${campaign.growthValue}`;
      } else if (campaign.grantType === "points" && campaign.pointsValue) {
        grantPointsForEvent({
          userId: target.userId,
          eventType: "campaign_bonus",
          sourceType: "campaign",
          sourceBizId: batchId,
          changeValue: campaign.pointsValue,
          idempotentKey: `campaign:${campaign.campaignId}:${batchId}:points:${target.userId}`,
          operatorId: actor.adminId,
          remark: appendBatchMarker(campaign.remark || campaign.name, batchId),
        });
        detail = `发放积分 ${campaign.pointsValue}`;
      } else if (campaign.grantType === "benefit" && benefitDefinition && campaign.benefitValue) {
        insertMemberBenefitGrant({
          grantId: createId("bgrant"),
          userId: target.userId,
          benefitKey: benefitDefinition.benefitKey,
          benefitName: benefitDefinition.name,
          sourceType: "campaign",
          sourceLevelCode: null,
          valueType: benefitDefinition.valueType,
          benefitValue: campaign.benefitValue,
          status: "active",
          startAt: timestamp,
          expireAt: campaign.effectiveDays ? addDays(timestamp, campaign.effectiveDays) : null,
          operatorId: actor.adminId,
          remark: appendBatchMarker(campaign.remark || campaign.name, batchId),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        recalculateMemberProfile(target.userId, {
          reasonDetail: `活动发放权益：${campaign.name}`,
          operatorId: actor.adminId,
        });
        detail = `发放权益 ${benefitDefinition.name}=${campaign.benefitValue}`;
      } else if (campaign.grantType === "level" && campaign.levelCode) {
        adjustMemberLevelForAdmin(
          target.userId,
          {
            levelCode: campaign.levelCode,
            effectiveDays: campaign.effectiveDays,
            reason: campaign.remark || `活动升级：${campaign.name}`,
          },
          actor,
        );
        detail = `调整等级到 ${campaign.levelCode}`;
      } else {
        status = "skipped";
        detail = "活动配置不完整，已跳过";
      }
    } catch (error) {
      status = "failed";
      detail = error instanceof Error ? error.message : "执行失败";
    }

    if (status === "success") {
      successUserCount += 1;
    } else {
      failedUserCount += 1;
    }

    insertMemberCampaignExecutionResult({
      resultId: createId("mcres"),
      batchId,
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      userId: target.userId,
      status,
      detail,
      createdAt: nowIso(),
    });
  }

  insertMemberCampaignExecutionBatch({
    batchId,
    campaignId: campaign.campaignId,
    campaignName: campaign.name,
    grantType: campaign.grantType,
    targetType: campaign.targetType,
    targetSummary: options?.targetSummary ?? formatCampaignTargetSummary(campaign),
    plannedUserCount: targets.length,
    successUserCount,
    failedUserCount,
    operatorId: actor.adminId,
    startedAt: timestamp,
    finishedAt: nowIso(),
    createdAt: timestamp,
  });

  return {
    batchId,
    successUserCount,
    failedUserCount,
  };
}

export function deleteMemberCampaignForAdmin(campaignId: string, actor: { adminId: string }) {
  const existing = getMemberCampaign(campaignId);
  if (!existing) {
    return false;
  }
  deleteMemberCampaign(campaignId);
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "delete_member_campaign",
    detail: `删除活动「${existing.name}」`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });
  return true;
}

export function executeMemberCampaignForAdmin(
  campaignId: string,
  actor: { adminId: string },
): MemberCampaignExecutionResult | null {
  const campaign = getMemberCampaign(campaignId);
  if (!campaign || !campaign.enabled) {
    return null;
  }

  const timestamp = nowIso();
  const targets = resolveMemberCampaignTargetUsers(campaign);
  const execution = executeMemberCampaignForTargets(campaign, targets, actor, { timestamp });

  const nextCampaign: MemberCampaignRecord = {
    ...campaign,
    executionCount: campaign.executionCount + 1,
    lastExecutedAt: timestamp,
    lastExecutedUserCount: execution.successUserCount,
    updatedAt: timestamp,
  };
  upsertMemberCampaign(nextCampaign);
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "execute_member_campaign",
    detail: `执行活动「${campaign.name}」，发放 ${formatCampaignGrantLabel(campaign.grantType)}，成功 ${execution.successUserCount} 人，失败 ${execution.failedUserCount} 人`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });
  return {
    campaign: nextCampaign,
    affectedUserCount: execution.successUserCount,
    failedUserCount: execution.failedUserCount,
    batchId: execution.batchId,
  };
}

export function getMemberCampaignExecutionDetailForAdmin(batchId: string): MemberCampaignExecutionDetail | null {
  const batch = getMemberCampaignExecutionBatch(batchId);
  if (!batch) {
    return null;
  }

  const usersById = new Map(listAuthUsers().map((item) => [item.userId, item]));
  const results = listMemberCampaignExecutionResultsByBatchId(batchId, 200).map((item) => {
    const user = usersById.get(item.userId);
    return {
      resultId: item.resultId,
      userId: item.userId,
      nickname: user?.nickname ?? item.userId,
      maskedPhone: user ? (getPrimaryPhone(item.userId) ? maskPhone(getPrimaryPhone(item.userId) ?? "") : null) : null,
      status: item.status,
      detail: item.detail,
      createdAt: item.createdAt,
    };
  });

  return {
    batch: {
      batchId: batch.batchId,
      campaignId: batch.campaignId,
      campaignName: batch.campaignName,
      grantType: batch.grantType,
      targetSummary: batch.targetSummary,
      plannedUserCount: batch.plannedUserCount,
      successUserCount: batch.successUserCount,
      failedUserCount: batch.failedUserCount,
      operatorId: batch.operatorId,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      createdAt: batch.createdAt,
    },
    campaign: getMemberCampaign(batch.campaignId) ?? null,
    results,
  };
}

export function retryFailedMemberCampaignExecutionBatchForAdmin(
  batchId: string,
  actor: { adminId: string },
): MemberCampaignExecutionResult | null {
  const batch = getMemberCampaignExecutionBatch(batchId);
  if (!batch) {
    return null;
  }
  const campaign = getMemberCampaign(batch.campaignId);
  if (!campaign || !campaign.enabled) {
    return null;
  }

  const failedTargets = listMemberCampaignExecutionResultsByBatchId(batchId, 500)
    .filter((item) => item.status === "failed")
    .map((item) => ({ userId: item.userId }));

  if (failedTargets.length === 0) {
    return {
      campaign,
      affectedUserCount: 0,
      failedUserCount: 0,
      batchId,
    };
  }

  const timestamp = nowIso();
  const execution = executeMemberCampaignForTargets(campaign, failedTargets, actor, {
    timestamp,
    targetSummary: `失败重试自批次 ${batchId}`,
  });

  const nextCampaign: MemberCampaignRecord = {
    ...campaign,
    executionCount: campaign.executionCount + 1,
    lastExecutedAt: timestamp,
    lastExecutedUserCount: execution.successUserCount,
    updatedAt: timestamp,
  };
  upsertMemberCampaign(nextCampaign);
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "retry_member_campaign_batch",
    detail: `重试活动批次 ${batchId} 的失败用户，成功 ${execution.successUserCount} 人，失败 ${execution.failedUserCount} 人`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });

  return {
    campaign: nextCampaign,
    affectedUserCount: execution.successUserCount,
    failedUserCount: execution.failedUserCount,
    batchId: execution.batchId,
  };
}

export function rollbackMemberCampaignExecutionBatchForAdmin(
  batchId: string,
  actor: { adminId: string },
): MemberCampaignExecutionResult | null {
  const batch = getMemberCampaignExecutionBatch(batchId);
  if (!batch) {
    return null;
  }
  const campaign = getMemberCampaign(batch.campaignId);
  if (!campaign) {
    return null;
  }
  if (campaign.grantType === "level") {
    throw new MemberBenefitAccessError("等级活动暂不支持整批回滚，请通过手动调级处理。", {
      code: "CAMPAIGN_ROLLBACK_UNSUPPORTED",
      status: 400,
    });
  }

  const rollbackTargets = listMemberCampaignExecutionResultsByBatchId(batchId, 1000)
    .filter((item) => item.status === "success")
    .map((item) => ({ userId: item.userId }));

  if (rollbackTargets.length === 0) {
    return {
      campaign,
      affectedUserCount: 0,
      failedUserCount: 0,
      batchId,
    };
  }

  const rollbackBatchId = createId("mcrollback");
  const timestamp = nowIso();
  let successUserCount = 0;
  let failedUserCount = 0;

  const growthRows =
    campaign.grantType === "growth"
      ? (db
          .prepare(
            `
              SELECT *
              FROM member_growth_records
              WHERE source_type = 'campaign'
                AND (
                  source_biz_id = ?
                  OR idempotent_key LIKE ?
                )
                AND effective_value > 0
                AND status = 'effective'
            `,
          )
          .all(batchId, `%:${batchId}:growth:%`) as Array<Record<string, unknown>>)
      : [];

  const pointRows =
    campaign.grantType === "points"
      ? (db
          .prepare(
            `
              SELECT *
              FROM user_point_records
              WHERE source_type = 'campaign'
                AND (
                  source_biz_id = ?
                  OR idempotent_key LIKE ?
                )
                AND change_value > 0
                AND status = 'effective'
            `,
          )
          .all(batchId, `%:${batchId}:points:%`) as Array<Record<string, unknown>>)
      : [];

  const growthRowsByUser = new Map<string, Array<Record<string, unknown>>>();
  for (const row of growthRows) {
    const userId = String(row.user_id ?? "");
    growthRowsByUser.set(userId, [...(growthRowsByUser.get(userId) ?? []), row]);
  }

  const pointRowsByUser = new Map<string, Array<Record<string, unknown>>>();
  for (const row of pointRows) {
    const userId = String(row.user_id ?? "");
    pointRowsByUser.set(userId, [...(pointRowsByUser.get(userId) ?? []), row]);
  }

  for (const target of rollbackTargets) {
    let status: MemberCampaignExecutionResultRecord["status"] = "success";
    let detail = "";

    try {
      if (campaign.grantType === "growth") {
        const rows = growthRowsByUser.get(target.userId) ?? [];
        for (const row of rows) {
          const growthId = String(row.growth_id ?? "");
          const value = Number(row.effective_value ?? 0);
          grantGrowthForEvent({
            userId: target.userId,
            eventType: "manual_adjustment",
            sourceType: "campaign",
            sourceBizId: rollbackBatchId,
            changeValue: -Math.abs(value),
            idempotentKey: `campaign_rollback:${batchId}:${growthId}`,
            operatorId: actor.adminId,
            expireDays: null,
            remark: appendBatchMarker(`回滚活动批次 ${batchId}`, rollbackBatchId),
          });
        }
        detail = `回滚成长值 ${rows.reduce((sum, row) => sum + Number(row.effective_value ?? 0), 0)}`;
      } else if (campaign.grantType === "points") {
        const rows = pointRowsByUser.get(target.userId) ?? [];
        for (const row of rows) {
          const pointId = String(row.point_id ?? "");
          const value = Number(row.change_value ?? 0);
          grantPointsForEvent({
            userId: target.userId,
            eventType: "manual_adjustment",
            sourceType: "campaign",
            sourceBizId: rollbackBatchId,
            changeValue: -Math.abs(value),
            idempotentKey: `campaign_rollback:${batchId}:${pointId}`,
            operatorId: actor.adminId,
            expireDays: null,
            remark: appendBatchMarker(`回滚活动批次 ${batchId}`, rollbackBatchId),
          });
        }
        detail = `回滚积分 ${rows.reduce((sum, row) => sum + Number(row.change_value ?? 0), 0)}`;
      } else if (campaign.grantType === "benefit") {
        const grants = listMemberBenefitGrantsByUserId(target.userId, 200).filter(
          (item) =>
            item.status === "active" &&
            item.sourceType === "campaign" &&
            (item.remark ?? "").includes(`[batch:${batchId}]`),
        );
        for (const grant of grants) {
          revokeMemberBenefitGrant(grant.grantId, timestamp);
        }
        recalculateMemberProfile(target.userId, {
          reasonDetail: `回滚活动批次 ${batchId}`,
          operatorId: actor.adminId,
        });
        detail = `撤回权益 ${grants.length} 项`;
      } else {
        status = "skipped";
        detail = "当前活动类型不支持回滚";
      }
    } catch (error) {
      status = "failed";
      detail = error instanceof Error ? error.message : "回滚失败";
    }

    if (status === "success") {
      successUserCount += 1;
    } else {
      failedUserCount += 1;
    }

    insertMemberCampaignExecutionResult({
      resultId: createId("mcres"),
      batchId: rollbackBatchId,
      campaignId: campaign.campaignId,
      campaignName: `${campaign.name}（回滚）`,
      userId: target.userId,
      status,
      detail,
      createdAt: nowIso(),
    });
  }

  insertMemberCampaignExecutionBatch({
    batchId: rollbackBatchId,
    campaignId: campaign.campaignId,
    campaignName: `${campaign.name}（回滚）`,
    grantType: campaign.grantType,
    targetType: batch.targetType,
    targetSummary: `回滚批次 ${batchId}`,
    plannedUserCount: rollbackTargets.length,
    successUserCount,
    failedUserCount,
    operatorId: actor.adminId,
    startedAt: timestamp,
    finishedAt: nowIso(),
    createdAt: timestamp,
  });
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: null,
    actionType: "rollback_member_campaign_batch",
    detail: `回滚活动批次 ${batchId}，成功 ${successUserCount} 人，失败 ${failedUserCount} 人`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });

  return {
    campaign,
    affectedUserCount: successUserCount,
    failedUserCount,
    batchId: rollbackBatchId,
  };
}

export function grantBenefitForAdmin(
  userId: string,
  input: { benefitKey: string; benefitValue: string; reason: string; effectiveDays?: number | null },
  actor: { adminId: string },
) {
  const definition = listMemberBenefitDefinitions().find((item) => item.benefitKey === input.benefitKey);
  if (!definition) {
    return null;
  }

  const timestamp = nowIso();
  insertMemberBenefitGrant({
    grantId: createId("bgrant"),
    userId,
    benefitKey: definition.benefitKey,
    benefitName: definition.name,
    sourceType: "manual",
    sourceLevelCode: null,
    valueType: definition.valueType,
    benefitValue: input.benefitValue,
    status: "active",
    startAt: timestamp,
    expireAt: input.effectiveDays ? addDays(timestamp, input.effectiveDays) : null,
    operatorId: actor.adminId,
    remark: input.reason,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "grant_member_benefit",
    detail: `发放权益 ${definition.name}=${input.benefitValue}${input.effectiveDays ? `（${input.effectiveDays} 天）` : ""}：${input.reason}`,
    operatorId: actor.adminId,
    createdAt: timestamp,
  });

  return getMemberUserDetailForAdmin(userId);
}

export function revokeBenefitGrantForAdmin(
  userId: string,
  input: { grantId: string; reason: string },
  actor: { adminId: string },
) {
  const grant = getMemberBenefitGrant(input.grantId);
  if (!grant || grant.userId !== userId) {
    return null;
  }
  if (grant.status !== "active") {
    return getMemberUserDetailForAdmin(userId);
  }

  revokeMemberBenefitGrant(grant.grantId, nowIso());
  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "revoke_member_benefit",
    detail: `撤回权益 ${grant.benefitName}：${input.reason}`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });
  recalculateMemberProfile(userId, {
    reasonDetail: `撤回权益：${grant.benefitName}`,
    operatorId: actor.adminId,
  });

  return getMemberUserDetailForAdmin(userId);
}

export function transferMemberDataOnMerge(sourceUserId: string, targetUserId: string) {
  ensureMemberDefaults();
  transferMemberUserId(sourceUserId, targetUserId);

  const sourceProfile = ensureMemberProfile(sourceUserId);
  const targetProfile = ensureMemberProfile(targetUserId);
  if (sourceProfile) {
    upsertMemberProfile({
      ...sourceProfile,
      memberStatus: "merged",
      updatedAt: nowIso(),
    });
  }
  if (targetProfile) {
    upsertMemberProfile({
      ...targetProfile,
      updatedAt: nowIso(),
    });
  }

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: targetUserId,
    actionType: "merge_member_data",
    detail: `接收来源账号 ${sourceUserId} 的会员数据`,
    operatorId: "system-merge",
    createdAt: nowIso(),
  });

  return recalculateMemberProfile(targetUserId, {
    reasonType: "merge",
    reasonDetail: `合并来源账号 ${sourceUserId}`,
    operatorId: "system-merge",
  });
}

export function syncMemberStateForUserStatus(userId: string, reasonDetail: string, operatorId?: string | null) {
  const profile = recalculateMemberProfile(userId, {
    reasonType: operatorId ? "manual" : undefined,
    reasonDetail,
    operatorId: operatorId ?? null,
  });

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId,
    actionType: "sync_member_state",
    detail: reasonDetail,
    operatorId: operatorId ?? null,
    createdAt: nowIso(),
  });

  return profile;
}

export function isMemberCenterEnabled() {
  return getMemberConfigOrDefault().memberCenterEnabled;
}

export function isMemberAdminEnabled() {
  return getMemberConfigOrDefault().memberAdminEnabled;
}

export function listPublicMemberRulesPayload() {
  const enabledLevels = getEnabledLevels();
  const enabledLevelCodes = new Set(enabledLevels.map((item) => item.levelCode));
  const enabledBenefitDefinitions = listMemberBenefitDefinitions().filter((item) => item.enabled);
  const enabledBenefitKeys = new Set(enabledBenefitDefinitions.map((item) => item.benefitKey));
  const memberConfig = getMemberConfigOrDefault();
  const pointsConfig = getPointsConfigOrDefault();

  return {
    levels: enabledLevels,
    growthRules: listMemberGrowthRules().filter((item) => item.enabled),
    benefitDefinitions: enabledBenefitDefinitions,
    pointRules: listPointRules().filter((item) => item.enabled),
    levelBenefitMaps: listMemberLevelBenefitMaps().filter(
      (item) => item.enabled && enabledLevelCodes.has(item.levelCode) && enabledBenefitKeys.has(item.benefitKey),
    ),
    config: {
      memberCenterEnabled: memberConfig.memberCenterEnabled,
      growthExpireDays: memberConfig.growthExpireDays,
      gracePeriodDays: memberConfig.gracePeriodDays,
    },
    pointsConfig: {
      pointsEnabled: pointsConfig.pointsEnabled,
      defaultExpireDays: pointsConfig.defaultExpireDays,
    },
  };
}

export function listMemberRulesPayload() {
  return {
    levels: listMemberLevels(),
    growthRules: listMemberGrowthRules(),
    benefitDefinitions: listMemberBenefitDefinitions(),
    pointRules: listPointRules(),
    levelBenefitMaps: listMemberLevelBenefitMaps(),
    config: getMemberConfigOrDefault(),
    pointsConfig: getPointsConfigOrDefault(),
  };
}

export function buildMemberLogExportForAdmin(
  input: {
    logType: MemberExportLogType;
    userId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    batchId?: string | null;
    status?: string | null;
  },
  actor: { adminId: string },
) {
  const params: Array<string | number> = [];
  const conditions: string[] = [];
  const startAt = normalizeDateBoundary(input.startDate, "start");
  const endAt = normalizeDateBoundary(input.endDate, "end");
  const userMap = new Map(listAuthUsers().map((item) => [item.userId, item]));

  if (input.userId?.trim()) {
    conditions.push("user_id = ?");
    params.push(input.userId.trim());
  }
  if (startAt) {
    conditions.push("created_at >= ?");
    params.push(startAt);
  }
  if (endAt) {
    conditions.push("created_at <= ?");
    params.push(endAt);
  }

  let sql = "";
  let headers: string[] = [];
  let filePrefix = "";

  if (input.logType === "growth") {
    sql = `
      SELECT user_id, event_type, source_type, source_biz_id, effective_value, status, expire_at, remark, created_at
      FROM member_growth_records
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    headers = [
      "user_id",
      "昵称",
      "手机号",
      "事件",
      "来源",
      "source_biz_id",
      "成长值",
      "状态",
      "失效时间",
      "备注",
      "创建时间",
    ];
    filePrefix = "member-growth";
  } else if (input.logType === "points") {
    sql = `
      SELECT user_id, event_type, source_type, source_biz_id, change_value, status, expire_at, remark, created_at
      FROM user_point_records
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    headers = [
      "user_id",
      "昵称",
      "手机号",
      "事件",
      "来源",
      "source_biz_id",
      "积分",
      "状态",
      "失效时间",
      "备注",
      "创建时间",
    ];
    filePrefix = "member-points";
  } else if (input.logType === "benefit_grants") {
    if (input.status?.trim()) {
      conditions.push("status = ?");
      params.push(input.status.trim());
    }
    sql = `
      SELECT user_id, benefit_name, benefit_key, benefit_value, status, source_type, expire_at, remark, created_at
      FROM member_benefit_grants
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    headers = [
      "user_id",
      "昵称",
      "手机号",
      "权益名",
      "权益key",
      "权益值",
      "状态",
      "来源",
      "失效时间",
      "备注",
      "创建时间",
    ];
    filePrefix = "member-benefit-grants";
  } else if (input.logType === "benefit_usage") {
    if (input.status?.trim()) {
      conditions.push("result_status = ?");
      params.push(input.status.trim());
    }
    sql = `
      SELECT user_id, benefit_name, benefit_key, source_biz_type, current_count, next_count, limit_value, result_status, detail, created_at
      FROM member_benefit_usage_records
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    headers = [
      "user_id",
      "昵称",
      "手机号",
      "权益名",
      "权益key",
      "业务类型",
      "当前值",
      "目标值",
      "上限",
      "结果",
      "详情",
      "创建时间",
    ];
    filePrefix = "member-benefit-usage";
  } else {
    if (input.batchId?.trim()) {
      conditions.push("batch_id = ?");
      params.push(input.batchId.trim());
    }
    if (input.status?.trim()) {
      conditions.push("status = ?");
      params.push(input.status.trim());
    }
    sql = `
      SELECT batch_id, campaign_name, user_id, status, detail, created_at
      FROM member_campaign_execution_results
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    headers = ["batch_id", "活动名称", "user_id", "昵称", "手机号", "状态", "详情", "创建时间"];
    filePrefix = "member-campaign-results";
  }

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const csvRows = rows.map((row) => {
    const userId = row.user_id ? String(row.user_id) : "";
    const user = userId ? userMap.get(userId) : null;
    const maskedPhone = userId ? (getPrimaryPhone(userId) ? maskPhone(getPrimaryPhone(userId) ?? "") : "") : "";

    if (input.logType === "growth") {
      return [
        row.user_id,
        user?.nickname ?? "",
        maskedPhone,
        row.event_type,
        row.source_type,
        row.source_biz_id ?? "",
        row.effective_value,
        row.status,
        row.expire_at ?? "",
        row.remark ?? "",
        row.created_at,
      ];
    }
    if (input.logType === "points") {
      return [
        row.user_id,
        user?.nickname ?? "",
        maskedPhone,
        row.event_type,
        row.source_type,
        row.source_biz_id ?? "",
        row.change_value,
        row.status,
        row.expire_at ?? "",
        row.remark ?? "",
        row.created_at,
      ];
    }
    if (input.logType === "benefit_grants") {
      return [
        row.user_id,
        user?.nickname ?? "",
        maskedPhone,
        row.benefit_name,
        row.benefit_key,
        row.benefit_value,
        row.status,
        row.source_type,
        row.expire_at ?? "",
        row.remark ?? "",
        row.created_at,
      ];
    }
    if (input.logType === "benefit_usage") {
      return [
        row.user_id,
        user?.nickname ?? "",
        maskedPhone,
        row.benefit_name,
        row.benefit_key,
        row.source_biz_type ?? "",
        row.current_count,
        row.next_count,
        row.limit_value ?? "",
        row.result_status,
        row.detail ?? "",
        row.created_at,
      ];
    }
    return [
      row.batch_id,
      row.campaign_name,
      row.user_id,
      user?.nickname ?? "",
      maskedPhone,
      row.status,
      row.detail,
      row.created_at,
    ];
  });

  insertMemberOperationLog({
    operateId: createId("mop"),
    userId: input.userId?.trim() || null,
    actionType: "export_member_logs",
    detail: `导出会员日志 ${input.logType}，共 ${csvRows.length} 条`,
    operatorId: actor.adminId,
    createdAt: nowIso(),
  });

  const csv = [headers, ...csvRows]
    .map((row) => row.map((cell) => toCsvCell(cell as string | number | boolean | null | undefined)).join(","))
    .join("\n");

  return {
    csv: `\uFEFF${csv}`,
    fileName: `${filePrefix}-${Date.now()}.csv`,
    total: csvRows.length,
  };
}
