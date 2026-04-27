export const USER_SESSION_COOKIE = "travel_user_session";
export const ADMIN_SESSION_COOKIE = "travel_admin_session";
export const DEV_CANONICAL_HOSTNAME = process.env.DEV_CANONICAL_HOSTNAME || "127.0.0.1";
export const SESSION_EXPIRE_DAYS = 7;
export const SESSION_MAX_AGE_SECONDS = SESSION_EXPIRE_DAYS * 24 * 60 * 60;

export const USER_PROTECTED_ROUTE_PREFIXES = ["/overview", "/assets", "/models", "/settings", "/studio"] as const;
export const PUBLIC_API_PREFIXES = ["/api/auth", "/api/admin-auth", "/api/health"] as const;

function startsWithAnyPrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

export function isUserProtectedPath(pathname: string) {
  return startsWithAnyPrefix(pathname, USER_PROTECTED_ROUTE_PREFIXES);
}

export function isPublicApiPath(pathname: string) {
  return pathname.startsWith("/api") && startsWithAnyPrefix(pathname, PUBLIC_API_PREFIXES);
}
