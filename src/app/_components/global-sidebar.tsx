"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { GlobalSidebarAccountMenu } from "./global-sidebar-account-menu";
import { isActivePath, shouldRenderGlobalSidebar, type SidebarUserSummary } from "./global-sidebar-config";

type NavigationItem = {
  label: string;
  href: string;
  child?: boolean;
};

type NavigationGroup = {
  title: string;
  items: NavigationItem[];
  standalone: boolean;
};

const navigationGroups: NavigationGroup[] = [
  {
    title: "概览页",
    items: [{ label: "概览页", href: "/overview" }],
    standalone: true,
  },
  {
    title: "内容创作",
    items: [
      { label: "实拍素材成片", href: "/studio/task-creation/real-photo-video" },
      { label: "AI 素材成片", href: "/studio/task-creation/ai-image-video" },
      { label: "快速生成", href: "/studio/video-generation" },
    ],
    standalone: false,
  },
  {
    title: "模型定制",
    items: [{ label: "人物模型", href: "/models/character" }],
    standalone: false,
  },
  {
    title: "素材管理",
    items: [
      { label: "商品信息", href: "/assets/product-info" },
      { label: "音色管理", href: "/assets/voice-management" },
      { label: "视频拆解", href: "/assets/video-materials" },
    ],
    standalone: false,
  },
  {
    title: "系统设置",
    items: [
      { label: "参数设置", href: "/settings/parameter-settings" },
      { label: "会员中心", href: "/settings/membership" },
      { label: "账号管理", href: "/settings/account" },
    ],
    standalone: false,
  },
];

export function GlobalSidebar({ user }: { user: SidebarUserSummary | null }) {
  const pathname = usePathname() ?? "/";
  const [pendingNav, setPendingNav] = useState<{ href: string; fromPathname: string } | null>(null);
  const activeHref =
    navigationGroups
      .flatMap((group) => group.items)
      .filter((item) => isActivePath(pathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? "";

  if (!shouldRenderGlobalSidebar(pathname)) {
    return null;
  }

  return (
    <aside className="global-sidebar">
      <div className="global-sidebar-brand">
        <div className="global-sidebar-logo">AI</div>
        <div className="global-sidebar-brand-copy">
          <strong>任务工作台</strong>
          <span>Hospitality AI Studio</span>
        </div>
      </div>

      <nav className="global-sidebar-nav" aria-label="全局导航">
        {navigationGroups.map((group) => (
          <div key={group.title} className="global-nav-section">
            {group.standalone ? null : <p className="global-nav-title">{group.title}</p>}
            <div className="global-nav-items">
              {group.items.map((item) => {
                const active = activeHref === item.href;
                const pending = pendingNav?.href === item.href && pendingNav.fromPathname === pathname && !active;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    onClick={() => {
                      if (!active) {
                        setPendingNav({ href: item.href, fromPathname: pathname });
                      }
                    }}
                    aria-busy={pending}
                    className={`global-nav-link ${active ? "active" : ""} ${pending ? "pending" : ""} ${group.standalone ? "standalone" : ""}`}
                  >
                    <span className="global-nav-dot" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <GlobalSidebarAccountMenu user={user} />
    </aside>
  );
}
