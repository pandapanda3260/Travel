import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";

import { getUserSidebarProfile } from "../lib/auth-service";
import { getOptionalUserPageSession } from "../lib/auth-session";
import { getUserPointsAccount } from "../lib/points-store";
import { BackToTopButton } from "./_components/back-to-top-button";
import { shouldRenderGlobalSidebar } from "./_components/global-sidebar-config";
import { GlobalSidebar } from "./_components/global-sidebar";
import "./globals.css";

const CURRENT_PATHNAME_HEADER = "x-travel-pathname";

export const metadata: Metadata = {
  title: "Hospitality AI Studio",
  description: "面向酒旅场景的 AI 导演模式与短视频生产 Web 应用",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headerStore = await headers();
  const pathname = headerStore.get(CURRENT_PATHNAME_HEADER) ?? "/";
  const shouldRenderSidebar = shouldRenderGlobalSidebar(pathname);
  const session = shouldRenderSidebar ? await getOptionalUserPageSession() : null;
  const sidebarProfile = session ? getUserSidebarProfile(session.userId) : null;
  const pointsAccount = session ? getUserPointsAccount(session.userId) : null;

  return (
    <html lang="zh-CN">
      <body>
        <div className="app-frame">
          <GlobalSidebar
            user={
              session
                ? {
                    userId: session.userId,
                    nickname: session.user.nickname,
                    avatar: session.user.avatar,
                    status: session.user.status,
                    planLevel: session.user.planLevel,
                    certificationLabel: session.user.certificationLabel,
                    maskedPhone: sidebarProfile?.maskedPhone ?? null,
                    activeSessionCount: sidebarProfile?.activeSessionCount ?? 0,
                    availablePoints: pointsAccount?.availablePoints ?? 0,
                  }
                : null
            }
          />
          <div className="app-frame-main">{children}</div>
        </div>
        <BackToTopButton />
      </body>
    </html>
  );
}
