import { ArrowRight, ShieldCheck, Users, Waves } from "lucide-react";
import Link from "next/link";

import { formatDateTime, formatLoginType } from "../../../lib/auth-display";
import { getAdminDashboardSnapshot } from "../../../lib/auth-service";
import { DashboardRefreshButton } from "./DashboardRefreshButton";

export const dynamic = "force-dynamic";

const quickLinks = [
  {
    title: "用户管理",
    desc: "处理正常账号与风控账号。",
    href: "/admin/users",
    icon: Users,
  },
  {
    title: "绑定与合并",
    desc: "修正手机号、重置密码、合并主体。",
    href: "/admin/members",
    icon: Waves,
  },
  {
    title: "运营账号管理",
    desc: "维护后台账号、角色与认证配置。",
    href: "/admin/permissions",
    icon: ShieldCheck,
  },
];

function formatRate(numerator: number, denominator: number) {
  if (denominator === 0) {
    return "--";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default function SystemStatusPage() {
  const snapshot = getAdminDashboardSnapshot();

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">Account Console</p>
        <div className="admin-page-header-row">
          <div>
            <h1>账号看板</h1>
            <p className="admin-page-desc">实时汇总当前账号数据、登录状态、风控概况和后台运营动作。</p>
          </div>
          <div className="admin-page-pill-row">
            <DashboardRefreshButton />
            <span className="admin-page-pill">实时数据</span>
            <span className="admin-page-pill subtle">更新于 {formatDateTime(snapshot.generatedAt)}</span>
          </div>
        </div>
      </header>

      <section className="admin-summary-grid">
        <article className="admin-summary-card primary">
          <span>注册用户</span>
          <strong>{snapshot.totals.totalUsers}</strong>
          <p>今日新增 {snapshot.today.registrations}</p>
        </article>
        <article className="admin-summary-card success">
          <span>今日登录成功率</span>
          <strong>{formatRate(snapshot.today.loginSuccess, snapshot.today.loginTotal)}</strong>
          <p>
            成功 {snapshot.today.loginSuccess} / 失败 {snapshot.today.loginFail}
          </p>
        </article>
        <article className="admin-summary-card danger">
          <span>风控账号</span>
          <strong>{snapshot.totals.bannedUsers}</strong>
          <p>今日新增风控 {snapshot.today.riskBlocks}</p>
        </article>
        <article className="admin-summary-card info">
          <span>运营账号</span>
          <strong>{snapshot.totals.totalOperators}</strong>
          <p>
            启用 {snapshot.totals.activeOperators} / 在线会话 {snapshot.totals.activeAdminSessions}
          </p>
        </article>
      </section>

      <section className="panel admin-tool-card admin-overview-panel">
        <div className="panel-header compact">
          <div>
            <h3>快捷入口</h3>
            <p className="admin-panel-desc">围绕账号域的后台主入口已经接齐。</p>
          </div>
        </div>
        <div className="admin-quick-link-grid">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="admin-quick-link-card">
                <span className="admin-quick-link-icon" aria-hidden="true">
                  <Icon size={15} />
                </span>
                <div className="admin-quick-link-copy">
                  <strong>{item.title}</strong>
                  <p>{item.desc}</p>
                </div>
                <span className="admin-quick-link-arrow" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>近 7 日概览</strong>
            <span>实时统计</span>
          </div>
          <div className="admin-data-grid admin-data-grid-head">
            <span>日期</span>
            <span>新增</span>
            <span>登录成功</span>
            <span>验证码</span>
            <span>后台操作</span>
          </div>
          <div className="admin-data-stack">
            {snapshot.daily.map((item) => (
              <div key={item.dateKey} className="admin-data-grid">
                <strong>{item.label}</strong>
                <span>{item.newUsers}</span>
                <span>{item.loginSuccess}</span>
                <span>{item.smsRequests}</span>
                <span>{item.adminActions}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>结构概览</strong>
            <span>P0</span>
          </div>
          <div className="admin-mini-stat-grid">
            <div className="admin-mini-stat-card">
              <span>正常账号</span>
              <strong>{snapshot.totals.normalUsers}</strong>
              <p>占总用户 {formatRate(snapshot.totals.normalUsers, snapshot.totals.totalUsers)}</p>
            </div>
            <div className="admin-mini-stat-card">
              <span>已设密码</span>
              <strong>{snapshot.totals.passwordReadyUsers}</strong>
              <p>未设密码 {snapshot.totals.totalUsers - snapshot.totals.passwordReadyUsers}</p>
            </div>
            <div className="admin-mini-stat-card">
              <span>用户会话</span>
              <strong>{snapshot.totals.activeUserSessions}</strong>
              <p>当前有效登录态</p>
            </div>
            <div className="admin-mini-stat-card">
              <span>验证码使用</span>
              <strong>{snapshot.today.smsUsed}</strong>
              <p>今日请求 {snapshot.today.smsRequests}</p>
            </div>
          </div>
          <div className="admin-config-grid">
            <div className="admin-config-item">
              <span>短信功能</span>
              <strong>{snapshot.config.smsEnabled ? "开启" : "关闭"}</strong>
            </div>
            <div className="admin-config-item">
              <span>调试短信</span>
              <strong>{snapshot.config.smsDebugMode ? "开启" : "关闭"}</strong>
            </div>
            <div className="admin-config-item">
              <span>登录有效期</span>
              <strong>固定 {snapshot.config.tokenExpireDays} 天</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>最近登录记录</strong>
            <span>{snapshot.recentUserLogins.length} 条</span>
          </div>
          <div className="admin-feed-list">
            {snapshot.recentUserLogins.map((item) => (
              <div key={item.logId} className="admin-feed-row">
                <div className="admin-feed-copy">
                  <div className="admin-inline-badges">
                    <span className={`admin-status-badge ${item.success ? "success" : "danger"}`}>
                      {item.success ? "成功" : "失败"}
                    </span>
                    <span className="admin-mini-chip">{formatLoginType(item.loginType)}</span>
                  </div>
                  <strong>{item.userId ?? "未命中用户"}</strong>
                  <p>{item.detail}</p>
                </div>
                <div className="admin-feed-side">
                  <span>{item.ip}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            {snapshot.recentUserLogins.length === 0 ? <div className="auth-empty-state">暂无登录记录</div> : null}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>最近后台操作</strong>
            <span>{snapshot.recentAdminActions.length} 条</span>
          </div>
          <div className="admin-feed-list">
            {snapshot.recentAdminActions.map((item) => (
              <div key={item.logId} className="admin-feed-row">
                <div className="admin-feed-copy">
                  <strong>{item.actionType}</strong>
                  <p>
                    操作人 {item.adminId}
                    {item.targetId ? ` · 目标 ${item.targetId}` : ""}
                  </p>
                  <p>{item.detail}</p>
                </div>
                <div className="admin-feed-side">
                  <span>{item.ip}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            {snapshot.recentAdminActions.length === 0 ? <div className="auth-empty-state">暂无后台操作</div> : null}
          </div>
        </article>
      </section>
    </div>
  );
}
