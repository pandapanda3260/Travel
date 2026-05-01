import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BackToTopButton } from "./_components/back-to-top-button";
import { GlobalSidebar } from "./_components/global-sidebar";
import { NavigationPerfMonitor } from "./_components/navigation-perf-monitor";
import "./globals.css";

const enableNavigationPerfMonitor =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_NAV_PERF_MONITOR === "1";

export const metadata: Metadata = {
  title: "Hospitality AI Studio",
  description: "面向酒旅场景的 AI 导演模式与短视频生产 Web 应用",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-frame">
          <GlobalSidebar />
          <div className="app-frame-main">{children}</div>
        </div>
        <BackToTopButton />
        {enableNavigationPerfMonitor ? <NavigationPerfMonitor /> : null}
      </body>
    </html>
  );
}
