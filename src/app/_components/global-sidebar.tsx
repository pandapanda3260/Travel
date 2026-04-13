"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationGroups = [
  {
    title: "概览页",
    items: [{ label: "概览页", href: "/overview" }],
    standalone: true,
  },
  {
    title: "内容创作",
    items: [{ label: "导演模式", href: "/studio/task-creation" }],
  },
  {
    title: "模型定制",
    items: [{ label: "人物模型", href: "/models/character" }],
  },
  {
    title: "素材管理",
    items: [
      { label: "商品信息", href: "/assets/product-info" },
      { label: "音色管理", href: "/assets/voice-management" },
      { label: "视频拆解", href: "/assets/video-materials" },
    ],
  },
  {
    title: "工程设置",
    items: [{ label: "系统提示词", href: "/settings/constraint-prompts" }],
  },
];

export function GlobalSidebar() {
  const pathname = usePathname();

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
                const active = pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`global-nav-link ${active ? "active" : ""} ${group.standalone ? "standalone" : ""}`}
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
    </aside>
  );
}
