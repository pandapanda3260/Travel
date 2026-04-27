import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, USER_SESSION_COOKIE } from "./auth-route-config";
import { getAdminSessionByToken, getUserSessionByToken } from "./auth-service";

const readUserPageSessionByToken = cache((token: string | null) => getUserSessionByToken(token));
const readAdminPageSessionByToken = cache((token: string | null) => getAdminSessionByToken(token));

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function applyUserSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(USER_SESSION_COOKIE, token, getCookieOptions());
}

export function clearUserSessionCookie(response: NextResponse) {
  response.cookies.set(USER_SESSION_COOKIE, "", { ...getCookieOptions(), maxAge: 0 });
}

export function applyAdminSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(ADMIN_SESSION_COOKIE, token, getCookieOptions());
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...getCookieOptions(), maxAge: 0 });
}

export async function getOptionalUserPageSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USER_SESSION_COOKIE)?.value ?? null;
  return readUserPageSessionByToken(token);
}

export async function getOptionalAdminPageSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  return readAdminPageSessionByToken(token);
}

export async function requireUserPageSession() {
  const session = await getOptionalUserPageSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireAdminPageSession() {
  const session = await getOptionalAdminPageSession();
  if (!session) {
    redirect("/admin-auth/login");
  }
  return session;
}

function buildApiUnauthorizedBody(message: string, redirectTo: string) {
  return {
    error: message,
    code: "UNAUTHORIZED",
    redirectTo,
  };
}

export function requireUserApiSession(request: NextRequest) {
  const session = getUserSessionByToken(request.cookies.get(USER_SESSION_COOKIE)?.value ?? null);
  return session;
}

export function requireAdminApiSession(request: NextRequest) {
  const session = getAdminSessionByToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null);
  return session;
}

export async function buildRequestAuditContext() {
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for") ||
    headerStore.get("x-real-ip") ||
    headerStore.get("cf-connecting-ip") ||
    "unknown";
  const userAgent = headerStore.get("user-agent");
  return { ip, userAgent };
}

export function userApiUnauthorizedResponse() {
  return Response.json(buildApiUnauthorizedBody("用户未登录或登录已失效。", "/login"), { status: 401 });
}

export function adminApiUnauthorizedResponse() {
  return Response.json(buildApiUnauthorizedBody("运营账号未登录或登录已失效。", "/admin-auth/login"), {
    status: 401,
  });
}

export { USER_SESSION_COOKIE, ADMIN_SESSION_COOKIE };
