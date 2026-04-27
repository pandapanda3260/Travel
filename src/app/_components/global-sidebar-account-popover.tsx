"use client";

import { Check, LogOut, PencilLine, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatUserStatus } from "../../lib/auth-display";
import type { SidebarUserSummary } from "./global-sidebar-config";

const userPanelGroups = [
  {
    title: "账号与安全",
    items: [
      { label: "会员中心", href: "/settings/membership", icon: Sparkles },
      { label: "账号管理", href: "/settings/account", icon: ShieldCheck },
      { label: "参数设置", href: "/settings/parameter-settings", icon: Settings2 },
    ],
  },
] as const;

function buildSidebarAccountId(userId: string) {
  const digits = userId.replace(/\D/g, "");
  return digits ? digits.slice(-10) : userId.slice(-10).toUpperCase();
}

function formatPoints(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function GlobalSidebarAccountPopover({
  user,
  avatarText,
  planLabel,
  onClose,
  onNicknameUpdated,
}: {
  user: SidebarUserSummary;
  avatarText: string;
  planLabel: string;
  onClose: () => void;
  onNicknameUpdated: (nickname: string) => void;
}) {
  const router = useRouter();
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(user.nickname);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [isSavingNickname, setIsSavingNickname] = useState(false);

  useEffect(() => {
    setNicknameDraft(user.nickname);
  }, [user.nickname]);

  useEffect(() => {
    if (!isEditingNickname) {
      return;
    }

    nicknameInputRef.current?.focus();
    nicknameInputRef.current?.select();
  }, [isEditingNickname]);

  async function handleNicknameSave() {
    if (isSavingNickname) {
      return;
    }

    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) {
      setNicknameError("请输入用户昵称。");
      return;
    }

    setIsSavingNickname(true);
    setNicknameError(null);
    try {
      const response = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nextNickname }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        overview?: {
          user?: {
            nickname?: string;
          };
        };
      };

      if (!response.ok) {
        throw new Error(data.error ?? "昵称更新失败");
      }

      const savedNickname = data.overview?.user?.nickname?.trim() || nextNickname;
      onNicknameUpdated(savedNickname);
      setNicknameDraft(savedNickname);
      setIsEditingNickname(false);
      router.refresh();
    } catch (error) {
      setNicknameError(error instanceof Error ? error.message : "昵称更新失败");
    } finally {
      setIsSavingNickname(false);
    }
  }

  function handleNicknameCancel() {
    setNicknameDraft(user.nickname);
    setNicknameError(null);
    setIsEditingNickname(false);
  }

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      onClose();
      router.push("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="sidebar-account-popover">
      <div className="sidebar-account-popover-head">
        <span
          className={`sidebar-account-avatar large ${user.avatar ? "image-fill" : ""}`}
          style={user.avatar ? { backgroundImage: `url(${user.avatar})` } : undefined}
          aria-hidden="true"
        >
          {user.avatar ? null : avatarText}
        </span>
        <div className="sidebar-account-profile-copy">
          <div className="sidebar-account-profile-row">
            <div className="sidebar-account-nickname-group">
              {isEditingNickname ? (
                <>
                  <input
                    ref={nicknameInputRef}
                    type="text"
                    className="sidebar-account-nickname-input"
                    value={nicknameDraft}
                    onChange={(event) => setNicknameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleNicknameSave();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        handleNicknameCancel();
                      }
                    }}
                    maxLength={32}
                    disabled={isSavingNickname}
                    placeholder="请输入昵称"
                    aria-label="用户昵称"
                  />
                  <div className="sidebar-account-nickname-actions">
                    <button
                      type="button"
                      className="sidebar-account-nickname-icon"
                      onClick={() => void handleNicknameSave()}
                      disabled={isSavingNickname}
                      aria-label="保存昵称"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="sidebar-account-nickname-icon subtle"
                      onClick={handleNicknameCancel}
                      disabled={isSavingNickname}
                      aria-label="取消修改昵称"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>{user.nickname}</strong>
                  <button
                    type="button"
                    className="sidebar-account-nickname-icon"
                    onClick={() => {
                      setNicknameDraft(user.nickname);
                      setNicknameError(null);
                      setIsEditingNickname(true);
                    }}
                    aria-label="修改昵称"
                  >
                    <PencilLine size={13} />
                  </button>
                </>
              )}
            </div>
            <Link href="/settings/account" className="sidebar-account-profile-link" onClick={onClose}>
              账号管理
            </Link>
          </div>
          {nicknameError ? <p className="sidebar-account-profile-error">{nicknameError}</p> : null}
          <span>账号 ID · {buildSidebarAccountId(user.userId)}</span>
          <div className="sidebar-account-badges">
            <span className="sidebar-account-badge">主账号</span>
            <span className="sidebar-account-badge accent">{planLabel}</span>
            {user.certificationLabel ? (
              <span className="sidebar-account-badge success">{user.certificationLabel}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sidebar-account-metrics">
        <div className="sidebar-account-metric">
          <span>状态</span>
          <strong>{formatUserStatus(user.status)}</strong>
        </div>
        <div className="sidebar-account-metric">
          <span>会话</span>
          <strong>{user.activeSessionCount}</strong>
        </div>
        <div className="sidebar-account-metric">
          <span>手机号</span>
          <strong>{user.maskedPhone || "待修正"}</strong>
        </div>
      </div>

      <div className="sidebar-account-points-panel">
        <div className="sidebar-account-points-copy">
          <span>当前剩余积分</span>
          <strong>{formatPoints(user.availablePoints)}</strong>
        </div>
        <Link href="/settings/membership#points-records" className="sidebar-account-points-link" onClick={onClose}>
          积分账单
        </Link>
      </div>

      <div className="sidebar-account-groups">
        {userPanelGroups.map((group) => (
          <section key={group.title} className="sidebar-account-group">
            <p>{group.title}</p>
            <div className="sidebar-account-shortcuts">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="sidebar-account-shortcut" onClick={onClose}>
                    <span className="sidebar-account-shortcut-icon">
                      <Icon size={14} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <button type="button" className="sidebar-account-logout" onClick={handleLogout} disabled={isLoggingOut}>
        <LogOut size={14} />
        <span>{isLoggingOut ? "退出中..." : "退出登录"}</span>
      </button>
    </div>
  );
}
