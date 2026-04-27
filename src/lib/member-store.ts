import { db, dbDelete, dbGet, dbGetAll, dbGetSingleton, dbSetSingleton, dbUpsert } from "./db";

export type MemberLevelCode = "L1" | "L2" | "L3" | "L4" | "L5";
export type MemberStatus = "active" | "grace" | "frozen" | "merged";
export type BenefitValueType = "number" | "string" | "boolean";
export type BenefitConflictPolicy = "max" | "best" | "or" | "manual_first";
export type MemberGrowthSourceType = "system" | "rule" | "campaign" | "manual" | "merge" | "seed" | "benefit";
export type MemberGrowthStatus = "effective" | "expired" | "reversed";
export type MemberBenefitGrantStatus = "active" | "expired" | "revoked";
export type MemberBenefitUsageStatus = "allowed" | "blocked";
export type MemberLevelChangeReasonType =
  | "init"
  | "upgrade"
  | "downgrade"
  | "manual"
  | "freeze"
  | "unfreeze"
  | "merge"
  | "seed";

export type MemberLevelRecord = {
  levelCode: MemberLevelCode;
  levelNumber: number;
  name: string;
  description: string;
  upgradeThreshold: number;
  retainThreshold: number;
  badgeLabel: string;
  themeTone: "neutral" | "info" | "success" | "warning" | "danger";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemberGrowthRuleRecord = {
  ruleCode: string;
  eventType: string;
  name: string;
  growthValue: number;
  dailyLimit: number | null;
  enabled: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type MemberBenefitDefinitionRecord = {
  benefitKey: string;
  name: string;
  category: "identity" | "function" | "content" | "activity" | "service" | "price" | "acceleration";
  valueType: BenefitValueType;
  unit: string | null;
  description: string;
  conflictPolicy: BenefitConflictPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemberLevelBenefitMapRecord = {
  mapId: string;
  levelCode: MemberLevelCode;
  benefitKey: string;
  benefitValue: string | number | boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemberUserProfileRecord = {
  userId: string;
  currentLevelCode: MemberLevelCode;
  currentLevelNumber: number;
  memberStatus: MemberStatus;
  effectiveGrowthValue: number;
  lifetimeGrowthValue: number;
  nextLevelCode: MemberLevelCode | null;
  nextLevelGap: number;
  lastLevelChangedAt: string | null;
  graceStartAt: string | null;
  graceExpireAt: string | null;
  manualLevelCode: MemberLevelCode | null;
  manualLevelExpireAt: string | null;
  quotaScopeSnapshot: "limited" | "unlimited";
  benefitSnapshotVersion: string;
  excludeFromMetrics: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemberConfigRecord = {
  memberCenterEnabled: boolean;
  memberGrowthEnabled: boolean;
  memberBenefitEnforcementEnabled: boolean;
  memberAdminEnabled: boolean;
  growthExpireDays: number;
  gracePeriodDays: number;
  seedUserIds: string[];
  excludedUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemberGrowthRecord = {
  growthId: string;
  userId: string;
  eventType: string;
  sourceType: MemberGrowthSourceType;
  sourceBizId: string | null;
  idempotentKey: string;
  changeValue: number;
  baseValue: number;
  appliedMultiplier: number;
  effectiveValue: number;
  status: MemberGrowthStatus;
  expireAt: string | null;
  reversedGrowthId: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
};

export type MemberBenefitGrantRecord = {
  grantId: string;
  userId: string;
  benefitKey: string;
  benefitName: string;
  sourceType: MemberGrowthSourceType;
  sourceLevelCode: MemberLevelCode | null;
  valueType: BenefitValueType;
  benefitValue: string;
  status: MemberBenefitGrantStatus;
  startAt: string;
  expireAt: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemberLevelChangeLogRecord = {
  changeId: string;
  userId: string;
  fromLevelCode: MemberLevelCode | null;
  toLevelCode: MemberLevelCode;
  reasonType: MemberLevelChangeReasonType;
  reasonDetail: string;
  operatorId: string | null;
  createdAt: string;
};

export type MemberOperationLogRecord = {
  operateId: string;
  userId: string | null;
  actionType: string;
  detail: string;
  operatorId: string | null;
  createdAt: string;
};

export type MemberCampaignTargetType = "all_metric_users" | "levels" | "user_ids";
export type MemberCampaignGrantType = "growth" | "points" | "benefit" | "level";
export type MemberCampaignExecutionResultStatus = "success" | "failed" | "skipped";

export type MemberCampaignRecord = {
  campaignId: string;
  name: string;
  enabled: boolean;
  targetType: MemberCampaignTargetType;
  targetLevelCodes: MemberLevelCode[];
  targetUserIds: string[];
  grantType: MemberCampaignGrantType;
  growthValue: number | null;
  pointsValue: number | null;
  benefitKey: string | null;
  benefitValue: string | null;
  levelCode: MemberLevelCode | null;
  effectiveDays: number | null;
  remark: string;
  executionCount: number;
  lastExecutedAt: string | null;
  lastExecutedUserCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemberCampaignExecutionBatchRecord = {
  batchId: string;
  campaignId: string;
  campaignName: string;
  grantType: MemberCampaignGrantType;
  targetType: MemberCampaignTargetType;
  targetSummary: string;
  plannedUserCount: number;
  successUserCount: number;
  failedUserCount: number;
  operatorId: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type MemberCampaignExecutionResultRecord = {
  resultId: string;
  batchId: string;
  campaignId: string;
  campaignName: string;
  userId: string;
  status: MemberCampaignExecutionResultStatus;
  detail: string;
  createdAt: string;
};

export type MemberBenefitUsageRecord = {
  usageId: string;
  userId: string;
  benefitKey: string;
  benefitName: string;
  usageType: "quota_check";
  sourceBizType: string | null;
  sourceBizId: string | null;
  currentCount: number;
  increment: number;
  nextCount: number;
  limitValue: string | null;
  resultStatus: MemberBenefitUsageStatus;
  detail: string | null;
  createdAt: string;
};

const MEMBER_LEVEL_COLLECTION = "member-levels";
const MEMBER_GROWTH_RULE_COLLECTION = "member-growth-rules";
const MEMBER_BENEFIT_COLLECTION = "member-benefits";
const MEMBER_LEVEL_BENEFIT_MAP_COLLECTION = "member-level-benefit-maps";
const MEMBER_PROFILE_COLLECTION = "member-user-profiles";
const MEMBER_CONFIG_COLLECTION = "member-config";
const MEMBER_CAMPAIGN_COLLECTION = "member-campaigns";

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

export function ensureMemberSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_growth_records (
      growth_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_biz_id TEXT,
      idempotent_key TEXT NOT NULL,
      change_value INTEGER NOT NULL,
      base_value INTEGER NOT NULL,
      applied_multiplier REAL NOT NULL DEFAULT 1,
      effective_value INTEGER NOT NULL,
      status TEXT NOT NULL,
      expire_at TEXT,
      reversed_growth_id TEXT,
      operator_id TEXT,
      remark TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_member_growth_idempotent
      ON member_growth_records (idempotent_key);

    CREATE INDEX IF NOT EXISTS idx_member_growth_user_created
      ON member_growth_records (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_member_growth_user_status_expire
      ON member_growth_records (user_id, status, expire_at);

    CREATE TABLE IF NOT EXISTS member_benefit_grants (
      grant_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      benefit_key TEXT NOT NULL,
      benefit_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_level_code TEXT,
      value_type TEXT NOT NULL,
      benefit_value TEXT NOT NULL,
      status TEXT NOT NULL,
      start_at TEXT NOT NULL,
      expire_at TEXT,
      operator_id TEXT,
      remark TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_benefit_grants_user_created
      ON member_benefit_grants (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_member_benefit_grants_user_status
      ON member_benefit_grants (user_id, status, expire_at);

    CREATE TABLE IF NOT EXISTS member_level_change_logs (
      change_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_level_code TEXT,
      to_level_code TEXT NOT NULL,
      reason_type TEXT NOT NULL,
      reason_detail TEXT NOT NULL,
      operator_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_level_change_logs_user_created
      ON member_level_change_logs (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS member_operation_logs (
      operate_id TEXT PRIMARY KEY,
      user_id TEXT,
      action_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      operator_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_operation_logs_user_created
      ON member_operation_logs (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS member_campaign_execution_batches (
      batch_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      grant_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_summary TEXT NOT NULL,
      planned_user_count INTEGER NOT NULL,
      success_user_count INTEGER NOT NULL,
      failed_user_count INTEGER NOT NULL,
      operator_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_campaign_execution_batches_created
      ON member_campaign_execution_batches (created_at DESC);

    CREATE TABLE IF NOT EXISTS member_campaign_execution_results (
      result_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_campaign_execution_results_batch_created
      ON member_campaign_execution_results (batch_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_member_campaign_execution_results_user_created
      ON member_campaign_execution_results (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS member_benefit_usage_records (
      usage_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      benefit_key TEXT NOT NULL,
      benefit_name TEXT NOT NULL,
      usage_type TEXT NOT NULL,
      source_biz_type TEXT,
      source_biz_id TEXT,
      current_count INTEGER NOT NULL,
      increment INTEGER NOT NULL,
      next_count INTEGER NOT NULL,
      limit_value TEXT,
      result_status TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_member_benefit_usage_records_user_created
      ON member_benefit_usage_records (user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_member_benefit_usage_records_benefit_created
      ON member_benefit_usage_records (benefit_key, created_at DESC);
  `);

  initialized = true;
}

function buildDefaultLevels() {
  const timestamp = nowIso();
  return [
    {
      levelCode: "L1",
      levelNumber: 1,
      name: "标准会员",
      description: "新注册与基础使用用户",
      upgradeThreshold: 0,
      retainThreshold: 0,
      badgeLabel: "标准",
      themeTone: "neutral",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      levelCode: "L2",
      levelNumber: 2,
      name: "优享会员",
      description: "稳定活跃的轻度创作者",
      upgradeThreshold: 200,
      retainThreshold: 120,
      badgeLabel: "优享",
      themeTone: "info",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      levelCode: "L3",
      levelNumber: 3,
      name: "专业会员",
      description: "持续使用核心创作链路的主力用户",
      upgradeThreshold: 800,
      retainThreshold: 500,
      badgeLabel: "专业",
      themeTone: "success",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      levelCode: "L4",
      levelNumber: 4,
      name: "旗舰会员",
      description: "高频活跃的高级用户",
      upgradeThreshold: 2000,
      retainThreshold: 1400,
      badgeLabel: "旗舰",
      themeTone: "warning",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      levelCode: "L5",
      levelNumber: 5,
      name: "黑金会员",
      description: "高价值/企业/白名单级用户",
      upgradeThreshold: 5000,
      retainThreshold: 3800,
      badgeLabel: "黑金",
      themeTone: "danger",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies MemberLevelRecord[];
}

function buildDefaultGrowthRules() {
  const timestamp = nowIso();
  return [
    {
      ruleCode: "register_success",
      eventType: "register_success",
      name: "注册成功",
      growthValue: 50,
      dailyLimit: null,
      enabled: true,
      description: "用户首次注册成功时发放",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "daily_login",
      eventType: "daily_login",
      name: "每日首次登录",
      growthValue: 5,
      dailyLimit: 5,
      enabled: true,
      description: "按用户当日首次登录发放",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "product_archive_create",
      eventType: "product_archive_create",
      name: "创建商品档案",
      growthValue: 10,
      dailyLimit: 20,
      enabled: true,
      description: "创建新的商品档案成功时发放",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "video_material_create",
      eventType: "video_material_create",
      name: "创建视频素材",
      growthValue: 15,
      dailyLimit: 45,
      enabled: true,
      description: "创建新的视频素材记录成功时发放",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "video_task_create",
      eventType: "video_task_create",
      name: "创建视频任务",
      growthValue: 20,
      dailyLimit: 60,
      enabled: true,
      description: "创建新的视频任务成功时发放",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "manual_adjustment",
      eventType: "manual_adjustment",
      name: "人工调整",
      growthValue: 0,
      dailyLimit: null,
      enabled: true,
      description: "后台人工补偿或扣减",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      ruleCode: "campaign_bonus",
      eventType: "campaign_bonus",
      name: "活动赠送",
      growthValue: 0,
      dailyLimit: null,
      enabled: true,
      description: "运营活动补偿或限时赠送",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies MemberGrowthRuleRecord[];
}

function buildDefaultBenefitDefinitions() {
  const timestamp = nowIso();
  return [
    {
      benefitKey: "growth_multiplier",
      name: "成长加速",
      category: "acceleration",
      valueType: "number",
      unit: "x",
      description: "成长值结算倍率",
      conflictPolicy: "max",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "daily_video_tasks",
      name: "每日视频任务额度",
      category: "function",
      valueType: "string",
      unit: "次/日",
      description: "每日创建视频任务的额度上限",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "video_material_limit",
      name: "视频素材额度",
      category: "function",
      valueType: "string",
      unit: "条",
      description: "可管理的视频素材数量上限",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "product_archive_limit",
      name: "商品档案额度",
      category: "function",
      valueType: "string",
      unit: "条",
      description: "可管理的商品档案数量上限",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "voice_clone_limit",
      name: "音色复刻额度",
      category: "function",
      valueType: "string",
      unit: "个",
      description: "可创建的音色复刻数量上限",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "template_pack",
      name: "模板包",
      category: "content",
      valueType: "string",
      unit: null,
      description: "可使用的专属模板包档位",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "activity_priority",
      name: "活动优先级",
      category: "activity",
      valueType: "string",
      unit: null,
      description: "参与活动和内测的优先级",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      benefitKey: "support_priority",
      name: "支持优先级",
      category: "service",
      valueType: "string",
      unit: null,
      description: "高等级用户支持与补偿优先级",
      conflictPolicy: "best",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ] satisfies MemberBenefitDefinitionRecord[];
}

function buildDefaultLevelBenefitMaps() {
  const timestamp = nowIso();
  const rows: Array<[MemberLevelCode, string, string | number | boolean]> = [
    ["L1", "growth_multiplier", 1],
    ["L1", "daily_video_tasks", "按积分结算"],
    ["L1", "video_material_limit", "按积分结算"],
    ["L1", "product_archive_limit", "按积分结算"],
    ["L1", "voice_clone_limit", "按积分结算"],
    ["L1", "template_pack", "无"],
    ["L1", "activity_priority", "标准"],
    ["L1", "support_priority", "标准"],
    ["L2", "growth_multiplier", 1.05],
    ["L2", "daily_video_tasks", "按积分结算"],
    ["L2", "video_material_limit", "按积分结算"],
    ["L2", "product_archive_limit", "按积分结算"],
    ["L2", "voice_clone_limit", "按积分结算"],
    ["L2", "template_pack", "基础包"],
    ["L2", "activity_priority", "优先"],
    ["L2", "support_priority", "标准"],
    ["L3", "growth_multiplier", 1.1],
    ["L3", "daily_video_tasks", "按积分结算"],
    ["L3", "video_material_limit", "按积分结算"],
    ["L3", "product_archive_limit", "按积分结算"],
    ["L3", "voice_clone_limit", "按积分结算"],
    ["L3", "template_pack", "进阶包"],
    ["L3", "activity_priority", "高优先"],
    ["L3", "support_priority", "普通优先"],
    ["L4", "growth_multiplier", 1.15],
    ["L4", "daily_video_tasks", "按积分结算"],
    ["L4", "video_material_limit", "按积分结算"],
    ["L4", "product_archive_limit", "按积分结算"],
    ["L4", "voice_clone_limit", "按积分结算"],
    ["L4", "template_pack", "旗舰包"],
    ["L4", "activity_priority", "高优先"],
    ["L4", "support_priority", "高优先"],
    ["L5", "growth_multiplier", 1.2],
    ["L5", "daily_video_tasks", "按积分结算"],
    ["L5", "video_material_limit", "按积分结算"],
    ["L5", "product_archive_limit", "按积分结算"],
    ["L5", "voice_clone_limit", "按积分结算"],
    ["L5", "template_pack", "黑金包"],
    ["L5", "activity_priority", "最高优先"],
    ["L5", "support_priority", "专属支持"],
  ];

  return rows.map(([levelCode, benefitKey, benefitValue]) => ({
    mapId: `${levelCode}:${benefitKey}`,
    levelCode,
    benefitKey,
    benefitValue,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })) satisfies MemberLevelBenefitMapRecord[];
}

export function getDefaultMemberConfig(): MemberConfigRecord {
  const timestamp = nowIso();
  return {
    memberCenterEnabled: true,
    memberGrowthEnabled: true,
    memberBenefitEnforcementEnabled: true,
    memberAdminEnabled: true,
    growthExpireDays: 365,
    gracePeriodDays: 30,
    seedUserIds: [],
    excludedUserIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function ensureMemberDefaults() {
  ensureMemberSchema();
  const pointsSettledBenefitKeys = new Set([
    "daily_video_tasks",
    "video_material_limit",
    "product_archive_limit",
    "voice_clone_limit",
  ]);

  if (listMemberLevels().length === 0) {
    for (const item of buildDefaultLevels()) {
      dbUpsert(MEMBER_LEVEL_COLLECTION, item.levelCode, item);
    }
  }

  if (listMemberGrowthRules().length === 0) {
    for (const item of buildDefaultGrowthRules()) {
      dbUpsert(MEMBER_GROWTH_RULE_COLLECTION, item.ruleCode, item);
    }
  }

  if (listMemberBenefitDefinitions().length === 0) {
    for (const item of buildDefaultBenefitDefinitions()) {
      dbUpsert(MEMBER_BENEFIT_COLLECTION, item.benefitKey, item);
    }
  }

  if (listMemberLevelBenefitMaps().length === 0) {
    for (const item of buildDefaultLevelBenefitMaps()) {
      dbUpsert(MEMBER_LEVEL_BENEFIT_MAP_COLLECTION, item.mapId, item);
    }
  }

  for (const item of listMemberLevelBenefitMaps()) {
    if (!pointsSettledBenefitKeys.has(item.benefitKey) || item.benefitValue === "按积分结算") {
      continue;
    }
    dbUpsert(MEMBER_LEVEL_BENEFIT_MAP_COLLECTION, item.mapId, {
      ...item,
      benefitValue: "按积分结算",
      updatedAt: nowIso(),
    });
  }

  const config = getMemberConfig();
  if (!config) {
    dbSetSingleton(MEMBER_CONFIG_COLLECTION, getDefaultMemberConfig());
  } else if (config.memberBenefitEnforcementEnabled !== true) {
    dbSetSingleton(MEMBER_CONFIG_COLLECTION, {
      ...config,
      memberBenefitEnforcementEnabled: true,
      updatedAt: nowIso(),
    });
  }
}

export function listMemberLevels() {
  ensureMemberSchema();
  return safeList<MemberLevelRecord>(MEMBER_LEVEL_COLLECTION).sort(
    (left, right) => left.levelNumber - right.levelNumber,
  );
}

export function listMemberGrowthRules() {
  ensureMemberSchema();
  return safeList<MemberGrowthRuleRecord>(MEMBER_GROWTH_RULE_COLLECTION).sort((left, right) =>
    left.ruleCode.localeCompare(right.ruleCode),
  );
}

export function listMemberBenefitDefinitions() {
  ensureMemberSchema();
  return safeList<MemberBenefitDefinitionRecord>(MEMBER_BENEFIT_COLLECTION).sort((left, right) =>
    left.benefitKey.localeCompare(right.benefitKey),
  );
}

export function listMemberLevelBenefitMaps() {
  ensureMemberSchema();
  return safeList<MemberLevelBenefitMapRecord>(MEMBER_LEVEL_BENEFIT_MAP_COLLECTION).sort((left, right) =>
    left.mapId.localeCompare(right.mapId),
  );
}

export function getMemberConfig() {
  ensureMemberSchema();
  return dbGetSingleton<MemberConfigRecord>(MEMBER_CONFIG_COLLECTION);
}

export function setMemberConfig(config: MemberConfigRecord) {
  ensureMemberDefaults();
  dbSetSingleton(MEMBER_CONFIG_COLLECTION, config);
}

export function listMemberCampaigns() {
  ensureMemberDefaults();
  return safeList<MemberCampaignRecord>(MEMBER_CAMPAIGN_COLLECTION).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function getMemberCampaign(campaignId: string) {
  ensureMemberDefaults();
  return dbGet<MemberCampaignRecord>(MEMBER_CAMPAIGN_COLLECTION, campaignId);
}

export function upsertMemberCampaign(campaign: MemberCampaignRecord) {
  ensureMemberDefaults();
  dbUpsert(MEMBER_CAMPAIGN_COLLECTION, campaign.campaignId, campaign);
}

export function deleteMemberCampaign(campaignId: string) {
  ensureMemberDefaults();
  dbDelete(MEMBER_CAMPAIGN_COLLECTION, campaignId);
}

export function upsertMemberLevel(level: MemberLevelRecord) {
  ensureMemberDefaults();
  dbUpsert(MEMBER_LEVEL_COLLECTION, level.levelCode, level);
}

export function upsertMemberGrowthRule(rule: MemberGrowthRuleRecord) {
  ensureMemberDefaults();
  dbUpsert(MEMBER_GROWTH_RULE_COLLECTION, rule.ruleCode, rule);
}

export function upsertMemberLevelBenefitMap(map: MemberLevelBenefitMapRecord) {
  ensureMemberDefaults();
  dbUpsert(MEMBER_LEVEL_BENEFIT_MAP_COLLECTION, map.mapId, map);
}

export function getMemberProfile(userId: string) {
  ensureMemberDefaults();
  return dbGet<MemberUserProfileRecord>(MEMBER_PROFILE_COLLECTION, userId);
}

export function listMemberProfiles() {
  ensureMemberDefaults();
  return safeList<MemberUserProfileRecord>(MEMBER_PROFILE_COLLECTION);
}

export function upsertMemberProfile(profile: MemberUserProfileRecord) {
  ensureMemberDefaults();
  dbUpsert(MEMBER_PROFILE_COLLECTION, profile.userId, profile);
}

function mapGrowthRow(row: Record<string, unknown>): MemberGrowthRecord {
  return {
    growthId: String(row.growth_id ?? ""),
    userId: String(row.user_id ?? ""),
    eventType: String(row.event_type ?? ""),
    sourceType: String(row.source_type ?? "rule") as MemberGrowthSourceType,
    sourceBizId: row.source_biz_id ? String(row.source_biz_id) : null,
    idempotentKey: String(row.idempotent_key ?? ""),
    changeValue: Number(row.change_value ?? 0),
    baseValue: Number(row.base_value ?? 0),
    appliedMultiplier: Number(row.applied_multiplier ?? 1),
    effectiveValue: Number(row.effective_value ?? 0),
    status: String(row.status ?? "effective") as MemberGrowthStatus,
    expireAt: row.expire_at ? String(row.expire_at) : null,
    reversedGrowthId: row.reversed_growth_id ? String(row.reversed_growth_id) : null,
    operatorId: row.operator_id ? String(row.operator_id) : null,
    remark: row.remark ? String(row.remark) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function getMemberGrowthRecordByIdempotentKey(idempotentKey: string) {
  ensureMemberDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM member_growth_records
        WHERE idempotent_key = ?
        LIMIT 1
      `,
    )
    .get(idempotentKey) as Record<string, unknown> | undefined;

  return row ? mapGrowthRow(row) : null;
}

export function insertMemberGrowthRecord(record: MemberGrowthRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_growth_records (
        growth_id,
        user_id,
        event_type,
        source_type,
        source_biz_id,
        idempotent_key,
        change_value,
        base_value,
        applied_multiplier,
        effective_value,
        status,
        expire_at,
        reversed_growth_id,
        operator_id,
        remark,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.growthId,
    record.userId,
    record.eventType,
    record.sourceType,
    record.sourceBizId,
    record.idempotentKey,
    record.changeValue,
    record.baseValue,
    record.appliedMultiplier,
    record.effectiveValue,
    record.status,
    record.expireAt,
    record.reversedGrowthId,
    record.operatorId,
    record.remark,
    record.createdAt,
  );
}

export function expireGrowthRecordsForUser(userId: string, nowAt: string) {
  ensureMemberDefaults();
  db.prepare(
    `
      UPDATE member_growth_records
      SET status = 'expired'
      WHERE user_id = ?
        AND status = 'effective'
        AND expire_at IS NOT NULL
        AND expire_at <= ?
    `,
  ).run(userId, nowAt);
}

export function getDailyGrowthTotal(userId: string, eventType: string, startAt: string, endAt: string) {
  ensureMemberDefaults();
  const row = db
    .prepare(
      `
        SELECT COALESCE(SUM(CASE WHEN effective_value > 0 THEN effective_value ELSE 0 END), 0) AS total
        FROM member_growth_records
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

export function getMemberGrowthStats(userId: string, nowAt: string) {
  ensureMemberDefaults();
  const row = db
    .prepare(
      `
        SELECT
          COALESCE(SUM(
            CASE
              WHEN status = 'effective' AND (expire_at IS NULL OR expire_at > ?)
                THEN effective_value
              ELSE 0
            END
          ), 0) AS effective_total,
          COALESCE(SUM(
            CASE
              WHEN status != 'reversed'
                THEN effective_value
              ELSE 0
            END
          ), 0) AS lifetime_total
        FROM member_growth_records
        WHERE user_id = ?
      `,
    )
    .get(nowAt, userId) as { effective_total?: number; lifetime_total?: number } | undefined;

  return {
    effectiveTotal: Number(row?.effective_total ?? 0),
    lifetimeTotal: Number(row?.lifetime_total ?? 0),
  };
}

export function listMemberGrowthRecordsByUserId(userId: string, limit = 50) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_growth_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapGrowthRow);
}

function mapGrantRow(row: Record<string, unknown>): MemberBenefitGrantRecord {
  return {
    grantId: String(row.grant_id ?? ""),
    userId: String(row.user_id ?? ""),
    benefitKey: String(row.benefit_key ?? ""),
    benefitName: String(row.benefit_name ?? ""),
    sourceType: String(row.source_type ?? "manual") as MemberGrowthSourceType,
    sourceLevelCode: row.source_level_code ? (String(row.source_level_code) as MemberLevelCode) : null,
    valueType: String(row.value_type ?? "string") as BenefitValueType,
    benefitValue: String(row.benefit_value ?? ""),
    status: String(row.status ?? "active") as MemberBenefitGrantStatus,
    startAt: String(row.start_at ?? ""),
    expireAt: row.expire_at ? String(row.expire_at) : null,
    operatorId: row.operator_id ? String(row.operator_id) : null,
    remark: row.remark ? String(row.remark) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function expireBenefitGrantsForUser(userId: string, nowAt: string) {
  ensureMemberDefaults();
  db.prepare(
    `
      UPDATE member_benefit_grants
      SET status = 'expired', updated_at = ?
      WHERE user_id = ?
        AND status = 'active'
        AND expire_at IS NOT NULL
        AND expire_at <= ?
    `,
  ).run(nowAt, userId, nowAt);
}

export function insertMemberBenefitGrant(record: MemberBenefitGrantRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_benefit_grants (
        grant_id,
        user_id,
        benefit_key,
        benefit_name,
        source_type,
        source_level_code,
        value_type,
        benefit_value,
        status,
        start_at,
        expire_at,
        operator_id,
        remark,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.grantId,
    record.userId,
    record.benefitKey,
    record.benefitName,
    record.sourceType,
    record.sourceLevelCode,
    record.valueType,
    record.benefitValue,
    record.status,
    record.startAt,
    record.expireAt,
    record.operatorId,
    record.remark,
    record.createdAt,
    record.updatedAt,
  );
}

export function listMemberBenefitGrantsByUserId(userId: string, limit = 50) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_benefit_grants
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapGrantRow);
}

export function getMemberBenefitGrant(grantId: string) {
  ensureMemberDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM member_benefit_grants
        WHERE grant_id = ?
        LIMIT 1
      `,
    )
    .get(grantId) as Record<string, unknown> | undefined;

  return row ? mapGrantRow(row) : null;
}

export function revokeMemberBenefitGrant(grantId: string, nowAt: string) {
  ensureMemberDefaults();
  db.prepare(
    `
      UPDATE member_benefit_grants
      SET status = 'revoked', updated_at = ?
      WHERE grant_id = ?
        AND status = 'active'
    `,
  ).run(nowAt, grantId);
}

export function listActiveMemberBenefitGrantsByUserId(userId: string, nowAt: string) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_benefit_grants
        WHERE user_id = ?
          AND status = 'active'
          AND start_at <= ?
          AND (expire_at IS NULL OR expire_at > ?)
        ORDER BY created_at DESC
      `,
    )
    .all(userId, nowAt, nowAt) as Record<string, unknown>[];

  return rows.map(mapGrantRow);
}

function mapLevelChangeRow(row: Record<string, unknown>): MemberLevelChangeLogRecord {
  return {
    changeId: String(row.change_id ?? ""),
    userId: String(row.user_id ?? ""),
    fromLevelCode: row.from_level_code ? (String(row.from_level_code) as MemberLevelCode) : null,
    toLevelCode: String(row.to_level_code ?? "L1") as MemberLevelCode,
    reasonType: String(row.reason_type ?? "manual") as MemberLevelChangeReasonType,
    reasonDetail: String(row.reason_detail ?? ""),
    operatorId: row.operator_id ? String(row.operator_id) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapCampaignExecutionBatchRow(row: Record<string, unknown>): MemberCampaignExecutionBatchRecord {
  return {
    batchId: String(row.batch_id ?? ""),
    campaignId: String(row.campaign_id ?? ""),
    campaignName: String(row.campaign_name ?? ""),
    grantType: String(row.grant_type ?? "growth") as MemberCampaignGrantType,
    targetType: String(row.target_type ?? "all_metric_users") as MemberCampaignTargetType,
    targetSummary: String(row.target_summary ?? ""),
    plannedUserCount: Number(row.planned_user_count ?? 0),
    successUserCount: Number(row.success_user_count ?? 0),
    failedUserCount: Number(row.failed_user_count ?? 0),
    operatorId: row.operator_id ? String(row.operator_id) : null,
    startedAt: String(row.started_at ?? ""),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapCampaignExecutionResultRow(row: Record<string, unknown>): MemberCampaignExecutionResultRecord {
  return {
    resultId: String(row.result_id ?? ""),
    batchId: String(row.batch_id ?? ""),
    campaignId: String(row.campaign_id ?? ""),
    campaignName: String(row.campaign_name ?? ""),
    userId: String(row.user_id ?? ""),
    status: String(row.status ?? "success") as MemberCampaignExecutionResultStatus,
    detail: String(row.detail ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapBenefitUsageRow(row: Record<string, unknown>): MemberBenefitUsageRecord {
  return {
    usageId: String(row.usage_id ?? ""),
    userId: String(row.user_id ?? ""),
    benefitKey: String(row.benefit_key ?? ""),
    benefitName: String(row.benefit_name ?? ""),
    usageType: "quota_check",
    sourceBizType: row.source_biz_type ? String(row.source_biz_type) : null,
    sourceBizId: row.source_biz_id ? String(row.source_biz_id) : null,
    currentCount: Number(row.current_count ?? 0),
    increment: Number(row.increment ?? 0),
    nextCount: Number(row.next_count ?? 0),
    limitValue: row.limit_value ? String(row.limit_value) : null,
    resultStatus: String(row.result_status ?? "allowed") as MemberBenefitUsageStatus,
    detail: row.detail ? String(row.detail) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function insertMemberLevelChangeLog(record: MemberLevelChangeLogRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_level_change_logs (
        change_id,
        user_id,
        from_level_code,
        to_level_code,
        reason_type,
        reason_detail,
        operator_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.changeId,
    record.userId,
    record.fromLevelCode,
    record.toLevelCode,
    record.reasonType,
    record.reasonDetail,
    record.operatorId,
    record.createdAt,
  );
}

export function listMemberLevelChangeLogsByUserId(userId: string, limit = 30) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_level_change_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapLevelChangeRow);
}

export function insertMemberOperationLog(record: MemberOperationLogRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_operation_logs (
        operate_id,
        user_id,
        action_type,
        detail,
        operator_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(record.operateId, record.userId, record.actionType, record.detail, record.operatorId, record.createdAt);
}

export function listMemberOperationLogsByUserId(userId: string, limit = 30) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_operation_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map((row) => ({
    operateId: String(row.operate_id ?? ""),
    userId: row.user_id ? String(row.user_id) : null,
    actionType: String(row.action_type ?? ""),
    detail: String(row.detail ?? ""),
    operatorId: row.operator_id ? String(row.operator_id) : null,
    createdAt: String(row.created_at ?? ""),
  }));
}

export function insertMemberCampaignExecutionBatch(record: MemberCampaignExecutionBatchRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_campaign_execution_batches (
        batch_id,
        campaign_id,
        campaign_name,
        grant_type,
        target_type,
        target_summary,
        planned_user_count,
        success_user_count,
        failed_user_count,
        operator_id,
        started_at,
        finished_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.batchId,
    record.campaignId,
    record.campaignName,
    record.grantType,
    record.targetType,
    record.targetSummary,
    record.plannedUserCount,
    record.successUserCount,
    record.failedUserCount,
    record.operatorId,
    record.startedAt,
    record.finishedAt,
    record.createdAt,
  );
}

export function listMemberCampaignExecutionBatches(limit = 20) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_campaign_execution_batches
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapCampaignExecutionBatchRow);
}

export function getMemberCampaignExecutionBatch(batchId: string) {
  ensureMemberDefaults();
  const row = db
    .prepare(
      `
        SELECT *
        FROM member_campaign_execution_batches
        WHERE batch_id = ?
        LIMIT 1
      `,
    )
    .get(batchId) as Record<string, unknown> | undefined;

  return row ? mapCampaignExecutionBatchRow(row) : null;
}

export function insertMemberCampaignExecutionResult(record: MemberCampaignExecutionResultRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_campaign_execution_results (
        result_id,
        batch_id,
        campaign_id,
        campaign_name,
        user_id,
        status,
        detail,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.resultId,
    record.batchId,
    record.campaignId,
    record.campaignName,
    record.userId,
    record.status,
    record.detail,
    record.createdAt,
  );
}

export function listMemberCampaignExecutionResults(limit = 50) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_campaign_execution_results
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapCampaignExecutionResultRow);
}

export function listMemberCampaignExecutionResultsByBatchId(batchId: string, limit = 100) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_campaign_execution_results
        WHERE batch_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(batchId, limit) as Record<string, unknown>[];

  return rows.map(mapCampaignExecutionResultRow);
}

export function insertMemberBenefitUsageRecord(record: MemberBenefitUsageRecord) {
  ensureMemberDefaults();
  db.prepare(
    `
      INSERT INTO member_benefit_usage_records (
        usage_id,
        user_id,
        benefit_key,
        benefit_name,
        usage_type,
        source_biz_type,
        source_biz_id,
        current_count,
        increment,
        next_count,
        limit_value,
        result_status,
        detail,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.usageId,
    record.userId,
    record.benefitKey,
    record.benefitName,
    record.usageType,
    record.sourceBizType,
    record.sourceBizId,
    record.currentCount,
    record.increment,
    record.nextCount,
    record.limitValue,
    record.resultStatus,
    record.detail,
    record.createdAt,
  );
}

export function listMemberBenefitUsageRecordsByUserId(userId: string, limit = 30) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_benefit_usage_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map(mapBenefitUsageRow);
}

export function listMemberBenefitUsageRecords(limit = 50) {
  ensureMemberDefaults();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM member_benefit_usage_records
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapBenefitUsageRow);
}

export function transferMemberUserId(sourceUserId: string, targetUserId: string) {
  ensureMemberDefaults();

  db.prepare("UPDATE member_growth_records SET user_id = ? WHERE user_id = ?").run(targetUserId, sourceUserId);
  db.prepare("UPDATE member_benefit_grants SET user_id = ?, updated_at = ? WHERE user_id = ?").run(
    targetUserId,
    nowIso(),
    sourceUserId,
  );
  db.prepare("UPDATE member_level_change_logs SET user_id = ? WHERE user_id = ?").run(targetUserId, sourceUserId);
  db.prepare("UPDATE member_operation_logs SET user_id = ? WHERE user_id = ?").run(targetUserId, sourceUserId);
  db.prepare("UPDATE member_campaign_execution_results SET user_id = ? WHERE user_id = ?").run(
    targetUserId,
    sourceUserId,
  );
  db.prepare("UPDATE member_benefit_usage_records SET user_id = ? WHERE user_id = ?").run(targetUserId, sourceUserId);
}
