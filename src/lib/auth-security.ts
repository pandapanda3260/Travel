import { createHash, randomBytes } from "node:crypto";

import { compareSync, genSaltSync, hashSync } from "bcryptjs";

const PASSWORD_MIN_LENGTH = 8;
const CHINA_MAINLAND_PHONE_PATTERN = /^1\d{10}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{3,31}$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidUsername(value: string) {
  return USERNAME_PATTERN.test(value.trim());
}

export function isValidPhone(value: string) {
  return CHINA_MAINLAND_PHONE_PATTERN.test(normalizePhone(value));
}

export function isStrongEnoughPassword(value: string) {
  const password = value.trim();
  return password.length >= PASSWORD_MIN_LENGTH && /[a-zA-Z]/.test(password) && /\d/.test(password);
}

export function hashPassword(password: string) {
  const salt = genSaltSync(10);
  const passwordHash = hashSync(password, salt);
  return { salt, passwordHash };
}

export function verifyPassword(password: string, passwordHash: string) {
  return compareSync(password, passwordHash);
}

export function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 7) {
    return normalized;
  }

  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

export function buildAutoNickname(phone?: string | null) {
  if (phone) {
    return `旅拍用户 ${maskPhone(phone)}`;
  }

  return `旅拍用户 ${randomBytes(2).toString("hex").toUpperCase()}`;
}

export function sanitizeIp(value: string | null | undefined) {
  if (!value) {
    return "unknown";
  }

  return value.split(",")[0]?.trim() || "unknown";
}

export function getPasswordRuleText() {
  return "密码至少 8 位，且需同时包含字母和数字。";
}
