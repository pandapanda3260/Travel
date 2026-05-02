"use client";

import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useOptimistic, useRef, useState } from "react";

import type { SidebarUserSummary } from "./global-sidebar-config";

const GlobalSidebarAccountPopover = dynamic(() =>
  import("./global-sidebar-account-popover").then((module) => module.GlobalSidebarAccountPopover),
);

type SidebarAccountDetails = Pick<SidebarUserSummary, "maskedPhone" | "activeSessionCount" | "availablePoints">;

type SidebarAccountDetailsPayload = {
  user?: Partial<SidebarAccountDetails>;
  error?: string;
};

type SidebarAccountDetailsResult = {
  userId: string;
  details: SidebarAccountDetails;
};

type SidebarAccountDetailsLoadState = {
  userId: string | null;
  status: "idle" | "loading" | "success" | "error";
};

export type SidebarAccountMenuState = {
  shouldRender: true;
  isAuthenticated: boolean;
  nickname: string;
  planLabel: string;
  avatarText: string;
  primaryActionLabel: "退出登录" | "登录";
};

function pickSidebarAccountDetails(user: SidebarUserSummary): SidebarAccountDetails {
  return {
    maskedPhone: user.maskedPhone,
    activeSessionCount: user.activeSessionCount,
    availablePoints: user.availablePoints,
  };
}

function buildAvatarText(user: SidebarUserSummary | null, nicknameOverride?: string) {
  if (!user) {
    return "";
  }

  const nickname = (nicknameOverride ?? user.nickname).trim();
  if (nickname) {
    return nickname.slice(0, 1).toUpperCase();
  }

  if (user.maskedPhone) {
    return user.maskedPhone.slice(-1);
  }

  return "U";
}

function buildPlanLabel(user: SidebarUserSummary | null) {
  if (!user) {
    return "";
  }

  if (user.planLevel) {
    return `L${user.planLevel} 会员`;
  }
  return "标准会员";
}

export function buildSidebarAccountMenuState(
  user: SidebarUserSummary | null,
  nicknameOverride?: string,
): SidebarAccountMenuState {
  return {
    shouldRender: true,
    isAuthenticated: Boolean(user),
    nickname: user ? (nicknameOverride ?? user.nickname) : "",
    planLabel: buildPlanLabel(user),
    avatarText: buildAvatarText(user, nicknameOverride),
    primaryActionLabel: user ? "退出登录" : "登录",
  };
}

export function GlobalSidebarAccountMenu({ user }: { user: SidebarUserSummary | null }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeUserIdRef = useRef<string | null>(user?.userId ?? null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [accountDetailsResult, setAccountDetailsResult] = useState<SidebarAccountDetailsResult | null>(null);
  const [accountDetailsLoadState, setAccountDetailsLoadState] = useState<SidebarAccountDetailsLoadState>({
    userId: null,
    status: "idle",
  });
  const [displayNickname, setDisplayNickname] = useOptimistic(
    user?.nickname ?? "",
    (_currentNickname, nextNickname: string) => nextNickname,
  );

  activeUserIdRef.current = user?.userId ?? null;

  const loadAccountDetails = useCallback(async () => {
    if (!user) {
      return;
    }
    if (
      accountDetailsLoadState.userId === user.userId &&
      (accountDetailsLoadState.status === "loading" || accountDetailsLoadState.status === "success")
    ) {
      return;
    }

    const requestUserId = user.userId;
    setAccountDetailsLoadState({ userId: requestUserId, status: "loading" });

    try {
      const response = await fetch("/api/account/sidebar?details=1", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as SidebarAccountDetailsPayload;
      if (!response.ok) {
        throw new Error(data.error ?? "账号概览同步失败");
      }
      if (activeUserIdRef.current !== requestUserId) {
        return;
      }
      setAccountDetailsResult({
        userId: requestUserId,
        details: {
          maskedPhone: data.user?.maskedPhone ?? null,
          activeSessionCount: data.user?.activeSessionCount ?? 0,
          availablePoints: data.user?.availablePoints ?? 0,
        },
      });
      setAccountDetailsLoadState({ userId: requestUserId, status: "success" });
    } catch {
      if (activeUserIdRef.current !== requestUserId) {
        return;
      }
      setAccountDetailsLoadState({ userId: requestUserId, status: "error" });
    }
  }, [accountDetailsLoadState.status, accountDetailsLoadState.userId, user]);

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

  const menuState = buildSidebarAccountMenuState(user, displayNickname);
  const displayUser = user
    ? {
        ...user,
        ...(accountDetailsResult?.userId === user.userId
          ? accountDetailsResult.details
          : pickSidebarAccountDetails(user)),
        nickname: menuState.nickname,
      }
    : null;
  const accountDetailsLoadStatus =
    user && accountDetailsLoadState.userId === user.userId ? accountDetailsLoadState.status : "idle";

  return (
    <div className={`sidebar-account-shell ${isPanelOpen ? "open" : ""}`} ref={panelRef}>
      <button
        type="button"
        className="sidebar-account-trigger"
        onClick={() => {
          const nextOpen = !isPanelOpen;
          setIsPanelOpen(nextOpen);
          if (nextOpen && user) {
            void loadAccountDetails();
          }
        }}
        aria-expanded={isPanelOpen}
        aria-label={menuState.isAuthenticated ? "打开账号菜单" : "打开登录菜单"}
      >
        <span
          className={`sidebar-account-avatar ${displayUser?.avatar ? "image-fill" : ""}`}
          style={displayUser?.avatar ? { backgroundImage: `url(${displayUser.avatar})` } : undefined}
          aria-hidden="true"
        >
          {displayUser?.avatar ? null : menuState.avatarText}
        </span>
        <span className="sidebar-account-trigger-copy">
          <strong>{menuState.nickname}</strong>
          <span>{menuState.planLabel}</span>
        </span>
        <span className="sidebar-account-trigger-arrow" aria-hidden="true">
          <ChevronRight size={15} />
        </span>
      </button>

      {isPanelOpen ? (
        <GlobalSidebarAccountPopover
          user={displayUser}
          avatarText={menuState.avatarText}
          planLabel={menuState.planLabel}
          accountDetailsLoadStatus={accountDetailsLoadStatus}
          onClose={() => setIsPanelOpen(false)}
          onNicknameUpdated={setDisplayNickname}
        />
      ) : null}
    </div>
  );
}
