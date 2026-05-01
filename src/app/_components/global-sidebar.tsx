"use client";

import { useEffect, useRef, useState } from "react";
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
      { label: "用量账单", href: "/settings/usage" },
      { label: "账号管理", href: "/settings/account" },
    ],
    standalone: false,
  },
];

type SidebarUserPayload = {
  user?: SidebarUserSummary;
  error?: string;
};

const taskCreationSoftNavigationHrefs = new Set([
  "/studio/task-creation/real-photo-video",
  "/studio/task-creation/ai-image-video",
]);

function shouldUseTaskCreationSoftNavigation(fromPathname: string, toHref: string) {
  return taskCreationSoftNavigationHrefs.has(fromPathname) && taskCreationSoftNavigationHrefs.has(toHref);
}

export function GlobalSidebar({ user: initialUser = null }: { user?: SidebarUserSummary | null }) {
  const pathname = usePathname() ?? "/";
  const shouldShowSidebar = shouldRenderGlobalSidebar(pathname);
  const sessionFetchStartedRef = useRef(false);
  const [resolvedUser, setResolvedUser] = useState<SidebarUserSummary | null>(initialUser);
  const [pendingNav, setPendingNav] = useState<{ href: string; fromPathname: string } | null>(null);
  const activeHref =
    navigationGroups
      .flatMap((group) => group.items)
      .filter((item) => isActivePath(pathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? "";

  useEffect(() => {
    if (!shouldShowSidebar || resolvedUser || sessionFetchStartedRef.current) {
      return;
    }

    let isActive = true;
    sessionFetchStartedRef.current = true;
    fetch("/api/account/sidebar?details=0", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as SidebarUserPayload;
        if (!response.ok) {
          throw new Error(data.error ?? "账号摘要同步失败");
        }
        if (isActive && data.user) {
          setResolvedUser(data.user);
        }
      })
      .catch(() => {
        sessionFetchStartedRef.current = false;
      });

    return () => {
      isActive = false;
    };
  }, [resolvedUser, shouldShowSidebar]);

  if (!shouldShowSidebar) {
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
                    onClick={(event) => {
                      if (shouldUseTaskCreationSoftNavigation(pathname, item.href)) {
                        event.preventDefault();
                        window.history.pushState({ travelSoftNavigation: true }, "", item.href);
                        window.dispatchEvent(
                          new CustomEvent("travel:task-creation-mode-change", { detail: { href: item.href } }),
                        );
                        window.scrollTo({ top: 0, behavior: "instant" });
                        return;
                      }

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

      <GlobalSidebarAccountMenu user={resolvedUser} />
    </aside>
  );
}
