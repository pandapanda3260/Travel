import { accessSync, constants, mkdirSync } from "node:fs";

import {
  getAuthRiskConfig,
  listAdminActionLogs,
  listAuthUsers,
  listRiskBlockEntries,
  listUserAccounts,
  listUserLoginLogs,
  listUserPhones,
  listUserSessions,
  type AdminRole,
} from "./auth-store";
import { ensureRecentAdminDataDailyAggregates } from "./admin-data-analytics";
import { db } from "./db";
import { getFfmpegBinaryPathOrNull } from "./ffmpeg-runtime";
import { listMaterialLibraryItems } from "./material-library-store";
import { listNarrationResults } from "./narration-result-store";
import { buildOverviewPipelineModelMap, buildOverviewServiceReport } from "./overview-service-report";
import { listProductArchives } from "./product-archive-store";
import { getRuntimeStorageMeta } from "./runtime-storage";
import { listTaskClipShots } from "./task-clip-store";
import { listTaskVisualImageShots } from "./task-visual-image-store";
import { getStoredTimbreLibraryMeta } from "./timbre-library-store";
import { listVideoCompositions } from "./video-composition-store";
import { listVideoJobs } from "./video-job-store";
import { listVideoMaterials } from "./video-material-store";
import { getVideoTaskStatusIndex, type VideoTaskStatus } from "./video-task-schema";
import { listVideoTasks } from "./video-task-store";
import { listClonedVoices } from "./voice-management-store";

export type AdminDataTone = "primary" | "success" | "warning" | "neutral";

export type AdminDataStat = {
  label: string;
  value: string;
  meta: string;
  tone?: AdminDataTone;
};

export type AdminDataListItem = {
  label: string;
  value: string;
  meta?: string;
  href?: string;
};

export type AdminDataPanel = {
  title: string;
  hint: string;
  items: AdminDataListItem[];
};

export type AdminTrendItem = {
  label: string;
  value: number;
  displayValue: string;
  helper?: string;
};

export type AdminMetricCard = {
  label: string;
  value: string;
  meta: string;
  tone?: AdminDataTone;
};

export type AdminRecordRow = {
  title: string;
  subtitle?: string;
  value?: string;
  note?: string;
  href?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export type AdminOverviewSnapshot = {
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  userTrend: AdminTrendItem[];
  taskTrend: AdminTrendItem[];
  taskFunnel: AdminTrendItem[];
  stageMetrics: AdminMetricCard[];
  recentAlerts: AdminRecordRow[];
  recentTasks: AdminRecordRow[];
};

export type AdminUserSnapshot = {
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  newUserTrend: AdminTrendItem[];
  activeUserTrend: AdminTrendItem[];
  loginMix: AdminMetricCard[];
  lifecycle: AdminMetricCard[];
  retention: AdminMetricCard[];
  recentUsers: AdminRecordRow[];
  recentLogins: AdminRecordRow[];
};

export type AdminTaskSnapshot = {
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  taskTrend: AdminTrendItem[];
  taskStatuses: AdminTrendItem[];
  taskFunnel: AdminTrendItem[];
  stageMetrics: AdminMetricCard[];
  providerMix: AdminMetricCard[];
  recentTasks: AdminRecordRow[];
  recentFailures: AdminRecordRow[];
};

export type AdminAssetSnapshot = {
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  archiveTrend: AdminTrendItem[];
  materialTrend: AdminTrendItem[];
  assetMix: AdminMetricCard[];
  voiceMix: AdminMetricCard[];
  latestArchives: AdminRecordRow[];
  latestMaterials: AdminRecordRow[];
};

export type AdminSystemSnapshot = {
  stats: AdminDataStat[];
  panels: AdminDataPanel[];
  healthChecks: AdminMetricCard[];
  stageMetrics: AdminMetricCard[];
  serviceStatuses: AdminRecordRow[];
  jobStatusTrend: AdminTrendItem[];
  recentFailures: AdminRecordRow[];
  recentActions: AdminRecordRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEED_PHONE = "15600608369";

function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 10000) {
    const normalized = value / 10000;
    return `${normalized >= 100 ? Math.round(normalized) : Number(normalized.toFixed(1))}w`;
  }
  return `${value}`;
}

function formatPercent(value: number, precision = 1) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(precision)}%`;
}

function formatDurationMs(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return "0ms";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatDateLabel(input: string | Date) {
  const date = new Date(input);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

function formatDateTimeLabel(input: string | Date | null | undefined) {
  if (!input) {
    return "暂无";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return String(input);
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function canViewSensitiveAdminData(role: AdminRole) {
  return role === "super_admin";
}

function sanitizeSystemDetail(detail: string, checkName: string, ok: boolean, role: AdminRole) {
  if (canViewSensitiveAdminData(role)) {
    return detail;
  }
  if (checkName === "数据目录" || checkName === "公共存储") {
    return ok ? "读写正常" : "访问异常";
  }
  if (checkName === "SQLite") {
    return ok ? "读写连接正常" : "检查失败";
  }
  return detail;
}

function truncateDetailText(value: string, maxLength = 72) {
  const text = value.trim();
  if (!text) {
    return "";
  }
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : chars.join("");
}

function sanitizeSensitiveSummaryText(
  value: string | null | undefined,
  role: AdminRole,
  options: {
    hiddenText: string;
    emptyText?: string;
    maxLength?: number;
  },
) {
  const text = value?.trim() ?? "";
  if (!text) {
    return options.emptyText ?? "暂无";
  }
  if (canViewSensitiveAdminData(role)) {
    return truncateDetailText(text, options.maxLength ?? 72);
  }
  return options.hiddenText;
}

function sanitizeErrorSummary(value: string | null | undefined, role: AdminRole, emptyText = "未知错误") {
  return sanitizeSensitiveSummaryText(value, role, {
    hiddenText: "错误详情已隐藏",
    emptyText,
  });
}

function sanitizeProviderFailureSummary(
  errorCode: string | null | undefined,
  objectId: string | null | undefined,
  role: AdminRole,
) {
  if (errorCode?.trim()) {
    return errorCode.trim();
  }
  if (canViewSensitiveAdminData(role) && objectId?.trim()) {
    return objectId.trim();
  }
  return "调用失败";
}

function buildAdminDataDetailsHref(
  domain: "users" | "tasks" | "assets" | "system",
  options?: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams({ domain, page: "1" });
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value == null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  return `/admin/data/details?${params.toString()}`;
}

type ProviderCallSummaryRow = {
  serviceName: string;
  provider: string | null;
  modelId: string | null;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgDurationMs: number | null;
  latestCreatedAt: string | null;
};

type ProviderFailureRow = {
  serviceName: string;
  provider: string | null;
  modelId: string | null;
  objectType: string | null;
  objectId: string | null;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: string;
};

type TaskStageSummaryRow = {
  stageKey: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  queuedRuns: number;
  inProgressRuns: number;
  avgDurationMs: number | null;
  latestStartedAt: string | null;
};

type TaskStageFailureRow = {
  taskId: string;
  stageKey: string;
  provider: string | null;
  modelId: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type ApiRequestSummaryRow = {
  totalCalls: number;
  failedCalls: number;
  avgDurationMs: number | null;
  latestCreatedAt: string | null;
};

type EventSummaryRow = {
  totalEvents: number;
  distinctActors: number;
  latestCreatedAt: string | null;
};

const ASSET_PROVIDER_SERVICE_NAMES = new Set([
  "audio.asr",
  "video.analysis",
  "llm.material_script",
  "audio.voice_preview",
]);

function isAssetProviderService(serviceName: string) {
  return ASSET_PROVIDER_SERVICE_NAMES.has(serviceName) || serviceName.startsWith("voice.clone.");
}

function getWindowStartIso(days = 7) {
  return addDays(startOfDay(), -(days - 1)).toISOString();
}

function getProviderCallSummary(days = 7): ProviderCallSummaryRow[] {
  const rows = db
    .prepare(
      `
        SELECT
          service_name AS serviceName,
          provider AS provider,
          model_id AS modelId,
          COUNT(*) AS totalCalls,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successCalls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failedCalls,
          AVG(duration_ms) AS avgDurationMs,
          MAX(created_at) AS latestCreatedAt
        FROM analytics_provider_call_log
        WHERE created_at >= ?
        GROUP BY service_name, provider, model_id
        ORDER BY totalCalls DESC, latestCreatedAt DESC
      `,
    )
    .all(getWindowStartIso(days)) as Array<{
    serviceName: string;
    provider: string | null;
    modelId: string | null;
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    avgDurationMs: number | null;
    latestCreatedAt: string | null;
  }>;

  return rows.map((row) => ({
    ...row,
    totalCalls: Number(row.totalCalls) || 0,
    successCalls: Number(row.successCalls) || 0,
    failedCalls: Number(row.failedCalls) || 0,
    avgDurationMs: row.avgDurationMs == null ? null : Number(row.avgDurationMs),
  }));
}

function listRecentProviderFailures(limit = 6): ProviderFailureRow[] {
  const rows = db
    .prepare(
      `
        SELECT
          service_name AS serviceName,
          provider AS provider,
          model_id AS modelId,
          object_type AS objectType,
          object_id AS objectId,
          error_code AS errorCode,
          duration_ms AS durationMs,
          created_at AS createdAt
        FROM analytics_provider_call_log
        WHERE success = 0
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{
    serviceName: string;
    provider: string | null;
    modelId: string | null;
    objectType: string | null;
    objectId: string | null;
    errorCode: string | null;
    durationMs: number | null;
    createdAt: string;
  }>;

  return rows.map((row) => ({
    ...row,
    durationMs: row.durationMs == null ? null : Number(row.durationMs),
  }));
}

function getTaskStageSummary(days = 7): TaskStageSummaryRow[] {
  const rows = db
    .prepare(
      `
        SELECT
          stage_key AS stageKey,
          COUNT(*) AS totalRuns,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedRuns,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failedRuns,
          SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queuedRuns,
          SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS inProgressRuns,
          AVG(duration_ms) AS avgDurationMs,
          MAX(started_at) AS latestStartedAt
        FROM analytics_task_stage_run
        WHERE started_at >= ?
        GROUP BY stage_key
        ORDER BY latestStartedAt DESC
      `,
    )
    .all(getWindowStartIso(days)) as Array<{
    stageKey: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    queuedRuns: number;
    inProgressRuns: number;
    avgDurationMs: number | null;
    latestStartedAt: string | null;
  }>;

  return rows.map((row) => ({
    ...row,
    totalRuns: Number(row.totalRuns) || 0,
    completedRuns: Number(row.completedRuns) || 0,
    failedRuns: Number(row.failedRuns) || 0,
    queuedRuns: Number(row.queuedRuns) || 0,
    inProgressRuns: Number(row.inProgressRuns) || 0,
    avgDurationMs: row.avgDurationMs == null ? null : Number(row.avgDurationMs),
  }));
}

function listRecentTaskStageFailures(limit = 6): TaskStageFailureRow[] {
  return db
    .prepare(
      `
        SELECT
          task_id AS taskId,
          stage_key AS stageKey,
          provider AS provider,
          model_id AS modelId,
          error_message AS errorMessage,
          started_at AS startedAt,
          finished_at AS finishedAt
        FROM analytics_task_stage_run
        WHERE status = 'FAILED'
        ORDER BY COALESCE(finished_at, started_at) DESC
        LIMIT ?
      `,
    )
    .all(limit) as TaskStageFailureRow[];
}

function getApiRequestSummary(days = 7): ApiRequestSummaryRow {
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS totalCalls,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failedCalls,
          AVG(duration_ms) AS avgDurationMs,
          MAX(created_at) AS latestCreatedAt
        FROM analytics_api_request_log
        WHERE created_at >= ?
      `,
    )
    .get(getWindowStartIso(days)) as {
    totalCalls?: number;
    failedCalls?: number;
    avgDurationMs?: number | null;
    latestCreatedAt?: string | null;
  };

  return {
    totalCalls: Number(row?.totalCalls) || 0,
    failedCalls: Number(row?.failedCalls) || 0,
    avgDurationMs: row?.avgDurationMs == null ? null : Number(row.avgDurationMs),
    latestCreatedAt: row?.latestCreatedAt ?? null,
  };
}

function getEventSummary(days = 7): EventSummaryRow {
  const row = db
    .prepare(
      `
        SELECT
          COUNT(*) AS totalEvents,
          COUNT(DISTINCT actor_id) AS distinctActors,
          MAX(created_at) AS latestCreatedAt
        FROM analytics_event_log
        WHERE created_at >= ?
      `,
    )
    .get(getWindowStartIso(days)) as {
    totalEvents?: number;
    distinctActors?: number;
    latestCreatedAt?: string | null;
  };

  return {
    totalEvents: Number(row?.totalEvents) || 0,
    distinctActors: Number(row?.distinctActors) || 0,
    latestCreatedAt: row?.latestCreatedAt ?? null,
  };
}

function getAssetProviderCallSummary(days = 7) {
  return getProviderCallSummary(days).filter((item) => isAssetProviderService(item.serviceName));
}

function listRecentAssetProviderFailures(limit = 6) {
  return listRecentProviderFailures(limit * 3)
    .filter((item) => isAssetProviderService(item.serviceName))
    .slice(0, limit);
}

function getStageTerminalCount(stage?: TaskStageSummaryRow | null) {
  return (stage?.completedRuns ?? 0) + (stage?.failedRuns ?? 0);
}

function getStageSuccessRate(stage?: TaskStageSummaryRow | null) {
  const terminalRuns = getStageTerminalCount(stage);
  return terminalRuns > 0 ? (stage?.completedRuns ?? 0) / terminalRuns : 0;
}

function buildStageMetricCard(
  stage: TaskStageSummaryRow | null | undefined,
  label: string,
  emptyMeta: string,
): AdminMetricCard {
  const pendingRuns = (stage?.queuedRuns ?? 0) + (stage?.inProgressRuns ?? 0);
  if (!stage) {
    return {
      label,
      value: "0%",
      meta: emptyMeta,
      tone: "neutral",
    };
  }

  const successRate = getStageSuccessRate(stage);
  const terminalRuns = getStageTerminalCount(stage);
  const metaParts = terminalRuns > 0 ? [`run ${stage.completedRuns}/${terminalRuns}`] : [`总 run ${stage.totalRuns}`];
  if (pendingRuns > 0) {
    metaParts.push(`排队 ${pendingRuns}`);
  }
  if (stage.avgDurationMs != null) {
    metaParts.push(`平均 ${formatDurationMs(stage.avgDurationMs)}`);
  }

  return {
    label,
    value: formatPercent(successRate),
    meta: metaParts.join(" · "),
    tone: stage.failedRuns > 0 ? "warning" : pendingRuns > 0 ? "primary" : "success",
  };
}

function buildDayBuckets(days = 7) {
  const today = startOfDay();
  return Array.from({ length: days }, (_, index) => {
    const start = addDays(today, -(days - 1 - index));
    const end = addDays(start, 1);
    return {
      label: formatDateLabel(start),
      start,
      end,
    };
  });
}

function countItemsByDay<T>(
  items: T[],
  getTimestamp: (item: T) => string | null | undefined,
  predicate?: (item: T) => boolean,
  days = 7,
) {
  const buckets = buildDayBuckets(days);
  return buckets.map((bucket) => {
    const value = items.reduce((sum, item) => {
      if (predicate && !predicate(item)) {
        return sum;
      }
      const timestamp = getTimestamp(item);
      if (!timestamp) {
        return sum;
      }
      const time = new Date(timestamp).getTime();
      if (Number.isNaN(time)) {
        return sum;
      }
      return time >= bucket.start.getTime() && time < bucket.end.getTime() ? sum + 1 : sum;
    }, 0);

    return {
      label: bucket.label,
      value,
      displayValue: `${value}`,
    } satisfies AdminTrendItem;
  });
}

function countUniqueByDay<T>(
  items: T[],
  getTimestamp: (item: T) => string | null | undefined,
  getKey: (item: T) => string | null | undefined,
  predicate?: (item: T) => boolean,
  days = 7,
) {
  const buckets = buildDayBuckets(days);
  return buckets.map((bucket) => {
    const set = new Set<string>();
    for (const item of items) {
      if (predicate && !predicate(item)) {
        continue;
      }
      const key = getKey(item);
      const timestamp = getTimestamp(item);
      if (!key || !timestamp) {
        continue;
      }
      const time = new Date(timestamp).getTime();
      if (Number.isNaN(time)) {
        continue;
      }
      if (time >= bucket.start.getTime() && time < bucket.end.getTime()) {
        set.add(key);
      }
    }

    return {
      label: bucket.label,
      value: set.size,
      displayValue: `${set.size}`,
    } satisfies AdminTrendItem;
  });
}

function resolveExcludedUserIds() {
  const users = listAuthUsers();
  const accounts = listUserAccounts();
  const phones = listUserPhones();
  const excluded = new Set<string>();

  for (const user of users) {
    if ((user as { isSystemSeed?: boolean }).isSystemSeed) {
      excluded.add(user.userId);
    }
  }

  for (const account of accounts) {
    if (account.username === DEFAULT_SEED_PHONE) {
      excluded.add(account.userId);
    }
  }

  for (const phone of phones) {
    if (phone.phone === DEFAULT_SEED_PHONE) {
      excluded.add(phone.userId);
    }
  }

  return excluded;
}

function getActiveUserIdsWithinDays(days: number, excludedUserIds: Set<string>) {
  const start = addDays(startOfDay(), -(days - 1));
  const activeUsers = new Set<string>();
  for (const log of listUserLoginLogs()) {
    if (!log.success || !log.userId || excludedUserIds.has(log.userId)) {
      continue;
    }
    const time = new Date(log.createdAt).getTime();
    if (!Number.isNaN(time) && time >= start.getTime()) {
      activeUsers.add(log.userId);
    }
  }
  return activeUsers;
}

function buildUserLifecycle(excludedUserIds: Set<string>) {
  const now = Date.now();
  const successLogs = listUserLoginLogs().filter((log) => log.success && log.userId && !excludedUserIds.has(log.userId));
  const lastLoginMap = new Map<string, number>();

  for (const log of successLogs) {
    if (!log.userId) {
      continue;
    }
    const time = new Date(log.createdAt).getTime();
    if (!Number.isNaN(time) && time > (lastLoginMap.get(log.userId) ?? -Infinity)) {
      lastLoginMap.set(log.userId, time);
    }
  }

  const counts = {
    newUsers: 0,
    active: 0,
    quiet: 0,
    dormant: 0,
    banned: 0,
  };

  for (const user of listAuthUsers()) {
    if (user.status === "merged" || excludedUserIds.has(user.userId)) {
      continue;
    }
    if (user.status === "banned") {
      counts.banned += 1;
      continue;
    }

    const createdAt = new Date(user.createdAt).getTime();
    const lastLogin = lastLoginMap.get(user.userId);
    const ageDays = Math.max(0, Math.floor((now - createdAt) / DAY_MS));
    const inactiveDays =
      lastLogin == null ? ageDays : Math.max(0, Math.floor((now - lastLogin) / DAY_MS));

    if (ageDays <= 3) {
      counts.newUsers += 1;
    } else if (inactiveDays <= 7) {
      counts.active += 1;
    } else if (inactiveDays <= 30) {
      counts.quiet += 1;
    } else {
      counts.dormant += 1;
    }
  }

  return counts;
}

function buildRetention(windowDays: number, excludedUserIds: Set<string>) {
  const users = listAuthUsers().filter(
    (user) =>
      user.status !== "merged" &&
      !excludedUserIds.has(user.userId) &&
      new Date(user.createdAt).getTime() <= addDays(startOfDay(), -windowDays).getTime(),
  );
  const successLogs = listUserLoginLogs().filter((log) => log.success && log.userId && !excludedUserIds.has(log.userId));
  let retained = 0;

  for (const user of users) {
    const cohortStart = addDays(startOfDay(new Date(user.createdAt)), windowDays);
    const cohortEnd = addDays(cohortStart, 1);
    const hasLogin = successLogs.some((log) => {
      if (log.userId !== user.userId) {
        return false;
      }
      const time = new Date(log.createdAt).getTime();
      return time >= cohortStart.getTime() && time < cohortEnd.getTime();
    });
    if (hasLogin) {
      retained += 1;
    }
  }

  return {
    retained,
    base: users.length,
    rate: users.length > 0 ? retained / users.length : 0,
  };
}

function summarizeHealthChecks() {
  const storageMeta = getRuntimeStorageMeta();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  try {
    db.prepare("SELECT 1 AS ok").get();
    checks.push({ name: "SQLite", ok: true, detail: "读写连接正常" });
  } catch (error) {
    checks.push({
      name: "SQLite",
      ok: false,
      detail: error instanceof Error ? error.message : "检查失败",
    });
  }

  try {
    mkdirSync(storageMeta.dataDir, { recursive: true });
    accessSync(storageMeta.dataDir, constants.R_OK | constants.W_OK);
    checks.push({ name: "数据目录", ok: true, detail: storageMeta.dataDir });
  } catch (error) {
    checks.push({
      name: "数据目录",
      ok: false,
      detail: error instanceof Error ? error.message : "不可访问",
    });
  }

  try {
    mkdirSync(storageMeta.publicStorageDir, { recursive: true });
    accessSync(storageMeta.publicStorageDir, constants.R_OK | constants.W_OK);
    checks.push({ name: "公共存储", ok: true, detail: storageMeta.publicStorageDir });
  } catch (error) {
    checks.push({
      name: "公共存储",
      ok: false,
      detail: error instanceof Error ? error.message : "不可访问",
    });
  }

  checks.push({
    name: "FFmpeg",
    ok: Boolean(getFfmpegBinaryPathOrNull()),
    detail: getFfmpegBinaryPathOrNull() ? "可正常调用" : "缺少 FFmpeg",
  });

  return checks;
}

function buildTaskFunnel(tasks = listVideoTasks()) {
  const flow: Array<{ label: string; key: VideoTaskStatus | "CREATED_ONLY" }> = [
    { label: "任务创建", key: "CREATED_ONLY" },
    { label: "字幕音频", key: "SUBTITLE_AUDIO_READY" },
    { label: "视觉图", key: "IMAGES_READY" },
    { label: "片段完成", key: "CLIPS_READY" },
    { label: "成片完成", key: "COMPOSITION_READY" },
  ];

  const total = tasks.length;

  return flow.map((item) => {
    let count = total;
    if (item.key !== "CREATED_ONLY") {
      const targetStatus: VideoTaskStatus = item.key;
      count = tasks.filter((task) => getVideoTaskStatusIndex(task.status) >= getVideoTaskStatusIndex(targetStatus)).length;
    }
    return {
      label: item.label,
      value: count,
      displayValue: `${count}`,
      helper: total > 0 ? `占比 ${formatPercent(count / total)}` : "暂无任务",
    } satisfies AdminTrendItem;
  });
}

function buildRecentTaskRows(limit = 6): AdminRecordRow[] {
  return listVideoTasks()
    .slice(0, limit)
    .map((task) => ({
      title: task.title,
      subtitle: `${task.parameters.video.videoType} · ${task.status}`,
      value: formatDateTimeLabel(task.updatedAt || task.createdAt),
      note: `镜头 ${task.shotPlan?.shots?.length ?? 0} / 片段 ${task.directorPlan?.renderSegments?.length ?? task.parameters.video.segmentCount}`,
      href: buildAdminDataDetailsHref("tasks", { keyword: task.taskId }),
      tone: task.status === "COMPOSITION_READY" ? "success" : "neutral",
    }));
}

function buildRecentAlertRows(role: AdminRole, limit = 6): AdminRecordRow[] {
  const jobAlerts = listVideoJobs()
    .map((job) => ({
      job,
      time: new Date(job.updatedAt).getTime(),
    }))
    .filter((item) => item.job.status === "FAILED")
    .sort((left, right) => right.time - left.time)
    .map(({ job }) => ({
      title: job.taskName || job.jobId,
      subtitle: `视频作业失败 · ${job.provider ?? "unknown"}`,
      value: formatDateTimeLabel(job.updatedAt),
      note: sanitizeErrorSummary(job.error, role),
      href: buildAdminDataDetailsHref("system", { systemType: "job", status: "failed", keyword: job.jobId }),
      tone: "danger" as const,
    }));

  const materialAlerts = listVideoMaterials()
    .map((material) => ({
      material,
      time: new Date(material.updatedAt).getTime(),
    }))
    .filter((item) => item.material.status === "error")
    .sort((left, right) => right.time - left.time)
    .map(({ material }) => ({
      title: material.name || material.materialId,
      subtitle: "视频拆解异常",
      value: formatDateTimeLabel(material.updatedAt),
      note: sanitizeErrorSummary(material.statusMessage, role, "处理失败"),
      href: buildAdminDataDetailsHref("assets", { assetType: "material", status: "error", keyword: material.materialId }),
      tone: "warning" as const,
    }));

  return [...jobAlerts, ...materialAlerts].slice(0, limit);
}

export function getAdminOverviewSnapshot(role: AdminRole = "super_admin"): AdminOverviewSnapshot {
  ensureRecentAdminDataDailyAggregates();
  const excludedUserIds = resolveExcludedUserIds();
  const users = listAuthUsers().filter((user) => user.status !== "merged" && !excludedUserIds.has(user.userId));
  const activeUsers7d = getActiveUserIdsWithinDays(7, excludedUserIds);
  const tasks = listVideoTasks();
  const compositions = listVideoCompositions();
  const materials = listVideoMaterials();
  const archives = listProductArchives();
  const providerCalls = getProviderCallSummary(7);
  const stageSummaries = getTaskStageSummary(7);
  const eventSummary = getEventSummary(7);
  const stageSummaryMap = new Map(stageSummaries.map((item) => [item.stageKey, item]));
  const subtitleStage = stageSummaryMap.get("subtitle_audio");
  const materialStage = stageSummaryMap.get("material_processing");
  const clipStage = stageSummaryMap.get("clip_generation");
  const compositionStage = stageSummaryMap.get("composition");
  const recentProviderFailures = listRecentProviderFailures(4);
  const recentStageFailures = listRecentTaskStageFailures(4);
  const completedTaskIds = new Set(
    compositions.filter((item) => item.status === "COMPLETED" && item.taskId).map((item) => item.taskId as string),
  );
  const readyMaterials = materials.filter((item) => item.status === "ready").length;
  const readyArchives = archives.filter((item) => item.sourceImageUrl && item.parsedText.trim()).length;
  const totalProviderCalls = providerCalls.reduce((sum, item) => sum + item.totalCalls, 0);
  const failedProviderCalls = providerCalls.reduce((sum, item) => sum + item.failedCalls, 0);
  const overviewAlerts = [
    ...recentStageFailures.map((item) => ({
      sortTime: new Date(item.finishedAt ?? item.startedAt).getTime(),
      row: {
        title: item.stageKey,
        subtitle: `${item.provider ?? "unknown"} · ${item.modelId ?? "unknown-model"}`,
        value: formatDateTimeLabel(item.finishedAt ?? item.startedAt),
        note: sanitizeErrorSummary(item.errorMessage, role, `task ${item.taskId}`),
        href: buildAdminDataDetailsHref("system", {
          systemType: "stage",
          status: "failed",
          keyword: item.taskId,
        }),
        tone: "danger" as const,
      },
    })),
    ...recentProviderFailures.map((item) => ({
      sortTime: new Date(item.createdAt).getTime(),
      row: {
        title: item.serviceName,
        subtitle: `${item.provider ?? "provider"} · ${item.modelId ?? "unknown-model"}`,
        value: formatDateTimeLabel(item.createdAt),
        note: sanitizeProviderFailureSummary(item.errorCode, item.objectId, role),
        href: buildAdminDataDetailsHref("system", {
          systemType: "provider",
          status: "failed",
          keyword: item.objectId ?? item.serviceName,
        }),
        tone: "danger" as const,
      },
    })),
    ...buildRecentAlertRows(role, 6).map((item) => ({
      sortTime: Date.now(),
      row: item,
    })),
  ]
    .sort((left, right) => right.sortTime - left.sortTime)
    .slice(0, 6)
    .map((item) => item.row);

  return {
    stats: [
      {
        label: "活跃用户",
        value: formatNumber(activeUsers7d.size),
        meta: `近 7 日登录活跃 / 总用户 ${formatNumber(users.length)}`,
        tone: "primary",
      },
      {
        label: "任务总量",
        value: formatNumber(tasks.length),
        meta: `成片完成 ${formatPercent(tasks.length > 0 ? completedTaskIds.size / tasks.length : 0)}`,
        tone: "success",
      },
      {
        label: "Provider 调用",
        value: formatNumber(totalProviderCalls),
        meta: `近 7 日失败 ${formatNumber(failedProviderCalls)} / 素材 ready ${formatNumber(readyMaterials)}`,
        tone: "neutral",
      },
      {
        label: "异常事件",
        value: formatNumber(overviewAlerts.length),
        meta: `FAILED 作业 ${listVideoJobs().filter((job) => job.status === "FAILED").length} / stage 失败 ${recentStageFailures.length}`,
        tone: "warning",
      },
    ],
    panels: [
      {
        title: "用户与登录",
        hint: "auth 域",
        items: [
          { label: "用户总数", value: formatNumber(users.length), meta: "已排除 merged 用户" },
          { label: "近 7 日活跃", value: formatNumber(activeUsers7d.size), meta: "按成功登录去重" },
          {
            label: "密码登录占比",
            value: formatPercent(
              (() => {
                const logs = listUserLoginLogs().filter(
                  (item) =>
                    item.success &&
                    item.userId &&
                    !excludedUserIds.has(item.userId) &&
                    new Date(item.createdAt).getTime() >= addDays(startOfDay(), -6).getTime(),
                );
                const passwordCount = logs.filter((item) => item.loginType === "password").length;
                return logs.length > 0 ? passwordCount / logs.length : 0;
              })(),
            ),
            meta: "近 7 日成功登录",
            href: "/admin/data/users",
          },
          {
            label: "风控限制项",
            value: formatNumber(listRiskBlockEntries().length),
            meta: `短信开关 ${getAuthRiskConfig().smsEnabled ? "开启" : "关闭"}`,
            href: "/admin/data/system",
          },
        ],
      },
      {
        title: "任务与素材",
        hint: "主链路",
        items: [
          { label: "任务总数", value: formatNumber(tasks.length), meta: "video-tasks" },
          { label: "成片完成", value: formatNumber(completedTaskIds.size), meta: "合成完成且有结果" },
          { label: "商品档案就绪", value: `${readyArchives}/${archives.length}`, meta: "已上传且完成解析" },
          {
            label: "素材归档",
            value: formatNumber(listMaterialLibraryItems().length),
            meta: "图片 / 片段 / 成片归档总量",
            href: "/admin/data/assets",
          },
        ],
      },
      {
        title: "P1 运行链路",
        hint: "近 7 日 analytics",
        items: [
          {
            label: "provider 调用",
            value: formatNumber(totalProviderCalls),
            meta: `失败 ${formatNumber(failedProviderCalls)} / 服务数 ${formatNumber(providerCalls.length)}`,
            href: buildAdminDataDetailsHref("system", { systemType: "provider" }),
          },
          {
            label: "业务事件",
            value: formatNumber(eventSummary.totalEvents),
            meta:
              eventSummary.totalEvents > 0
                ? `近 7 日 ${formatNumber(eventSummary.distinctActors)} 个用户触发`
                : "事件表刚接入，等待业务动作沉淀",
          },
          {
            label: "片段队列",
            value: formatNumber((clipStage?.queuedRuns ?? 0) + (clipStage?.inProgressRuns ?? 0)),
            meta: clipStage ? `clip_generation 总 run ${clipStage.totalRuns}` : "近 7 日暂无片段 run",
            href: buildAdminDataDetailsHref("system", { systemType: "stage", keyword: "clip_generation" }),
          },
          {
            label: "成片阶段",
            value: compositionStage ? formatPercent(getStageSuccessRate(compositionStage)) : "0%",
            meta: compositionStage ? `平均 ${formatDurationMs(compositionStage.avgDurationMs)}` : "近 7 日暂无合成 run",
            href: buildAdminDataDetailsHref("system", { systemType: "stage", keyword: "composition" }),
          },
          {
            label: "商品解析完成",
            value: formatPercent(archives.length > 0 ? readyArchives / archives.length : 0),
            meta: `${formatNumber(readyArchives)}/${formatNumber(archives.length)} 个商品档案`,
            href: buildAdminDataDetailsHref("assets", { assetType: "archive" }),
          },
        ],
      },
    ],
    userTrend: countUniqueByDay(
      listUserLoginLogs(),
      (item) => item.createdAt,
      (item) => item.userId,
      (item) => Boolean(item.success && item.userId && !excludedUserIds.has(item.userId)),
    ),
    taskTrend: countItemsByDay(listVideoTasks(), (item) => item.createdAt),
    taskFunnel: buildTaskFunnel(tasks),
    stageMetrics: [
      buildStageMetricCard(subtitleStage, "字幕阶段", "近 7 日暂无字幕 run"),
      buildStageMetricCard(materialStage, "素材处理", "近 7 日暂无素材 run"),
      buildStageMetricCard(clipStage, "片段阶段", "近 7 日暂无片段 run"),
      buildStageMetricCard(compositionStage, "成片阶段", "近 7 日暂无合成 run"),
    ],
    recentAlerts: overviewAlerts,
    recentTasks: buildRecentTaskRows(),
  };
}

export function getAdminUserSnapshot(): AdminUserSnapshot {
  ensureRecentAdminDataDailyAggregates();
  const excludedUserIds = resolveExcludedUserIds();
  const users = listAuthUsers().filter((user) => user.status !== "merged" && !excludedUserIds.has(user.userId));
  const loginLogs = listUserLoginLogs().filter((item) => item.userId && !excludedUserIds.has(item.userId));
  const successLogs = loginLogs.filter((item) => item.success);
  const sevenDayStart = addDays(startOfDay(), -6);
  const recentSuccessLogs = successLogs.filter((item) => new Date(item.createdAt).getTime() >= sevenDayStart.getTime());
  const lifecycle = buildUserLifecycle(excludedUserIds);
  const d1Retention = buildRetention(1, excludedUserIds);
  const d7Retention = buildRetention(7, excludedUserIds);

  return {
    stats: [
      {
        label: "用户总数",
        value: formatNumber(users.length),
        meta: "已排除 merged 用户",
        tone: "primary",
      },
      {
        label: "近 7 日新增",
        value: formatNumber(users.filter((item) => new Date(item.createdAt).getTime() >= sevenDayStart.getTime()).length),
        meta: "按注册时间统计",
        tone: "success",
      },
      {
        label: "近 7 日活跃",
        value: formatNumber(new Set(recentSuccessLogs.map((item) => item.userId as string)).size),
        meta: "按成功登录去重",
        tone: "neutral",
      },
      {
        label: "密码登录占比",
        value: formatPercent(
          recentSuccessLogs.length > 0
            ? recentSuccessLogs.filter((item) => item.loginType === "password").length / recentSuccessLogs.length
            : 0,
        ),
        meta: "近 7 日成功登录",
        tone: "warning",
      },
    ],
    panels: [
      {
        title: "核心口径",
        hint: "P0 说明",
        items: [
          { label: "活跃用户", value: "登录口径", meta: "先按成功登录定义，P1 升级到业务行为活跃" },
          { label: "留存口径", value: "注册 cohort", meta: "按 D1 / D7 的 exact day 登录回访计算" },
          { label: "生命周期", value: "规则计算", meta: "新注册 / 活跃 / 沉默 / 沉睡 / 封禁" },
          { label: "种子账号", value: "已排除", meta: "按当前默认工作台账号规则做启发式排除" },
        ],
      },
      {
        title: "风控与会话",
        hint: "auth 域",
        items: [
          {
            label: "活动会话",
            value: formatNumber(
              listUserSessions().filter(
                (item) => !item.revokedAt && !excludedUserIds.has(item.userId) && new Date(item.expiresAt).getTime() > Date.now(),
              ).length,
            ),
            meta: "未撤销且未过期",
          },
          {
            label: "短信风控限制",
            value: formatNumber(listRiskBlockEntries().length),
            meta: `短信 ${getAuthRiskConfig().smsEnabled ? "开启" : "关闭"} / 调试 ${getAuthRiskConfig().smsDebugMode ? "开启" : "关闭"}`,
          },
          {
            label: "近 7 日失败登录",
            value: formatNumber(
              loginLogs.filter(
                (item) => !item.success && new Date(item.createdAt).getTime() >= sevenDayStart.getTime(),
              ).length,
            ),
            meta: "用于定位登录与风控问题",
          },
          {
            label: "手机号登录域",
            value: "已接入",
            meta: "用户统一以手机号为登录主体",
          },
        ],
      },
    ],
    newUserTrend: countItemsByDay(users, (item) => item.createdAt),
    activeUserTrend: countUniqueByDay(
      recentSuccessLogs,
      (item) => item.createdAt,
      (item) => item.userId,
    ),
    loginMix: [
      {
        label: "密码登录",
        value: formatNumber(recentSuccessLogs.filter((item) => item.loginType === "password").length),
        meta: "近 7 日成功登录次数",
        tone: "primary",
      },
      {
        label: "短信登录",
        value: formatNumber(recentSuccessLogs.filter((item) => item.loginType === "sms").length),
        meta: "近 7 日成功登录次数",
        tone: "success",
      },
      {
        label: "失败登录",
        value: formatNumber(
          loginLogs.filter(
            (item) => !item.success && new Date(item.createdAt).getTime() >= sevenDayStart.getTime(),
          ).length,
        ),
        meta: "近 7 日失败次数",
        tone: "warning",
      },
      {
        label: "活跃去重",
        value: formatNumber(new Set(recentSuccessLogs.map((item) => item.userId as string)).size),
        meta: "近 7 日成功登录去重用户",
        tone: "neutral",
      },
    ],
    lifecycle: [
      { label: "新注册", value: formatNumber(lifecycle.newUsers), meta: "注册 <= 3 天", tone: "primary" },
      { label: "活跃", value: formatNumber(lifecycle.active), meta: "最近 7 天有登录", tone: "success" },
      { label: "沉默", value: formatNumber(lifecycle.quiet), meta: "8~30 天未登录", tone: "warning" },
      { label: "沉睡 / 封禁", value: `${lifecycle.dormant}/${lifecycle.banned}`, meta: "30+ 天未登录 / banned", tone: "neutral" },
    ],
    retention: [
      {
        label: "次日留存",
        value: formatPercent(d1Retention.rate),
        meta: `${d1Retention.retained}/${d1Retention.base} 个 cohort 用户`,
        tone: "primary",
      },
      {
        label: "7 日留存",
        value: formatPercent(d7Retention.rate),
        meta: `${d7Retention.retained}/${d7Retention.base} 个 cohort 用户`,
        tone: "success",
      },
      {
        label: "短信冷却",
        value: `${getAuthRiskConfig().smsCooldownSeconds}s`,
        meta: "短信验证码发送冷却",
        tone: "warning",
      },
      {
        label: "Token 过期",
        value: `${getAuthRiskConfig().tokenExpireDays} 天`,
        meta: "用户与后台会话有效期",
        tone: "neutral",
      },
    ],
    recentUsers: users.slice(0, 6).map((user) => ({
      title: user.nickname,
      subtitle: `${user.userId} · ${user.status}`,
      value: formatDateTimeLabel(user.createdAt),
      note: `最近登录 ${formatDateTimeLabel(user.lastLoginAt)}`,
      href: "/admin/data/details",
    })),
    recentLogins: successLogs
      .slice(0, 6)
      .map((log) => ({
        title: `${log.loginType === "password" ? "密码登录" : "短信登录"}`,
        subtitle: log.detail,
        value: formatDateTimeLabel(log.createdAt),
        note: `user ${log.userId ?? "unknown"}`,
        href: "/admin/data/details",
      })),
  };
}

export function getAdminTaskSnapshot(role: AdminRole = "super_admin"): AdminTaskSnapshot {
  ensureRecentAdminDataDailyAggregates();
  const tasks = listVideoTasks();
  const jobs = listVideoJobs();
  const compositions = listVideoCompositions();
  const providerCalls = getProviderCallSummary(7);
  const stageSummaries = getTaskStageSummary(7);
  const stageSummaryMap = new Map(stageSummaries.map((item) => [item.stageKey, item]));
  const subtitleStage = stageSummaryMap.get("subtitle_audio");
  const visualStage = stageSummaryMap.get("visual_images");
  const clipStage = stageSummaryMap.get("clip_generation");
  const lipSyncStage = stageSummaryMap.get("lip_sync");
  const compositionStage = stageSummaryMap.get("composition");
  const nonCompositionJobs = jobs.filter((item) => item.mode !== "composition");
  const clipStageTerminal = getStageTerminalCount(clipStage);
  const clipSuccessRate =
    clipStageTerminal > 0
      ? (clipStage?.completedRuns ?? 0) / clipStageTerminal
      : nonCompositionJobs.length > 0
        ? nonCompositionJobs.filter((item) => item.status === "COMPLETED").length / nonCompositionJobs.length
        : 0;
  const subtitleStageTerminal = getStageTerminalCount(subtitleStage);
  const subtitleSuccessRate = subtitleStageTerminal > 0 ? (subtitleStage?.completedRuns ?? 0) / subtitleStageTerminal : 0;
  const compositionStageTerminal = getStageTerminalCount(compositionStage);
  const compositionSuccessRate =
    compositionStageTerminal > 0
      ? getStageSuccessRate(compositionStage)
      : compositions.length > 0
        ? compositions.filter((item) => item.status === "COMPLETED").length / compositions.length
        : 0;
  const taskStatusMap = new Map<string, number>();
  for (const task of tasks) {
    taskStatusMap.set(task.status, (taskStatusMap.get(task.status) ?? 0) + 1);
  }
  const recentStageFailures = listRecentTaskStageFailures(6);
  const recentProviderFailures = listRecentProviderFailures(6);

  return {
    stats: [
      { label: "任务总量", value: formatNumber(tasks.length), meta: "video-tasks", tone: "primary" },
      {
        label: "近 7 日新建",
        value: formatNumber(tasks.filter((item) => new Date(item.createdAt).getTime() >= addDays(startOfDay(), -6).getTime()).length),
        meta: "按创建时间统计",
        tone: "success",
      },
      {
        label: "字幕阶段成功率",
        value: formatPercent(subtitleSuccessRate),
        meta:
          subtitleStageTerminal > 0
            ? `近 7 日 stage run ${subtitleStage?.completedRuns ?? 0}/${subtitleStageTerminal}`
            : "近 7 日暂无字幕阶段运行",
        tone: "warning",
      },
      {
        label: "片段阶段成功率",
        value: formatPercent(clipSuccessRate),
        meta:
          clipStageTerminal > 0
            ? `近 7 日 stage run ${clipStage?.completedRuns ?? 0}/${clipStageTerminal}`
            : `回退按作业近似 ${nonCompositionJobs.filter((item) => item.status === "COMPLETED").length}/${nonCompositionJobs.length}`,
        tone: "neutral",
      },
    ],
    panels: [
      {
        title: "链路口径",
        hint: "任务主链路",
        items: [
          { label: "任务主对象", value: "video-tasks", meta: "主任务状态与参数源" },
          {
            label: "字幕结果",
            value: formatNumber(listNarrationResults().length),
            meta: subtitleStage ? `近 7 日 run ${subtitleStage.totalRuns}` : "narration-results",
          },
          {
            label: "视觉图镜头",
            value: formatNumber(listTaskVisualImageShots().length),
            meta: visualStage ? `近 7 日 run ${visualStage.totalRuns}` : "task-visual-image-shots",
          },
          {
            label: "片段记录",
            value: formatNumber(listTaskClipShots().length),
            meta: clipStage ? `近 7 日 run ${clipStage.totalRuns}` : "task-clip-shots",
          },
        ],
      },
      {
        title: "P1 运行日志",
        hint: "真实 provider / stage 数据",
        items: [
          {
            label: "provider 调用",
            value: formatNumber(providerCalls.reduce((sum, item) => sum + item.totalCalls, 0)),
            meta: `近 7 日失败 ${formatNumber(providerCalls.reduce((sum, item) => sum + item.failedCalls, 0))}`,
          },
          {
            label: "视觉阶段",
            value: visualStage ? formatPercent(visualStage.completedRuns / Math.max(1, visualStage.completedRuns + visualStage.failedRuns)) : "0%",
            meta: visualStage ? `平均耗时 ${formatDurationMs(visualStage.avgDurationMs)}` : "近 7 日暂无出图 run",
          },
          {
            label: "片段队列",
            value: formatNumber((clipStage?.queuedRuns ?? 0) + (clipStage?.inProgressRuns ?? 0)),
            meta: clipStage ? "按 clip_generation stage run" : "暂无排队片段",
          },
          {
            label: "成片成功率",
            value: formatPercent(compositionSuccessRate),
            meta: `${compositions.filter((item) => item.status === "COMPLETED").length}/${compositions.length} 个合成项目`,
          },
        ],
      },
    ],
    taskTrend: countItemsByDay(tasks, (item) => item.createdAt),
    taskStatuses: Array.from(taskStatusMap.entries())
      .map(([label, value]) => ({
        label,
        value,
        displayValue: `${value}`,
        helper: tasks.length > 0 ? `占比 ${formatPercent(value / tasks.length)}` : "暂无任务",
      }))
      .sort((left, right) => right.value - left.value),
    taskFunnel: buildTaskFunnel(tasks),
    stageMetrics: [
      buildStageMetricCard(subtitleStage, "字幕阶段", "近 7 日暂无字幕 run"),
      buildStageMetricCard(visualStage, "出图阶段", "近 7 日暂无出图 run"),
      buildStageMetricCard(lipSyncStage, "口型阶段", "近 7 日暂无口型 run"),
      buildStageMetricCard(compositionStage, "成片阶段", "近 7 日暂无合成 run"),
    ],
    providerMix: providerCalls.slice(0, 4).map((item) => ({
      label: item.serviceName,
      value: formatNumber(item.totalCalls),
      meta: `${item.provider ?? "provider"} · 成功 ${formatPercent(item.totalCalls > 0 ? item.successCalls / item.totalCalls : 0)} · ${formatDurationMs(item.avgDurationMs)}`,
      tone: item.failedCalls > 0 ? ("warning" as const) : ("primary" as const),
    })),
    recentTasks: buildRecentTaskRows(),
    recentFailures: [
      ...recentStageFailures.map((item) => ({
        sortTime: new Date(item.finishedAt ?? item.startedAt).getTime(),
        row: {
          title: item.stageKey,
          subtitle: `${item.provider ?? "unknown"} · ${item.modelId ?? "unknown-model"}`,
          value: formatDateTimeLabel(item.finishedAt ?? item.startedAt),
          note: sanitizeErrorSummary(item.errorMessage, role, `task ${item.taskId}`),
          href: buildAdminDataDetailsHref("system", {
            systemType: "stage",
            status: "failed",
            keyword: item.taskId,
          }),
          tone: "danger" as const,
        },
      })),
      ...recentProviderFailures.map((item) => ({
        sortTime: new Date(item.createdAt).getTime(),
        row: {
          title: item.serviceName,
          subtitle: `${item.provider ?? "unknown"} · ${item.modelId ?? "unknown-model"}`,
          value: formatDateTimeLabel(item.createdAt),
          note: sanitizeProviderFailureSummary(item.errorCode, item.objectId, role),
          href: buildAdminDataDetailsHref("system", {
            systemType: "provider",
            status: "failed",
            keyword: item.objectId ?? item.serviceName,
          }),
          tone: "danger" as const,
        },
      })),
      ...buildRecentAlertRows(role, 6)
        .filter((item) => item.tone === "danger")
        .map((item) => ({
          sortTime: Date.now(),
          row: item,
        })),
    ]
      .sort((left, right) => right.sortTime - left.sortTime)
      .slice(0, 6)
      .map((item) => item.row),
  };
}

export function getAdminAssetSnapshot(role: AdminRole = "super_admin"): AdminAssetSnapshot {
  ensureRecentAdminDataDailyAggregates();
  const archives = listProductArchives();
  const materials = listVideoMaterials();
  const materialLibrary = listMaterialLibraryItems();
  const clonedVoices = listClonedVoices();
  const timbreMeta = getStoredTimbreLibraryMeta();
  const providerCalls = getAssetProviderCallSummary(7);
  const providerCallMap = new Map(providerCalls.map((item) => [item.serviceName, item]));
  const stageSummaries = getTaskStageSummary(7);
  const materialStage = stageSummaries.find((item) => item.stageKey === "material_processing") ?? null;
  const voiceStage = stageSummaries.find((item) => item.stageKey === "voice_clone") ?? null;
  const recentProviderFailures = listRecentAssetProviderFailures(6);
  const readyArchives = archives.filter((item) => item.sourceImageUrl && item.parsedText.trim()).length;
  const readyMaterials = materials.filter((item) => item.status === "ready").length;
  const materialStageTerminal = (materialStage?.completedRuns ?? 0) + (materialStage?.failedRuns ?? 0);
  const materialStageSuccessRate =
    materialStageTerminal > 0 ? (materialStage?.completedRuns ?? 0) / materialStageTerminal : 0;
  const totalProviderCalls = providerCalls.reduce((sum, item) => sum + item.totalCalls, 0);
  const failedProviderCalls = providerCalls.reduce((sum, item) => sum + item.failedCalls, 0);
  const archiveStatusItems = [
    { label: "已解析商品档案", value: readyArchives },
    { label: "待完善商品档案", value: archives.length - readyArchives },
  ];
  const voiceStatusMap = new Map<string, number>();
  for (const voice of clonedVoices) {
    voiceStatusMap.set(voice.status, (voiceStatusMap.get(voice.status) ?? 0) + 1);
  }

  return {
    stats: [
      {
        label: "商品档案",
        value: formatNumber(archives.length),
        meta: `解析完成率 ${formatPercent(archives.length > 0 ? readyArchives / archives.length : 0)}`,
        tone: "primary",
      },
      {
        label: "视频素材",
        value: formatNumber(materials.length),
        meta:
          materialStageTerminal > 0
            ? `处理成功率 ${formatPercent(materialStageSuccessRate)}`
            : `ready ${readyMaterials}/${materials.length}`,
        tone: "success",
      },
      {
        label: "资产服务调用",
        value: formatNumber(totalProviderCalls),
        meta:
          totalProviderCalls > 0
            ? `近 7 日失败 ${formatNumber(failedProviderCalls)}`
            : "近 7 日暂无素材 / 音色服务调用",
        tone: "neutral",
      },
      {
        label: "克隆音色",
        value: formatNumber(clonedVoices.length),
        meta:
          voiceStage != null
            ? `近 7 日提交 ${formatNumber(voiceStage.totalRuns)}`
            : `音色库 ${formatNumber(timbreMeta.count)} / 同步 ${formatDateTimeLabel(timbreMeta.syncedAt)}`,
        tone: "warning",
      },
    ],
    panels: [
      {
        title: "当前接入对象",
        hint: "真实数据域",
        items: [
          { label: "商品档案", value: formatNumber(archives.length), meta: "product-archives" },
          { label: "视频拆解素材", value: formatNumber(materials.length), meta: "video-materials" },
          { label: "素材归档", value: formatNumber(materialLibrary.length), meta: "material-library" },
          { label: "音色克隆", value: formatNumber(clonedVoices.length), meta: "voice-management.clonedVoices" },
        ],
      },
      {
        title: "P1 运行日志",
        hint: "近 7 日真实调用",
        items: [
          {
            label: "素材处理 run",
            value: formatNumber(materialStage?.totalRuns ?? 0),
            meta:
              materialStage != null
                ? `成功率 ${formatPercent(materialStageSuccessRate)} / 平均 ${formatDurationMs(materialStage.avgDurationMs)}`
                : "近 7 日暂无素材处理 run",
          },
          {
            label: "ASR 调用",
            value: formatNumber(providerCallMap.get("audio.asr")?.totalCalls ?? 0),
            meta: `失败 ${formatNumber(providerCallMap.get("audio.asr")?.failedCalls ?? 0)}`,
          },
          {
            label: "视频分析",
            value: formatNumber(providerCallMap.get("video.analysis")?.totalCalls ?? 0),
            meta: `平均 ${formatDurationMs(providerCallMap.get("video.analysis")?.avgDurationMs ?? null)}`,
          },
          {
            label: "音色服务",
            value: formatNumber(
              providerCalls
                .filter((item) => item.serviceName.startsWith("voice.clone.") || item.serviceName === "audio.voice_preview")
                .reduce((sum, item) => sum + item.totalCalls, 0),
            ),
            meta: recentProviderFailures[0] ? `最近异常 ${formatDateTimeLabel(recentProviderFailures[0].createdAt)}` : "近 7 日无音色异常",
          },
        ],
      },
    ],
    archiveTrend: countItemsByDay(archives, (item) => item.createdAt),
    materialTrend: countItemsByDay(materials, (item) => item.createdAt),
    assetMix: [
      {
        label: "已解析档案",
        value: formatNumber(archiveStatusItems[0].value),
        meta: archives.length > 0 ? formatPercent(archiveStatusItems[0].value / archives.length) : "0%",
        tone: "primary",
      },
      {
        label: "素材处理成功",
        value: formatPercent(materialStageSuccessRate),
        meta:
          materialStageTerminal > 0
            ? `${materialStage?.completedRuns ?? 0}/${materialStageTerminal} 个处理 run`
            : materials.length > 0
              ? `${formatNumber(readyMaterials)} 个 ready 素材`
              : "暂无处理 run",
        tone: "success",
      },
      {
        label: "ASR 调用",
        value: formatNumber(providerCallMap.get("audio.asr")?.totalCalls ?? 0),
        meta: providerCallMap.get("audio.asr")
          ? `成功率 ${formatPercent(
              (providerCallMap.get("audio.asr")!.totalCalls - providerCallMap.get("audio.asr")!.failedCalls) /
                Math.max(1, providerCallMap.get("audio.asr")!.totalCalls),
            )}`
          : "近 7 日暂无 ASR 调用",
        tone: "warning",
      },
      {
        label: "脚本生成",
        value: formatNumber(providerCallMap.get("llm.material_script")?.totalCalls ?? 0),
        meta: providerCallMap.get("llm.material_script")
          ? `平均 ${formatDurationMs(providerCallMap.get("llm.material_script")!.avgDurationMs)}`
          : "近 7 日暂无脚本生成",
        tone: "neutral",
      },
    ],
    voiceMix: [
      {
        label: "训练提交",
        value: formatNumber(providerCallMap.get("voice.clone.upload")?.totalCalls ?? 0),
        meta: `失败 ${formatNumber(providerCallMap.get("voice.clone.upload")?.failedCalls ?? 0)}`,
        tone: "primary",
      },
      {
        label: "状态查询",
        value: formatNumber(
          (providerCallMap.get("voice.clone.status")?.totalCalls ?? 0) +
            (providerCallMap.get("voice.clone.status_batch")?.totalCalls ?? 0),
        ),
        meta: voiceStage ? `近 7 日 clone run ${formatNumber(voiceStage.totalRuns)}` : "近 7 日暂无 clone run",
        tone: "neutral",
      },
      {
        label: "试听生成",
        value: formatNumber(providerCallMap.get("audio.voice_preview")?.totalCalls ?? 0),
        meta: providerCallMap.get("audio.voice_preview")
          ? `平均 ${formatDurationMs(providerCallMap.get("audio.voice_preview")!.avgDurationMs)}`
          : "近 7 日暂无试听生成",
        tone: "success",
      },
      {
        label: "ACTIVE / FAILED",
        value: `${formatNumber(voiceStatusMap.get("ACTIVE") ?? 0)}/${formatNumber(voiceStatusMap.get("FAILED") ?? 0)}`,
        meta: `音色库 ${formatNumber(timbreMeta.count)} / 同步 ${formatDateTimeLabel(timbreMeta.syncedAt)}`,
        tone: "warning",
      },
    ],
    latestArchives: archives.slice(0, 6).map((archive) => ({
      title: archive.title,
      subtitle: archive.sourceImageUrl ? "已上传商品图" : "未上传商品图",
      value: formatDateTimeLabel(archive.updatedAt),
      note: archive.parsedText.trim() ? "已完成结构化解析" : "待补解析内容",
      href: "/admin/data/assets",
    })),
    latestMaterials: [
      ...recentProviderFailures.map((item) => ({
        sortTime: new Date(item.createdAt).getTime(),
        row: {
          title: item.serviceName,
          subtitle: `${item.provider ?? "provider"} · ${item.modelId ?? "unknown-model"}`,
          value: formatDateTimeLabel(item.createdAt),
          note: sanitizeProviderFailureSummary(item.errorCode, item.objectId, role),
          href: "/admin/data/system",
          tone: "danger" as const,
        },
      })),
      ...materials.slice(0, 6).map((material) => ({
        sortTime: new Date(material.updatedAt).getTime(),
        row: {
          title: material.name || material.materialId,
          subtitle: `${material.processingMode} · ${material.status}`,
          value: formatDateTimeLabel(material.updatedAt),
          note: sanitizeErrorSummary(material.statusMessage, role, material.status === "ready" ? "处理完成" : "处理中"),
          href: "/admin/data/assets",
          tone: material.status === "error" ? ("danger" as const) : material.status === "ready" ? ("success" as const) : ("warning" as const),
        },
      })),
    ]
      .sort((left, right) => right.sortTime - left.sortTime)
      .slice(0, 6)
      .map((item) => item.row),
  };
}

export function getAdminSystemSnapshot(role: AdminRole = "super_admin"): AdminSystemSnapshot {
  ensureRecentAdminDataDailyAggregates();
  const checks = summarizeHealthChecks();
  const jobs = listVideoJobs();
  const services = buildOverviewServiceReport();
  const pipelineStages = buildOverviewPipelineModelMap();
  const apiSummary = getApiRequestSummary(7);
  const providerSummary = getProviderCallSummary(7);
  const providerFailures = listRecentProviderFailures(6);
  const stageSummaries = getTaskStageSummary(7);
  const clipStage = stageSummaries.find((item) => item.stageKey === "clip_generation");
  const lipSyncStage = stageSummaries.find((item) => item.stageKey === "lip_sync");
  const compositionStage = stageSummaries.find((item) => item.stageKey === "composition");
  const materialStage = stageSummaries.find((item) => item.stageKey === "material_processing");
  const pendingJobs = jobs.filter((item) => item.status === "QUEUED" || item.status === "IN_PROGRESS");
  const failedJobs = jobs.filter((item) => item.status === "FAILED");
  const totalProviderCalls = providerSummary.reduce((sum, item) => sum + item.totalCalls, 0);
  const failedProviderCalls = providerSummary.reduce((sum, item) => sum + item.failedCalls, 0);
  const providerSuccessRate =
    totalProviderCalls > 0 ? (totalProviderCalls - failedProviderCalls) / totalProviderCalls : 0;
  const serviceStatuses = services
    .slice(0, 3)
    .map((item) => ({
      title: item.title,
      subtitle: `${item.type} · ${item.modelOrService}`,
      value: item.status,
      note: `本周 ${item.thisWeekCount} / 昨日 ${item.yesterdayCount}`,
      href: buildAdminDataDetailsHref("system", { systemType: "provider", keyword: item.title }),
      tone:
        item.statusTone === "danger"
          ? ("danger" as const)
          : item.statusTone === "warning"
            ? ("warning" as const)
            : ("success" as const),
    }));
  const providerStatusRows = providerSummary.slice(0, 3).map((item) => ({
    title: item.serviceName,
    subtitle: `${item.provider ?? "provider"} · ${item.modelId ?? "unknown-model"}`,
    value: formatPercent(item.totalCalls > 0 ? item.successCalls / item.totalCalls : 0),
    note: `${formatNumber(item.totalCalls)} 次 · 平均 ${formatDurationMs(item.avgDurationMs)}`,
    href: buildAdminDataDetailsHref("system", { systemType: "provider", keyword: item.serviceName }),
    tone: item.failedCalls > 0 ? ("warning" as const) : ("success" as const),
  }));
  const recentActions = listAdminActionLogs()
    .slice(0, 6)
    .map((item) => ({
      title: item.detail,
      subtitle: `${item.actionType} · ${item.targetType}`,
      value: formatDateTimeLabel(item.createdAt),
      note: `admin ${item.adminId}`,
      href: buildAdminDataDetailsHref("system", { systemType: "action", keyword: item.adminId }),
      tone: "neutral" as const,
    }));
  const jobStatusMap = new Map<string, number>();
  for (const job of jobs) {
    jobStatusMap.set(job.status, (jobStatusMap.get(job.status) ?? 0) + 1);
  }

  return {
    stats: [
      {
        label: "健康检查",
        value: `${checks.filter((item) => item.ok).length}/${checks.length}`,
        meta: checks.every((item) => item.ok) ? "核心依赖正常" : "存在待处理项",
        tone: checks.every((item) => item.ok) ? "success" : "warning",
      },
      {
        label: "7 日 API 调用",
        value: formatNumber(apiSummary.totalCalls),
        meta: `失败 ${formatNumber(apiSummary.failedCalls)} / 平均 ${formatDurationMs(apiSummary.avgDurationMs)}`,
        tone: "primary",
      },
      {
        label: "Provider 成功率",
        value: formatPercent(providerSuccessRate),
        meta:
          totalProviderCalls > 0
            ? `${formatNumber(totalProviderCalls - failedProviderCalls)}/${formatNumber(totalProviderCalls)} 次第三方调用`
            : "近 7 日暂无第三方调用",
        tone: "warning",
      },
      {
        label: "待处理作业",
        value: formatNumber(pendingJobs.length),
        meta: `clip stage 排队 ${formatNumber((clipStage?.queuedRuns ?? 0) + (clipStage?.inProgressRuns ?? 0))}`,
        tone: "neutral",
      },
    ],
    panels: [
      {
        title: "当前可复用",
        hint: "现有系统快照",
        items: [
          { label: "基础健康", value: "已接入", meta: "SQLite / 目录 / FFmpeg" },
          { label: "运行服务", value: formatNumber(services.length), meta: "overview-service-report" },
          { label: "主链路节点", value: formatNumber(pipelineStages.length), meta: "overview pipeline map" },
          { label: "后台操作日志", value: formatNumber(listAdminActionLogs().length), meta: "auth-admin-action-logs" },
        ],
      },
      {
        title: "P1 实时日志",
        hint: "近 7 日 analytics",
        items: [
          {
            label: "api_request_log",
            value: formatNumber(apiSummary.totalCalls),
            meta: `最近更新时间 ${formatDateTimeLabel(apiSummary.latestCreatedAt)}`,
          },
          {
            label: "provider_call_log",
            value: formatNumber(totalProviderCalls),
            meta: `失败 ${formatNumber(failedProviderCalls)} / 成功率 ${formatPercent(providerSuccessRate)}`,
          },
          {
            label: "clip stage",
            value: formatNumber(clipStage?.totalRuns ?? 0),
            meta: clipStage ? `平均耗时 ${formatDurationMs(clipStage.avgDurationMs)}` : "近 7 日暂无 clip run",
          },
          {
            label: "最近失败调用",
            value: formatNumber(providerFailures.length),
            meta: providerFailures[0] ? formatDateTimeLabel(providerFailures[0].createdAt) : "暂无失败调用",
          },
        ],
      },
    ],
    healthChecks: checks.map((item) => ({
      label: item.name,
      value: item.ok ? "正常" : "异常",
      meta: sanitizeSystemDetail(item.detail, item.name, item.ok, role),
      tone: item.ok ? ("success" as const) : ("warning" as const),
    })),
    stageMetrics: [
      buildStageMetricCard(materialStage, "素材处理", "近 7 日暂无素材处理 run"),
      buildStageMetricCard(clipStage, "片段生成", "近 7 日暂无片段 run"),
      buildStageMetricCard(lipSyncStage, "口型同步", "近 7 日暂无口型 run"),
      buildStageMetricCard(compositionStage, "成片合成", "近 7 日暂无合成 run"),
    ],
    serviceStatuses: [...providerStatusRows, ...serviceStatuses].slice(0, 6),
    jobStatusTrend: Array.from(jobStatusMap.entries()).map(([label, value]) => ({
      label,
      value,
      displayValue: `${value}`,
      helper: jobs.length > 0 ? `占比 ${formatPercent(value / jobs.length)}` : "暂无作业",
    })),
    recentFailures: [
      ...providerFailures.map((item) => ({
        sortTime: new Date(item.createdAt).getTime(),
        row: {
          title: item.serviceName,
          subtitle: `${item.provider ?? "provider"} · ${item.modelId ?? "unknown-model"}`,
          value: formatDateTimeLabel(item.createdAt),
          note: sanitizeProviderFailureSummary(item.errorCode, item.objectId, role),
          href: buildAdminDataDetailsHref("system", {
            systemType: "provider",
            status: "failed",
            keyword: item.objectId ?? item.serviceName,
          }),
          tone: "danger" as const,
        },
      })),
      ...failedJobs.slice(0, 6).map((job) => ({
        sortTime: new Date(job.updatedAt).getTime(),
        row: {
          title: job.taskName || job.jobId,
          subtitle: `${job.provider ?? job.mode} · ${job.modelId ?? "unknown-model"}`,
          value: formatDateTimeLabel(job.updatedAt),
          note: sanitizeErrorSummary(job.error, role),
          href: buildAdminDataDetailsHref("system", {
            systemType: "job",
            status: "failed",
            keyword: job.jobId,
          }),
          tone: "danger" as const,
        },
      })),
    ]
      .sort((left, right) => right.sortTime - left.sortTime)
      .slice(0, 6)
      .map((item) => item.row),
    recentActions,
  };
}
