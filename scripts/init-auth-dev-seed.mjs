#!/usr/bin/env node

import Database from "better-sqlite3";
import { compareSync, genSaltSync, hashSync } from "bcryptjs";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const LEGACY_SHARED_TRAVEL_ENV_FILE = "/Users/bytedance/Desktop/Travel 相关文件/key/travel.env.local";
const DEFAULT_SHARED_TRAVEL_ENV_FILE_CANDIDATES = ["travel.shared.env.local", "travel.env.shared.local"];
const args = new Set(process.argv.slice(2));
const allowExternalDataDir =
  args.has("--allow-external-data-dir") || process.env.TRAVEL_DEV_ALLOW_EXTERNAL_DATA_DIR?.trim() === "1";
const allowPasswordReset =
  args.has("--reset-passwords") || process.env.TRAVEL_DEV_RESET_PASSWORDS?.trim() === "1";

if (process.env.NODE_ENV === "production" && !args.has("--force")) {
  console.error("[auth:init-dev] 生产环境默认禁止写入开发测试账号，如需继续请显式传入 --force。");
  process.exit(1);
}

function isPathWithinDirectory(rootDir, targetPath) {
  const normalizedRoot = resolve(rootDir);
  const normalizedTarget = resolve(targetPath);
  const rel = relative(normalizedRoot, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function normalizeEnvValue(value) {
  const trimmed = value.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unwrapped = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unwrapped.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      : unwrapped;
  }

  return trimmed;
}

function parseEnvFileContent(content) {
  return content.split(/\r?\n/).reduce((accumulator, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return accumulator;
    }

    const normalizedLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      return accumulator;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const value = normalizeEnvValue(normalizedLine.slice(separatorIndex + 1));
    accumulator[key] = value;
    return accumulator;
  }, {});
}

function readEnvFileIfExists(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return parseEnvFileContent(readFileSync(filePath, "utf8"));
}

function getSharedTravelEnvFilePath() {
  const explicitPath = process.env.TRAVEL_SHARED_ENV_FILE?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  for (const candidate of DEFAULT_SHARED_TRAVEL_ENV_FILE_CANDIDATES) {
    const candidatePath = join(process.cwd(), candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return existsSync(LEGACY_SHARED_TRAVEL_ENV_FILE) ? LEGACY_SHARED_TRAVEL_ENV_FILE : "";
}

function loadOptionalEnvFile(fileName) {
  if (isAbsolute(fileName)) {
    return readEnvFileIfExists(fileName);
  }

  const sharedEnvPath = getSharedTravelEnvFilePath();
  const sharedConfig = sharedEnvPath ? readEnvFileIfExists(sharedEnvPath) : {};
  const localConfig = readEnvFileIfExists(join(process.cwd(), fileName));

  return {
    ...sharedConfig,
    ...localConfig,
  };
}

const envConfig = loadOptionalEnvFile("travel.env.local");

function getConfiguredValue(key) {
  return process.env[key]?.trim() || envConfig[key]?.trim() || "";
}

function getRuntimeStorageRoot() {
  return getConfiguredValue("TRAVEL_STORAGE_ROOT") || process.cwd();
}

function getRuntimeDataDir() {
  return getConfiguredValue("TRAVEL_DATA_DIR") || join(getRuntimeStorageRoot(), "data");
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

function normalizePhone(value) {
  return value.replace(/\D/g, "");
}

function buildSeedNickname(phone) {
  return `${phone.slice(-4)}手机用户`;
}

function shouldUseSeedNickname(currentNickname, phone) {
  const nickname = String(currentNickname ?? "").trim();
  return !nickname || nickname.startsWith("旅拍用户 ") || nickname === buildSeedNickname(phone);
}

function hashPassword(password) {
  const salt = genSaltSync(10);
  const passwordHash = hashSync(password, salt);
  return { salt, passwordHash };
}

function resolvePasswordPayload(existingRecord, password) {
  if (!existingRecord) {
    return {
      ...hashPassword(password),
      action: "created",
    };
  }

  if (compareSync(password, existingRecord.passwordHash)) {
    return {
      salt: existingRecord.salt,
      passwordHash: existingRecord.passwordHash,
      action: "unchanged",
    };
  }

  if (!allowPasswordReset) {
    return {
      salt: existingRecord.salt,
      passwordHash: existingRecord.passwordHash,
      action: "preserved",
    };
  }

  return {
    ...hashPassword(password),
    action: "updated",
  };
}

function describeSeedStatus(seedResult) {
  if (seedResult.created) {
    return "新建";
  }

  if (seedResult.passwordAction === "updated") {
    return "已更新密码";
  }

  if (seedResult.passwordAction === "preserved") {
    return "已存在（保留现有密码）";
  }

  return "已存在";
}

function formatCredentialSummary(identifier, configuredPassword, seedResult) {
  if (seedResult.passwordAction === "preserved") {
    return `${identifier} / （保留现有密码）`;
  }

  return `${identifier} / ${configuredPassword}`;
}

const dataDir = getRuntimeDataDir();
const projectRoot = resolve(process.cwd());
const resolvedDataDir = resolve(dataDir);

if (!isPathWithinDirectory(projectRoot, resolvedDataDir) && !allowExternalDataDir) {
  console.error(
    `[auth:init-dev] 当前数据目录 ${resolvedDataDir} 不在项目目录 ${projectRoot} 内。为避免误改共享/正式数据，默认禁止写入外部目录；如确认需要，请显式传入 --allow-external-data-dir 或设置 TRAVEL_DEV_ALLOW_EXTERNAL_DATA_DIR=1。`,
  );
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const db = new Database(join(dataDir, "app.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    key        TEXT NOT NULL,
    data       TEXT NOT NULL,
    PRIMARY KEY (collection, key)
  )
`);

function listCollection(collection) {
  const rows = db.prepare("SELECT data FROM records WHERE collection = ?").all(collection);
  return rows.map((row) => JSON.parse(row.data));
}

function upsertRecord(collection, key, data) {
  db.prepare("INSERT OR REPLACE INTO records (collection, key, data) VALUES (?, ?, ?)")
    .run(collection, key, JSON.stringify(data));
}

function deleteRecord(collection, key) {
  db.prepare("DELETE FROM records WHERE collection = ? AND key = ?").run(collection, key);
}

function getAdminByUsername(username) {
  return listCollection("auth-admin-users").find((item) => item.username === username) ?? null;
}

function deleteAdminSeedByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  const admin = getAdminByUsername(normalizedUsername);
  if (!admin) {
    return {
      removed: false,
      username: normalizedUsername,
    };
  }

  const sessions = listCollection("auth-admin-sessions").filter((item) => item.adminId === admin.adminId);
  for (const session of sessions) {
    deleteRecord("auth-admin-sessions", session.sessionId);
  }
  deleteRecord("auth-admin-users", admin.adminId);

  return {
    removed: true,
    username: normalizedUsername,
    sessionCount: sessions.length,
  };
}

function getUserById(userId) {
  return listCollection("auth-users").find((item) => item.userId === userId) ?? null;
}

function getUserAccountByUsername(username) {
  return listCollection("auth-user-accounts").find((item) => item.username === username) ?? null;
}

function getUserPhoneByPhone(phone) {
  return listCollection("auth-user-phones").find((item) => item.phone === phone) ?? null;
}

function getUserAccountsByUserId(userId) {
  return listCollection("auth-user-accounts").filter((item) => item.userId === userId);
}

function getUserPhonesByUserId(userId) {
  return listCollection("auth-user-phones").filter((item) => item.userId === userId);
}

function upsertAdminSeed({ username, password, displayName }) {
  const normalizedUsername = normalizeUsername(username);
  const existing = getAdminByUsername(normalizedUsername);
  const passwordPayload = resolvePasswordPayload(existing, password);
  const timestamp = nowIso();
  const admin = {
    adminId: existing?.adminId ?? createId("admin"),
    username: normalizedUsername,
    displayName,
    role: "super_admin",
    status: "active",
    passwordHash: passwordPayload.passwordHash,
    salt: passwordPayload.salt,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastLoginAt: existing?.lastLoginAt ?? null,
    lastLoginIp: existing?.lastLoginIp ?? null,
  };
  upsertRecord("auth-admin-users", admin.adminId, admin);
  return {
    username: admin.username,
    created: !existing,
    passwordAction: passwordPayload.action,
  };
}

function upsertWorkbenchSeed({
  phone,
  password,
  nickname,
  planLevel,
  certificationLabel,
}) {
  const normalizedPhone = normalizePhone(phone);
  const existingPhoneBinding = getUserPhoneByPhone(normalizedPhone);
  const existingAccount = getUserAccountByUsername(normalizedPhone);

  if (existingPhoneBinding && existingAccount && existingPhoneBinding.userId !== existingAccount.userId) {
    throw new Error(
      `手机号 ${normalizedPhone} 的短信绑定与密码账号指向不同用户，请先手工清理脏数据后再执行脚本。`,
    );
  }

  const linkedUserId = existingPhoneBinding?.userId ?? existingAccount?.userId ?? null;
  const existingUser = linkedUserId ? getUserById(linkedUserId) : null;
  const timestamp = nowIso();
  const user = {
    userId: existingUser?.userId ?? createId("user"),
    nickname: shouldUseSeedNickname(existingUser?.nickname, normalizedPhone) ? nickname : existingUser.nickname,
    avatar: existingUser?.avatar ?? null,
    status: "normal",
    planLevel,
    quotaScope: "unlimited",
    certificationLabel,
    createdAt: existingUser?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastLoginAt: existingUser?.lastLoginAt ?? null,
    lastLoginIp: existingUser?.lastLoginIp ?? null,
    mergedIntoUserId: null,
  };
  upsertRecord("auth-users", user.userId, user);

  const phoneRecords = getUserPhonesByUserId(user.userId);
  const primaryPhoneRecord =
    (existingPhoneBinding && existingPhoneBinding.userId === user.userId ? existingPhoneBinding : null) ??
    phoneRecords[0] ??
    null;
  const phoneId = primaryPhoneRecord?.phoneId ?? createId("phone");
  for (const record of phoneRecords) {
    if (record.phoneId !== phoneId) {
      deleteRecord("auth-user-phones", record.phoneId);
    }
  }
  upsertRecord("auth-user-phones", phoneId, {
    phoneId,
    userId: user.userId,
    phone: normalizedPhone,
    verified: true,
    createdAt: primaryPhoneRecord?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });

  const accountRecords = getUserAccountsByUserId(user.userId);
  const primaryAccountRecord =
    (existingAccount && existingAccount.userId === user.userId ? existingAccount : null) ??
    accountRecords.find((item) => item.username === normalizedPhone) ??
    accountRecords[0] ??
    null;
  const passwordPayload = resolvePasswordPayload(primaryAccountRecord, password);
  const accountId = primaryAccountRecord?.accountId ?? createId("acct");
  for (const record of accountRecords) {
    if (record.accountId !== accountId) {
      deleteRecord("auth-user-accounts", record.accountId);
    }
  }
  upsertRecord("auth-user-accounts", accountId, {
    accountId,
    userId: user.userId,
    username: normalizedPhone,
    passwordHash: passwordPayload.passwordHash,
    salt: passwordPayload.salt,
    createdAt: primaryAccountRecord?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });

  return {
    userId: user.userId,
    phone: normalizedPhone,
    created: !existingUser,
    passwordAction: passwordPayload.action,
  };
}

const primaryAdminUsername = normalizeUsername(getConfiguredValue("TRAVEL_DEV_ADMIN_USERNAME") || "15600608369");
const primaryAdminPassword = getConfiguredValue("TRAVEL_DEV_ADMIN_PASSWORD") || "123456";
const primaryAdminDisplayName = getConfiguredValue("TRAVEL_DEV_ADMIN_DISPLAY_NAME") || "超级管理员";
const workbenchPhone = normalizePhone(getConfiguredValue("TRAVEL_DEV_WORKBENCH_PHONE") || "15600608369");
const workbenchPassword = getConfiguredValue("TRAVEL_DEV_WORKBENCH_PASSWORD") || "123456";
const workbenchPlanLevel = Number(getConfiguredValue("TRAVEL_DEV_WORKBENCH_PLAN_LEVEL") || 5);
const workbenchCertificationLabel = getConfiguredValue("TRAVEL_DEV_WORKBENCH_CERTIFICATION_LABEL") || "企业认证";
const workbenchNickname = getConfiguredValue("TRAVEL_DEV_WORKBENCH_NICKNAME") || buildSeedNickname(workbenchPhone);
const legacyAdminUsername = "admin";

const runSeed = db.transaction(() => {
  const removedLegacyAdmin =
    primaryAdminUsername !== legacyAdminUsername ? deleteAdminSeedByUsername(legacyAdminUsername) : null;

  const adminSeed = upsertAdminSeed({
    username: primaryAdminUsername,
    password: primaryAdminPassword,
    displayName: primaryAdminDisplayName,
  });

  const workbenchSeed = upsertWorkbenchSeed({
    phone: workbenchPhone,
    password: workbenchPassword,
    nickname: workbenchNickname,
    planLevel: Number.isFinite(workbenchPlanLevel) ? workbenchPlanLevel : 5,
    certificationLabel: workbenchCertificationLabel,
  });

  return {
    removedLegacyAdmin,
    adminSeed,
    workbenchSeed,
  };
});

try {
  const result = runSeed();
  console.log(`[auth:init-dev] 已写入开发测试账号，数据目录：${dataDir}`);
  console.log(
    `[auth:init-dev] 管理后台超级管理员：${formatCredentialSummary(result.adminSeed.username, primaryAdminPassword, result.adminSeed)} (${describeSeedStatus(result.adminSeed)})`,
  );
  if (result.removedLegacyAdmin?.removed) {
    console.log(
      `[auth:init-dev] 已清理历史附加管理员：${result.removedLegacyAdmin.username}（移除 ${result.removedLegacyAdmin.sessionCount ?? 0} 个后台会话）`,
    );
  }
  console.log(
    `[auth:init-dev] 工作台账号：${formatCredentialSummary(result.workbenchSeed.phone, workbenchPassword, result.workbenchSeed)} (${describeSeedStatus(result.workbenchSeed)})`,
  );
  if (!allowPasswordReset) {
    console.log("[auth:init-dev] 默认不会重置已存在账号密码；如需显式覆盖，请传入 --reset-passwords。");
  }
} catch (error) {
  console.error(`[auth:init-dev] 初始化失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
