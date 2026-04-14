import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ErrorBoundary } from "./_components/error-boundary";
import { GlobalSidebar } from "./_components/global-sidebar";
import "./globals.css";

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
          <div className="app-frame-main">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </div>
      </body>
    </html>
  );
}
