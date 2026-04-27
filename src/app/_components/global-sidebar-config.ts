import type { AuthUserStatus } from "../../lib/auth-store";

const hiddenSidebarPrefixes = ["/admin", "/admin-auth", "/login"] as const;

export type SidebarUserSummary = {
  userId: string;
  nickname: string;
  avatar: string | null;
  status: AuthUserStatus;
  planLevel: number | null;
  certificationLabel: string | null;
  maskedPhone: string | null;
  activeSessionCount: number;
  availablePoints: number;
};

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function shouldRenderGlobalSidebar(pathname: string) {
  return !hiddenSidebarPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
