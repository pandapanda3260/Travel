"use client";

import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useOptimistic, useRef, useState } from "react";

import type { SidebarUserSummary } from "./global-sidebar-config";

const GlobalSidebarAccountPopover = dynamic(() =>
  import("./global-sidebar-account-popover").then((module) => module.GlobalSidebarAccountPopover),
);

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
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [displayNickname, setDisplayNickname] = useOptimistic(
    user?.nickname ?? "",
    (_currentNickname, nextNickname: string) => nextNickname,
  );

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
    nickname: displayNickname,
  };
  const avatarText = buildAvatarText(displayUser);
  const planLabel = buildPlanLabel(displayUser);

  return (
    <div className={`sidebar-account-shell ${isPanelOpen ? "open" : ""}`} ref={panelRef}>
      <button
        type="button"
        className="sidebar-account-trigger"
        onClick={() => setIsPanelOpen((current) => !current)}
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
          onClose={() => setIsPanelOpen(false)}
          onNicknameUpdated={setDisplayNickname}
        />
      ) : null}
    </div>
  );
}
