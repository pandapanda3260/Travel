import { PageBrandTitle } from "../../_components/page-brand-title";
import { formatDateTime } from "../../../lib/auth-display";
import { requireUserPageSession } from "../../../lib/auth-session";
import { getUserModelUsagePayload } from "../../../lib/model-usage-service";

export const dynamic = "force-dynamic";

function formatCurrency(value: number) {
  return `¥${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function getStatusLabel(status: "charged" | "unpriced" | "skipped") {
  switch (status) {
    case "charged":
      return "已扣费";
    case "unpriced":
      return "待定价";
    default:
      return "未计费";
  }
}

function getStatusClass(status: "charged" | "unpriced" | "skipped") {
  return status === "charged" ? "positive" : "negative";
}

export default async function UsageBillingPage() {
  const session = await requireUserPageSession();
  const usage = getUserModelUsagePayload(session.userId);
  const riskCalls = usage.summary.unpricedCalls + usage.summary.skippedCalls;

  return (
    <main className="shell">
      <section className="content member-center-page settings-console-page usage-billing-page">
        <section className="header-panel member-header-panel settings-console-header">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Usage Billing" />
            </div>
          </header>
        </section>

        <section className="member-hero panel">
          <div className="member-hero-main">
            <div className="member-hero-copy-stack">
              <span className="settings-section-kicker">近 30 天</span>
              <h2>AI 用量账单</h2>
              <p className="member-hero-copy">展示近 30 天模型调用、金额估算和积分扣减流水。</p>
            </div>
            <div className="member-pill-row">
              <span className="member-pill accent">剩余积分 {formatPoints(usage.pointsAccount?.availablePoints ?? 0)}</span>
              <span className="member-pill">{riskCalls > 0 ? "存在待核对用量" : "账单正常"}</span>
            </div>
          </div>

          <div className="member-stat-grid settings-metric-grid">
            <article className="member-stat-card">
              <span>近 30 天调用</span>
              <strong>{usage.summary.totalCalls}</strong>
              <p>已扣费 {usage.summary.chargedCalls}</p>
            </article>
            <article className="member-stat-card">
              <span>模型费用</span>
              <strong>{formatCurrency(usage.summary.totalAmountRmb)}</strong>
              <p>供应商价格折算</p>
            </article>
            <article className="member-stat-card">
              <span>扣减积分</span>
              <strong>{formatPoints(usage.summary.totalPoints)}</strong>
              <p>按计费规则实时扣减</p>
            </article>
            <article className="member-stat-card">
              <span>待核对</span>
              <strong>{riskCalls}</strong>
              <p>待定价或未计费用量</p>
            </article>
          </div>
        </section>

        <section className="usage-billing-grid">
          <article className="panel member-surface usage-ledger-card">
            <div className="panel-header compact">
              <h3>模型用量流水</h3>
              <span className="table-meta">{usage.records.length} 条</span>
            </div>
            <div className="member-record-list">
              {usage.records.map((record) => (
                <div key={record.usageId} className="member-record-item">
                  <div>
                    <strong>{record.pricingSnapshot.label ?? record.modelId ?? record.serviceName}</strong>
                    <span>
                      {getStatusLabel(record.status)} · {record.serviceName}
                      {record.objectId ? ` · ${record.objectType ?? "对象"} ${record.objectId}` : ""}
                    </span>
                    <span>{formatDateTime(record.createdAt)}</span>
                  </div>
                  <b className={getStatusClass(record.status)}>-{formatPoints(record.pointsCost)}</b>
                </div>
              ))}
              {usage.records.length === 0 ? <div className="member-empty-inline">暂无 AI 用量记录</div> : null}
            </div>
          </article>

          <article className="panel member-surface usage-detail-card">
            <div className="panel-header compact">
              <h3>费用明细</h3>
            </div>
            <div className="member-record-list compact">
              {usage.records.slice(0, 20).map((record) => (
                <div key={`${record.usageId}-amount`} className="member-record-item">
                  <div>
                    <strong>{record.serviceName}</strong>
                    <span>
                      {record.pricingKey ?? "未匹配定价"} · {record.provider ?? "未知供应商"}
                    </span>
                    <span>
                      金额 {formatCurrency(record.amountRmb)} · 积分 {formatPoints(record.pointsCost)}
                    </span>
                  </div>
                  <b className={record.amountRmb > 0 ? "negative" : "positive"}>{formatCurrency(record.amountRmb)}</b>
                </div>
              ))}
              {usage.records.length === 0 ? <div className="member-empty-inline">暂无费用明细</div> : null}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
