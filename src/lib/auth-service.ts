import { listAuthDashboardDailyMetrics, upsertAuthDashboardDailyMetric } from "./auth-analytics-store";
import {
  deleteRiskBlockEntry,
  deleteUserAccount,
  deleteUserPhone,
  getAdminSession,
  getAdminUser,
  getAuthRiskConfig,
  getAuthUser,
  getRiskBlockEntry,
  getUserAccount,
  getUserPhone,
  getUserSession,
  listAdminActionLogs,
  listAdminSessions,
  listAdminUsers,
  listAuthUsers,
  listRiskBlockEntries,
  listSmsCodes,
  listUserAccounts,
  listUserLoginLogs,
  listUserPhones,
  listUserSecurityLogs,
  listUserSessions,
  setAuthRiskConfig,
  type AdminRole,
  type AdminStatus,
  type AdminUserRecord,
  type AuthRiskConfigRecord,
  type AuthUserRecord,
  type AuthUserStatus,
  type RiskBlockType,
  type SmsCodePurpose,
  type UserLoginType,
  type UserSecurityActionType,
  upsertAdminActionLog,
  upsertAdminSession,
  upsertAdminUser,
  upsertAuthUser,
  upsertRiskBlockEntry,
  upsertSmsCode,
  upsertUserAccount,
  upsertUserLoginLog,
  upsertUserPhone,
  upsertUserSecurityLog,
  upsertUserSession,
} from "./auth-store";
import {
  buildAutoNickname,
  generateSessionToken,
  generateSixDigitCode,
  getPasswordRuleText,
  hashPassword,
  isStrongEnoughPassword,
  isValidPhone,
  isValidUsername,
  maskPhone,
  normalizePhone,
  normalizeUsername,
  sanitizeIp,
  sha256,
  verifyPassword,
} from "./auth-security";
import {
  ensureMemberProfile,
  grantGrowthForEvent,
  syncMemberStateForUserStatus,
  transferMemberDataOnMerge,
} from "./member-service";
import { recordAdminDataEvent } from "./admin-data-analytics";
import { SESSION_EXPIRE_DAYS } from "./auth-route-config";
import { sendTencentVerificationSms, TencentSmsProviderError } from "./tencent-sms-provider";

export type RequestAuditContext = {
  ip: string;
  userAgent: string | null;
};

export type AuthenticatedUserSession = {
  sessionId: string;
  userId: string;
  loginType: UserLoginType;
  expiresAt: string;
  user: AuthUserRecord;
};

export type AuthenticatedAdminSession = {
  sessionId: string;
  adminId: string;
  expiresAt: string;
  admin: Pick<AdminUserRecord, "adminId" | "username" | "displayName" | "role" | "status">;
};

export type UserAccountOverview = {
  user: {
    userId: string;
    nickname: string;
    avatar: string | null;
    status: AuthUserStatus;
    planLevel: number | null;
    quotaScope: "limited" | "unlimited";
    certificationLabel: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    phone: string | null;
    maskedPhone: string | null;
    hasPassword: boolean;
    passwordUpdatedAt: string | null;
    loginMethods: UserLoginType[];
  };
  accounts: Array<{
    accountId: string;
    username: string;
    createdAt: string;
    updatedAt: string;
  }>;
  phones: Array<{
    phoneId: string;
    phone: string;
    maskedPhone: string;
    verified: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    loginType: UserLoginType;
    createdAt: string;
    expiresAt: string;
    lastSeenAt: string | null;
    current: boolean;
    ip: string;
  }>;
  recentLogins: Array<{
    logId: string;
    loginType: UserLoginType;
    success: boolean;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  securityLogs: Array<{
    logId: string;
    actionType: UserSecurityActionType;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  suggestions: {
    shouldBindPhone: boolean;
    shouldSetPassword: boolean;
  };
};

export type AdminUserListItem = {
  userId: string;
  nickname: string;
  status: AuthUserStatus;
  planLevel: number | null;
  quotaScope: "limited" | "unlimited";
  certificationLabel: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  usernames: string[];
  phones: string[];
  phone: string | null;
  maskedPhone: string | null;
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  loginMethods: UserLoginType[];
  activeSessionCount: number;
};

export type AdminUserDetail = {
  summary: AdminUserListItem;
  accounts: Array<{
    accountId: string;
    username: string;
    createdAt: string;
    updatedAt: string;
  }>;
  phones: Array<{
    phoneId: string;
    phone: string;
    maskedPhone: string;
    verified: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    loginType: UserLoginType;
    createdAt: string;
    expiresAt: string;
    lastSeenAt: string | null;
    ip: string;
  }>;
  recentLogins: Array<{
    logId: string;
    loginType: UserLoginType;
    success: boolean;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  securityLogs: Array<{
    logId: string;
    actionType: UserSecurityActionType;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  smsRecords: Array<{
    smsId: string;
    purpose: SmsCodePurpose;
    maskedPhone: string;
    used: boolean;
    usedAt: string | null;
    expireAt: string;
    requestIp: string;
    createdAt: string;
  }>;
};

export type BindingManagementSnapshot = {
  users: Array<{
    userId: string;
    nickname: string;
    status: AuthUserStatus;
    usernames: Array<{ accountId: string; username: string }>;
    phones: Array<{ phoneId: string; phone: string; maskedPhone: string; verified: boolean }>;
    phone: string | null;
    maskedPhone: string | null;
    hasPassword: boolean;
    passwordUpdatedAt: string | null;
    loginMethods: UserLoginType[];
    lastLoginAt: string | null;
    createdAt: string;
  }>;
};

export type SecurityManagementSnapshot = {
  config: AuthRiskConfigRecord;
  phoneHourlyStats: Array<{ phone: string; count: number }>;
  ipHourlyStats: Array<{ ip: string; count: number }>;
  blocks: Array<{
    blockId: string;
    type: RiskBlockType;
    value: string;
    reason: string;
    createdAt: string;
  }>;
  recentUserLogins: Array<{
    logId: string;
    userId: string | null;
    loginType: UserLoginType;
    success: boolean;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  recentAdminActions: Array<{
    logId: string;
    adminId: string;
    actionType: string;
    targetType: string;
    targetId: string | null;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  recentUserSecurityLogs: Array<{
    logId: string;
    userId: string;
    actionType: UserSecurityActionType;
    detail: string;
    ip: string;
    createdAt: string;
  }>;
  recentSmsRecords: Array<{
    smsId: string;
    purpose: SmsCodePurpose;
    phone: string;
    maskedPhone: string;
    used: boolean;
    usedAt: string | null;
    expireAt: string;
    requestIp: string;
    createdAt: string;
  }>;
  operators: Array<{
    adminId: string;
    username: string;
    displayName: string;
    role: AdminRole;
    status: AdminStatus;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
  }>;
};

export type AdminUserListFilters = {
  keyword?: string;
  loginMethod?: UserLoginType | "all";
  passwordState?: "ready" | "missing" | "all";
};

export type AdminUserListQuery = AdminUserListFilters & {
  normalPage?: number;
  riskPage?: number;
  pageSize?: number;
};

export type AdminUserListPage = {
  items: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AdminUserListSnapshot = {
  summary: {
    total: number;
    normalCount: number;
    riskCount: number;
    passwordReadyCount: number;
    profilePendingCount: number;
  };
  normal: AdminUserListPage;
  risk: AdminUserListPage;
};

export type AdminDashboardSnapshot = {
  generatedAt: string;
  totals: {
    totalUsers: number;
    normalUsers: number;
    bannedUsers: number;
    passwordReadyUsers: number;
    activeUserSessions: number;
    totalOperators: number;
    activeOperators: number;
    activeAdminSessions: number;
    totalRiskBlocks: number;
  };
  today: {
    registrations: number;
    loginTotal: number;
    loginSuccess: number;
    loginFail: number;
    loginSuccessRate: number;
    smsRequests: number;
    smsUsed: number;
    riskBlocks: number;
    adminActions: number;
  };
  daily: Array<{
    dateKey: string;
    label: string;
    newUsers: number;
    loginSuccess: number;
    smsRequests: number;
    adminActions: number;
  }>;
  recentUserLogins: SecurityManagementSnapshot["recentUserLogins"];
  recentAdminActions: SecurityManagementSnapshot["recentAdminActions"];
  config: Pick<AuthRiskConfigRecord, "smsEnabled" | "smsDebugMode" | "tokenExpireDays">;
};

export class AuthServiceError extends Error {
  code: string;
  status: number;
  data?: Record<string, unknown>;

  constructor(message: string, options?: { code?: string; status?: number; data?: Record<string, unknown> }) {
    super(message);
    this.name = "AuthServiceError";
    this.code = options?.code ?? "AUTH_SERVICE_ERROR";
    this.status = options?.status ?? 400;
    this.data = options?.data;
  }
}

const DEFAULT_AVATAR = null;

function nowIso() {
  return new Date().toISOString();
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getUtcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function runAuthSideEffectSafely(label: string, effect: () => void) {
  try {
    effect();
  } catch (error) {
    console.error(`[auth-service] ${label} failed`, error);
  }
}

function sortByNewest<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function toDateValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function startOfCurrentDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatLocalDateKey(timestamp: number) {
  const source = new Date(timestamp);
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const AUTH_DASHBOARD_DAILY_WINDOW_DAYS = 7;
const AUTH_DASHBOARD_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function shouldRefreshAuthDashboardDailyMetrics(
  records: ReturnType<typeof listAuthDashboardDailyMetrics>,
  todayMetricDate: string,
) {
  if (records.length < AUTH_DASHBOARD_DAILY_WINDOW_DAYS) {
    return true;
  }

  const todayRecord = records.find((item) => item.metricDate === todayMetricDate);
  if (!todayRecord) {
    return true;
  }

  return Date.now() - toDateValue(todayRecord.generatedAt) >= AUTH_DASHBOARD_REFRESH_INTERVAL_MS;
}

function refreshAuthDashboardDailyMetrics(params: {
  users: AdminUserListItem[];
  userLoginLogs: ReturnType<typeof listUserLoginLogs>;
  smsCodes: ReturnType<typeof listSmsCodes>;
  adminActionLogs: ReturnType<typeof listAdminActionLogs>;
  riskBlocks: ReturnType<typeof listRiskBlockEntries>;
  todayStart: number;
  activeUserSessions: number;
  totalOperators: number;
  activeOperators: number;
  activeAdminSessions: number;
  generatedAt: string;
}) {
  Array.from({ length: AUTH_DASHBOARD_DAILY_WINDOW_DAYS }, (_, index) => {
    const offset = AUTH_DASHBOARD_DAILY_WINDOW_DAYS - 1 - index;
    const dayStart = params.todayStart - offset * 24 * 60 * 60 * 1000;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const isInWindow = (value: string | null | undefined) => {
      const current = toDateValue(value);
      return current >= dayStart && current < dayEnd;
    };
    const metricDate = formatLocalDateKey(dayStart);
    const totalUsersAtDay = params.users.filter((item) => toDateValue(item.createdAt) < dayEnd).length;
    const bannedUsersAtDay = params.users.filter(
      (item) => item.status === "banned" && toDateValue(item.createdAt) < dayEnd,
    ).length;
    const passwordReadyAtDay = params.users.filter((item) => {
      const effectiveAt = toDateValue(item.passwordUpdatedAt ?? item.createdAt);
      return item.hasPassword && effectiveAt < dayEnd;
    }).length;

    upsertAuthDashboardDailyMetric({
      metricDate,
      totalUsers: totalUsersAtDay,
      normalUsers: Math.max(totalUsersAtDay - bannedUsersAtDay, 0),
      bannedUsers: bannedUsersAtDay,
      passwordReadyUsers: passwordReadyAtDay,
      activeUserSessions: params.activeUserSessions,
      totalOperators: params.totalOperators,
      activeOperators: params.activeOperators,
      activeAdminSessions: params.activeAdminSessions,
      totalRiskBlocks: params.riskBlocks.length,
      newUsers: params.users.filter((item) => isInWindow(item.createdAt)).length,
      loginTotal: params.userLoginLogs.filter((item) => isInWindow(item.createdAt)).length,
      loginSuccess: params.userLoginLogs.filter((item) => item.success && isInWindow(item.createdAt)).length,
      loginFail: params.userLoginLogs.filter((item) => !item.success && isInWindow(item.createdAt)).length,
      smsRequests: params.smsCodes.filter((item) => isInWindow(item.createdAt)).length,
      smsUsed: params.smsCodes.filter((item) => isInWindow(item.usedAt)).length,
      riskBlocks: params.riskBlocks.filter((item) => isInWindow(item.createdAt)).length,
      adminActions: params.adminActionLogs.filter((item) => isInWindow(item.createdAt)).length,
      generatedAt: params.generatedAt,
    });
  });
}

function buildDayLabel(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function normalizeAdminUserFilters(input?: string | AdminUserListFilters): Required<AdminUserListFilters> {
  if (typeof input === "string") {
    return {
      keyword: input,
      loginMethod: "all",
      passwordState: "all",
    };
  }

  return {
    keyword: input?.keyword?.trim() ?? "",
    loginMethod: input?.loginMethod ?? "all",
    passwordState: input?.passwordState ?? "all",
  };
}

function getRequestContext(context?: Partial<RequestAuditContext>): RequestAuditContext {
  return {
    ip: sanitizeIp(context?.ip),
    userAgent: context?.userAgent?.trim() || null,
  };
}

function ensureRiskConfig() {
  const config = getAuthRiskConfig();
  setAuthRiskConfig(config);
  return config;
}

function getTokenExpireDays() {
  return SESSION_EXPIRE_DAYS;
}

function recordUserLoginAttempt(
  params: {
    userId: string | null;
    loginType: UserLoginType;
    success: boolean;
    detail: string;
  },
  context?: Partial<RequestAuditContext>,
) {
  const audit = getRequestContext(context);
  const createdAt = nowIso();
  upsertUserLoginLog({
    logId: createId("ulog"),
    userId: params.userId,
    loginType: params.loginType,
    success: params.success,
    detail: params.detail,
    ip: audit.ip,
    createdAt,
  });
  runAuthSideEffectSafely("record login analytics", () => {
    recordAdminDataEvent({
      eventName: params.success ? "auth.login_success" : "auth.login_failed",
      actorType: params.userId ? "user" : "anonymous",
      actorId: params.userId ?? null,
      objectType: "login_method",
      objectId: params.loginType,
      metadata: {
        detail: params.detail,
        ip: audit.ip,
      },
      createdAt,
    });
  });
}

function recordUserSecurityAction(
  params: {
    userId: string;
    actionType: UserSecurityActionType;
    detail: string;
  },
  context?: Partial<RequestAuditContext>,
) {
  const audit = getRequestContext(context);
  const createdAt = nowIso();
  upsertUserSecurityLog({
    logId: createId("uslog"),
    userId: params.userId,
    actionType: params.actionType,
    detail: params.detail,
    ip: audit.ip,
    createdAt,
  });
  runAuthSideEffectSafely("record security analytics", () => {
    recordAdminDataEvent({
      eventName: `account.${params.actionType}`,
      actorType: "user",
      actorId: params.userId,
      objectType: "security_action",
      objectId: params.actionType,
      metadata: {
        detail: params.detail,
        ip: audit.ip,
      },
      createdAt,
    });
  });
}

function recordAdminAction(
  params: {
    adminId: string;
    actionType: string;
    targetType: string;
    targetId?: string | null;
    detail: string;
  },
  context?: Partial<RequestAuditContext>,
) {
  const audit = getRequestContext(context);
  upsertAdminActionLog({
    logId: createId("alog"),
    adminId: params.adminId,
    actionType: params.actionType,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    detail: params.detail,
    ip: audit.ip,
    createdAt: nowIso(),
  });
}

function ensureUserExists(userId: string) {
  const user = getAuthUser(userId);
  if (!user) {
    throw new AuthServiceError("用户不存在。", { code: "USER_NOT_FOUND", status: 404 });
  }
  return user;
}

function ensureAdminExists(adminId: string) {
  const admin = getAdminUser(adminId);
  if (!admin) {
    throw new AuthServiceError("运营账号不存在。", { code: "ADMIN_NOT_FOUND", status: 404 });
  }
  return admin;
}

function ensureAdminRoleAllowed(adminId: string, allowedRoles: AdminRole[], message: string) {
  const admin = ensureAdminExists(adminId);
  if (!allowedRoles.includes(admin.role)) {
    throw new AuthServiceError(message, {
      code: "ADMIN_FORBIDDEN",
      status: 403,
    });
  }
  return admin;
}

function ensureAdminCanManageUsers(adminId: string) {
  return ensureAdminRoleAllowed(adminId, ["super_admin", "operator"], "当前账号仅支持查看，不能操作用户。");
}

function ensureAdminCanManageSecurity(adminId: string) {
  return ensureAdminRoleAllowed(adminId, ["super_admin"], "仅超级管理员可修改安全策略。");
}

function ensureUserActive(user: AuthUserRecord) {
  if (user.status === "banned") {
    throw new AuthServiceError("该账号已被封禁，请联系运营处理。", {
      code: "USER_BANNED",
      status: 403,
      data: { userId: user.userId },
    });
  }

  if (user.status === "merged") {
    throw new AuthServiceError("该账号已合并到其他主体，请使用主账号登录。", {
      code: "USER_MERGED",
      status: 409,
      data: { mergedIntoUserId: user.mergedIntoUserId },
    });
  }
}

function ensureAdminActive(admin: AdminUserRecord) {
  if (admin.status !== "active") {
    throw new AuthServiceError("当前运营账号已停用。", {
      code: "ADMIN_DISABLED",
      status: 403,
      data: { adminId: admin.adminId },
    });
  }
}

function getUserAccountsByUserId(userId: string) {
  return sortByNewest(listUserAccounts().filter((item) => item.userId === userId));
}

function getUserPhonesByUserId(userId: string) {
  return sortByNewest(listUserPhones().filter((item) => item.userId === userId));
}

function getUserSessionsByUserId(userId: string) {
  return sortByNewest(listUserSessions().filter((item) => item.userId === userId));
}

function getUserLoginLogsByUserId(userId: string) {
  return sortByNewest(listUserLoginLogs().filter((item) => item.userId === userId));
}

function getUserSecurityLogsByUserId(userId: string) {
  return sortByNewest(listUserSecurityLogs().filter((item) => item.userId === userId));
}

function getActiveUserSessionsByUserId(userId: string) {
  const now = Date.now();
  return getUserSessionsByUserId(userId).filter((item) => !item.revokedAt && new Date(item.expiresAt).getTime() > now);
}

function findAccountByUsername(username: string) {
  return listUserAccounts().find((item) => item.username === normalizeUsername(username)) ?? null;
}

function findPhoneBinding(phone: string) {
  return listUserPhones().find((item) => item.phone === normalizePhone(phone)) ?? null;
}

function getPrimaryPhoneBinding(userId: string) {
  return getUserPhonesByUserId(userId).find((item) => item.verified) ?? getUserPhonesByUserId(userId)[0] ?? null;
}

function getPrimaryPasswordAccount(userId: string) {
  const phone = getPrimaryPhoneBinding(userId)?.phone ?? null;
  const accounts = getUserAccountsByUserId(userId);
  if (phone) {
    const matched = accounts.find((item) => item.username === phone);
    if (matched) {
      return matched;
    }
  }
  return accounts[0] ?? null;
}

function buildUserLoginMethods(userId: string): UserLoginType[] {
  const phoneBinding = getPrimaryPhoneBinding(userId);
  if (!phoneBinding) {
    return [];
  }
  const methods: UserLoginType[] = [];
  if (getPrimaryPasswordAccount(userId)) {
    methods.push("password");
  }
  methods.push("sms");
  return methods;
}

function setCanonicalPhoneForUser(userId: string, phone: string, verified = true) {
  const normalizedPhone = normalizePhone(phone);
  const existing = findPhoneBinding(normalizedPhone);
  const phones = getUserPhonesByUserId(userId);
  const timestamp = nowIso();
  const preserved = existing && existing.userId === userId ? existing : (phones[0] ?? null);
  const nextPhoneId = preserved?.phoneId ?? createId("phone");
  const createdAt = preserved?.createdAt ?? timestamp;

  if (existing && existing.userId !== userId) {
    throw new AuthServiceError("该手机号已绑定其他账号。", {
      code: "PHONE_BOUND_TO_OTHER_USER",
      status: 409,
      data: { conflictUserId: existing.userId, maskedPhone: maskPhone(normalizedPhone) },
    });
  }

  for (const item of phones) {
    if (item.phoneId !== nextPhoneId) {
      deleteUserPhone(item.phoneId);
    }
  }

  upsertUserPhone({
    phoneId: nextPhoneId,
    userId,
    phone: normalizedPhone,
    verified,
    createdAt,
    updatedAt: timestamp,
  });

  normalizeUserCredentialRecords(userId);
  return getUserPhone(nextPhoneId) ?? findPhoneBinding(normalizedPhone);
}

function setPasswordForUser(userId: string, password: string) {
  const phoneBinding = getPrimaryPhoneBinding(userId);
  if (!phoneBinding) {
    throw new AuthServiceError("当前账号缺少手机号，无法设置密码，请先由管理员修正手机号。", {
      code: "PHONE_REQUIRED_FOR_PASSWORD",
      status: 409,
    });
  }

  if (!isStrongEnoughPassword(password)) {
    throw new AuthServiceError(getPasswordRuleText(), {
      code: "PASSWORD_INVALID",
      status: 400,
    });
  }

  const accounts = getUserAccountsByUserId(userId);
  const existingByPhone = findAccountByUsername(phoneBinding.phone);
  if (existingByPhone && existingByPhone.userId !== userId) {
    throw new AuthServiceError("该手机号已被其他账号占用，无法直接设置密码。", {
      code: "ACCOUNT_BOUND_TO_OTHER_USER",
      status: 409,
      data: { conflictUserId: existingByPhone.userId, phone: phoneBinding.phone },
    });
  }

  const preserved = existingByPhone && existingByPhone.userId === userId ? existingByPhone : (accounts[0] ?? null);
  const timestamp = nowIso();
  const passwordPayload = hashPassword(password);
  const accountId = preserved?.accountId ?? createId("acct");
  const createdAt = preserved?.createdAt ?? timestamp;

  for (const item of accounts) {
    if (item.accountId !== accountId) {
      deleteUserAccount(item.accountId);
    }
  }

  upsertUserAccount({
    accountId,
    userId,
    username: phoneBinding.phone,
    passwordHash: passwordPayload.passwordHash,
    salt: passwordPayload.salt,
    createdAt,
    updatedAt: timestamp,
  });

  return getUserAccount(accountId) ?? findAccountByUsername(phoneBinding.phone);
}

function normalizeUserCredentialRecords(userId: string) {
  const phoneBinding = getPrimaryPhoneBinding(userId);
  const phones = getUserPhonesByUserId(userId);
  const accounts = getUserAccountsByUserId(userId);

  if (phoneBinding) {
    for (const item of phones) {
      if (item.phoneId !== phoneBinding.phoneId) {
        deleteUserPhone(item.phoneId);
      }
    }
  }

  if (accounts.length === 0) {
    return;
  }

  const primaryAccount =
    (phoneBinding ? accounts.find((item) => item.username === phoneBinding.phone) : null) ?? accounts[0];

  for (const item of accounts) {
    if (item.accountId !== primaryAccount.accountId) {
      deleteUserAccount(item.accountId);
    }
  }

  if (!phoneBinding || primaryAccount.username === phoneBinding.phone) {
    return;
  }

  const existingByPhone = findAccountByUsername(phoneBinding.phone);
  if (existingByPhone && existingByPhone.userId !== userId) {
    return;
  }

  upsertUserAccount({
    ...primaryAccount,
    username: phoneBinding.phone,
    updatedAt: nowIso(),
  });
}

function findUserSessionByToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  return listUserSessions().find((item) => item.tokenHash === tokenHash) ?? null;
}

function findAdminByUsername(username: string) {
  return listAdminUsers().find((item) => item.username === normalizeUsername(username)) ?? null;
}

function findAdminSessionByToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  return listAdminSessions().find((item) => item.tokenHash === tokenHash) ?? null;
}

function isExpired(iso: string) {
  return new Date(iso).getTime() <= Date.now();
}

const SESSION_LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

function shouldRefreshSessionLastSeen(lastSeenAt: string | null) {
  if (!lastSeenAt) {
    return true;
  }

  const lastSeenTime = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenTime)) {
    return true;
  }

  return Date.now() - lastSeenTime >= SESSION_LAST_SEEN_REFRESH_MS;
}

function revokeUserSession(sessionId: string, reason: string) {
  const session = getUserSession(sessionId);
  if (!session || session.revokedAt) {
    return;
  }

  upsertUserSession({
    ...session,
    revokedAt: nowIso(),
    revokedReason: reason,
    lastSeenAt: nowIso(),
  });
}

function revokeUserSessionsForUser(userId: string, reason: string) {
  for (const session of getActiveUserSessionsByUserId(userId)) {
    revokeUserSession(session.sessionId, reason);
  }
}

function revokeOtherUserSessions(userId: string, currentSessionId: string | null | undefined, reason: string) {
  for (const session of getActiveUserSessionsByUserId(userId)) {
    if (currentSessionId && session.sessionId === currentSessionId) {
      continue;
    }
    revokeUserSession(session.sessionId, reason);
  }
}

function revokeAdminSession(sessionId: string, reason: string) {
  const session = getAdminSession(sessionId);
  if (!session || session.revokedAt) {
    return;
  }

  upsertAdminSession({
    ...session,
    revokedAt: nowIso(),
    revokedReason: reason,
    lastSeenAt: nowIso(),
  });
}

function revokeAdminSessionsForAdmin(adminId: string, reason: string) {
  for (const session of listAdminSessions().filter((item) => item.adminId === adminId && !item.revokedAt)) {
    revokeAdminSession(session.sessionId, reason);
  }
}

function countAvailableBindings(userId: string) {
  return getUserAccountsByUserId(userId).length + getUserPhonesByUserId(userId).filter((item) => item.verified).length;
}

function ensureBlockAllowed(type: RiskBlockType, value: string) {
  const matched = listRiskBlockEntries().find((item) => item.type === type && item.value === value);
  if (matched) {
    const label = type === "phone" ? "手机号" : "IP";
    throw new AuthServiceError(`${label} 已被限制：${matched.reason}`, {
      code: "RISK_BLOCKED",
      status: 429,
      data: matched,
    });
  }
}

function getSmsCodeWindowStats(phone: string, ip: string, cooldownSeconds: number) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const cooldownStartAt = Date.now() - cooldownSeconds * 1000;
  const normalizedPhone = normalizePhone(phone);
  const normalizedIp = sanitizeIp(ip);
  const records = listSmsCodes().filter((item) => new Date(item.createdAt).getTime() >= oneHourAgo);

  return {
    phoneHourlyCount: records.filter((item) => item.phone === normalizedPhone).length,
    ipHourlyCount: records.filter((item) => item.requestIp === normalizedIp).length,
    phoneCooldownHit: records.some(
      (item) => item.phone === normalizedPhone && new Date(item.createdAt).getTime() >= cooldownStartAt,
    ),
  };
}

function verifyAndConsumeSmsCode(phone: string, code: string, purpose: SmsCodePurpose) {
  const record = ensureSmsCodeValid(phone, code, purpose);
  upsertSmsCode({
    ...record,
    used: true,
    usedAt: nowIso(),
  });
}

function ensureSmsCodeValid(phone: string, code: string, purpose: SmsCodePurpose) {
  const normalizedPhone = normalizePhone(phone);
  const codeHash = sha256(code);
  const record = sortByNewest(
    listSmsCodes().filter((item) => item.phone === normalizedPhone && item.purpose === purpose),
  ).find((item) => !item.used && !isExpired(item.expireAt) && item.codeHash === codeHash);

  if (!record) {
    throw new AuthServiceError("验证码错误或已过期，请重新获取。", {
      code: "SMS_CODE_INVALID",
      status: 400,
    });
  }
  return record;
}

function issueUserSession(user: AuthUserRecord, loginType: UserLoginType, context?: Partial<RequestAuditContext>) {
  ensureUserActive(user);
  const audit = getRequestContext(context);
  const createdAt = new Date();
  const rawToken = generateSessionToken();
  const sessionId = createId("usess");
  upsertUserSession({
    sessionId,
    userId: user.userId,
    tokenHash: sha256(rawToken),
    loginType,
    createdAt: createdAt.toISOString(),
    expiresAt: addDays(createdAt, getTokenExpireDays()).toISOString(),
    revokedAt: null,
    revokedReason: null,
    lastSeenAt: createdAt.toISOString(),
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  upsertAuthUser({
    ...user,
    lastLoginAt: createdAt.toISOString(),
    lastLoginIp: audit.ip,
    updatedAt: createdAt.toISOString(),
  });

  return {
    token: rawToken,
    sessionId,
    userId: user.userId,
    expiresAt: addDays(createdAt, getTokenExpireDays()).toISOString(),
  };
}

function issueAdminSession(admin: AdminUserRecord, context?: Partial<RequestAuditContext>) {
  ensureAdminActive(admin);
  const audit = getRequestContext(context);
  const createdAt = new Date();
  const rawToken = generateSessionToken();
  const sessionId = createId("asess");
  upsertAdminSession({
    sessionId,
    adminId: admin.adminId,
    tokenHash: sha256(rawToken),
    createdAt: createdAt.toISOString(),
    expiresAt: addDays(createdAt, getTokenExpireDays()).toISOString(),
    revokedAt: null,
    revokedReason: null,
    lastSeenAt: createdAt.toISOString(),
    ip: audit.ip,
    userAgent: audit.userAgent,
  });

  upsertAdminUser({
    ...admin,
    lastLoginAt: createdAt.toISOString(),
    lastLoginIp: audit.ip,
    updatedAt: createdAt.toISOString(),
  });

  return {
    token: rawToken,
    sessionId,
    adminId: admin.adminId,
    expiresAt: addDays(createdAt, getTokenExpireDays()).toISOString(),
  };
}

function createUser(params?: { nickname?: string; phone?: string | null }) {
  const timestamp = nowIso();
  const user: AuthUserRecord = {
    userId: createId("user"),
    nickname: params?.nickname?.trim() || buildAutoNickname(params?.phone),
    avatar: DEFAULT_AVATAR,
    status: "normal",
    planLevel: null,
    quotaScope: "limited",
    certificationLabel: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
    lastLoginIp: null,
    mergedIntoUserId: null,
  };
  upsertAuthUser(user);
  ensureMemberProfile(user.userId);
  return user;
}

export function registerUserWithPassword(
  input: { phone: string; password: string; nickname?: string },
  context?: Partial<RequestAuditContext>,
) {
  const phone = normalizePhone(input.phone);
  const nickname = input.nickname?.trim() || "";
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的 11 位手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }
  if (!nickname) {
    throw new AuthServiceError("请输入用户昵称。", {
      code: "NICKNAME_REQUIRED",
      status: 400,
    });
  }

  if (!isStrongEnoughPassword(input.password)) {
    throw new AuthServiceError(getPasswordRuleText(), {
      code: "PASSWORD_INVALID",
      status: 400,
    });
  }

  if (findPhoneBinding(phone)) {
    throw new AuthServiceError("该手机号已注册，请直接登录。", {
      code: "PHONE_REGISTERED",
      status: 409,
      data: { phone, maskedPhone: maskPhone(phone) },
    });
  }

  const user = createUser({ nickname, phone });
  setCanonicalPhoneForUser(user.userId, phone, true);
  setPasswordForUser(user.userId, input.password);

  const session = issueUserSession(user, "password", context);
  recordUserLoginAttempt(
    {
      userId: user.userId,
      loginType: "password",
      success: true,
      detail: `手机号 ${maskPhone(phone)} 注册并完成密码登录`,
    },
    context,
  );
  runAuthSideEffectSafely("record register analytics", () => {
    recordAdminDataEvent({
      eventName: "auth.register_success",
      actorType: "user",
      actorId: user.userId,
      objectType: "user",
      objectId: user.userId,
      metadata: {
        registerMethod: "password",
        phone: maskPhone(phone),
      },
    });
  });
  runAuthSideEffectSafely("register growth grant", () => {
    grantGrowthForEvent({
      userId: user.userId,
      eventType: "register_success",
      sourceType: "rule",
      sourceBizId: user.userId,
      idempotentKey: `register:${user.userId}`,
      remark: "注册成功",
    });
  });
  runAuthSideEffectSafely("register daily login growth grant", () => {
    grantGrowthForEvent({
      userId: user.userId,
      eventType: "daily_login",
      sourceType: "rule",
      sourceBizId: session.sessionId,
      idempotentKey: `daily_login:${user.userId}:${getUtcDateString()}`,
      remark: "注册当日首次登录",
    });
  });

  return {
    token: session.token,
    userId: user.userId,
    overview: getUserAccountOverview(user.userId, session.sessionId),
  };
}

export function loginUserWithPassword(
  input: { phone: string; password: string },
  context?: Partial<RequestAuditContext>,
) {
  const phone = normalizePhone(input.phone);
  const binding = findPhoneBinding(phone);
  const user = binding ? ensureUserExists(binding.userId) : null;
  const account = user ? getPrimaryPasswordAccount(user.userId) : null;
  if (!binding || !user || !account || !verifyPassword(input.password, account.passwordHash)) {
    recordUserLoginAttempt(
      {
        userId: user?.userId ?? null,
        loginType: "password",
        success: false,
        detail: "手机号或密码错误",
      },
      context,
    );
    throw new AuthServiceError("手机号或密码错误。", {
      code: "PASSWORD_LOGIN_INVALID",
      status: 401,
    });
  }

  ensureUserActive(user);
  const session = issueUserSession(user, "password", context);
  recordUserLoginAttempt(
    {
      userId: user.userId,
      loginType: "password",
      success: true,
      detail: `手机号 ${maskPhone(phone)} 密码登录成功`,
    },
    context,
  );
  runAuthSideEffectSafely("password login growth grant", () => {
    grantGrowthForEvent({
      userId: user.userId,
      eventType: "daily_login",
      sourceType: "rule",
      sourceBizId: session.sessionId,
      idempotentKey: `daily_login:${user.userId}:${getUtcDateString()}`,
      remark: "每日首次登录",
    });
  });
  return {
    token: session.token,
    userId: user.userId,
    overview: getUserAccountOverview(user.userId, session.sessionId),
  };
}

export async function sendSmsCode(
  input: { phone: string; purpose?: SmsCodePurpose },
  context?: Partial<RequestAuditContext>,
) {
  const config = ensureRiskConfig();
  if (!config.smsEnabled) {
    throw new AuthServiceError("短信能力当前已关闭，请联系管理员。", {
      code: "SMS_DISABLED",
      status: 503,
    });
  }

  const phone = normalizePhone(input.phone);
  const purpose = input.purpose ?? "login";
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的 11 位手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }
  if (purpose === "login" && !findPhoneBinding(phone)) {
    throw new AuthServiceError("该手机号未注册，请先完成注册。", {
      code: "PHONE_NOT_REGISTERED",
      status: 404,
    });
  }
  if (purpose === "reset_password" && !findPhoneBinding(phone)) {
    throw new AuthServiceError("该手机号未注册，无法找回密码。", {
      code: "PHONE_NOT_REGISTERED",
      status: 404,
    });
  }
  if (purpose === "change_phone_old" && !findPhoneBinding(phone)) {
    throw new AuthServiceError("当前账号未绑定手机号，无法发起换绑。", {
      code: "PHONE_NOT_REGISTERED",
      status: 404,
    });
  }

  const audit = getRequestContext(context);
  ensureBlockAllowed("phone", phone);
  ensureBlockAllowed("ip", audit.ip);
  const stats = getSmsCodeWindowStats(phone, audit.ip, config.smsCooldownSeconds);
  if (stats.phoneCooldownHit) {
    throw new AuthServiceError("验证码发送过于频繁，请 1 分钟后再试。", {
      code: "SMS_COOLDOWN",
      status: 429,
    });
  }
  if (stats.phoneHourlyCount >= config.smsHourlyLimitPerPhone) {
    throw new AuthServiceError("该手机号 1 小时内发送次数已达上限。", {
      code: "SMS_PHONE_HOURLY_LIMIT",
      status: 429,
    });
  }
  if (stats.ipHourlyCount >= config.smsHourlyLimitPerIp) {
    throw new AuthServiceError("当前 IP 发送次数过多，请稍后再试。", {
      code: "SMS_IP_HOURLY_LIMIT",
      status: 429,
    });
  }

  const code = generateSixDigitCode();
  const createdAt = new Date();
  const smsId = createId("sms");
  let provider: "debug" | "tencent" = "debug";
  let providerRequestId: string | null = null;
  let providerSerialNo: string | null = null;
  let providerStatusCode: string | null = "DebugMode";
  let providerStatusMessage: string | null = config.smsDebugMode ? "debug mode skipped provider send" : null;
  let providerTemplateId: string | null = null;
  let providerPhoneNumber: string | null = null;
  let sentAt: string | null = createdAt.toISOString();

  if (!config.smsDebugMode) {
    try {
      const delivery = await sendTencentVerificationSms({
        phone,
        code,
        expireSeconds: config.smsExpireSeconds,
        purpose,
        sessionContext: smsId,
      });
      provider = delivery.provider;
      providerRequestId = delivery.requestId;
      providerSerialNo = delivery.serialNo;
      providerStatusCode = delivery.statusCode;
      providerStatusMessage = delivery.statusMessage;
      providerTemplateId = delivery.templateId;
      providerPhoneNumber = delivery.phoneNumber;
      sentAt = nowIso();
    } catch (error) {
      if (error instanceof TencentSmsProviderError) {
        const data: Record<string, unknown> = {
          provider: "tencent",
          providerCode: error.code,
        };
        if (error.statusCode) {
          data.providerStatusCode = error.statusCode;
        }
        if (error.requestId) {
          data.providerRequestId = error.requestId;
        }
        if (error.missingKeys.length > 0) {
          data.missingKeys = error.missingKeys;
        }
        throw new AuthServiceError(
          error.code === "TENCENT_SMS_CONFIG_MISSING"
            ? "短信通道未配置完整，请联系管理员。"
            : "验证码发送失败，请稍后再试。",
          {
            code: error.code === "TENCENT_SMS_CONFIG_MISSING" ? "SMS_PROVIDER_CONFIG_MISSING" : "SMS_PROVIDER_FAILED",
            status: error.code === "TENCENT_SMS_CONFIG_MISSING" ? 503 : 502,
            data,
          },
        );
      }

      throw new AuthServiceError("验证码发送失败，请稍后再试。", {
        code: "SMS_PROVIDER_FAILED",
        status: 502,
      });
    }
  }

  upsertSmsCode({
    smsId,
    phone,
    codeHash: sha256(code),
    expireAt: new Date(createdAt.getTime() + config.smsExpireSeconds * 1000).toISOString(),
    used: false,
    usedAt: null,
    createdAt: createdAt.toISOString(),
    requestIp: audit.ip,
    purpose,
    provider,
    providerRequestId,
    providerSerialNo,
    providerStatusCode,
    providerStatusMessage,
    providerTemplateId,
    providerPhoneNumber,
    sentAt,
  });

  return {
    ok: true,
    expireSeconds: config.smsExpireSeconds,
    debugCode: config.smsDebugMode ? code : null,
    provider,
    requestId: providerRequestId,
  };
}

export function resetPasswordWithSms(
  input: { phone: string; code: string; password: string },
  context?: Partial<RequestAuditContext>,
) {
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }
  if (!isStrongEnoughPassword(input.password)) {
    throw new AuthServiceError(getPasswordRuleText(), {
      code: "PASSWORD_INVALID",
      status: 400,
    });
  }

  verifyAndConsumeSmsCode(phone, input.code.trim(), "reset_password");
  const binding = findPhoneBinding(phone);
  const user = binding ? ensureUserExists(binding.userId) : null;
  if (!binding || !user) {
    throw new AuthServiceError("该手机号未注册，无法找回密码。", {
      code: "PHONE_NOT_REGISTERED",
      status: 404,
    });
  }

  ensureUserActive(user);
  setPasswordForUser(user.userId, input.password);
  revokeUserSessionsForUser(user.userId, "用户通过验证码重置密码");
  recordUserSecurityAction(
    {
      userId: user.userId,
      actionType: "reset_password",
      detail: `通过验证码重置密码 ${maskPhone(phone)}`,
    },
    context,
  );

  const session = issueUserSession(user, "sms", context);
  recordUserLoginAttempt(
    {
      userId: user.userId,
      loginType: "sms",
      success: true,
      detail: `手机号 ${maskPhone(phone)} 重置密码并重新登录`,
    },
    context,
  );
  runAuthSideEffectSafely("reset password login growth grant", () => {
    grantGrowthForEvent({
      userId: user.userId,
      eventType: "daily_login",
      sourceType: "rule",
      sourceBizId: session.sessionId,
      idempotentKey: `daily_login:${user.userId}:${getUtcDateString()}`,
      remark: "重置密码后登录",
    });
  });
  return {
    token: session.token,
    userId: user.userId,
    overview: getUserAccountOverview(user.userId, session.sessionId),
  };
}

export function loginUserWithSms(input: { phone: string; code: string }, context?: Partial<RequestAuditContext>) {
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }

  verifyAndConsumeSmsCode(phone, input.code.trim(), "login");
  let binding = findPhoneBinding(phone);
  let user = binding ? ensureUserExists(binding.userId) : null;
  if (!user) {
    recordUserLoginAttempt(
      {
        userId: null,
        loginType: "sms",
        success: false,
        detail: `手机号 ${maskPhone(phone)} 未注册`,
      },
      context,
    );
    throw new AuthServiceError("该手机号未注册，请先完成注册。", {
      code: "PHONE_NOT_REGISTERED",
      status: 404,
    });
  }

  ensureUserActive(user);
  const session = issueUserSession(user, "sms", context);
  recordUserLoginAttempt(
    {
      userId: user.userId,
      loginType: "sms",
      success: true,
      detail: `手机号 ${maskPhone(phone)} 验证码登录成功`,
    },
    context,
  );
  runAuthSideEffectSafely("sms login growth grant", () => {
    grantGrowthForEvent({
      userId: user.userId,
      eventType: "daily_login",
      sourceType: "rule",
      sourceBizId: session.sessionId,
      idempotentKey: `daily_login:${user.userId}:${getUtcDateString()}`,
      remark: "每日首次登录",
    });
  });
  return {
    token: session.token,
    userId: user.userId,
    overview: getUserAccountOverview(user.userId, session.sessionId),
  };
}

export function getUserSessionByToken(rawToken: string | null | undefined): AuthenticatedUserSession | null {
  if (!rawToken) {
    return null;
  }

  const session = findUserSessionByToken(rawToken);
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    return null;
  }

  const user = getAuthUser(session.userId);
  if (!user || user.status !== "normal") {
    return null;
  }

  const normalizedUser: AuthUserRecord = {
    ...user,
    planLevel: user.planLevel ?? null,
    quotaScope: user.quotaScope ?? "limited",
    certificationLabel: user.certificationLabel ?? null,
  };

  if (shouldRefreshSessionLastSeen(session.lastSeenAt)) {
    upsertUserSession({
      ...session,
      lastSeenAt: nowIso(),
    });
  }

  return {
    sessionId: session.sessionId,
    userId: user.userId,
    loginType: session.loginType,
    expiresAt: session.expiresAt,
    user: normalizedUser,
  };
}

export function logoutUserByToken(rawToken: string | null | undefined) {
  if (!rawToken) {
    return;
  }

  const session = findUserSessionByToken(rawToken);
  if (!session) {
    return;
  }

  revokeUserSession(session.sessionId, "用户主动退出登录");
}

export function logoutAllUserSessions(userId: string, currentSessionId?: string | null) {
  revokeOtherUserSessions(userId, currentSessionId, "用户手动执行全部退出");
}

export function revokeUserSessionByOwner(
  userId: string,
  targetSessionId: string,
  currentSessionId?: string | null,
  context?: Partial<RequestAuditContext>,
) {
  ensureUserExists(userId);
  const session = getUserSession(targetSessionId);
  if (!session || session.userId !== userId || session.revokedAt || isExpired(session.expiresAt)) {
    throw new AuthServiceError("目标会话不存在或已失效。", {
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  }
  if (currentSessionId && session.sessionId === currentSessionId) {
    throw new AuthServiceError("当前设备请直接退出登录。", {
      code: "SESSION_CURRENT_FORBIDDEN",
      status: 409,
    });
  }

  revokeUserSession(session.sessionId, "用户手动下线指定设备");
  recordUserSecurityAction(
    {
      userId,
      actionType: "revoke_session",
      detail: `下线设备 ${session.loginType === "sms" ? "短信验证码" : "手机号密码"} · ${session.ip}`,
    },
    context,
  );
  return getUserAccountOverview(userId, currentSessionId);
}

export function logoutOtherUserSessionsByOwner(
  userId: string,
  currentSessionId?: string | null,
  context?: Partial<RequestAuditContext>,
) {
  ensureUserExists(userId);
  logoutAllUserSessions(userId, currentSessionId);
  recordUserSecurityAction(
    {
      userId,
      actionType: "logout_other_sessions",
      detail: "将其他设备全部下线",
    },
    context,
  );
  return getUserAccountOverview(userId, currentSessionId);
}

export async function sendPhoneChangeCodeForUser(
  userId: string,
  input: { stage: "old" | "new"; phone?: string },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const currentPhone = getPrimaryPhoneBinding(userId)?.phone ?? null;

  if (input.stage === "old") {
    if (!currentPhone) {
      throw new AuthServiceError("当前账号还没有已验证手机号。", {
        code: "PHONE_NOT_BOUND",
        status: 409,
      });
    }
    return sendSmsCode(
      {
        phone: currentPhone,
        purpose: "change_phone_old",
      },
      context,
    );
  }

  const nextPhone = normalizePhone(input.phone ?? "");
  if (!isValidPhone(nextPhone)) {
    throw new AuthServiceError("请输入正确的 11 位手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }
  if (currentPhone && nextPhone === currentPhone) {
    throw new AuthServiceError("新手机号不能与当前手机号相同。", {
      code: "PHONE_UNCHANGED",
      status: 409,
    });
  }
  const existing = findPhoneBinding(nextPhone);
  if (existing && existing.userId !== userId) {
    throw new AuthServiceError("该手机号已绑定其他账号。", {
      code: "PHONE_BOUND_TO_OTHER_USER",
      status: 409,
      data: {
        phone: nextPhone,
        maskedPhone: maskPhone(nextPhone),
        conflictUserId: existing.userId,
      },
    });
  }

  return sendSmsCode(
    {
      phone: nextPhone,
      purpose: "change_phone_new",
    },
    context,
  );
}

export async function sendPhoneBindCodeForUser(
  userId: string,
  input: { phone?: string },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const phone = normalizePhone(input.phone ?? "");
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的 11 位手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }

  const currentPhone = getPrimaryPhoneBinding(userId)?.phone ?? null;
  if (currentPhone === phone) {
    throw new AuthServiceError("该手机号已绑定当前账号。", {
      code: "PHONE_ALREADY_BOUND",
      status: 409,
    });
  }

  const existing = findPhoneBinding(phone);
  if (existing && existing.userId !== userId) {
    throw new AuthServiceError("该手机号已绑定其他账号。", {
      code: "PHONE_BOUND_TO_OTHER_USER",
      status: 409,
      data: {
        phone,
        maskedPhone: maskPhone(phone),
        conflictUserId: existing.userId,
      },
    });
  }

  return sendSmsCode(
    {
      phone,
      purpose: "bind_phone",
    },
    context,
  );
}

export function changePhoneForUser(
  userId: string,
  input: { oldCode: string; newPhone: string; newCode: string; currentSessionId?: string | null },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const currentPhone = getPrimaryPhoneBinding(userId)?.phone ?? null;
  if (!currentPhone) {
    throw new AuthServiceError("当前账号还没有已验证手机号，请先补充手机号。", {
      code: "PHONE_NOT_BOUND",
      status: 409,
    });
  }

  const nextPhone = normalizePhone(input.newPhone);
  if (!isValidPhone(nextPhone)) {
    throw new AuthServiceError("请输入正确的 11 位手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }
  if (nextPhone === currentPhone) {
    throw new AuthServiceError("新手机号不能与当前手机号相同。", {
      code: "PHONE_UNCHANGED",
      status: 409,
    });
  }
  const existing = findPhoneBinding(nextPhone);
  if (existing && existing.userId !== userId) {
    throw new AuthServiceError("该手机号已绑定其他账号。", {
      code: "PHONE_BOUND_TO_OTHER_USER",
      status: 409,
      data: {
        phone: nextPhone,
        maskedPhone: maskPhone(nextPhone),
        conflictUserId: existing.userId,
      },
    });
  }

  verifyAndConsumeSmsCode(currentPhone, input.oldCode.trim(), "change_phone_old");
  verifyAndConsumeSmsCode(nextPhone, input.newCode.trim(), "change_phone_new");
  setCanonicalPhoneForUser(userId, nextPhone, true);
  revokeOtherUserSessions(userId, input.currentSessionId, "用户换绑手机号");
  recordUserSecurityAction(
    {
      userId,
      actionType: "change_phone",
      detail: `将手机号从 ${maskPhone(currentPhone)} 换绑为 ${maskPhone(nextPhone)}`,
    },
    context,
  );

  return getUserAccountOverview(userId, input.currentSessionId);
}

export function bindPhoneForUser(
  userId: string,
  input: { phone: string; code: string; currentSessionId?: string | null },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const currentPhone = getPrimaryPhoneBinding(userId)?.phone ?? null;
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的手机号。", {
      code: "PHONE_INVALID",
      status: 400,
    });
  }

  const existing = findPhoneBinding(phone);
  if (existing && existing.userId !== userId) {
    ensureSmsCodeValid(phone, input.code.trim(), "bind_phone");
    throw new AuthServiceError("该手机号已绑定其他账号。", {
      code: "PHONE_BOUND_TO_OTHER_USER",
      status: 409,
      data: {
        phone,
        maskedPhone: maskPhone(phone),
        conflictUserId: existing.userId,
      },
    });
  }
  verifyAndConsumeSmsCode(phone, input.code.trim(), "bind_phone");
  setCanonicalPhoneForUser(userId, phone, true);
  revokeOtherUserSessions(userId, input.currentSessionId, "用户补充手机号");
  recordUserSecurityAction(
    {
      userId,
      actionType: "bind_phone",
      detail: currentPhone ? `更新手机号为 ${maskPhone(phone)}` : `绑定手机号 ${maskPhone(phone)}`,
    },
    context,
  );

  recordUserLoginAttempt(
    {
      userId,
      loginType: "sms",
      success: true,
      detail: `保存手机号 ${maskPhone(phone)} 成功`,
    },
    context,
  );

  return getUserAccountOverview(userId, input.currentSessionId);
}

function mergeUsersInternal(sourceUserId: string, targetUserId: string) {
  if (sourceUserId === targetUserId) {
    throw new AuthServiceError("源账号和目标账号不能相同。", { code: "MERGE_SAME_USER", status: 400 });
  }
  const source = ensureUserExists(sourceUserId);
  const target = ensureUserExists(targetUserId);
  ensureUserActive(target);
  if (source.status === "merged") {
    throw new AuthServiceError("源账号已合并，请勿重复操作。", { code: "SOURCE_ALREADY_MERGED", status: 409 });
  }

  const targetAccountNames = new Set(getUserAccountsByUserId(target.userId).map((item) => item.username));
  for (const account of getUserAccountsByUserId(source.userId)) {
    if (targetAccountNames.has(account.username)) {
      deleteUserAccount(account.accountId);
      continue;
    }
    upsertUserAccount({
      ...account,
      userId: target.userId,
      updatedAt: nowIso(),
    });
  }

  const targetPhones = new Set(getUserPhonesByUserId(target.userId).map((item) => item.phone));
  for (const phone of getUserPhonesByUserId(source.userId)) {
    if (targetPhones.has(phone.phone)) {
      deleteUserPhone(phone.phoneId);
      continue;
    }
    upsertUserPhone({
      ...phone,
      userId: target.userId,
      updatedAt: nowIso(),
    });
  }

  revokeUserSessionsForUser(source.userId, "账号已被合并");
  upsertAuthUser({
    ...source,
    status: "merged",
    mergedIntoUserId: target.userId,
    updatedAt: nowIso(),
  });
  upsertAuthUser({
    ...target,
    updatedAt: nowIso(),
  });
  normalizeUserCredentialRecords(target.userId);
  transferMemberDataOnMerge(source.userId, target.userId);

  return {
    source: ensureUserExists(source.userId),
    target: ensureUserExists(target.userId),
  };
}

export function mergeCurrentUserIntoTargetByPhone(
  currentUserId: string,
  input: { targetUserId: string; phone: string; code: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureUserExists(currentUserId);
  const target = ensureUserExists(input.targetUserId);
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的手机号。", { code: "PHONE_INVALID", status: 400 });
  }

  verifyAndConsumeSmsCode(phone, input.code.trim(), "bind_phone");
  const binding = findPhoneBinding(phone);
  if (!binding || binding.userId !== target.userId) {
    throw new AuthServiceError("当前手机号与待合并账号不匹配，请重新发起绑定流程。", {
      code: "MERGE_PHONE_MISMATCH",
      status: 409,
    });
  }

  const result = mergeUsersInternal(currentUserId, target.userId);
  const session = issueUserSession(result.target, "sms", context);
  recordUserLoginAttempt(
    {
      userId: result.target.userId,
      loginType: "sms",
      success: true,
      detail: `手机号 ${maskPhone(phone)} 触发账号合并并重新登录`,
    },
    context,
  );

  return {
    token: session.token,
    userId: result.target.userId,
    overview: getUserAccountOverview(result.target.userId, session.sessionId),
  };
}

export function bindAccountForUser(
  userId: string,
  input: { password: string; currentSessionId?: string | null },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const hadPassword = Boolean(getPrimaryPasswordAccount(userId));
  setPasswordForUser(userId, input.password);
  revokeOtherUserSessions(userId, input.currentSessionId, "用户更新密码");
  recordUserSecurityAction(
    {
      userId,
      actionType: "set_password",
      detail: hadPassword ? "更新登录密码" : "设置登录密码",
    },
    context,
  );
  return getUserAccountOverview(userId, input.currentSessionId);
}

export function updateUserProfile(
  userId: string,
  input: { nickname?: string },
  context?: Partial<RequestAuditContext>,
) {
  const user = ensureUserExists(userId);
  ensureUserActive(user);
  const nextNickname = input.nickname?.trim() || "";
  if (!nextNickname) {
    throw new AuthServiceError("请输入用户昵称。", {
      code: "NICKNAME_REQUIRED",
      status: 400,
    });
  }

  upsertAuthUser({
    ...user,
    nickname: nextNickname,
    updatedAt: nowIso(),
  });
  if (user.nickname !== nextNickname) {
    recordUserSecurityAction(
      {
        userId,
        actionType: "update_profile",
        detail: `更新昵称为 ${nextNickname}`,
      },
      context,
    );
  }

  return getUserAccountOverview(userId);
}

export function getUserAccountOverview(userId: string, currentSessionId?: string | null): UserAccountOverview {
  const user = ensureUserExists(userId);
  const normalizedUser: AuthUserRecord = {
    ...user,
    planLevel: user.planLevel ?? null,
    quotaScope: user.quotaScope ?? "limited",
    certificationLabel: user.certificationLabel ?? null,
  };
  const accounts = getUserAccountsByUserId(userId);
  const phones = getUserPhonesByUserId(userId);
  const primaryPhone = getPrimaryPhoneBinding(userId);
  const primaryPassword = getPrimaryPasswordAccount(userId);
  const loginMethods = buildUserLoginMethods(userId);
  const sessions = getActiveUserSessionsByUserId(userId);
  const recentLogins = getUserLoginLogsByUserId(userId).slice(0, 12);
  const securityLogs = getUserSecurityLogsByUserId(userId).slice(0, 12);

  return {
    user: {
      userId: normalizedUser.userId,
      nickname: normalizedUser.nickname,
      avatar: normalizedUser.avatar,
      status: normalizedUser.status,
      planLevel: normalizedUser.planLevel,
      quotaScope: normalizedUser.quotaScope,
      certificationLabel: normalizedUser.certificationLabel,
      createdAt: normalizedUser.createdAt,
      lastLoginAt: normalizedUser.lastLoginAt,
      lastLoginIp: normalizedUser.lastLoginIp,
      phone: primaryPhone?.phone ?? null,
      maskedPhone: primaryPhone ? maskPhone(primaryPhone.phone) : null,
      hasPassword: Boolean(primaryPassword),
      passwordUpdatedAt: primaryPassword?.updatedAt ?? null,
      loginMethods,
    },
    accounts: accounts.map((item) => ({
      accountId: item.accountId,
      username: item.username,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    phones: phones.map((item) => ({
      phoneId: item.phoneId,
      phone: item.phone,
      maskedPhone: maskPhone(item.phone),
      verified: item.verified,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    sessions: sessions.map((item) => ({
      sessionId: item.sessionId,
      loginType: item.loginType,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      lastSeenAt: item.lastSeenAt,
      current: currentSessionId === item.sessionId,
      ip: item.ip,
    })),
    recentLogins: recentLogins.map((item) => ({
      logId: item.logId,
      loginType: item.loginType,
      success: item.success,
      detail: item.detail,
      ip: item.ip,
      createdAt: item.createdAt,
    })),
    securityLogs: securityLogs.map((item) => ({
      logId: item.logId,
      actionType: item.actionType,
      detail: item.detail,
      ip: item.ip,
      createdAt: item.createdAt,
    })),
    suggestions: {
      shouldBindPhone: !primaryPhone,
      shouldSetPassword: !primaryPassword,
    },
  };
}

export function getUserSidebarProfile(userId: string) {
  const primaryPhone = getPrimaryPhoneBinding(userId);
  return {
    maskedPhone: primaryPhone ? maskPhone(primaryPhone.phone) : null,
    activeSessionCount: getActiveUserSessionsByUserId(userId).length,
  };
}

function buildAdminUserListItem(user: AuthUserRecord): AdminUserListItem {
  const usernames = getUserAccountsByUserId(user.userId).map((item) => item.username);
  const phones = getUserPhonesByUserId(user.userId).map((item) => item.phone);
  const primaryPhone = getPrimaryPhoneBinding(user.userId);
  const primaryPassword = getPrimaryPasswordAccount(user.userId);
  return {
    userId: user.userId,
    nickname: user.nickname,
    status: user.status,
    planLevel: user.planLevel ?? null,
    quotaScope: user.quotaScope ?? "limited",
    certificationLabel: user.certificationLabel ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastLoginIp: user.lastLoginIp,
    usernames,
    phones,
    phone: primaryPhone?.phone ?? null,
    maskedPhone: primaryPhone ? maskPhone(primaryPhone.phone) : null,
    hasPassword: Boolean(primaryPassword),
    passwordUpdatedAt: primaryPassword?.updatedAt ?? null,
    loginMethods: buildUserLoginMethods(user.userId),
    activeSessionCount: getActiveUserSessionsByUserId(user.userId).length,
  };
}

export function listUsersForAdmin(input?: string | AdminUserListFilters) {
  const filters = normalizeAdminUserFilters(input);
  const search = filters.keyword.trim().toLowerCase();
  return sortByNewest(listAuthUsers())
    .filter((user) => user.status !== "merged")
    .map(buildAdminUserListItem)
    .filter((item) => {
      const matchesKeyword =
        !search ||
        item.userId.toLowerCase().includes(search) ||
        item.nickname.toLowerCase().includes(search) ||
        item.usernames.some((value) => value.toLowerCase().includes(search)) ||
        item.phones.some((value) => value.includes(search));
      const matchesLoginMethod =
        filters.loginMethod === "all" ? true : item.loginMethods.includes(filters.loginMethod);
      const matchesPasswordState =
        filters.passwordState === "all"
          ? true
          : filters.passwordState === "ready"
            ? item.hasPassword
            : !item.hasPassword;
      return matchesKeyword && matchesLoginMethod && matchesPasswordState;
    });
}

function paginateAdminUsers(items: AdminUserListItem[], page: number, pageSize: number): AdminUserListPage {
  const safePageSize = Math.min(Math.max(pageSize, 1), 50);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * safePageSize;

  return {
    items: items.slice(start, start + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

export function listUsersForAdminSnapshot(input?: AdminUserListQuery): AdminUserListSnapshot {
  const pageSize = Math.min(Math.max(input?.pageSize ?? 8, 1), 50);
  const allUsers = listUsersForAdmin(input);
  const normalUsers = allUsers.filter((item) => item.status === "normal");
  const riskUsers = allUsers.filter((item) => item.status === "banned");

  return {
    summary: {
      total: allUsers.length,
      normalCount: normalUsers.length,
      riskCount: riskUsers.length,
      passwordReadyCount: allUsers.filter((item) => item.hasPassword).length,
      profilePendingCount: allUsers.filter((item) => !item.maskedPhone || !item.hasPassword).length,
    },
    normal: paginateAdminUsers(normalUsers, input?.normalPage ?? 1, pageSize),
    risk: paginateAdminUsers(riskUsers, input?.riskPage ?? 1, pageSize),
  };
}

export function getUserDetailForAdmin(userId: string): AdminUserDetail {
  const user = ensureUserExists(userId);
  const summary = buildAdminUserListItem(user);
  const phones = getUserPhonesByUserId(userId);
  const phoneSet = new Set(phones.map((item) => item.phone));
  return {
    summary,
    accounts: getUserAccountsByUserId(userId).map((item) => ({
      accountId: item.accountId,
      username: item.username,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    phones: phones.map((item) => ({
      phoneId: item.phoneId,
      phone: item.phone,
      maskedPhone: maskPhone(item.phone),
      verified: item.verified,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    sessions: getActiveUserSessionsByUserId(userId).map((item) => ({
      sessionId: item.sessionId,
      loginType: item.loginType,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      lastSeenAt: item.lastSeenAt,
      ip: item.ip,
    })),
    recentLogins: getUserLoginLogsByUserId(userId)
      .slice(0, 20)
      .map((item) => ({
        logId: item.logId,
        loginType: item.loginType,
        success: item.success,
        detail: item.detail,
        ip: item.ip,
        createdAt: item.createdAt,
      })),
    securityLogs: getUserSecurityLogsByUserId(userId)
      .slice(0, 20)
      .map((item) => ({
        logId: item.logId,
        actionType: item.actionType,
        detail: item.detail,
        ip: item.ip,
        createdAt: item.createdAt,
      })),
    smsRecords: sortByNewest(listSmsCodes().filter((item) => phoneSet.has(item.phone)))
      .slice(0, 20)
      .map((item) => ({
        smsId: item.smsId,
        purpose: item.purpose,
        maskedPhone: maskPhone(item.phone),
        used: item.used,
        usedAt: item.usedAt,
        expireAt: item.expireAt,
        requestIp: item.requestIp,
        createdAt: item.createdAt,
      })),
  };
}

export function recordUserDetailViewForAdmin(
  userId: string,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "view_user_detail",
      targetType: "user",
      targetId: userId,
      detail: "查看用户详情",
    },
    context,
  );
}

export function recordUserDetailExportForAdmin(
  userId: string,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "export_user_detail",
      targetType: "user",
      targetId: userId,
      detail: "导出用户详情",
    },
    context,
  );
}

export function recordUserExportForAdmin(
  filters: AdminUserListFilters,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  const detailParts = [
    filters.keyword?.trim() ? `keyword=${filters.keyword.trim()}` : null,
    filters.loginMethod && filters.loginMethod !== "all" ? `loginMethod=${filters.loginMethod}` : null,
    filters.passwordState && filters.passwordState !== "all" ? `passwordState=${filters.passwordState}` : null,
  ].filter(Boolean);

  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "export_users",
      targetType: "user",
      detail: detailParts.length > 0 ? `导出用户列表：${detailParts.join(", ")}` : "导出用户列表：全部结果",
    },
    context,
  );
}

export function setUserStatusForAdmin(
  userId: string,
  status: Extract<AuthUserStatus, "normal" | "banned">,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageUsers(actor.adminId);
  const user = ensureUserExists(userId);
  if (user.status === "merged") {
    throw new AuthServiceError("已合并账号不支持重复封禁或解封。", {
      code: "USER_MERGED_IMMUTABLE",
      status: 409,
    });
  }

  upsertAuthUser({
    ...user,
    status,
    updatedAt: nowIso(),
  });
  if (status === "banned") {
    revokeUserSessionsForUser(userId, "运营后台执行封禁");
  }
  syncMemberStateForUserStatus(
    userId,
    status === "banned" ? "账号已封禁，会员权益已冻结" : "账号已解封，会员状态已同步恢复",
    actor.adminId,
  );
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: status === "banned" ? "ban_user" : "unban_user",
      targetType: "user",
      targetId: userId,
      detail: status === "banned" ? "封禁用户" : "解除封禁",
    },
    context,
  );
  return getUserDetailForAdmin(userId);
}

export function forceLogoutUserForAdmin(
  userId: string,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageUsers(actor.adminId);
  ensureUserExists(userId);
  revokeUserSessionsForUser(userId, "运营后台强制下线");
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "force_logout_user",
      targetType: "user",
      targetId: userId,
      detail: "强制该用户所有会话失效",
    },
    context,
  );
  return getUserDetailForAdmin(userId);
}

export function unbindUserBindingForAdmin(
  input: { bindingType: "account" | "phone"; bindingId: string },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  if (input.bindingType === "account") {
    const account = getUserAccount(input.bindingId);
    if (!account) {
      throw new AuthServiceError("账号绑定不存在。", { code: "ACCOUNT_BINDING_NOT_FOUND", status: 404 });
    }
    if (countAvailableBindings(account.userId) <= 1) {
      throw new AuthServiceError("该用户至少需要保留一种可登录方式。", {
        code: "LAST_BINDING_FORBIDDEN",
        status: 409,
      });
    }
    deleteUserAccount(account.accountId);
    recordAdminAction(
      {
        adminId: actor.adminId,
        actionType: "unbind_account",
        targetType: "account",
        targetId: account.accountId,
        detail: `解绑账号 ${account.username}`,
      },
      context,
    );
    return getUserDetailForAdmin(account.userId);
  }

  const phone = getUserPhone(input.bindingId);
  if (!phone) {
    throw new AuthServiceError("手机号绑定不存在。", { code: "PHONE_BINDING_NOT_FOUND", status: 404 });
  }
  if (countAvailableBindings(phone.userId) <= 1) {
    throw new AuthServiceError("该用户至少需要保留一种可登录方式。", {
      code: "LAST_BINDING_FORBIDDEN",
      status: 409,
    });
  }
  deleteUserPhone(phone.phoneId);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "unbind_phone",
      targetType: "phone",
      targetId: phone.phoneId,
      detail: `解绑手机号 ${maskPhone(phone.phone)}`,
    },
    context,
  );
  return getUserDetailForAdmin(phone.userId);
}

export function bindPhoneForUserByAdmin(
  input: { userId: string; phone: string },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageUsers(actor.adminId);
  const user = ensureUserExists(input.userId);
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw new AuthServiceError("请输入正确的手机号。", { code: "PHONE_INVALID", status: 400 });
  }
  setCanonicalPhoneForUser(user.userId, phone, true);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "manual_repair_phone",
      targetType: "user",
      targetId: user.userId,
      detail: `修正手机号 ${maskPhone(phone)}`,
    },
    context,
  );
  return getUserDetailForAdmin(user.userId);
}

export function bindAccountForUserByAdmin(
  input: { userId: string; password: string },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageUsers(actor.adminId);
  const user = ensureUserExists(input.userId);
  setPasswordForUser(user.userId, input.password);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "manual_reset_password",
      targetType: "user",
      targetId: user.userId,
      detail: "手动重置登录密码",
    },
    context,
  );
  return getUserDetailForAdmin(user.userId);
}

export function mergeUsersForAdmin(
  input: { sourceUserId: string; targetUserId: string },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageUsers(actor.adminId);
  const { source, target } = mergeUsersInternal(input.sourceUserId, input.targetUserId);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "merge_user",
      targetType: "user",
      targetId: target.userId,
      detail: `将 ${source.userId} 合并到 ${target.userId}`,
    },
    context,
  );

  return {
    target: getUserDetailForAdmin(target.userId),
    source: buildAdminUserListItem(ensureUserExists(source.userId)),
  };
}

export function getBindingManagementSnapshot(keyword?: string): BindingManagementSnapshot {
  return {
    users: listUsersForAdmin(keyword).map((item) => ({
      userId: item.userId,
      nickname: item.nickname,
      status: item.status,
      usernames: getUserAccountsByUserId(item.userId).map((account) => ({
        accountId: account.accountId,
        username: account.username,
      })),
      phones: getUserPhonesByUserId(item.userId).map((phone) => ({
        phoneId: phone.phoneId,
        phone: phone.phone,
        maskedPhone: maskPhone(phone.phone),
        verified: phone.verified,
      })),
      phone: item.phone,
      maskedPhone: item.maskedPhone,
      hasPassword: item.hasPassword,
      passwordUpdatedAt: item.passwordUpdatedAt,
      loginMethods: item.loginMethods,
      lastLoginAt: item.lastLoginAt,
      createdAt: item.createdAt,
    })),
  };
}

export function getSecurityManagementSnapshot(): SecurityManagementSnapshot {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentSms = listSmsCodes().filter((item) => new Date(item.createdAt).getTime() >= oneHourAgo);
  const phoneHourlyMap = new Map<string, number>();
  const ipHourlyMap = new Map<string, number>();
  for (const item of recentSms) {
    phoneHourlyMap.set(item.phone, (phoneHourlyMap.get(item.phone) ?? 0) + 1);
    ipHourlyMap.set(item.requestIp, (ipHourlyMap.get(item.requestIp) ?? 0) + 1);
  }

  return {
    config: ensureRiskConfig(),
    phoneHourlyStats: [...phoneHourlyMap.entries()]
      .map(([phone, count]) => ({ phone, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    ipHourlyStats: [...ipHourlyMap.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    blocks: sortByNewest(listRiskBlockEntries()).map((item) => ({
      blockId: item.blockId,
      type: item.type,
      value: item.value,
      reason: item.reason,
      createdAt: item.createdAt,
    })),
    recentUserLogins: sortByNewest(listUserLoginLogs())
      .slice(0, 20)
      .map((item) => ({
        logId: item.logId,
        userId: item.userId,
        loginType: item.loginType,
        success: item.success,
        detail: item.detail,
        ip: item.ip,
        createdAt: item.createdAt,
      })),
    recentAdminActions: sortByNewest(listAdminActionLogs())
      .slice(0, 20)
      .map((item) => ({
        logId: item.logId,
        adminId: item.adminId,
        actionType: item.actionType,
        targetType: item.targetType,
        targetId: item.targetId,
        detail: item.detail,
        ip: item.ip,
        createdAt: item.createdAt,
      })),
    recentUserSecurityLogs: sortByNewest(listUserSecurityLogs())
      .slice(0, 20)
      .map((item) => ({
        logId: item.logId,
        userId: item.userId,
        actionType: item.actionType,
        detail: item.detail,
        ip: item.ip,
        createdAt: item.createdAt,
      })),
    recentSmsRecords: sortByNewest(listSmsCodes())
      .slice(0, 20)
      .map((item) => ({
        smsId: item.smsId,
        purpose: item.purpose,
        phone: item.phone,
        maskedPhone: maskPhone(item.phone),
        used: item.used,
        usedAt: item.usedAt,
        expireAt: item.expireAt,
        requestIp: item.requestIp,
        createdAt: item.createdAt,
      })),
    operators: sortByNewest(listAdminUsers()).map((item) => ({
      adminId: item.adminId,
      username: item.username,
      displayName: item.displayName,
      role: item.role,
      status: item.status,
      lastLoginAt: item.lastLoginAt,
      lastLoginIp: item.lastLoginIp,
    })),
  };
}

export function getAdminDashboardSnapshot(options?: { forceRefresh?: boolean }): AdminDashboardSnapshot {
  const securitySnapshot = getSecurityManagementSnapshot();
  const users = listUsersForAdmin();
  const userLoginLogs = sortByNewest(listUserLoginLogs());
  const smsCodes = sortByNewest(listSmsCodes());
  const userSessions = listUserSessions();
  const adminSessions = listAdminSessions();
  const adminActionLogs = sortByNewest(listAdminActionLogs());
  const riskBlocks = sortByNewest(listRiskBlockEntries());

  const todayStart = startOfCurrentDay();
  const isToday = (value: string | null | undefined) => toDateValue(value) >= todayStart;
  const isActiveSession = (record: { revokedAt: string | null; expiresAt: string }) =>
    !record.revokedAt && toDateValue(record.expiresAt) > Date.now();

  const totalUsers = users.length;
  const normalUsers = users.filter((item) => item.status === "normal").length;
  const bannedUsers = users.filter((item) => item.status === "banned").length;
  const passwordReadyUsers = users.filter((item) => item.hasPassword).length;
  const activeUserSessions = userSessions.filter(isActiveSession).length;
  const totalOperators = securitySnapshot.operators.length;
  const activeOperators = securitySnapshot.operators.filter((item) => item.status === "active").length;
  const activeAdminSessions = adminSessions.filter(isActiveSession).length;

  const todayRegistrations = users.filter((item) => isToday(item.createdAt)).length;
  const todayLogins = userLoginLogs.filter((item) => isToday(item.createdAt));
  const todayLoginSuccess = todayLogins.filter((item) => item.success).length;
  const todayLoginFail = todayLogins.length - todayLoginSuccess;
  const todaySmsRequests = smsCodes.filter((item) => isToday(item.createdAt)).length;
  const todaySmsUsed = smsCodes.filter((item) => isToday(item.usedAt)).length;
  const todayRiskBlocks = riskBlocks.filter((item) => isToday(item.createdAt)).length;
  const todayAdminActions = adminActionLogs.filter((item) => isToday(item.createdAt)).length;

  const generatedAt = nowIso();
  const metricDateToday = formatLocalDateKey(todayStart);
  let dailyMetrics = listAuthDashboardDailyMetrics(AUTH_DASHBOARD_DAILY_WINDOW_DAYS);
  if (options?.forceRefresh || shouldRefreshAuthDashboardDailyMetrics(dailyMetrics, metricDateToday)) {
    refreshAuthDashboardDailyMetrics({
      users,
      userLoginLogs,
      smsCodes,
      adminActionLogs,
      riskBlocks,
      todayStart,
      activeUserSessions,
      totalOperators,
      activeOperators,
      activeAdminSessions,
      generatedAt,
    });
    dailyMetrics = listAuthDashboardDailyMetrics(AUTH_DASHBOARD_DAILY_WINDOW_DAYS);
  }

  const daily = dailyMetrics
    .reverse()
    .map((item) => ({
      dateKey: item.metricDate,
      label: buildDayLabel(new Date(`${item.metricDate}T00:00:00`).getTime()),
      newUsers: item.newUsers,
      loginSuccess: item.loginSuccess,
      smsRequests: item.smsRequests,
      adminActions: item.adminActions,
    }));

  return {
    generatedAt,
    totals: {
      totalUsers,
      normalUsers,
      bannedUsers,
      passwordReadyUsers,
      activeUserSessions,
      totalOperators,
      activeOperators,
      activeAdminSessions,
      totalRiskBlocks: riskBlocks.length,
    },
    today: {
      registrations: todayRegistrations,
      loginTotal: todayLogins.length,
      loginSuccess: todayLoginSuccess,
      loginFail: todayLoginFail,
      loginSuccessRate: todayLogins.length > 0 ? todayLoginSuccess / todayLogins.length : 0,
      smsRequests: todaySmsRequests,
      smsUsed: todaySmsUsed,
      riskBlocks: todayRiskBlocks,
      adminActions: todayAdminActions,
    },
    daily,
    recentUserLogins: securitySnapshot.recentUserLogins.slice(0, 6),
    recentAdminActions: securitySnapshot.recentAdminActions.slice(0, 6),
    config: {
      smsEnabled: securitySnapshot.config.smsEnabled,
      smsDebugMode: securitySnapshot.config.smsDebugMode,
      tokenExpireDays: securitySnapshot.config.tokenExpireDays,
    },
  };
}

export function refreshAdminDashboardSnapshotForAdmin(
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminRoleAllowed(actor.adminId, ["super_admin", "operator"], "当前账号不支持刷新账号看板。");
  const snapshot = getAdminDashboardSnapshot({ forceRefresh: true });
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "refresh_auth_dashboard",
      targetType: "system",
      detail: "手动刷新账号看板聚合",
    },
    context,
  );
  return snapshot;
}

export function updateRiskConfigForAdmin(
  input: Partial<AuthRiskConfigRecord>,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageSecurity(actor.adminId);
  const current = ensureRiskConfig();
  const next: AuthRiskConfigRecord = {
    ...current,
    ...input,
    smsExpireSeconds: Math.max(60, Number(input.smsExpireSeconds ?? current.smsExpireSeconds)),
    smsCooldownSeconds: Math.max(30, Number(input.smsCooldownSeconds ?? current.smsCooldownSeconds)),
    smsHourlyLimitPerPhone: Math.max(1, Number(input.smsHourlyLimitPerPhone ?? current.smsHourlyLimitPerPhone)),
    smsHourlyLimitPerIp: Math.max(1, Number(input.smsHourlyLimitPerIp ?? current.smsHourlyLimitPerIp)),
    tokenExpireDays: SESSION_EXPIRE_DAYS,
  };
  setAuthRiskConfig(next);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "update_risk_config",
      targetType: "system",
      detail: "更新短信与 token 风控配置",
    },
    context,
  );
  return getSecurityManagementSnapshot();
}

export function addRiskBlockForAdmin(
  input: { type: RiskBlockType; value: string; reason: string },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageSecurity(actor.adminId);
  const normalizedValue = input.type === "phone" ? normalizePhone(input.value) : sanitizeIp(input.value);
  if (!normalizedValue) {
    throw new AuthServiceError("限制对象不能为空。", { code: "RISK_BLOCK_VALUE_REQUIRED", status: 400 });
  }
  if (input.type === "phone" && !isValidPhone(normalizedValue)) {
    throw new AuthServiceError("请输入正确的手机号。", { code: "PHONE_INVALID", status: 400 });
  }
  const duplicate = listRiskBlockEntries().find((item) => item.type === input.type && item.value === normalizedValue);
  if (duplicate) {
    throw new AuthServiceError("该限制项已存在。", { code: "RISK_BLOCK_DUPLICATE", status: 409 });
  }
  upsertRiskBlockEntry({
    blockId: createId("block"),
    type: input.type,
    value: normalizedValue,
    reason: input.reason.trim() || "手动限制",
    createdAt: nowIso(),
  });
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "add_risk_block",
      targetType: input.type,
      targetId: normalizedValue,
      detail: `新增风控限制：${input.reason.trim() || "手动限制"}`,
    },
    context,
  );
  return getSecurityManagementSnapshot();
}

export function removeRiskBlockForAdmin(
  blockId: string,
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageSecurity(actor.adminId);
  const block = getRiskBlockEntry(blockId);
  if (!block) {
    throw new AuthServiceError("限制项不存在。", { code: "RISK_BLOCK_NOT_FOUND", status: 404 });
  }
  deleteRiskBlockEntry(blockId);
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: "remove_risk_block",
      targetType: block.type,
      targetId: block.value,
      detail: "移除风控限制",
    },
    context,
  );
  return getSecurityManagementSnapshot();
}

export function loginAdminWithPassword(
  input: { username: string; password: string },
  context?: Partial<RequestAuditContext>,
) {
  const username = normalizeUsername(input.username);
  const admin = findAdminByUsername(username);
  if (!admin || !verifyPassword(input.password, admin.passwordHash)) {
    throw new AuthServiceError("运营账号或密码错误。", {
      code: "ADMIN_LOGIN_INVALID",
      status: 401,
    });
  }
  ensureAdminActive(admin);
  const session = issueAdminSession(admin, context);
  recordAdminAction(
    {
      adminId: admin.adminId,
      actionType: "admin_login",
      targetType: "admin",
      targetId: admin.adminId,
      detail: `运营账号 ${admin.username} 登录成功`,
    },
    context,
  );
  return {
    token: session.token,
    adminId: admin.adminId,
    admin: {
      adminId: admin.adminId,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      status: admin.status,
    },
  };
}

export function getAdminSessionByToken(rawToken: string | null | undefined): AuthenticatedAdminSession | null {
  if (!rawToken) {
    return null;
  }

  const session = findAdminSessionByToken(rawToken);
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    return null;
  }
  const admin = getAdminUser(session.adminId);
  if (!admin || admin.status !== "active") {
    return null;
  }

  upsertAdminSession({
    ...session,
    lastSeenAt: nowIso(),
  });

  return {
    sessionId: session.sessionId,
    adminId: admin.adminId,
    expiresAt: session.expiresAt,
    admin: {
      adminId: admin.adminId,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      status: admin.status,
    },
  };
}

export function logoutAdminByToken(rawToken: string | null | undefined) {
  if (!rawToken) {
    return;
  }
  const session = findAdminSessionByToken(rawToken);
  if (!session) {
    return;
  }
  revokeAdminSession(session.sessionId, "运营账号主动退出");
}

export function upsertOperatorForAdmin(
  input: {
    adminId?: string;
    username: string;
    displayName: string;
    role: AdminRole;
    status: AdminStatus;
    password?: string;
  },
  actor: { adminId: string },
  context?: Partial<RequestAuditContext>,
) {
  ensureAdminCanManageSecurity(actor.adminId);

  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) {
    throw new AuthServiceError("运营账号用户名格式不正确。", {
      code: "USERNAME_INVALID",
      status: 400,
    });
  }

  const existingByUsername = findAdminByUsername(username);
  if (existingByUsername && existingByUsername.adminId !== input.adminId) {
    throw new AuthServiceError("该运营账号用户名已存在。", {
      code: "ADMIN_USERNAME_DUPLICATE",
      status: 409,
    });
  }

  const now = nowIso();
  const current = input.adminId ? ensureAdminExists(input.adminId) : null;
  if (!current && !input.password) {
    throw new AuthServiceError("新增运营账号时必须设置密码。", {
      code: "ADMIN_PASSWORD_REQUIRED",
      status: 400,
    });
  }
  if (input.password && !isStrongEnoughPassword(input.password)) {
    throw new AuthServiceError(getPasswordRuleText(), {
      code: "PASSWORD_INVALID",
      status: 400,
    });
  }
  const nextPassword =
    input.password && input.password.trim()
      ? hashPassword(input.password)
      : {
          salt: current?.salt ?? "",
          passwordHash: current?.passwordHash ?? "",
        };

  const nextAdmin: AdminUserRecord = {
    adminId: current?.adminId ?? createId("admin"),
    username,
    displayName: input.displayName.trim() || username,
    role: input.role,
    status: input.status,
    passwordHash: nextPassword.passwordHash,
    salt: nextPassword.salt,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    lastLoginAt: current?.lastLoginAt ?? null,
    lastLoginIp: current?.lastLoginIp ?? null,
  };
  upsertAdminUser(nextAdmin);
  if (nextAdmin.status !== "active") {
    revokeAdminSessionsForAdmin(nextAdmin.adminId, "运营账号被停用");
  }
  recordAdminAction(
    {
      adminId: actor.adminId,
      actionType: current ? "update_operator" : "create_operator",
      targetType: "admin",
      targetId: nextAdmin.adminId,
      detail: current ? `更新运营账号 ${nextAdmin.username}` : `创建运营账号 ${nextAdmin.username}`,
    },
    context,
  );
  return getSecurityManagementSnapshot();
}
