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

function pickSidebarAccountDetails(user: SidebarUserSummary): SidebarAccountDetails {
  return {
    maskedPhone: user.maskedPhone,
    activeSessionCount: user.activeSessionCount,
    availablePoints: user.availablePoints,
  };
}

function buildAvatarText(user: SidebarUserSummary) {
  const nickname = user.nickname.trim();
  if (nickname) {
    return nickname.slice(0, 1).toUpperCase();
  }

  if (user.maskedPhone) {
    return user.maskedPhone.slice(-1);
  }

  return "U";
}

function buildPlanLabel(user: SidebarUserSummary) {
  if (user.planLevel) {
    return `L${user.planLevel} 会员`;
  }
  return "标准会员";
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

  if (!user) {
    return null;
  }

  const displayUser = {
    ...user,
    ...(accountDetailsResult?.userId === user.userId ? accountDetailsResult.details : pickSidebarAccountDetails(user)),
    nickname: displayNickname,
  };
  const accountDetailsLoadStatus =
    accountDetailsLoadState.userId === user.userId ? accountDetailsLoadState.status : "idle";
  const avatarText = buildAvatarText(displayUser);
  const planLabel = buildPlanLabel(displayUser);

  return (
    <div className={`sidebar-account-shell ${isPanelOpen ? "open" : ""}`} ref={panelRef}>
      <button
        type="button"
        className="sidebar-account-trigger"
        onClick={() => {
          const nextOpen = !isPanelOpen;
          setIsPanelOpen(nextOpen);
          if (nextOpen) {
            void loadAccountDetails();
          }
        }}
        aria-expanded={isPanelOpen}
      >
        <span
          className={`sidebar-account-avatar ${displayUser.avatar ? "image-fill" : ""}`}
          style={displayUser.avatar ? { backgroundImage: `url(${displayUser.avatar})` } : undefined}
          aria-hidden="true"
        >
          {displayUser.avatar ? null : avatarText}
        </span>
        <span className="sidebar-account-trigger-copy">
          <strong>{displayUser.nickname}</strong>
          <span>{planLabel}</span>
        </span>
        <span className="sidebar-account-trigger-arrow" aria-hidden="true">
          <ChevronRight size={15} />
        </span>
      </button>

      {isPanelOpen ? (
        <GlobalSidebarAccountPopover
          user={displayUser}
          avatarText={avatarText}
          planLabel={planLabel}
          accountDetailsLoadStatus={accountDetailsLoadStatus}
          onClose={() => setIsPanelOpen(false)}
          onNicknameUpdated={setDisplayNickname}
        />
      ) : null}
    </div>
  );
}
