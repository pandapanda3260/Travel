import { db } from "./db";

export type AuthDashboardDailyMetricRecord = {
  metricDate: string;
  totalUsers: number;
  normalUsers: number;
  bannedUsers: number;
  passwordReadyUsers: number;
  activeUserSessions: number;
  totalOperators: number;
  activeOperators: number;
  activeAdminSessions: number;
  totalRiskBlocks: number;
  newUsers: number;
  loginTotal: number;
  loginSuccess: number;
  loginFail: number;
  smsRequests: number;
  smsUsed: number;
  riskBlocks: number;
  adminActions: number;
  generatedAt: string;
};

let initialized = false;

function ensureAuthAnalyticsSchema() {
  if (initialized) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_dashboard_daily_metrics (
      metric_date TEXT PRIMARY KEY,
      total_users INTEGER NOT NULL,
      normal_users INTEGER NOT NULL,
      banned_users INTEGER NOT NULL,
      password_ready_users INTEGER NOT NULL,
      active_user_sessions INTEGER NOT NULL,
      total_operators INTEGER NOT NULL,
      active_operators INTEGER NOT NULL,
      active_admin_sessions INTEGER NOT NULL,
      total_risk_blocks INTEGER NOT NULL,
      new_users INTEGER NOT NULL,
      login_total INTEGER NOT NULL,
      login_success INTEGER NOT NULL,
      login_fail INTEGER NOT NULL,
      sms_requests INTEGER NOT NULL,
      sms_used INTEGER NOT NULL,
      risk_blocks INTEGER NOT NULL,
      admin_actions INTEGER NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_dashboard_metrics_generated
      ON auth_dashboard_daily_metrics (generated_at DESC);
  `);

  initialized = true;
}

function mapMetricRow(row: Record<string, unknown>): AuthDashboardDailyMetricRecord {
  return {
    metricDate: String(row.metric_date ?? ""),
    totalUsers: Number(row.total_users ?? 0),
    normalUsers: Number(row.normal_users ?? 0),
    bannedUsers: Number(row.banned_users ?? 0),
    passwordReadyUsers: Number(row.password_ready_users ?? 0),
    activeUserSessions: Number(row.active_user_sessions ?? 0),
    totalOperators: Number(row.total_operators ?? 0),
    activeOperators: Number(row.active_operators ?? 0),
    activeAdminSessions: Number(row.active_admin_sessions ?? 0),
    totalRiskBlocks: Number(row.total_risk_blocks ?? 0),
    newUsers: Number(row.new_users ?? 0),
    loginTotal: Number(row.login_total ?? 0),
    loginSuccess: Number(row.login_success ?? 0),
    loginFail: Number(row.login_fail ?? 0),
    smsRequests: Number(row.sms_requests ?? 0),
    smsUsed: Number(row.sms_used ?? 0),
    riskBlocks: Number(row.risk_blocks ?? 0),
    adminActions: Number(row.admin_actions ?? 0),
    generatedAt: String(row.generated_at ?? ""),
  };
}

export function upsertAuthDashboardDailyMetric(record: AuthDashboardDailyMetricRecord) {
  ensureAuthAnalyticsSchema();
  db.prepare(
    `
      INSERT INTO auth_dashboard_daily_metrics (
        metric_date,
        total_users,
        normal_users,
        banned_users,
        password_ready_users,
        active_user_sessions,
        total_operators,
        active_operators,
        active_admin_sessions,
        total_risk_blocks,
        new_users,
        login_total,
        login_success,
        login_fail,
        sms_requests,
        sms_used,
        risk_blocks,
        admin_actions,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(metric_date) DO UPDATE SET
        total_users = excluded.total_users,
        normal_users = excluded.normal_users,
        banned_users = excluded.banned_users,
        password_ready_users = excluded.password_ready_users,
        active_user_sessions = excluded.active_user_sessions,
        total_operators = excluded.total_operators,
        active_operators = excluded.active_operators,
        active_admin_sessions = excluded.active_admin_sessions,
        total_risk_blocks = excluded.total_risk_blocks,
        new_users = excluded.new_users,
        login_total = excluded.login_total,
        login_success = excluded.login_success,
        login_fail = excluded.login_fail,
        sms_requests = excluded.sms_requests,
        sms_used = excluded.sms_used,
        risk_blocks = excluded.risk_blocks,
        admin_actions = excluded.admin_actions,
        generated_at = excluded.generated_at
    `,
  ).run(
    record.metricDate,
    record.totalUsers,
    record.normalUsers,
    record.bannedUsers,
    record.passwordReadyUsers,
    record.activeUserSessions,
    record.totalOperators,
    record.activeOperators,
    record.activeAdminSessions,
    record.totalRiskBlocks,
    record.newUsers,
    record.loginTotal,
    record.loginSuccess,
    record.loginFail,
    record.smsRequests,
    record.smsUsed,
    record.riskBlocks,
    record.adminActions,
    record.generatedAt,
  );
}

export function listAuthDashboardDailyMetrics(limit = 30) {
  ensureAuthAnalyticsSchema();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM auth_dashboard_daily_metrics
        ORDER BY metric_date DESC
        LIMIT ?
      `,
    )
    .all(limit) as Record<string, unknown>[];

  return rows.map(mapMetricRow);
}
