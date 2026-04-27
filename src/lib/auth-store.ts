import { SESSION_EXPIRE_DAYS } from "./auth-route-config";
import { dbDelete, dbGet, dbGetAll, dbGetSingleton, dbSetSingleton, dbUpsert } from "./db";

export type AuthUserStatus = "normal" | "banned" | "merged";
export type UserLoginType = "password" | "sms";
export type SmsCodePurpose = "login" | "bind_phone" | "reset_password" | "change_phone_old" | "change_phone_new";
export type AdminRole = "super_admin" | "operator" | "viewer";
export type AdminStatus = "active" | "disabled";
export type RiskBlockType = "phone" | "ip";
export type UserSecurityActionType =
  | "update_profile"
  | "set_password"
  | "reset_password"
  | "bind_phone"
  | "change_phone"
  | "logout_other_sessions"
  | "revoke_session";

export type AuthUserRecord = {
  userId: string;
  nickname: string;
  avatar: string | null;
  status: AuthUserStatus;
  planLevel: number | null;
  quotaScope: "limited" | "unlimited";
  certificationLabel: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  mergedIntoUserId: string | null;
};

export type UserAccountRecord = {
  accountId: string;
  userId: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
};

export type UserPhoneRecord = {
  phoneId: string;
  userId: string;
  phone: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SmsCodeRecord = {
  smsId: string;
  phone: string;
  codeHash: string;
  expireAt: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string;
  requestIp: string;
  purpose: SmsCodePurpose;
  provider?: "debug" | "tencent";
  providerRequestId?: string | null;
  providerSerialNo?: string | null;
  providerStatusCode?: string | null;
  providerStatusMessage?: string | null;
  providerTemplateId?: string | null;
  providerPhoneNumber?: string | null;
  sentAt?: string | null;
};

export type UserSessionRecord = {
  sessionId: string;
  userId: string;
  tokenHash: string;
  loginType: UserLoginType;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastSeenAt: string | null;
  ip: string;
  userAgent: string | null;
};

export type UserLoginLogRecord = {
  logId: string;
  userId: string | null;
  loginType: UserLoginType;
  success: boolean;
  detail: string;
  ip: string;
  createdAt: string;
};

export type UserSecurityLogRecord = {
  logId: string;
  userId: string;
  actionType: UserSecurityActionType;
  detail: string;
  ip: string;
  createdAt: string;
};

export type AdminUserRecord = {
  adminId: string;
  username: string;
  displayName: string;
  role: AdminRole;
  status: AdminStatus;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
};

export type AdminSessionRecord = {
  sessionId: string;
  adminId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastSeenAt: string | null;
  ip: string;
  userAgent: string | null;
};

export type AdminActionLogRecord = {
  logId: string;
  adminId: string;
  actionType: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  ip: string;
  createdAt: string;
};

export type RiskBlockEntryRecord = {
  blockId: string;
  type: RiskBlockType;
  value: string;
  reason: string;
  createdAt: string;
};

export type AuthRiskConfigRecord = {
  smsEnabled: boolean;
  smsDebugMode: boolean;
  smsExpireSeconds: number;
  smsCooldownSeconds: number;
  smsHourlyLimitPerPhone: number;
  smsHourlyLimitPerIp: number;
  tokenExpireDays: number;
};

const USER_COLLECTION = "auth-users";
const USER_ACCOUNT_COLLECTION = "auth-user-accounts";
const USER_PHONE_COLLECTION = "auth-user-phones";
const SMS_CODE_COLLECTION = "auth-sms-codes";
const USER_SESSION_COLLECTION = "auth-user-sessions";
const USER_LOGIN_LOG_COLLECTION = "auth-user-login-logs";
const USER_SECURITY_LOG_COLLECTION = "auth-user-security-logs";
const ADMIN_USER_COLLECTION = "auth-admin-users";
const ADMIN_SESSION_COLLECTION = "auth-admin-sessions";
const ADMIN_LOG_COLLECTION = "auth-admin-action-logs";
const RISK_BLOCK_COLLECTION = "auth-risk-blocks";
const RISK_CONFIG_COLLECTION = "auth-risk-config";

function safeList<T>(collection: string) {
  try {
    return dbGetAll<T>(collection);
  } catch {
    return [] as T[];
  }
}

export function getDefaultAuthRiskConfig(): AuthRiskConfigRecord {
  return {
    smsEnabled: true,
    smsDebugMode: process.env.NODE_ENV !== "production",
    smsExpireSeconds: 300,
    smsCooldownSeconds: 60,
    smsHourlyLimitPerPhone: 10,
    smsHourlyLimitPerIp: 30,
    tokenExpireDays: SESSION_EXPIRE_DAYS,
  };
}

function normalizeAuthRiskConfig(config: Partial<AuthRiskConfigRecord> | null | undefined): AuthRiskConfigRecord {
  const defaults = getDefaultAuthRiskConfig();
  return {
    ...defaults,
    ...config,
    smsDebugMode: process.env.NODE_ENV === "production" ? false : (config?.smsDebugMode ?? defaults.smsDebugMode),
    tokenExpireDays: SESSION_EXPIRE_DAYS,
  };
}

export function listAuthUsers() {
  return safeList<AuthUserRecord>(USER_COLLECTION);
}

export function getAuthUser(userId: string) {
  return dbGet<AuthUserRecord>(USER_COLLECTION, userId);
}

export function upsertAuthUser(user: AuthUserRecord) {
  dbUpsert(USER_COLLECTION, user.userId, user);
}

export function listUserAccounts() {
  return safeList<UserAccountRecord>(USER_ACCOUNT_COLLECTION);
}

export function getUserAccount(accountId: string) {
  return dbGet<UserAccountRecord>(USER_ACCOUNT_COLLECTION, accountId);
}

export function upsertUserAccount(account: UserAccountRecord) {
  dbUpsert(USER_ACCOUNT_COLLECTION, account.accountId, account);
}

export function deleteUserAccount(accountId: string) {
  dbDelete(USER_ACCOUNT_COLLECTION, accountId);
}

export function listUserPhones() {
  return safeList<UserPhoneRecord>(USER_PHONE_COLLECTION);
}

export function getUserPhone(phoneId: string) {
  return dbGet<UserPhoneRecord>(USER_PHONE_COLLECTION, phoneId);
}

export function upsertUserPhone(phone: UserPhoneRecord) {
  dbUpsert(USER_PHONE_COLLECTION, phone.phoneId, phone);
}

export function deleteUserPhone(phoneId: string) {
  dbDelete(USER_PHONE_COLLECTION, phoneId);
}

export function listSmsCodes() {
  return safeList<SmsCodeRecord>(SMS_CODE_COLLECTION);
}

export function getSmsCode(smsId: string) {
  return dbGet<SmsCodeRecord>(SMS_CODE_COLLECTION, smsId);
}

export function upsertSmsCode(code: SmsCodeRecord) {
  dbUpsert(SMS_CODE_COLLECTION, code.smsId, code);
}

export function listUserSessions() {
  return safeList<UserSessionRecord>(USER_SESSION_COLLECTION);
}

export function getUserSession(sessionId: string) {
  return dbGet<UserSessionRecord>(USER_SESSION_COLLECTION, sessionId);
}

export function upsertUserSession(session: UserSessionRecord) {
  dbUpsert(USER_SESSION_COLLECTION, session.sessionId, session);
}

export function deleteUserSession(sessionId: string) {
  dbDelete(USER_SESSION_COLLECTION, sessionId);
}

export function listUserLoginLogs() {
  return safeList<UserLoginLogRecord>(USER_LOGIN_LOG_COLLECTION);
}

export function upsertUserLoginLog(log: UserLoginLogRecord) {
  dbUpsert(USER_LOGIN_LOG_COLLECTION, log.logId, log);
}

export function listUserSecurityLogs() {
  return safeList<UserSecurityLogRecord>(USER_SECURITY_LOG_COLLECTION);
}

export function upsertUserSecurityLog(log: UserSecurityLogRecord) {
  dbUpsert(USER_SECURITY_LOG_COLLECTION, log.logId, log);
}

export function listAdminUsers() {
  return safeList<AdminUserRecord>(ADMIN_USER_COLLECTION);
}

export function getAdminUser(adminId: string) {
  return dbGet<AdminUserRecord>(ADMIN_USER_COLLECTION, adminId);
}

export function upsertAdminUser(admin: AdminUserRecord) {
  dbUpsert(ADMIN_USER_COLLECTION, admin.adminId, admin);
}

export function listAdminSessions() {
  return safeList<AdminSessionRecord>(ADMIN_SESSION_COLLECTION);
}

export function getAdminSession(sessionId: string) {
  return dbGet<AdminSessionRecord>(ADMIN_SESSION_COLLECTION, sessionId);
}

export function upsertAdminSession(session: AdminSessionRecord) {
  dbUpsert(ADMIN_SESSION_COLLECTION, session.sessionId, session);
}

export function deleteAdminSession(sessionId: string) {
  dbDelete(ADMIN_SESSION_COLLECTION, sessionId);
}

export function listAdminActionLogs() {
  return safeList<AdminActionLogRecord>(ADMIN_LOG_COLLECTION);
}

export function upsertAdminActionLog(log: AdminActionLogRecord) {
  dbUpsert(ADMIN_LOG_COLLECTION, log.logId, log);
}

export function listRiskBlockEntries() {
  return safeList<RiskBlockEntryRecord>(RISK_BLOCK_COLLECTION);
}

export function getRiskBlockEntry(blockId: string) {
  return dbGet<RiskBlockEntryRecord>(RISK_BLOCK_COLLECTION, blockId);
}

export function upsertRiskBlockEntry(entry: RiskBlockEntryRecord) {
  dbUpsert(RISK_BLOCK_COLLECTION, entry.blockId, entry);
}

export function deleteRiskBlockEntry(blockId: string) {
  dbDelete(RISK_BLOCK_COLLECTION, blockId);
}

export function getAuthRiskConfig() {
  return normalizeAuthRiskConfig(dbGetSingleton<AuthRiskConfigRecord>(RISK_CONFIG_COLLECTION));
}

export function setAuthRiskConfig(config: AuthRiskConfigRecord) {
  dbSetSingleton(RISK_CONFIG_COLLECTION, normalizeAuthRiskConfig(config));
}
