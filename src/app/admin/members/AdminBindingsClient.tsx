"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatDateTime, formatLoginType, formatUserStatus } from "../../../lib/auth-display";
import type { BindingManagementSnapshot } from "../../../lib/auth-service";

type BindingsActionResponse = {
  error?: string;
  snapshot?: BindingManagementSnapshot;
};

function getBindingStatusTone(status: BindingManagementSnapshot["users"][number]["status"]) {
  if (status === "normal") {
    return "success";
  }
  if (status === "banned") {
    return "danger";
  }
  return "warning";
}

export function AdminBindingsClient() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [snapshot, setSnapshot] = useState<BindingManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [repairPhoneForm, setRepairPhoneForm] = useState({ userId: "", phone: "" });
  const [resetPasswordForm, setResetPasswordForm] = useState({ userId: "", password: "" });
  const [mergeForm, setMergeForm] = useState({ sourceUserId: "", targetUserId: "" });

  const hitUserCount = snapshot?.users.length ?? 0;
  const missingPhoneUserCount = snapshot?.users.filter((user) => !user.phone).length ?? 0;
  const missingPasswordUserCount = snapshot?.users.filter((user) => !user.hasPassword).length ?? 0;
  const readyUserCount = snapshot?.users.filter((user) => user.phone && user.hasPassword).length ?? 0;

  const loadSnapshot = useCallback(
    async (nextKeyword = "") => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/bindings?keyword=${encodeURIComponent(nextKeyword)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as BindingManagementSnapshot & { error?: string };
        if (response.status === 401) {
          router.push("/admin-auth/login");
          router.refresh();
          return;
        }
        if (!response.ok) {
          throw new Error(data.error || "账号数据加载失败");
        }
        setSnapshot(data);
      } catch (currentError) {
        setError(currentError instanceof Error ? currentError.message : "账号数据加载失败");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  async function runAction(payload: Record<string, unknown>, successMessage: string) {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/bindings/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          keyword,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as BindingsActionResponse;
      if (response.status === 401) {
        router.push("/admin-auth/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "操作失败");
      }
      if (data.snapshot) {
        setSnapshot(data.snapshot);
      } else {
        await loadSnapshot(keyword);
      }
      setSuccess(successMessage);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">Bindings & Merge</p>
        <div className="admin-page-header-row">
          <div>
            <h1>绑定与合并</h1>
            <p className="admin-page-desc">用于修正主体资料、重置密码和处理历史账号合并。</p>
          </div>
          <span className="admin-page-pill">命中 {loading ? "--" : hitUserCount}</span>
        </div>
      </header>

      {error ? <div className="auth-banner error">{error}</div> : null}
      {success ? <div className="auth-banner success">{success}</div> : null}

      <section className="admin-summary-grid">
        <article className="admin-summary-card primary">
          <span>命中账号</span>
          <strong>{loading ? "--" : hitUserCount}</strong>
        </article>
        <article className="admin-summary-card warning">
          <span>待补手机号</span>
          <strong>{loading ? "--" : missingPhoneUserCount}</strong>
        </article>
        <article className="admin-summary-card info">
          <span>待设密码</span>
          <strong>{loading ? "--" : missingPasswordUserCount}</strong>
        </article>
        <article className="admin-summary-card success">
          <span>资料完整</span>
          <strong>{loading ? "--" : readyUserCount}</strong>
        </article>
      </section>

      <section className="panel admin-tool-card admin-toolbar-card">
        <div className="admin-search-row">
          <label className="setting-field wide">
            <span>搜索</span>
            <input
              className="setting-input"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入 user_id / 昵称 / 手机号"
            />
          </label>
          <button type="button" className="auth-submit-button" onClick={() => loadSnapshot(keyword)}>
            查询
          </button>
        </div>
      </section>

      <section className="admin-auth-grid admin-auth-grid-three admin-binding-actions-grid">
        <article className="panel admin-tool-card admin-binding-action-card">
          <div className="panel-header compact">
            <div>
              <h3>修正手机号</h3>
            </div>
          </div>
          <div className="auth-form-stack">
            <label className="setting-field wide">
              <span>用户 ID</span>
              <input
                className="setting-input"
                value={repairPhoneForm.userId}
                onChange={(event) => setRepairPhoneForm((current) => ({ ...current, userId: event.target.value }))}
              />
            </label>
            <label className="setting-field wide">
              <span>手机号</span>
              <input
                className="setting-input"
                value={repairPhoneForm.phone}
                onChange={(event) => setRepairPhoneForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <div className="admin-binding-action-spacer" aria-hidden="true" />
            <button
              type="button"
              className="auth-submit-button"
              onClick={() => runAction({ action: "repair_phone", ...repairPhoneForm }, "手机号已修正。")}
              disabled={pending}
            >
              保存手机号
            </button>
          </div>
        </article>

        <article className="panel admin-tool-card admin-binding-action-card">
          <div className="panel-header compact">
            <div>
              <h3>重置密码</h3>
            </div>
          </div>
          <div className="auth-form-stack">
            <label className="setting-field wide">
              <span>用户 ID</span>
              <input
                className="setting-input"
                value={resetPasswordForm.userId}
                onChange={(event) => setResetPasswordForm((current) => ({ ...current, userId: event.target.value }))}
              />
            </label>
            <label className="setting-field wide">
              <span>新密码</span>
              <input
                className="setting-input"
                type="password"
                value={resetPasswordForm.password}
                onChange={(event) => setResetPasswordForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <div className="admin-binding-action-spacer" aria-hidden="true" />
            <button
              type="button"
              className="auth-submit-button"
              onClick={() => runAction({ action: "reset_password", ...resetPasswordForm }, "登录密码已重置。")}
              disabled={pending}
            >
              保存密码
            </button>
          </div>
        </article>

        <article className="panel admin-tool-card admin-binding-action-card">
          <div className="panel-header compact">
            <div>
              <h3>合并账号</h3>
            </div>
          </div>
          <div className="auth-form-stack">
            <label className="setting-field wide">
              <span>源账号</span>
              <input
                className="setting-input"
                value={mergeForm.sourceUserId}
                onChange={(event) => setMergeForm((current) => ({ ...current, sourceUserId: event.target.value }))}
              />
            </label>
            <label className="setting-field wide">
              <span>目标账号</span>
              <input
                className="setting-input"
                value={mergeForm.targetUserId}
                onChange={(event) => setMergeForm((current) => ({ ...current, targetUserId: event.target.value }))}
              />
            </label>
            <div className="admin-binding-action-spacer" aria-hidden="true" />
            <button
              type="button"
              className="auth-submit-button auth-submit-button-danger"
              onClick={() => runAction({ action: "merge", ...mergeForm }, "账号已合并。")}
              disabled={pending}
            >
              执行合并
            </button>
          </div>
        </article>
      </section>

      <section className="panel admin-tool-card">
        <div className="panel-header compact">
          <div>
            <h3>账号主体</h3>
            <p className="admin-panel-desc">检索结果按注册时间倒序展示，可直接定位待修正账号。</p>
          </div>
          <span className="table-meta">{loading ? "加载中" : `${snapshot?.users.length ?? 0} 条`}</span>
        </div>
        <div className="admin-binding-record-list">
          {snapshot?.users.map((user) => (
            <article key={user.userId} className="admin-binding-record">
              <div className="admin-binding-record-main">
                <div className="admin-binding-record-copy">
                  <div className="admin-user-record-title">
                    <strong>{user.nickname}</strong>
                    <div className="admin-inline-badges">
                      <span className={`admin-status-badge ${getBindingStatusTone(user.status)}`}>
                        {formatUserStatus(user.status)}
                      </span>
                      {user.loginMethods.map((item) => (
                        <span key={item} className="admin-mini-chip">
                          {formatLoginType(item)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span>{user.userId}</span>
                </div>
                <div className="admin-binding-record-meta">
                  <span>手机号</span>
                  <strong>{user.maskedPhone ?? "待修正"}</strong>
                  <em>{user.phone ?? "当前缺少手机号"}</em>
                </div>
                <div className="admin-binding-record-meta">
                  <span>密码状态</span>
                  <strong>{user.hasPassword ? "已设置" : "未设置"}</strong>
                  <em>{user.passwordUpdatedAt ? formatDateTime(user.passwordUpdatedAt) : "可由后台重置"}</em>
                </div>
                <div className="admin-binding-record-meta">
                  <span>最近登录</span>
                  <strong>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "未登录"}</strong>
                  <em>{user.loginMethods.length > 0 ? "登录方式已可用" : "暂无可用登录方式"}</em>
                </div>
                <div className="admin-binding-record-meta">
                  <span>注册时间</span>
                  <strong>{formatDateTime(user.createdAt)}</strong>
                </div>
              </div>
              <div className="admin-user-record-actions">
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => setRepairPhoneForm({ userId: user.userId, phone: user.phone ?? "" })}
                >
                  修正手机号
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => setResetPasswordForm((current) => ({ ...current, userId: user.userId }))}
                >
                  重置密码
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => setMergeForm((current) => ({ ...current, sourceUserId: user.userId }))}
                >
                  设为源账号
                </button>
              </div>
            </article>
          ))}
          {!loading && (snapshot?.users.length ?? 0) === 0 ? <div className="auth-empty-state">暂无匹配</div> : null}
        </div>
      </section>
    </div>
  );
}
