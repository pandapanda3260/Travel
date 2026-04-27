"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { formatDateTime, formatLoginType, formatUserStatus } from "../../../lib/auth-display";
import type { AdminUserListPage, AdminUserListSnapshot } from "../../../lib/auth-service";

type AdminUsersResponse = AdminUserListSnapshot & {
  error?: string;
};

type LoginMethodFilter = "all" | "password" | "sms";
type PasswordFilter = "all" | "ready" | "missing";

const PAGE_SIZE = 8;

type LoadUsersOptions = {
  keyword?: string;
  loginMethod?: LoginMethodFilter;
  passwordState?: PasswordFilter;
  normalPage?: number;
  riskPage?: number;
};

function buildPaginationLabel(page: AdminUserListPage) {
  if (page.total === 0) {
    return "暂无结果";
  }
  const start = (page.page - 1) * page.pageSize + 1;
  const end = Math.min(page.page * page.pageSize, page.total);
  return `${start}-${end} / ${page.total}`;
}

type AdminSectionPaginationProps = {
  page: AdminUserListPage;
  onChange: (nextPage: number) => void;
  disabled: boolean;
};

function AdminSectionPagination({ page, onChange, disabled }: AdminSectionPaginationProps) {
  if (page.total === 0) {
    return null;
  }

  return (
    <div className="admin-record-footer">
      <span className="table-meta">{buildPaginationLabel(page)}</span>
      <div className="admin-pagination">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => onChange(page.page - 1)}
          disabled={disabled || page.page <= 1}
        >
          上一页
        </button>
        <span className="admin-pagination-info">
          第 {page.page} / {page.totalPages} 页
        </span>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => onChange(page.page + 1)}
          disabled={disabled || page.page >= page.totalPages}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function AdminUsersClient() {
  const router = useRouter();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loginMethodFilter, setLoginMethodFilter] = useState<LoginMethodFilter>("all");
  const [passwordFilter, setPasswordFilter] = useState<PasswordFilter>("all");
  const [normalPage, setNormalPage] = useState(1);
  const [riskPage, setRiskPage] = useState(1);
  const [snapshot, setSnapshot] = useState<AdminUserListSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadUsers = useCallback(
    async (options: LoadUsersOptions = {}) => {
      const nextKeyword = options.keyword ?? keyword;
      const nextLoginMethod = options.loginMethod ?? loginMethodFilter;
      const nextPasswordState = options.passwordState ?? passwordFilter;
      const nextNormalPage = options.normalPage ?? normalPage;
      const nextRiskPage = options.riskPage ?? riskPage;

      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextKeyword.trim()) {
          params.set("keyword", nextKeyword.trim());
        }
        if (nextLoginMethod !== "all") {
          params.set("loginMethod", nextLoginMethod);
        }
        if (nextPasswordState !== "all") {
          params.set("passwordState", nextPasswordState);
        }
        params.set("normalPage", String(nextNormalPage));
        params.set("riskPage", String(nextRiskPage));
        params.set("pageSize", String(PAGE_SIZE));

        const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
        const data = (await response.json()) as AdminUsersResponse;
        if (response.status === 401) {
          router.push("/admin-auth/login");
          router.refresh();
          return;
        }
        if (!response.ok) {
          throw new Error(data.error || "用户列表加载失败");
        }

        setSnapshot(data);
        setKeyword(nextKeyword);
        setNormalPage(data.normal.page);
        setRiskPage(data.risk.page);
      } catch (currentError) {
        setError(currentError instanceof Error ? currentError.message : "用户列表加载失败");
      } finally {
        setLoading(false);
      }
    },
    [keyword, loginMethodFilter, normalPage, passwordFilter, riskPage, router],
  );

  useEffect(() => {
    if (snapshot) {
      return;
    }

    void loadUsers({
      keyword: "",
      loginMethod: "all",
      passwordState: "all",
      normalPage: 1,
      riskPage: 1,
    });
  }, [loadUsers, snapshot]);

  async function handleAction(action: "ban" | "unban" | "force_logout", userId: string) {
    setPendingKey(`${action}:${userId}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/users/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          userId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.status === 401) {
        router.push("/admin-auth/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "操作失败");
      }

      setSuccess(
        action === "ban" ? "账号已移入风控列表。" : action === "unban" ? "账号已解除风控。" : "账号已强制下线。",
      );
      await loadUsers();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "操作失败");
    } finally {
      setPendingKey("");
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess("");
    setNormalPage(1);
    setRiskPage(1);
    void loadUsers({
      keyword: keywordInput.trim(),
      normalPage: 1,
      riskPage: 1,
    });
  }

  function handleExport() {
    const total = snapshot?.summary.total ?? 0;
    if (total === 0) {
      return;
    }

    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (loginMethodFilter !== "all") {
      params.set("loginMethod", loginMethodFilter);
    }
    if (passwordFilter !== "all") {
      params.set("passwordState", passwordFilter);
    }

    const url = `/api/admin/users/export?${params.toString()}`;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.click();
    setSuccess(`已导出 ${total} 条用户数据。`);
  }

  const summary = snapshot?.summary;
  const normalUsers = snapshot?.normal.items ?? [];
  const riskUsers = snapshot?.risk.items ?? [];

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">User Operations</p>
        <div className="admin-page-header-row">
          <div>
            <h1>用户管理</h1>
            <p className="admin-page-desc">正常账号与风控账号分区展示，默认按注册时间倒序。</p>
          </div>
          <div className="admin-page-pill-row">
            <span className="admin-page-pill">当前结果 {summary?.total ?? 0}</span>
            <span className="admin-page-pill subtle">{keyword ? "已带筛选" : "全部结果"}</span>
          </div>
        </div>
      </header>

      {error ? <div className="auth-banner error">{error}</div> : null}
      {success ? <div className="auth-banner success">{success}</div> : null}

      <section className="admin-summary-grid">
        <article className="admin-summary-card success">
          <span>正常账号</span>
          <strong>{loading && !summary ? "--" : summary?.normalCount ?? 0}</strong>
          <p>可正常登录与使用。</p>
        </article>
        <article className="admin-summary-card danger">
          <span>风控账号</span>
          <strong>{loading && !summary ? "--" : summary?.riskCount ?? 0}</strong>
          <p>已被拉黑，需后台解封。</p>
        </article>
        <article className="admin-summary-card info">
          <span>已设密码</span>
          <strong>{loading && !summary ? "--" : summary?.passwordReadyCount ?? 0}</strong>
          <p>支持密码登录。</p>
        </article>
        <article className="admin-summary-card warning">
          <span>待补资料</span>
          <strong>{loading && !summary ? "--" : summary?.profilePendingCount ?? 0}</strong>
          <p>缺手机号或未设置密码。</p>
        </article>
      </section>

      <section className="panel admin-tool-card admin-toolbar-card">
        <form className="admin-toolbar-grid" onSubmit={handleSearchSubmit}>
          <label className="setting-field wide">
            <span>搜索</span>
            <input
              className="setting-input"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="手机号 / 昵称 / user_id"
            />
          </label>
          <label className="setting-field wide">
            <span>登录方式</span>
            <select
              className="setting-select"
              value={loginMethodFilter}
              onChange={(event) => {
                const nextValue = event.target.value as LoginMethodFilter;
                setLoginMethodFilter(nextValue);
                setNormalPage(1);
                setRiskPage(1);
                void loadUsers({
                  keyword: keywordInput.trim(),
                  loginMethod: nextValue,
                  normalPage: 1,
                  riskPage: 1,
                });
              }}
            >
              <option value="all">全部</option>
              <option value="password">手机号密码</option>
              <option value="sms">短信验证码</option>
            </select>
          </label>
          <label className="setting-field wide">
            <span>密码状态</span>
            <select
              className="setting-select"
              value={passwordFilter}
              onChange={(event) => {
                const nextValue = event.target.value as PasswordFilter;
                setPasswordFilter(nextValue);
                setNormalPage(1);
                setRiskPage(1);
                void loadUsers({
                  keyword: keywordInput.trim(),
                  passwordState: nextValue,
                  normalPage: 1,
                  riskPage: 1,
                });
              }}
            >
              <option value="all">全部</option>
              <option value="ready">已设置</option>
              <option value="missing">未设置</option>
            </select>
          </label>
          <div className="admin-toolbar-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={handleExport}
              disabled={loading || (snapshot?.summary.total ?? 0) === 0}
            >
              导出当前结果
            </button>
            <button type="submit" className="auth-submit-button" disabled={loading}>
              {loading ? "查询中..." : "查询"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel admin-tool-card admin-user-list-panel">
        <div className="panel-header compact">
          <div>
            <h3>用户列表</h3>
            <p className="admin-panel-desc">正常状态账号，支持强制下线和移入风控。</p>
          </div>
          <span className="table-meta">{loading && !snapshot ? "加载中" : `${snapshot?.normal.total ?? 0} 个账号`}</span>
        </div>
        <div className="admin-user-record-list">
          {normalUsers.map((item) => (
            <article key={item.userId} className="admin-user-record">
              <div className="admin-user-record-main">
                <div className="admin-user-record-copy">
                  <div className="admin-user-record-title">
                    <strong>{item.nickname}</strong>
                    <div className="admin-inline-badges">
                      <span className="admin-status-badge success">{formatUserStatus(item.status)}</span>
                      {item.loginMethods.map((loginType) => (
                        <span key={loginType} className="admin-mini-chip">
                          {formatLoginType(loginType)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span>{item.userId}</span>
                </div>
                <div className="admin-user-record-meta">
                  <span>手机号</span>
                  <strong>{item.maskedPhone ?? "待修正"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>密码状态</span>
                  <strong>{item.hasPassword ? "已设置" : "未设置"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>注册时间</span>
                  <strong>{formatDateTime(item.createdAt)}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>最近登录</span>
                  <strong>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "未登录"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>在线会话</span>
                  <strong>{item.activeSessionCount}</strong>
                </div>
              </div>
              <div className="admin-user-record-actions">
                <Link href={`/admin/users/${item.userId}`} className="toolbar-button">
                  查看明细
                </Link>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => handleAction("force_logout", item.userId)}
                  disabled={pendingKey === `force_logout:${item.userId}`}
                >
                  {pendingKey === `force_logout:${item.userId}` ? "处理中..." : "强制下线"}
                </button>
                <button
                  type="button"
                  className="toolbar-button danger"
                  onClick={() => handleAction("ban", item.userId)}
                  disabled={pendingKey === `ban:${item.userId}`}
                >
                  {pendingKey === `ban:${item.userId}` ? "处理中..." : "拉黑"}
                </button>
              </div>
            </article>
          ))}
          {!loading && normalUsers.length === 0 ? <div className="auth-empty-state">暂无正常账号</div> : null}
        </div>
        {snapshot ? (
          <AdminSectionPagination
            page={snapshot.normal}
            onChange={(nextPage) => void loadUsers({ normalPage: nextPage })}
            disabled={loading}
          />
        ) : null}
      </section>

      <section className="panel admin-tool-card admin-user-list-panel risk">
        <div className="panel-header compact">
          <div>
            <h3>风控列表</h3>
            <p className="admin-panel-desc">已拉黑账号，解封后会自动回到用户列表。</p>
          </div>
          <span className="table-meta">{loading && !snapshot ? "加载中" : `${snapshot?.risk.total ?? 0} 个账号`}</span>
        </div>
        <div className="admin-user-record-list">
          {riskUsers.map((item) => (
            <article key={item.userId} className="admin-user-record risk">
              <div className="admin-user-record-main">
                <div className="admin-user-record-copy">
                  <div className="admin-user-record-title">
                    <strong>{item.nickname}</strong>
                    <div className="admin-inline-badges">
                      <span className="admin-status-badge danger">{formatUserStatus(item.status)}</span>
                      {item.loginMethods.map((loginType) => (
                        <span key={loginType} className="admin-mini-chip">
                          {formatLoginType(loginType)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span>{item.userId}</span>
                </div>
                <div className="admin-user-record-meta">
                  <span>手机号</span>
                  <strong>{item.maskedPhone ?? "待修正"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>密码状态</span>
                  <strong>{item.hasPassword ? "已设置" : "未设置"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>注册时间</span>
                  <strong>{formatDateTime(item.createdAt)}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>最近登录</span>
                  <strong>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "未登录"}</strong>
                </div>
                <div className="admin-user-record-meta">
                  <span>在线会话</span>
                  <strong>{item.activeSessionCount}</strong>
                </div>
              </div>
              <div className="admin-user-record-actions">
                <Link href={`/admin/users/${item.userId}`} className="toolbar-button">
                  查看明细
                </Link>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => handleAction("unban", item.userId)}
                  disabled={pendingKey === `unban:${item.userId}`}
                >
                  {pendingKey === `unban:${item.userId}` ? "处理中..." : "解除风控"}
                </button>
              </div>
            </article>
          ))}
          {!loading && riskUsers.length === 0 ? <div className="auth-empty-state">暂无风控账号</div> : null}
        </div>
        {snapshot ? (
          <AdminSectionPagination
            page={snapshot.risk}
            onChange={(nextPage) => void loadUsers({ riskPage: nextPage })}
            disabled={loading}
          />
        ) : null}
      </section>
    </div>
  );
}
