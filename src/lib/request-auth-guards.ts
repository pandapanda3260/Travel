import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  DEV_CANONICAL_HOSTNAME,
  USER_SESSION_COOKIE,
  isPublicApiPath,
  isUserProtectedPath,
} from "./auth-route-config";

async function validateSessionViaApi(request: NextRequest, pathname: "/api/auth/session" | "/api/admin-auth/session") {
  try {
    const url = new URL(pathname, request.url);
    url.searchParams.set("mode", "probe");

    const response = await fetch(url, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as { authenticated?: boolean } | null;
    return typeof payload?.authenticated === "boolean" ? payload.authenticated : null;
  } catch {
    return null;
  }
}

function shouldProbePageSessionInMiddleware(request: NextRequest) {
  return process.env.NODE_ENV === "production" && request.method === "GET";
}

function clearSessionCookie(response: NextResponse, cookieName: string) {
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function isPublicAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

export function getCanonicalDevPageUrl(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    return null;
  }

  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return null;
  }

  if (request.nextUrl.hostname !== "localhost") {
    return null;
  }

  const canonicalUrl = request.nextUrl.clone();
  canonicalUrl.hostname = DEV_CANONICAL_HOSTNAME;
  return canonicalUrl;
}

export async function applyRequestAuthGuards(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const canonicalDevPageUrl = getCanonicalDevPageUrl(request);

  if (canonicalDevPageUrl) {
    return NextResponse.redirect(canonicalDevPageUrl);
  }

  if (isPublicAssetPath(pathname)) {
    return null;
  }

  if (isPublicApiPath(pathname)) {
    return null;
  }

  if (pathname.startsWith("/admin-auth")) {
    return null;
  }

  if (pathname.startsWith("/admin")) {
    const adminToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "";
    if (!adminToken) {
      const loginUrl = new URL("/admin-auth/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    if (shouldProbePageSessionInMiddleware(request)) {
      const isAuthenticated = await validateSessionViaApi(request, "/api/admin-auth/session");
      if (isAuthenticated === false) {
        const loginUrl = new URL("/admin-auth/login", request.url);
        const response = NextResponse.redirect(loginUrl);
        clearSessionCookie(response, ADMIN_SESSION_COOKIE);
        return response;
      }
    }

    return null;
  }

  if (pathname.startsWith("/api/admin")) {
    const adminToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "";
    if (!adminToken) {
      return NextResponse.json(
        { error: "运营账号未登录。", code: "UNAUTHORIZED", redirectTo: "/admin-auth/login" },
        { status: 401 },
      );
    }
    return null;
  }

  if (pathname.startsWith("/api")) {
    const userToken = request.cookies.get(USER_SESSION_COOKIE)?.value ?? "";
    if (!userToken) {
      return NextResponse.json({ error: "用户未登录。", code: "UNAUTHORIZED", redirectTo: "/login" }, { status: 401 });
    }
    return null;
  }

  if (isUserProtectedPath(pathname)) {
    const userToken = request.cookies.get(USER_SESSION_COOKIE)?.value ?? "";
    if (!userToken) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    if (shouldProbePageSessionInMiddleware(request)) {
      const isAuthenticated = await validateSessionViaApi(request, "/api/auth/session");
      if (isAuthenticated === false) {
        const loginUrl = new URL("/login", request.url);
        const response = NextResponse.redirect(loginUrl);
        clearSessionCookie(response, USER_SESSION_COOKIE);
        return response;
      }
    }
  }

  return null;
}
