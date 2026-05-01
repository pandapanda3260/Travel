import { Suspense } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { formatDateTime } from "../../../lib/auth-display";
import { requireUserPageSession } from "../../../lib/auth-session";
import { getCommercialCreditAccountPayload } from "../../../lib/commercial-billing-service";
import { listCommercialOrdersByUserId } from "../../../lib/commercial-order-service";

export const dynamic = "force-dynamic";

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "未记录";
  }
  return `¥${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "未记录";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatOrderStatus(status: string) {
  switch (status) {
    case "pending_payment":
      return "待确认";
    case "paid":
      return "已支付";
    case "fulfilled":
      return "已到账";
    case "refunded":
      return "已退款";
    case "closed":
      return "已关闭";
    default:
      return status;
  }
}

function UsageBillingFallback() {
  return (
    <main className="shell">
      <section className="content member-center-page settings-console-page">
        <section className="panel member-empty-panel">用量账单加载中...</section>
      </section>
    </main>
  );
}

async function UsageBillingPageContent() {
  const session = await requireUserPageSession();
  const account = getCommercialCreditAccountPayload(session.userId);
  const orders = listCommercialOrdersByUserId(session.userId, 20);
  const usageTransactions = account.transactions.filter((record) => record.sourceType === "usage_charge");

  return (
    <main className="shell">
      <section className="content member-center-page settings-console-page usage-billing-page">
        <section className="header-panel member-header-panel settings-console-header">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="用量账单" />
            </div>
          </header>
        </section>

        <section className="member-hero panel">
          <div className="member-hero-main">
            <div className="member-hero-copy-stack">
              <span className="settings-section-kicker">商业账本</span>
              <h2>{account.activeMembership?.planName ?? "未开通套餐"}</h2>
              <p className="member-hero-copy">
                {account.activeMembership
                  ? `会员有效至 ${formatDateTime(account.activeMembership.endAt)}`
                  : "开通会员后，真实 API 成本会按新积分规则结算"}
              </p>
            </div>
            <div className="member-pill-row">
              <span className="member-pill accent">可用 {formatCredits(account.balance.availableCredits)}</span>
              <span className="member-pill">冻结 {formatCredits(account.balance.frozenCredits)}</span>
              <span className="member-pill">扣费 {usageTransactions.length} 笔</span>
            </div>
          </div>

          <div className="member-stat-grid settings-metric-grid">
            <article className="member-stat-card">
              <span>可用积分</span>
              <strong>{formatCredits(account.balance.availableCredits)}</strong>
              <p>可用于真实 API 生成</p>
            </article>
            <article className="member-stat-card">
              <span>冻结积分</span>
              <strong>{formatCredits(account.balance.frozenCredits)}</strong>
              <p>生成中任务占用</p>
            </article>
            <article className="member-stat-card">
              <span>累计消耗</span>
              <strong>{formatCredits(account.balance.lifetimeUsedCredits)}</strong>
              <p>成功生成后确认扣除</p>
            </article>
            <article className="member-stat-card">
              <span>订单数量</span>
              <strong>{orders.length}</strong>
              <p>最近 20 条商业订单</p>
            </article>
          </div>
        </section>

        <section className="usage-billing-grid">
          <article className="panel member-surface usage-ledger-card">
            <div className="panel-header compact">
              <h3>扣费明细</h3>
              <span className="table-meta">{usageTransactions.length} 条</span>
            </div>
            <div className="member-record-list">
              {usageTransactions.slice(0, 40).map((record) => (
                <div key={record.transactionId} className="member-record-item">
                  <div>
                    <strong>{record.remark || record.featureCode || "用量扣费"}</strong>
                    <span>
                      {record.provider ?? "供应商未记录"} · {record.modelId ?? "模型未记录"}
                    </span>
                    <span>
                      成本 {formatMoney(record.realCostRmb)} · 收入 {formatMoney(record.chargedRevenueRmb)} · 毛利{" "}
                      {formatPercent(record.grossMarginRate)}
                    </span>
                    <span>{formatDateTime(record.createdAt)}</span>
                  </div>
                  <b className="negative">{formatCredits(record.changeCredits)}</b>
                </div>
              ))}
              {usageTransactions.length === 0 ? <div className="member-empty-inline">暂无扣费明细</div> : null}
            </div>
          </article>

          <article className="panel member-surface usage-detail-card">
            <div className="panel-header compact">
              <h3>积分流水</h3>
              <span className="table-meta">{account.transactions.length} 条</span>
            </div>
            <div className="member-record-list compact">
              {account.transactions.slice(0, 40).map((record) => (
                <div key={record.transactionId} className="member-record-item">
                  <div>
                    <strong>{record.remark || record.eventType}</strong>
                    <span>
                      {record.featureCode ?? record.sourceType}
                      {record.taskId ? ` · 任务 ${record.taskId}` : ""}
                    </span>
                    <span>{formatDateTime(record.createdAt)}</span>
                  </div>
                  <b className={record.changeCredits >= 0 ? "positive" : "negative"}>
                    {record.changeCredits >= 0 ? "+" : ""}
                    {formatCredits(record.changeCredits)}
                  </b>
                </div>
              ))}
              {account.transactions.length === 0 ? <div className="member-empty-inline">暂无积分流水</div> : null}
            </div>
          </article>
        </section>

        <section className="panel member-surface usage-detail-card">
          <div className="panel-header compact">
            <h3>订单记录</h3>
            <span className="table-meta">{orders.length} 条</span>
          </div>
          <div className="member-record-list compact">
            {orders.map((order) => (
              <div key={order.orderId} className="member-record-item">
                <div>
                  <strong>{order.productName}</strong>
                  <span>
                    {formatOrderStatus(order.status)} · {formatCredits(order.credits)} 积分
                  </span>
                  <span>{formatDateTime(order.createdAt)}</span>
                </div>
                <b className={order.status === "fulfilled" ? "positive" : "negative"}>{formatMoney(order.amountRmb)}</b>
              </div>
            ))}
            {orders.length === 0 ? <div className="member-empty-inline">暂无订单记录</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function UsageBillingPage() {
  return (
    <Suspense fallback={<UsageBillingFallback />}>
      <UsageBillingPageContent />
    </Suspense>
  );
}
