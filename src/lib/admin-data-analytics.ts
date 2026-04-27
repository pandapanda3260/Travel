import { listAdminActionLogs, listAuthUsers, listRiskBlockEntries, listUserLoginLogs } from "./auth-store";
import { db } from "./db";
import { listMaterialLibraryItems } from "./material-library-store";
import { listProductArchives } from "./product-archive-store";
import { listVideoCompositions } from "./video-composition-store";
import { listVideoJobs } from "./video-job-store";
import { listVideoMaterials } from "./video-material-store";
import { listVideoTasks } from "./video-task-store";
import { listClonedVoices } from "./voice-management-store";

const ANALYTICS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS analytics_daily_user_stats (
    stat_date TEXT PRIMARY KEY,
    total_users INTEGER NOT NULL DEFAULT 0,
    new_users INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    login_success_count INTEGER NOT NULL DEFAULT 0,
    password_login_count INTEGER NOT NULL DEFAULT 0,
    sms_login_count INTEGER NOT NULL DEFAULT 0,
    banned_users INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_daily_task_stats (
    stat_date TEXT PRIMARY KEY,
    total_tasks INTEGER NOT NULL DEFAULT 0,
    new_tasks INTEGER NOT NULL DEFAULT 0,
    completed_tasks INTEGER NOT NULL DEFAULT 0,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    pending_jobs INTEGER NOT NULL DEFAULT 0,
    compositions_completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_daily_asset_stats (
    stat_date TEXT PRIMARY KEY,
    total_archives INTEGER NOT NULL DEFAULT 0,
    parsed_archives INTEGER NOT NULL DEFAULT 0,
    total_materials INTEGER NOT NULL DEFAULT 0,
    ready_materials INTEGER NOT NULL DEFAULT 0,
    error_materials INTEGER NOT NULL DEFAULT 0,
    library_assets INTEGER NOT NULL DEFAULT 0,
    cloned_voices INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_daily_system_stats (
    stat_date TEXT PRIMARY KEY,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    pending_jobs INTEGER NOT NULL DEFAULT 0,
    material_errors INTEGER NOT NULL DEFAULT 0,
    admin_actions INTEGER NOT NULL DEFAULT 0,
    risk_blocks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_task_stage_run (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    stage_key TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT,
    model_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS analytics_api_request_log (
    request_id TEXT PRIMARY KEY,
    route_path TEXT NOT NULL,
    method TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_provider_call_log (
    call_id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    provider TEXT,
    model_id TEXT,
    object_type TEXT,
    object_id TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error_code TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_event_log (
    event_id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    object_type TEXT,
    object_id TEXT,
    event_value REAL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_api_request_log_route_time
  ON analytics_api_request_log(route_path, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_analytics_provider_call_log_service_time
  ON analytics_provider_call_log(service_name, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_analytics_task_stage_run_task_stage
  ON analytics_task_stage_run(task_id, stage_key, started_at DESC);

  CREATE INDEX IF NOT EXISTS idx_analytics_event_log_name_time
  ON analytics_event_log(event_name, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_analytics_event_log_actor_time
  ON analytics_event_log(actor_id, created_at DESC);
`;

db.exec(ANALYTICS_TABLE_SQL);

const upsertDailyUserStats = db.prepare(`
  INSERT INTO analytics_daily_user_stats (
    stat_date,
    total_users,
    new_users,
    active_users,
    login_success_count,
    password_login_count,
    sms_login_count,
    banned_users,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stat_date) DO UPDATE SET
    total_users = excluded.total_users,
    new_users = excluded.new_users,
    active_users = excluded.active_users,
    login_success_count = excluded.login_success_count,
    password_login_count = excluded.password_login_count,
    sms_login_count = excluded.sms_login_count,
    banned_users = excluded.banned_users,
    updated_at = excluded.updated_at
`);

const upsertDailyTaskStats = db.prepare(`
  INSERT INTO analytics_daily_task_stats (
    stat_date,
    total_tasks,
    new_tasks,
    completed_tasks,
    failed_jobs,
    pending_jobs,
    compositions_completed,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stat_date) DO UPDATE SET
    total_tasks = excluded.total_tasks,
    new_tasks = excluded.new_tasks,
    completed_tasks = excluded.completed_tasks,
    failed_jobs = excluded.failed_jobs,
    pending_jobs = excluded.pending_jobs,
    compositions_completed = excluded.compositions_completed,
    updated_at = excluded.updated_at
`);

const upsertDailyAssetStats = db.prepare(`
  INSERT INTO analytics_daily_asset_stats (
    stat_date,
    total_archives,
    parsed_archives,
    total_materials,
    ready_materials,
    error_materials,
    library_assets,
    cloned_voices,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stat_date) DO UPDATE SET
    total_archives = excluded.total_archives,
    parsed_archives = excluded.parsed_archives,
    total_materials = excluded.total_materials,
    ready_materials = excluded.ready_materials,
    error_materials = excluded.error_materials,
    library_assets = excluded.library_assets,
    cloned_voices = excluded.cloned_voices,
    updated_at = excluded.updated_at
`);

const upsertDailySystemStats = db.prepare(`
  INSERT INTO analytics_daily_system_stats (
    stat_date,
    failed_jobs,
    pending_jobs,
    material_errors,
    admin_actions,
    risk_blocks,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stat_date) DO UPDATE SET
    failed_jobs = excluded.failed_jobs,
    pending_jobs = excluded.pending_jobs,
    material_errors = excluded.material_errors,
    admin_actions = excluded.admin_actions,
    risk_blocks = excluded.risk_blocks,
    updated_at = excluded.updated_at
`);

const insertApiRequestLog = db.prepare(`
  INSERT OR REPLACE INTO analytics_api_request_log (
    request_id,
    route_path,
    method,
    actor_type,
    actor_id,
    status_code,
    duration_ms,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertProviderCallLog = db.prepare(`
  INSERT OR REPLACE INTO analytics_provider_call_log (
    call_id,
    service_name,
    provider,
    model_id,
    object_type,
    object_id,
    success,
    duration_ms,
    error_code,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTaskStageRun = db.prepare(`
  INSERT OR REPLACE INTO analytics_task_stage_run (
    run_id,
    task_id,
    stage_key,
    status,
    provider,
    model_id,
    started_at,
    finished_at,
    duration_ms,
    error_message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEventLog = db.prepare(`
  INSERT OR REPLACE INTO analytics_event_log (
    event_id,
    event_name,
    actor_type,
    actor_id,
    object_type,
    object_id,
    event_value,
    metadata_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let ensured = true;
let lastSyncKey = "";

function ensureTables() {
  if (ensured) {
    return;
  }
  db.exec(ANALYTICS_TABLE_SQL);
  ensured = true;
}

function startOfDay(input = new Date()) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function countInWindow(values: Array<string | null | undefined>, start: number, end: number) {
  return values.reduce((sum, value) => {
    const timestamp = toTimestamp(value);
    return timestamp >= start && timestamp < end ? sum + 1 : sum;
  }, 0);
}

export function ensureRecentAdminDataDailyAggregates(days = 30) {
  ensureTables();
  const todayKey = startOfDay().toISOString().slice(0, 10);
  const syncKey = `${todayKey}:${days}`;
  if (lastSyncKey === syncKey) {
    return;
  }

  const users = listAuthUsers();
  const loginLogs = listUserLoginLogs();
  const tasks = listVideoTasks();
  const jobs = listVideoJobs();
  const compositions = listVideoCompositions();
  const archives = listProductArchives();
  const materials = listVideoMaterials();
  const libraryAssets = listMaterialLibraryItems();
  const voices = listClonedVoices();
  const actions = listAdminActionLogs();
  const riskBlocks = listRiskBlockEntries();

  const nowIso = new Date().toISOString();
  const today = startOfDay();
  const run = db.transaction(() => {
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const currentDay = addDays(today, -offset);
      const nextDay = addDays(currentDay, 1);
      const statDate = currentDay.toISOString().slice(0, 10);
      const start = currentDay.getTime();
      const end = nextDay.getTime();

      const usersBeforeDay = users.filter(
        (item) => item.status !== "merged" && toTimestamp(item.createdAt) < end,
      );
      const successLoginsInDay = loginLogs.filter(
        (item) => item.success && item.userId && toTimestamp(item.createdAt) >= start && toTimestamp(item.createdAt) < end,
      );
      const activeUsers = new Set(successLoginsInDay.map((item) => item.userId as string));

      upsertDailyUserStats.run(
        statDate,
        usersBeforeDay.length,
        users.filter((item) => item.status !== "merged" && toTimestamp(item.createdAt) >= start && toTimestamp(item.createdAt) < end).length,
        activeUsers.size,
        successLoginsInDay.length,
        successLoginsInDay.filter((item) => item.loginType === "password").length,
        successLoginsInDay.filter((item) => item.loginType === "sms").length,
        usersBeforeDay.filter((item) => item.status === "banned").length,
        nowIso,
      );

      const tasksBeforeDay = tasks.filter((item) => toTimestamp(item.createdAt) < end);
      upsertDailyTaskStats.run(
        statDate,
        tasksBeforeDay.length,
        countInWindow(
          tasks.map((item) => item.createdAt),
          start,
          end,
        ),
        tasksBeforeDay.filter((item) => item.status === "COMPOSITION_READY").length,
        jobs.filter((item) => item.status === "FAILED" && toTimestamp(item.updatedAt) >= start && toTimestamp(item.updatedAt) < end).length,
        jobs.filter(
          (item) =>
            (item.status === "QUEUED" || item.status === "IN_PROGRESS") &&
            toTimestamp(item.submittedAt) < end,
        ).length,
        compositions.filter(
          (item) => item.status === "COMPLETED" && toTimestamp(item.updatedAt) >= start && toTimestamp(item.updatedAt) < end,
        ).length,
        nowIso,
      );

      const archivesBeforeDay = archives.filter((item) => toTimestamp(item.createdAt) < end);
      const materialsBeforeDay = materials.filter((item) => toTimestamp(item.createdAt) < end);
      upsertDailyAssetStats.run(
        statDate,
        archivesBeforeDay.length,
        archivesBeforeDay.filter((item) => item.parsedText.trim()).length,
        materialsBeforeDay.length,
        materialsBeforeDay.filter((item) => item.status === "ready").length,
        materialsBeforeDay.filter((item) => item.status === "error").length,
        libraryAssets.filter((item) => toTimestamp(item.addedAt) < end).length,
        voices.filter((item) => toTimestamp(item.createdAt) < end).length,
        nowIso,
      );

      upsertDailySystemStats.run(
        statDate,
        jobs.filter((item) => item.status === "FAILED" && toTimestamp(item.updatedAt) >= start && toTimestamp(item.updatedAt) < end).length,
        jobs.filter(
          (item) =>
            (item.status === "QUEUED" || item.status === "IN_PROGRESS") &&
            toTimestamp(item.submittedAt) < end,
        ).length,
        materials.filter((item) => item.status === "error" && toTimestamp(item.updatedAt) < end).length,
        actions.filter((item) => toTimestamp(item.createdAt) >= start && toTimestamp(item.createdAt) < end).length,
        riskBlocks.filter((item) => toTimestamp(item.createdAt) >= start && toTimestamp(item.createdAt) < end).length,
        nowIso,
      );
    }
  });

  run();
  lastSyncKey = syncKey;
}

export function recordAdminDataApiRequest(input: {
  requestId?: string;
  routePath: string;
  method: string;
  actorType: string;
  actorId?: string | null;
  statusCode: number;
  durationMs: number;
}) {
  ensureTables();
  insertApiRequestLog.run(
    input.requestId ?? crypto.randomUUID(),
    input.routePath,
    input.method,
    input.actorType,
    input.actorId ?? null,
    input.statusCode,
    input.durationMs,
    new Date().toISOString(),
  );
}

export function recordAdminDataProviderCall(input: {
  callId?: string;
  serviceName: string;
  provider?: string | null;
  modelId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  success: boolean;
  durationMs?: number | null;
  errorCode?: string | null;
}) {
  ensureTables();
  insertProviderCallLog.run(
    input.callId ?? crypto.randomUUID(),
    input.serviceName,
    input.provider ?? null,
    input.modelId ?? null,
    input.objectType ?? null,
    input.objectId ?? null,
    input.success ? 1 : 0,
    input.durationMs ?? null,
    input.errorCode ?? null,
    new Date().toISOString(),
  );
}

export function recordAdminDataTaskStageRun(input: {
  runId?: string;
  taskId: string;
  stageKey: string;
  status: string;
  provider?: string | null;
  modelId?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
}) {
  ensureTables();
  insertTaskStageRun.run(
    input.runId ?? crypto.randomUUID(),
    input.taskId,
    input.stageKey,
    input.status,
    input.provider ?? null,
    input.modelId ?? null,
    input.startedAt,
    input.finishedAt ?? null,
    input.durationMs ?? null,
    input.errorMessage ?? null,
  );
}

export function recordAdminDataEvent(input: {
  eventId?: string;
  eventName: string;
  actorType: string;
  actorId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  eventValue?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}) {
  ensureTables();
  insertEventLog.run(
    input.eventId ?? crypto.randomUUID(),
    input.eventName,
    input.actorType,
    input.actorId ?? null,
    input.objectType ?? null,
    input.objectId ?? null,
    input.eventValue ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.createdAt ?? new Date().toISOString(),
  );
}
