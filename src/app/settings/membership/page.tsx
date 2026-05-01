import { Suspense } from "react";

import { PageBrandTitle } from "../../_components/page-brand-title";
import { formatDateTime } from "../../../lib/auth-display";
import { requireUserPageSession } from "../../../lib/auth-session";
import { getCommercialCreditAccountPayload, getCommercialProductsPayload } from "../../../lib/commercial-billing-service";
import { listCommercialOrdersByUserId } from "../../../lib/commercial-order-service";
import { CommercialProductActions } from "./commercial-product-actions";

export const dynamic = "force-dynamic";

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function MembershipPageFallback() {
  return (
    <main className="shell">
      <section className="content member-center-page settings-console-page">
        <section className="panel member-empty-panel">套餐与积分加载中...</section>
      </section>
    </main>
  );
}

async function MembershipPageContent() {
  const session = await requireUserPageSession();
  const products = getCommercialProductsPayload();
  const account = getCommercialCreditAccountPayload(session.userId);
  const orders = listCommercialOrdersByUserId(session.userId, 10);
  const activeMembership = account.activeMembership;

  return (
    <main className="shell">
      <section className="content member-center-page settings-console-page">
        <section className="header-panel member-header-panel settings-console-header">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="套餐与积分" />
            </div>
          </header>
        </section>

        <section className="member-hero panel settings-console-hero membership-hero">
          <div className="member-hero-main">
            <div className="member-hero-copy-stack">
              <span className="settings-section-kicker">商业账户</span>
              <h2>{activeMembership?.planName ?? "未开通套餐"}</h2>
              <p className="member-hero-copy">
                {session.user.nickname}
                {session.user.certificationLabel ? ` · ${session.user.certificationLabel}` : ""}
              </p>
              <p className="member-hero-copy">
                {activeMembership ? `有效期至 ${formatDateTime(activeMembership.endAt)}` : "开通会员后可使用高成本生成能力"}
              </p>
            </div>
            <div className="member-pill-row">
              <span className="member-pill accent">{activeMembership ? "会员有效" : "未开通"}</span>
              <span className="member-pill">积分结算</span>
            </div>
          </div>

          <div className="member-stat-grid settings-metric-grid">
            <article className="member-stat-card">
              <span>可用积分</span>
              <strong>{formatCredits(account.balance.availableCredits)}</strong>
              <p>可用于视频等高成本生成</p>
            </article>
            <article className="member-stat-card">
              <span>冻结积分</span>
              <strong>{formatCredits(account.balance.frozenCredits)}</strong>
              <p>生成中任务占用</p>
            </article>
            <article className="member-stat-card">
              <span>累计购买</span>
              <strong>{formatCredits(account.balance.lifetimePurchasedCredits)}</strong>
              <p>会员与积分包到账总量</p>
            </article>
            <article className="member-stat-card">
              <span>累计消耗</span>
              <strong>{formatCredits(account.balance.lifetimeUsedCredits)}</strong>
              <p>成功生成后确认扣除</p>
            </article>
          </div>
        </section>

        <CommercialProductActions products={products} initialOrders={orders} />

        <section className="panel member-surface usage-detail-card">
          <div className="panel-header compact">
            <h3>商业积分流水</h3>
            <span className="table-meta">{account.transactions.length} 条</span>
          </div>
          <div className="member-record-list compact">
            {account.transactions.slice(0, 20).map((record) => (
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
            {account.transactions.length === 0 ? <div className="member-empty-inline">暂无商业积分流水</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function MembershipPage() {
  return (
    <Suspense fallback={<MembershipPageFallback />}>
      <MembershipPageContent />
    </Suspense>
  );
}
