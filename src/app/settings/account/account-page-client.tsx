"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { formatDateTime, formatLoginType, formatUserSecurityAction, formatUserStatus } from "../../../lib/auth-display";
import type { UserAccountOverview } from "../../../lib/auth-service";

type AccountResponse = {
  overview: UserAccountOverview;
};

type AccountRequestError = Error & {
  code?: string;
  data?: Record<string, unknown>;
};

type PendingKey =
  | ""
  | "profile"
  | "password"
  | "bind-code"
  | "bind-phone"
  | "old-code"
  | "new-code"
  | "change-phone"
  | "logout-all"
  | `session:${string}`;

type CountdownState = {
  bind: number;
  old: number;
  new: number;
};

type DebugHint = {
  label: string;
  code: string;
} | null;

const initialCountdownState: CountdownState = {
  bind: 0,
  old: 0,
  new: 0,
};

export function AccountPageClient() {
  const router = useRouter();
  const [overview, setOverview] = useState<UserAccountOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<PendingKey>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [debugHint, setDebugHint] = useState<DebugHint>(null);
  const [countdown, setCountdown] = useState<CountdownState>(initialCountdownState);
  const [profileForm, setProfileForm] = useState({ nickname: "" });
  const [passwordForm, setPasswordForm] = useState({ password: "" });
  const [bindPhoneForm, setBindPhoneForm] = useState({ phone: "", code: "" });
  const [phoneChangeForm, setPhoneChangeForm] = useState({ oldCode: "", newPhone: "", newCode: "" });

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        router.refresh();
        return;
      }

      const data = (await response.json()) as AccountResponse;
      setOverview(data.overview);
      setProfileForm({ nickname: data.overview.user.nickname });
      setBindPhoneForm((current) => ({
        phone: current.phone || data.overview.user.phone || "",
        code: "",
      }));
      setError("");
    } catch {
      setError("账号信息加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (Object.values(countdown).every((value) => value <= 0)) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => ({
        bind: Math.max(current.bind - 1, 0),
        old: Math.max(current.old - 1, 0),
        new: Math.max(current.new - 1, 0),
      }));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown]);

  async function postJson(url: string, payload: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      data?: Record<string, unknown>;
      debugCode?: string | null;
      expireSeconds?: number;
      overview?: UserAccountOverview;
    };
    if (response.status === 401) {
      router.push("/login");
      router.refresh();
      throw new Error("登录已失效，请重新登录。");
    }
    if (!response.ok) {
      const requestError = new Error(data.error || "请求失败") as AccountRequestError;
      requestError.code = data.code;
      requestError.data = data.data;
      throw requestError;
    }
    return data;
  }

  function resetFeedback() {
    setError("");
    setSuccess("");
    setDebugHint(null);
  }

  function applyOverview(nextOverview?: UserAccountOverview) {
    if (!nextOverview) {
      return;
    }

    setOverview(nextOverview);
    setProfileForm({ nickname: nextOverview.user.nickname });
    setBindPhoneForm({
      phone: nextOverview.user.phone || "",
      code: "",
    });
    setPhoneChangeForm({ oldCode: "", newPhone: "", newCode: "" });
  }

  async function handleProfileSave() {
    setPendingKey("profile");
    resetFeedback();
    try {
      const data = await postJson("/api/account/profile", {
        nickname: profileForm.nickname,
      });
      applyOverview(data.overview);
      setSuccess("昵称已更新。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "资料更新失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handlePasswordSave() {
    setPendingKey("password");
    resetFeedback();
    try {
      const data = await postJson("/api/account/bind/account", {
        password: passwordForm.password,
      });
      applyOverview(data.overview);
      setPasswordForm({ password: "" });
      setSuccess("登录密码已更新，其他设备已下线。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "密码更新失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handleSendBindCode() {
    setPendingKey("bind-code");
    resetFeedback();
    try {
      const data = await postJson("/api/account/phone/send-code", {
        stage: "bind",
        phone: bindPhoneForm.phone.trim(),
      });
      setCountdown((current) => ({ ...current, bind: 60 }));
      setDebugHint(data.debugCode ? { label: "补充手机号验证码", code: data.debugCode } : null);
      setSuccess("验证码已发送。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "验证码发送失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handleBindPhone() {
    setPendingKey("bind-phone");
    resetFeedback();
    try {
      const data = await postJson("/api/account/bind/phone", {
        phone: bindPhoneForm.phone.trim(),
        code: bindPhoneForm.code.trim(),
      });
      applyOverview(data.overview);
      setCountdown(initialCountdownState);
      setSuccess("手机号已保存，其他设备已下线。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "手机号保存失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handleSendPhoneChangeCode(stage: "old" | "new") {
    setPendingKey(stage === "old" ? "old-code" : "new-code");
    resetFeedback();
    try {
      const data = await postJson("/api/account/phone/send-code", {
        stage,
        phone: stage === "new" ? phoneChangeForm.newPhone.trim() : undefined,
      });
      setCountdown((current) => ({
        ...current,
        old: stage === "old" ? 60 : current.old,
        new: stage === "new" ? 60 : current.new,
      }));
      setDebugHint(
        data.debugCode ? { label: stage === "old" ? "旧手机号验证码" : "新手机号验证码", code: data.debugCode } : null,
      );
      setSuccess(stage === "old" ? "旧手机号验证码已发送。" : "新手机号验证码已发送。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "验证码发送失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handlePhoneChange() {
    setPendingKey("change-phone");
    resetFeedback();
    try {
      const data = await postJson("/api/account/phone/change", {
        oldCode: phoneChangeForm.oldCode.trim(),
        newPhone: phoneChangeForm.newPhone.trim(),
        newCode: phoneChangeForm.newCode.trim(),
      });
      applyOverview(data.overview);
      setCountdown(initialCountdownState);
      setSuccess("手机号已换绑，其他设备已下线。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "手机号换绑失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handleLogoutAllSessions() {
    setPendingKey("logout-all");
    resetFeedback();
    try {
      const data = await postJson("/api/account/logout-all", {});
      applyOverview(data.overview);
      setSuccess("已将其他设备全部下线。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "操作失败");
    } finally {
      setPendingKey("");
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setPendingKey(`session:${sessionId}`);
    resetFeedback();
    try {
      const data = await postJson("/api/account/sessions/revoke", {
        sessionId,
      });
      applyOverview(data.overview);
      setSuccess("该设备已下线。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "设备下线失败");
    } finally {
      setPendingKey("");
    }
  }

  if (loading || !overview) {
    return (
      <main className="shell">
        <section className="content">
          <section className="panel auth-dashboard-panel">
            <div className="auth-empty-state">账号信息加载中...</div>
          </section>
        </section>
      </main>
    );
  }

  const loginMethodText =
    overview.user.loginMethods.length > 0
      ? overview.user.loginMethods.map(formatLoginType).join(" / ")
      : "暂无可用方式";

  return (
    <main className="shell">
      <section className="content auth-dashboard-page settings-console-page account-console-page">
        <section className="header-panel settings-console-header account-console-header">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Account Management" />
            </div>
          </header>

          <section className="account-summary-strip account-summary-strip-refined">
            <span className="account-summary-avatar" aria-hidden="true">
              {(overview.user.nickname || "U").slice(0, 1).toUpperCase()}
            </span>
            <div className="account-summary-main">
              <strong>{overview.user.nickname}</strong>
              <span>
                {overview.user.maskedPhone ?? "待补手机号"} · {overview.user.certificationLabel ?? "未认证"}
              </span>
            </div>
            <div className="account-summary-chips">
              <span className="account-summary-chip">{formatUserStatus(overview.user.status)}</span>
              <span className="account-summary-chip">{loginMethodText}</span>
              <span className="account-summary-chip">{overview.sessions.length} 台设备</span>
              <span className="account-summary-chip">L{overview.user.planLevel ?? 1}</span>
            </div>
          </section>
        </section>

        {error ? <div className="auth-banner error">{error}</div> : null}
        {success ? <div className="auth-banner success">{success}</div> : null}
        {debugHint ? (
          <div className="auth-banner info">
            {debugHint.label}
            <span className="auth-inline-code">{debugHint.code}</span>
          </div>
        ) : null}

        <section className="auth-stat-grid settings-metric-grid account-metric-grid">
          <article className="auth-stat-card panel">
            <span>手机号</span>
            <strong>{overview.user.maskedPhone ?? "待补"}</strong>
            <p>{overview.user.phone ? "已绑定" : "未绑定"}</p>
          </article>
          <article className="auth-stat-card panel">
            <span>登录方式</span>
            <strong>{overview.user.loginMethods.length}</strong>
            <p>{loginMethodText}</p>
          </article>
          <article className="auth-stat-card panel">
            <span>密码状态</span>
            <strong>{overview.user.hasPassword ? "已设置" : "未设置"}</strong>
            <p>
              {overview.user.passwordUpdatedAt
                ? `更新于 ${formatDateTime(overview.user.passwordUpdatedAt)}`
                : "设置后即可使用密码登录"}
            </p>
          </article>
          <article className="auth-stat-card panel">
            <span>在线设备</span>
            <strong>{overview.sessions.length}</strong>
            <p>最近登录：{formatDateTime(overview.user.lastLoginAt)}</p>
          </article>
        </section>

        <section className="auth-dashboard-grid account-action-grid">
          <article className="panel auth-dashboard-card">
            <div className="panel-header compact">
              <h3>基础资料</h3>
            </div>
            <div className="auth-form-stack">
              <label className="setting-field wide">
                <span>用户昵称</span>
                <input
                  className="setting-input"
                  value={profileForm.nickname}
                  onChange={(event) => setProfileForm({ nickname: event.target.value })}
                  placeholder="请输入昵称"
                  disabled={pendingKey !== ""}
                />
              </label>
              <div className="auth-list">
                <div className="auth-list-item">
                  <strong>账号状态</strong>
                  <span>{formatUserStatus(overview.user.status)}</span>
                </div>
                <div className="auth-list-item">
                  <strong>注册时间</strong>
                  <span>{formatDateTime(overview.user.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                className="auth-submit-button"
                onClick={handleProfileSave}
                disabled={pendingKey !== ""}
              >
                {pendingKey === "profile" ? "保存中..." : "保存资料"}
              </button>
            </div>
          </article>

          <article className="panel auth-dashboard-card">
            <div className="panel-header compact">
              <h3>{overview.user.phone ? "手机号换绑" : "补充手机号"}</h3>
            </div>

            {overview.user.phone ? (
              <div className="auth-form-stack">
                <div className="auth-list">
                  <div className="auth-list-item">
                    <strong>当前手机号</strong>
                    <span>{overview.user.maskedPhone}</span>
                  </div>
                </div>
                <div className="auth-inline-field">
                  <label className="setting-field wide">
                    <span>旧号验证码</span>
                    <input
                      className="setting-input"
                      value={phoneChangeForm.oldCode}
                      onChange={(event) =>
                        setPhoneChangeForm((current) => ({ ...current, oldCode: event.target.value }))
                      }
                      placeholder="输入旧号验证码"
                      disabled={pendingKey !== ""}
                    />
                  </label>
                  <button
                    type="button"
                    className="auth-ghost-button"
                    onClick={() => handleSendPhoneChangeCode("old")}
                    disabled={pendingKey !== "" || countdown.old > 0}
                  >
                    {pendingKey === "old-code" ? "发送中..." : countdown.old > 0 ? `${countdown.old}s` : "发送旧号码"}
                  </button>
                </div>
                <label className="setting-field wide">
                  <span>新手机号</span>
                  <input
                    className="setting-input"
                    value={phoneChangeForm.newPhone}
                    onChange={(event) =>
                      setPhoneChangeForm((current) => ({ ...current, newPhone: event.target.value }))
                    }
                    placeholder="输入新手机号"
                    disabled={pendingKey !== ""}
                  />
                </label>
                <div className="auth-inline-field">
                  <label className="setting-field wide">
                    <span>新号验证码</span>
                    <input
                      className="setting-input"
                      value={phoneChangeForm.newCode}
                      onChange={(event) =>
                        setPhoneChangeForm((current) => ({ ...current, newCode: event.target.value }))
                      }
                      placeholder="输入新号验证码"
                      disabled={pendingKey !== ""}
                    />
                  </label>
                  <button
                    type="button"
                    className="auth-ghost-button"
                    onClick={() => handleSendPhoneChangeCode("new")}
                    disabled={pendingKey !== "" || countdown.new > 0}
                  >
                    {pendingKey === "new-code" ? "发送中..." : countdown.new > 0 ? `${countdown.new}s` : "发送新号码"}
                  </button>
                </div>
                <button
                  type="button"
                  className="auth-submit-button"
                  onClick={handlePhoneChange}
                  disabled={pendingKey !== ""}
                >
                  {pendingKey === "change-phone" ? "保存中..." : "确认换绑"}
                </button>
              </div>
            ) : (
              <div className="auth-form-stack">
                <label className="setting-field wide">
                  <span>手机号</span>
                  <input
                    className="setting-input"
                    value={bindPhoneForm.phone}
                    onChange={(event) => setBindPhoneForm((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="请输入手机号"
                    disabled={pendingKey !== ""}
                  />
                </label>
                <div className="auth-inline-field">
                  <label className="setting-field wide">
                    <span>验证码</span>
                    <input
                      className="setting-input"
                      value={bindPhoneForm.code}
                      onChange={(event) => setBindPhoneForm((current) => ({ ...current, code: event.target.value }))}
                      placeholder="输入 6 位验证码"
                      disabled={pendingKey !== ""}
                    />
                  </label>
                  <button
                    type="button"
                    className="auth-ghost-button"
                    onClick={handleSendBindCode}
                    disabled={pendingKey !== "" || countdown.bind > 0}
                  >
                    {pendingKey === "bind-code"
                      ? "发送中..."
                      : countdown.bind > 0
                        ? `${countdown.bind}s`
                        : "发送验证码"}
                  </button>
                </div>
                <button
                  type="button"
                  className="auth-submit-button"
                  onClick={handleBindPhone}
                  disabled={pendingKey !== ""}
                >
                  {pendingKey === "bind-phone" ? "保存中..." : "保存手机号"}
                </button>
              </div>
            )}
          </article>

          <article className="panel auth-dashboard-card">
            <div className="panel-header compact">
              <h3>{overview.user.hasPassword ? "登录密码" : "设置密码"}</h3>
            </div>
            <div className="auth-list">
              <div className="auth-list-item">
                <strong>{overview.user.hasPassword ? "已开启手机号密码登录" : "当前仅支持短信验证码登录"}</strong>
                <span>
                  {overview.user.passwordUpdatedAt
                    ? `上次更新：${formatDateTime(overview.user.passwordUpdatedAt)}`
                    : "设置后即可使用手机号密码登录"}
                </span>
              </div>
            </div>
            <div className="auth-form-stack">
              <label className="setting-field wide">
                <span>新密码</span>
                <input
                  className="setting-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.password}
                  onChange={(event) => setPasswordForm({ password: event.target.value })}
                  placeholder="密码至少 8 位，且需同时包含字母和数字。"
                  disabled={pendingKey !== ""}
                />
              </label>
              <button
                type="button"
                className="auth-submit-button"
                onClick={handlePasswordSave}
                disabled={pendingKey !== ""}
              >
                {pendingKey === "password" ? "保存中..." : overview.user.hasPassword ? "更新密码" : "设置密码"}
              </button>
            </div>
          </article>
        </section>

        <section className="auth-dashboard-grid auth-dashboard-grid-secondary account-activity-grid">
          <article className="panel auth-dashboard-card">
            <div className="panel-header compact">
              <h3>设备与登录态</h3>
              <button
                type="button"
                className="toolbar-button"
                onClick={handleLogoutAllSessions}
                disabled={pendingKey !== ""}
              >
                {pendingKey === "logout-all" ? "处理中..." : "其他设备下线"}
              </button>
            </div>
            <div className="auth-list">
              {overview.sessions.map((item) => (
                <div key={item.sessionId} className="auth-list-item auth-list-item-detail">
                  <div>
                    <strong>{formatLoginType(item.loginType)}</strong>
                    <span>{item.current ? "当前设备" : `登录 IP：${item.ip}`}</span>
                  </div>
                  <div>
                    <span>登录时间：{formatDateTime(item.createdAt)}</span>
                    <span>过期时间：{formatDateTime(item.expiresAt)}</span>
                  </div>
                  {!item.current ? (
                    <div className="auth-list-item-actions">
                      <button
                        type="button"
                        className="toolbar-button"
                        onClick={() => handleRevokeSession(item.sessionId)}
                        disabled={pendingKey !== ""}
                      >
                        {pendingKey === `session:${item.sessionId}` ? "处理中..." : "下线设备"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {overview.sessions.length === 0 ? <div className="auth-empty-state">暂无在线会话</div> : null}
            </div>
          </article>

          <article className="panel auth-dashboard-card">
            <div className="panel-header compact">
              <h3>安全动作</h3>
            </div>
            <div className="auth-list">
              {overview.securityLogs.map((item) => (
                <div key={item.logId} className="auth-list-item auth-list-item-detail">
                  <div>
                    <strong>{formatUserSecurityAction(item.actionType)}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <div>
                    <span>{item.ip}</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                </div>
              ))}
              {overview.securityLogs.length === 0 ? <div className="auth-empty-state">暂无安全记录</div> : null}
            </div>
          </article>
        </section>

        <section className="panel auth-dashboard-card">
          <div className="panel-header compact">
            <h3>访问记录</h3>
          </div>
          <div className="auth-list">
            {overview.recentLogins.map((item) => (
              <div key={item.logId} className="auth-list-item auth-list-item-detail">
                <div>
                  <strong>{formatLoginType(item.loginType)}</strong>
                  <span>{item.success ? "成功" : "失败"}</span>
                </div>
                <div>
                  <span>{item.detail}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            {overview.recentLogins.length === 0 ? <div className="auth-empty-state">暂无登录记录</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
