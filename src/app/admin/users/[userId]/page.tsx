import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatDateTime,
  formatLoginType,
  formatSmsCodePurpose,
  formatUserSecurityAction,
  formatUserStatus,
} from "../../../../lib/auth-display";
import { buildRequestAuditContext, requireAdminPageSession } from "../../../../lib/auth-session";
import { getUserDetailForAdmin, recordUserDetailViewForAdmin } from "../../../../lib/auth-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    userId: string;
  }>;
};

function getStatusTone(status: "normal" | "banned" | "merged") {
  if (status === "normal") {
    return "success";
  }
  if (status === "banned") {
    return "danger";
  }
  return "warning";
}

function getSmsRecordTone(record: { used: boolean; expireAt: string }) {
  if (record.used) {
    return "success";
  }
  if (new Date(record.expireAt).getTime() <= Date.now()) {
    return "warning";
  }
  return "info";
}

function getSmsRecordLabel(record: { used: boolean; expireAt: string }) {
  if (record.used) {
    return "已核销";
  }
  if (new Date(record.expireAt).getTime() <= Date.now()) {
    return "已过期";
  }
  return "待使用";
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { userId } = await params;
  const session = await requireAdminPageSession();
  const audit = await buildRequestAuditContext();

  let detail: ReturnType<typeof getUserDetailForAdmin>;
  try {
    detail = getUserDetailForAdmin(userId);
    recordUserDetailViewForAdmin(userId, { adminId: session.admin.adminId }, audit);
  } catch {
    notFound();
  }

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">User Detail</p>
        <div className="admin-page-header-row">
          <div>
            <h1>{detail.summary.nickname}</h1>
            <p className="admin-page-desc">{detail.summary.userId}</p>
          </div>
          <div className="admin-page-pill-row">
            <span className={`admin-status-badge ${getStatusTone(detail.summary.status)}`}>
              {formatUserStatus(detail.summary.status)}
            </span>
            <a href={`/api/admin/users/${detail.summary.userId}/export`} className="toolbar-button">
              导出详情
            </a>
            <Link href="/admin/users" className="toolbar-button">
              返回用户列表
            </Link>
          </div>
        </div>
      </header>

      <section className="admin-detail-summary-grid">
        <article className="admin-detail-summary-card">
          <span>手机号</span>
          <strong>{detail.summary.maskedPhone ?? "待修正"}</strong>
        </article>
        <article className="admin-detail-summary-card">
          <span>登录方式</span>
          <strong>
            {detail.summary.loginMethods.length > 0
              ? detail.summary.loginMethods.map(formatLoginType).join(" / ")
              : "暂无"}
          </strong>
        </article>
        <article className="admin-detail-summary-card">
          <span>注册时间</span>
          <strong>{formatDateTime(detail.summary.createdAt)}</strong>
        </article>
        <article className="admin-detail-summary-card">
          <span>在线会话</span>
          <strong>{detail.summary.activeSessionCount}</strong>
        </article>
      </section>

      <section className="admin-detail-grid">
        <article className="admin-detail-block">
          <div className="panel-header compact">
            <div>
              <h3>基础信息</h3>
            </div>
          </div>
          <div className="auth-list">
            <div className="auth-list-item">
              <strong>昵称</strong>
              <span>{detail.summary.nickname}</span>
            </div>
            <div className="auth-list-item">
              <strong>用户 ID</strong>
              <span>{detail.summary.userId}</span>
            </div>
            <div className="auth-list-item">
              <strong>密码状态</strong>
              <span>{detail.summary.hasPassword ? "已设置" : "未设置"}</span>
            </div>
            <div className="auth-list-item">
              <strong>最近登录</strong>
              <span>{detail.summary.lastLoginAt ? formatDateTime(detail.summary.lastLoginAt) : "未登录"}</span>
            </div>
            <div className="auth-list-item">
              <strong>最近登录 IP</strong>
              <span>{detail.summary.lastLoginIp ?? "暂无"}</span>
            </div>
          </div>
        </article>

        <article className="admin-detail-block">
          <div className="panel-header compact">
            <div>
              <h3>登录账号</h3>
            </div>
          </div>
          <div className="auth-list">
            {detail.accounts.map((item) => (
              <div key={item.accountId} className="auth-list-item">
                <div>
                  <strong>{item.username}</strong>
                  <span>{item.accountId}</span>
                </div>
                <span>{formatDateTime(item.updatedAt)}</span>
              </div>
            ))}
            {detail.accounts.length === 0 ? <div className="auth-empty-state">暂无密码账号</div> : null}
          </div>
        </article>
      </section>

      <section className="admin-detail-grid">
        <article className="admin-detail-block">
          <div className="panel-header compact">
            <div>
              <h3>手机号</h3>
            </div>
          </div>
          <div className="auth-list">
            {detail.phones.map((item) => (
              <div key={item.phoneId} className="auth-list-item">
                <div>
                  <strong>{item.maskedPhone}</strong>
                  <span>{item.verified ? "已验证" : "未验证"}</span>
                </div>
                <span>{formatDateTime(item.updatedAt)}</span>
              </div>
            ))}
            {detail.phones.length === 0 ? <div className="auth-empty-state">暂无手机号记录</div> : null}
          </div>
        </article>

        <article className="admin-detail-block">
          <div className="panel-header compact">
            <div>
              <h3>在线会话</h3>
            </div>
          </div>
          <div className="auth-list">
            {detail.sessions.map((item) => (
              <div key={item.sessionId} className="auth-list-item">
                <div>
                  <strong>{formatLoginType(item.loginType)}</strong>
                  <span>{item.ip}</span>
                </div>
                <span>{formatDateTime(item.lastSeenAt ?? item.createdAt)}</span>
              </div>
            ))}
            {detail.sessions.length === 0 ? <div className="auth-empty-state">当前没有有效会话</div> : null}
          </div>
        </article>
      </section>

      <section className="admin-detail-block">
        <div className="panel-header compact">
          <div>
            <h3>最近登录</h3>
          </div>
        </div>
        <div className="admin-feed-list">
          {detail.recentLogins.map((item) => (
            <div key={item.logId} className="admin-feed-row">
              <div className="admin-feed-copy">
                <div className="admin-inline-badges">
                  <span className={`admin-status-badge ${item.success ? "success" : "danger"}`}>
                    {item.success ? "成功" : "失败"}
                  </span>
                  <span className="admin-mini-chip">{formatLoginType(item.loginType)}</span>
                </div>
                <strong>{item.detail}</strong>
                <p>{item.ip}</p>
              </div>
              <div className="admin-feed-side">
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
            </div>
          ))}
          {detail.recentLogins.length === 0 ? <div className="auth-empty-state">暂无登录记录</div> : null}
        </div>
      </section>

      <section className="admin-detail-block">
        <div className="panel-header compact">
          <div>
            <h3>安全动作</h3>
          </div>
        </div>
        <div className="admin-feed-list">
          {detail.securityLogs.map((item) => (
            <div key={item.logId} className="admin-feed-row">
              <div className="admin-feed-copy">
                <div className="admin-inline-badges">
                  <span className="admin-mini-chip">{formatUserSecurityAction(item.actionType)}</span>
                </div>
                <strong>{item.detail}</strong>
                <p>{item.ip}</p>
              </div>
              <div className="admin-feed-side">
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
            </div>
          ))}
          {detail.securityLogs.length === 0 ? <div className="auth-empty-state">暂无安全动作</div> : null}
        </div>
      </section>

      <section className="admin-detail-block">
        <div className="panel-header compact">
          <div>
            <h3>短信记录</h3>
          </div>
        </div>
        <div className="admin-feed-list">
          {detail.smsRecords.map((item) => (
            <div key={item.smsId} className="admin-feed-row">
              <div className="admin-feed-copy">
                <div className="admin-inline-badges">
                  <span className="admin-mini-chip">{formatSmsCodePurpose(item.purpose)}</span>
                  <span className={`admin-status-badge ${getSmsRecordTone(item)}`}>{getSmsRecordLabel(item)}</span>
                </div>
                <strong>{item.maskedPhone}</strong>
                <p>
                  {item.requestIp}
                  {item.usedAt ? ` · 核销于 ${formatDateTime(item.usedAt)}` : ` · 截止 ${formatDateTime(item.expireAt)}`}
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
            </div>
          ))}
          {detail.smsRecords.length === 0 ? <div className="auth-empty-state">暂无短信记录</div> : null}
        </div>
      </section>
    </div>
  );
}
