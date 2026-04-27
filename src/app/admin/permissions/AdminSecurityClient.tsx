"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatAdminActionType,
  formatAdminRole,
  formatAdminStatus,
  formatDateTime,
  formatLoginType,
  formatSmsCodePurpose,
  formatUserSecurityAction,
} from "../../../lib/auth-display";
import type { SecurityManagementSnapshot } from "../../../lib/auth-service";

type SecurityActionResponse = {
  error?: string;
  snapshot?: SecurityManagementSnapshot;
};

type AuditFilterType = "all" | "admin" | "login" | "security" | "sms";
type AuditTimeRange = "all" | "24h" | "7d" | "30d";
type AuditResultFilter = "all" | "success" | "failed" | "pending" | "neutral";

type AuditFeedItem = {
  id: string;
  type: Exclude<AuditFilterType, "all">;
  title: string;
  detail: string;
  meta: string;
  createdAt: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  badges: string[];
  result: Exclude<AuditResultFilter, "all">;
};

function getAdminStatusTone(status: "active" | "disabled") {
  return status === "active" ? "success" : "warning";
}

function getAdminRoleTone(role: "super_admin" | "operator" | "viewer") {
  if (role === "super_admin") {
    return "danger";
  }
  if (role === "operator") {
    return "info";
  }
  return "neutral";
}

function buildAuditFeed(snapshot: SecurityManagementSnapshot): AuditFeedItem[] {
  const adminItems: AuditFeedItem[] = snapshot.recentAdminActions.map((item) => ({
    id: item.logId,
    type: "admin",
    title: formatAdminActionType(item.actionType),
    detail: item.detail,
    meta: [item.adminId, item.targetId, item.ip].filter(Boolean).join(" · "),
    createdAt: item.createdAt,
    tone: "neutral",
    badges: ["后台操作", item.targetType],
    result: "neutral",
  }));

  const loginItems: AuditFeedItem[] = snapshot.recentUserLogins.map((item) => ({
    id: item.logId,
    type: "login",
    title: `${item.success ? "登录成功" : "登录失败"} · ${formatLoginType(item.loginType)}`,
    detail: item.detail,
    meta: [item.userId ?? "未知用户", item.ip].join(" · "),
    createdAt: item.createdAt,
    tone: item.success ? "success" : "danger",
    badges: ["用户登录"],
    result: item.success ? "success" : "failed",
  }));

  const securityItems: AuditFeedItem[] = snapshot.recentUserSecurityLogs.map((item) => ({
    id: item.logId,
    type: "security",
    title: formatUserSecurityAction(item.actionType),
    detail: item.detail,
    meta: [item.userId, item.ip].join(" · "),
    createdAt: item.createdAt,
    tone: "info",
    badges: ["安全动作"],
    result: "neutral",
  }));

  const smsItems: AuditFeedItem[] = snapshot.recentSmsRecords.map((item) => ({
    id: item.smsId,
    type: "sms",
    title: formatSmsCodePurpose(item.purpose),
    detail: `${item.maskedPhone} · ${item.used ? "已核销" : new Date(item.expireAt).getTime() <= Date.now() ? "已过期" : "待使用"}`,
    meta: [item.requestIp, item.usedAt ? `核销 ${formatDateTime(item.usedAt)}` : `截止 ${formatDateTime(item.expireAt)}`]
      .filter(Boolean)
      .join(" · "),
    createdAt: item.createdAt,
    tone: item.used ? "success" : new Date(item.expireAt).getTime() <= Date.now() ? "warning" : "info",
    badges: ["验证码"],
    result: item.used ? "success" : new Date(item.expireAt).getTime() <= Date.now() ? "failed" : "pending",
  }));

  return [...adminItems, ...loginItems, ...securityItems, ...smsItems].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function AdminSecurityClient() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SecurityManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [auditKeyword, setAuditKeyword] = useState("");
  const [auditType, setAuditType] = useState<AuditFilterType>("all");
  const [auditTimeRange, setAuditTimeRange] = useState<AuditTimeRange>("7d");
  const [auditResult, setAuditResult] = useState<AuditResultFilter>("all");
  const [operatorForm, setOperatorForm] = useState({
    adminId: "",
    username: "",
    displayName: "",
    role: "operator" as "super_admin" | "operator" | "viewer",
    status: "active" as "active" | "disabled",
    password: "",
  });

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/security", { cache: "no-store" });
      const data = (await response.json()) as SecurityManagementSnapshot & { error?: string };
      if (response.status === 401) {
        router.push("/admin-auth/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "运营账号加载失败");
      }
      setSnapshot(data);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "运营账号加载失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  async function runAction(payload: Record<string, unknown>, successMessage: string) {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/security/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as SecurityActionResponse;
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
        await loadSnapshot();
      }
      setSuccess(successMessage);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-page admin-auth-page">
        <div className="auth-empty-state">运营账号加载中...</div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="admin-page admin-auth-page">
        {error ? <div className="auth-banner error">{error}</div> : null}
        <div className="auth-empty-state">当前未获取到运营账号数据。</div>
      </div>
    );
  }

  const totalOperators = snapshot.operators.length;
  const activeOperators = snapshot.operators.filter((item) => item.status === "active").length;
  const disabledOperators = snapshot.operators.filter((item) => item.status === "disabled").length;
  const superAdminCount = snapshot.operators.filter((item) => item.role === "super_admin").length;
  const auditFeed = buildAuditFeed(snapshot).filter((item) => {
    if (auditType !== "all" && item.type !== auditType) {
      return false;
    }
    if (auditResult !== "all" && item.result !== auditResult) {
      return false;
    }
    if (auditTimeRange !== "all") {
      const now = Date.now();
      const createdAt = new Date(item.createdAt).getTime();
      const rangeMap = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      } as const;
      if (createdAt < now - rangeMap[auditTimeRange]) {
        return false;
      }
    }
    const keyword = auditKeyword.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return [item.title, item.detail, item.meta, ...item.badges].join(" ").toLowerCase().includes(keyword);
  });

  function handleExportAudit() {
    if (auditFeed.length === 0) {
      return;
    }

    const csv = [
      ["type", "result", "title", "detail", "meta", "time"],
      ...auditFeed.map((item) => [item.type, item.result, item.title, item.detail, item.meta, formatDateTime(item.createdAt)]),
    ]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `auth-audit-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccess(`已导出 ${auditFeed.length} 条审计记录。`);
  }

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">Operators & Security</p>
        <div className="admin-page-header-row">
          <div>
            <h1>运营账号管理</h1>
            <p className="admin-page-desc">统一维护后台账号、角色状态与登录配置。</p>
          </div>
          <span className="admin-page-pill">账号 {totalOperators}</span>
        </div>
      </header>

      {error ? <div className="auth-banner error">{error}</div> : null}
      {success ? <div className="auth-banner success">{success}</div> : null}

      <section className="admin-summary-grid">
        <article className="admin-summary-card primary">
          <span>运营账号</span>
          <strong>{totalOperators}</strong>
          <p>当前后台可用账号总数。</p>
        </article>
        <article className="admin-summary-card success">
          <span>启用中</span>
          <strong>{activeOperators}</strong>
          <p>可正常登录后台。</p>
        </article>
        <article className="admin-summary-card warning">
          <span>停用中</span>
          <strong>{disabledOperators}</strong>
          <p>已停用但保留记录。</p>
        </article>
        <article className="admin-summary-card danger">
          <span>超级管理员</span>
          <strong>{superAdminCount}</strong>
          <p>拥有全局账号管理权限。</p>
        </article>
      </section>

      <section className="panel admin-tool-card">
        <div className="panel-header compact">
          <div>
            <h3>运营账号</h3>
            <p className="admin-panel-desc">左侧选择已有账号，右侧直接编辑或新建。</p>
          </div>
        </div>
        <div className="admin-auth-grid">
          <div className="auth-list">
            {snapshot.operators.map((item) => (
              <button
                key={item.adminId}
                type="button"
                className={`admin-list-row ${operatorForm.adminId === item.adminId ? "active" : ""}`}
                onClick={() =>
                  setOperatorForm({
                    adminId: item.adminId,
                    username: item.username,
                    displayName: item.displayName,
                    role: item.role,
                    status: item.status,
                    password: "",
                  })
                }
              >
                <div className="admin-list-row-main">
                  <div className="admin-list-row-title">
                    <strong>{item.displayName}</strong>
                    <div className="admin-inline-badges">
                      <span className={`admin-status-badge ${getAdminRoleTone(item.role)}`}>
                        {formatAdminRole(item.role)}
                      </span>
                      <span className={`admin-status-badge ${getAdminStatusTone(item.status)}`}>
                        {formatAdminStatus(item.status)}
                      </span>
                    </div>
                  </div>
                  <span className="admin-list-row-id">{item.username}</span>
                </div>
                <div className="admin-list-row-side">
                  <span>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "未登录"}</span>
                </div>
              </button>
            ))}
            {snapshot.operators.length === 0 ? <div className="auth-empty-state">暂无运营账号</div> : null}
          </div>

          <div className="auth-form-stack">
            <label className="setting-field wide">
              <span>运营账号</span>
              <input
                className="setting-input"
                value={operatorForm.username}
                onChange={(event) => setOperatorForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="请输入运营账号"
              />
            </label>
            <label className="setting-field wide">
              <span>显示名称</span>
              <input
                className="setting-input"
                value={operatorForm.displayName}
                onChange={(event) => setOperatorForm((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="请输入显示名称"
              />
            </label>
            <div className="admin-search-row">
              <label className="setting-field wide">
                <span>角色</span>
                <select
                  className="setting-select"
                  value={operatorForm.role}
                  onChange={(event) =>
                    setOperatorForm((current) => ({
                      ...current,
                      role: event.target.value as "super_admin" | "operator" | "viewer",
                    }))
                  }
                >
                  <option value="super_admin">超级管理员</option>
                  <option value="operator">运营</option>
                  <option value="viewer">只读</option>
                </select>
              </label>
              <label className="setting-field wide">
                <span>状态</span>
                <select
                  className="setting-select"
                  value={operatorForm.status}
                  onChange={(event) =>
                    setOperatorForm((current) => ({
                      ...current,
                      status: event.target.value as "active" | "disabled",
                    }))
                  }
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
            </div>
            <label className="setting-field wide">
              <span>密码</span>
              <input
                className="setting-input"
                type="password"
                value={operatorForm.password}
                onChange={(event) => setOperatorForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={operatorForm.adminId ? "留空则不修改" : "新增账号必须设置密码"}
              />
            </label>
            <div className="admin-action-group">
              <button
                type="button"
                className="auth-submit-button"
                onClick={() =>
                  runAction(
                    {
                      action: "upsert_operator",
                      operator: operatorForm,
                    },
                    operatorForm.adminId ? "运营账号已更新。" : "运营账号已创建。",
                  )
                }
                disabled={pending}
              >
                {operatorForm.adminId ? "保存账号" : "创建账号"}
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() =>
                  setOperatorForm({
                    adminId: "",
                    username: "",
                    displayName: "",
                    role: "operator",
                    status: "active",
                    password: "",
                  })
                }
                disabled={pending}
              >
                新建
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel admin-tool-card">
        <div className="panel-header compact">
          <div>
            <h3>认证配置</h3>
            <p className="admin-panel-desc">统一维护短信开关、调试模式和会话有效期。</p>
          </div>
        </div>
        <div className="auth-form-stack">
          <div className="admin-search-row">
            <label className="setting-field wide">
              <span>短信功能</span>
              <select
                className="setting-select"
                value={snapshot.config.smsEnabled ? "enabled" : "disabled"}
                onChange={(event) =>
                  setSnapshot((current) =>
                    current
                      ? {
                          ...current,
                          config: {
                            ...current.config,
                            smsEnabled: event.target.value === "enabled",
                          },
                        }
                      : current,
                  )
                }
              >
                <option value="enabled">开启</option>
                <option value="disabled">关闭</option>
              </select>
            </label>
            <label className="setting-field wide">
              <span>调试短信</span>
              <select
                className="setting-select"
                value={snapshot.config.smsDebugMode ? "enabled" : "disabled"}
                onChange={(event) =>
                  setSnapshot((current) =>
                    current
                      ? {
                          ...current,
                          config: {
                            ...current.config,
                            smsDebugMode: event.target.value === "enabled",
                          },
                        }
                      : current,
                  )
                }
              >
                <option value="enabled">开启</option>
                <option value="disabled">关闭</option>
              </select>
            </label>
          </div>
          <label className="setting-field wide">
            <span>登录有效期（固定）</span>
            <input
              className="setting-input"
              type="number"
              value={snapshot.config.tokenExpireDays}
              disabled
              readOnly
            />
          </label>
          <button
            type="button"
            className="auth-submit-button"
            onClick={() =>
              runAction(
                {
                  action: "update_config",
                  config: {
                    smsEnabled: snapshot.config.smsEnabled,
                    smsDebugMode: snapshot.config.smsDebugMode,
                  },
                },
                "短信配置已更新。",
              )
            }
            disabled={pending}
          >
            保存配置
          </button>
        </div>
      </section>

      <section className="panel admin-tool-card">
        <div className="panel-header compact">
          <div>
            <h3>安全审计</h3>
            <p className="admin-panel-desc">统一查看后台操作、用户登录、安全动作和验证码流水。</p>
          </div>
          <span className="table-meta">{auditFeed.length} 条结果</span>
        </div>
        <div className="admin-toolbar-grid compact audit">
          <label className="setting-field wide">
            <span>关键词</span>
            <input
              className="setting-input"
              value={auditKeyword}
              onChange={(event) => setAuditKeyword(event.target.value)}
              placeholder="用户 ID / IP / 动作 / 文案"
            />
          </label>
          <label className="setting-field wide">
            <span>类型</span>
            <select
              className="setting-select"
              value={auditType}
              onChange={(event) => setAuditType(event.target.value as AuditFilterType)}
            >
              <option value="all">全部</option>
              <option value="admin">后台操作</option>
              <option value="login">用户登录</option>
              <option value="security">安全动作</option>
              <option value="sms">验证码</option>
            </select>
          </label>
          <label className="setting-field wide">
            <span>时间范围</span>
            <select
              className="setting-select"
              value={auditTimeRange}
              onChange={(event) => setAuditTimeRange(event.target.value as AuditTimeRange)}
            >
              <option value="7d">近 7 天</option>
              <option value="24h">近 24 小时</option>
              <option value="30d">近 30 天</option>
              <option value="all">全部</option>
            </select>
          </label>
          <label className="setting-field wide">
            <span>结果</span>
            <select
              className="setting-select"
              value={auditResult}
              onChange={(event) => setAuditResult(event.target.value as AuditResultFilter)}
            >
              <option value="all">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败 / 过期</option>
              <option value="pending">待处理</option>
              <option value="neutral">中性</option>
            </select>
          </label>
          <div className="admin-toolbar-actions">
            <button type="button" className="toolbar-button" onClick={handleExportAudit} disabled={auditFeed.length === 0}>
              导出当前结果
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                setAuditKeyword("");
                setAuditType("all");
                setAuditTimeRange("7d");
                setAuditResult("all");
              }}
            >
              重置筛选
            </button>
          </div>
        </div>
        <div className="admin-feed-list">
          {auditFeed.map((item) => (
            <div key={`${item.type}-${item.id}`} className="admin-feed-row">
              <div className="admin-feed-copy">
                <div className="admin-inline-badges">
                  <span className={`admin-status-badge ${item.tone}`}>{item.title}</span>
                  {item.badges.map((badge) => (
                    <span key={badge} className="admin-mini-chip">
                      {badge}
                    </span>
                  ))}
                </div>
                <strong>{item.detail}</strong>
                <p>{item.meta}</p>
              </div>
              <div className="admin-feed-side">
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
            </div>
          ))}
          {auditFeed.length === 0 ? <div className="auth-empty-state">暂无匹配的审计记录</div> : null}
        </div>
      </section>
    </div>
  );
}
