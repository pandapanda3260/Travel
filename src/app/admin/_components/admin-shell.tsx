"use client";

import {
  Activity,
  BarChart3,
  Boxes,
  ChevronRight,
  Download,
  Film,
  LayoutGrid,
  LogOut,
  Search,
  ShieldCheck,
  Users,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { formatAdminRole, formatAdminStatus } from "../../../lib/auth-display";
import type { AdminRole, AdminStatus } from "../../../lib/auth-store";

type AdminShellProps = {
  children: ReactNode;
  admin: {
    adminId: string;
    username: string;
    displayName: string;
    role: AdminRole;
    status: AdminStatus;
  };
};

const adminNavGroups = [
  {
    title: "数据管理",
    items: [
      { label: "数据概览", href: "/admin/data/overview" },
      { label: "用户数据", href: "/admin/data/users" },
      { label: "任务与产能", href: "/admin/data/tasks" },
      { label: "素材与商品", href: "/admin/data/assets" },
      { label: "系统运行", href: "/admin/data/system" },
      { label: "用量与计费", href: "/admin/api-usage" },
      { label: "数据明细", href: "/admin/data/details" },
      { label: "导出中心", href: "/admin/data/exports" },
    ],
  },
  {
    title: "账号中心",
    items: [
      { label: "账号看板", href: "/admin/system-status" },
      { label: "用户管理", href: "/admin/users" },
      { label: "会员管理", href: "/admin/membership" },
      { label: "绑定与合并", href: "/admin/members" },
      { label: "运营账号管理", href: "/admin/permissions" },
    ],
  },
  {
    title: "业务配置",
    items: [{ label: "系统提示词", href: "/admin/prompts" }],
  },
];

const adminPanelLinks = [
  { label: "数据概览", href: "/admin/data/overview", icon: BarChart3 },
  { label: "任务与产能", href: "/admin/data/tasks", icon: Film },
  { label: "素材与商品", href: "/admin/data/assets", icon: Boxes },
  { label: "系统运行", href: "/admin/data/system", icon: Activity },
  { label: "用量与计费", href: "/admin/api-usage", icon: BarChart3 },
  { label: "数据明细", href: "/admin/data/details", icon: Search },
  { label: "导出中心", href: "/admin/data/exports", icon: Download },
  { label: "账号看板", href: "/admin/system-status", icon: LayoutGrid },
  { label: "用户管理", href: "/admin/users", icon: Users },
  { label: "会员管理", href: "/admin/membership", icon: Activity },
  { label: "绑定与合并", href: "/admin/members", icon: Waves },
  { label: "运营账号管理", href: "/admin/permissions", icon: ShieldCheck },
];

function buildAdminAvatarText(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "管";
}

export function AdminShell({ children, admin }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  useEffect(() => {
    setIsPanelOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsPanelOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isPanelOpen]);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await fetch("/api/admin-auth/logout", { method: "POST" });
      setIsPanelOpen(false);
      router.push("/admin-auth/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-logo">管理</div>
          <div className="admin-sidebar-brand-copy">
            <strong>管理后台</strong>
            <span>Access Console</span>
          </div>
        </div>

        <nav className="admin-sidebar-nav">
          {adminNavGroups.map((group) => (
            <div key={group.title} className="admin-nav-section">
              <p className="admin-nav-title">{group.title}</p>
              <div className="admin-nav-items">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link key={item.href} href={item.href} className={`admin-nav-link ${active ? "active" : ""}`}>
                      <span className="admin-nav-dot" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={`admin-account-shell ${isPanelOpen ? "open" : ""}`} ref={panelRef}>
          <button
            type="button"
            className="admin-account-trigger"
            onClick={() => setIsPanelOpen((current) => !current)}
            aria-expanded={isPanelOpen}
          >
            <span className="admin-account-avatar" aria-hidden="true">
              {buildAdminAvatarText(admin.displayName)}
            </span>
            <span className="admin-account-trigger-copy">
              <strong>{admin.displayName}</strong>
              <span>{formatAdminRole(admin.role)}</span>
            </span>
            <span className="admin-account-trigger-arrow" aria-hidden="true">
              <ChevronRight size={15} />
            </span>
          </button>

          {isPanelOpen ? (
            <div className="admin-account-popover">
              <div className="admin-account-popover-head">
                <span className="admin-account-avatar large" aria-hidden="true">
                  {buildAdminAvatarText(admin.displayName)}
                </span>
                <div className="admin-account-profile-copy">
                  <strong>{admin.displayName}</strong>
                  <span>{admin.username}</span>
                  <div className="admin-account-badges">
                    <span className="admin-account-badge accent">{formatAdminRole(admin.role)}</span>
                    <span className="admin-account-badge">{formatAdminStatus(admin.status)}</span>
                  </div>
                </div>
              </div>

              <div className="admin-account-shortcuts">
                {adminPanelLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="admin-account-shortcut"
                      onClick={() => setIsPanelOpen(false)}
                    >
                      <span className="admin-account-shortcut-icon">
                        <Icon size={14} />
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              <button type="button" className="admin-account-logout" onClick={handleLogout} disabled={isLoggingOut}>
                <LogOut size={14} />
                <span>{isLoggingOut ? "退出中..." : "退出登录"}</span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
