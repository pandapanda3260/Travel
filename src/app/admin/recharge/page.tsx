import { getCommercialProductsPayload } from "../../../lib/commercial-billing-service";
import { listCommercialCreditBalances } from "../../../lib/commercial-credit-ledger";
import { listCommercialOrders } from "../../../lib/commercial-order-service";
import { CommercialAdminOrderActions } from "./commercial-order-actions";

export const dynamic = "force-dynamic";

function formatCredits(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoney(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN").format(value)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function RechargePage() {
  const products = getCommercialProductsPayload();
  const recentOrders = listCommercialOrders(30);
  const creditBalances = listCommercialCreditBalances(20);

  return (
    <div className="admin-page admin-commercial-page">
      <header className="admin-page-header">
        <p className="eyebrow">Commercial Billing</p>
        <div className="admin-page-header-row">
          <div>
            <h1>充值与套餐</h1>
            <p className="admin-page-desc">统一管理会员套餐、积分包、视频扣费口径和订单到账状态。</p>
          </div>
          <div className="admin-page-pill-row">
            <span className="admin-page-pill">108 积分/元</span>
            <span className="admin-page-pill subtle">最低毛利 30%</span>
            <span className="admin-page-pill subtle">订单 {recentOrders.length}</span>
            <span className="admin-page-pill subtle">账户 {creditBalances.length}</span>
          </div>
        </div>
      </header>

      <section className="admin-summary-grid">
        {products.membershipPlans.map((plan) => (
          <article key={plan.code} className="admin-summary-card primary">
            <span>{plan.name}</span>
            <strong>{formatMoney(plan.priceRmb)}</strong>
            <p>
              {formatCredits(plan.monthlyCredits)} 积分/月 · 毛利 {formatPercent(plan.margin.grossMarginRate)}
            </p>
          </article>
        ))}
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>积分包</strong>
            <span>月包 / 年包</span>
          </div>
          <div className="admin-data-grid admin-data-grid-head commercial-admin-pack-grid">
            <span>产品</span>
            <span>价格</span>
            <span>积分</span>
            <span>毛利</span>
          </div>
          <div className="admin-data-stack">
            {products.creditPackages.map((item) => (
              <div key={item.code} className="admin-data-grid commercial-admin-pack-grid">
                <strong>{item.name}</strong>
                <span>{formatMoney(item.priceRmb)}</span>
                <span>{formatCredits(item.credits)}</span>
                <span>{formatPercent(item.margin.grossMarginRate)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>视频扣费</strong>
            <span>成功后扣费</span>
          </div>
          <div className="admin-data-grid admin-data-grid-head commercial-admin-pack-grid">
            <span>功能</span>
            <span>积分</span>
            <span>成本</span>
            <span>毛利</span>
          </div>
          <div className="admin-data-stack">
            {products.videoPricing.map((item) => (
              <div key={item.code} className="admin-data-grid commercial-admin-pack-grid">
                <strong>{item.name}</strong>
                <span>{formatCredits(item.chargedCredits)}</span>
                <span>{formatMoney(item.estimatedApiCostRmb)}</span>
                <span>{formatPercent(item.margin.grossMarginRate)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="admin-subsection-card">
        <div className="admin-subsection-head">
          <strong>最近订单</strong>
          <span>最近 30 条</span>
        </div>
        <div className="admin-data-grid admin-data-grid-head commercial-admin-order-grid">
          <span>用户</span>
          <span>产品</span>
          <span>金额</span>
          <span>积分</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        <CommercialAdminOrderActions initialOrders={recentOrders} />
      </section>

      <section className="admin-subsection-card">
        <div className="admin-subsection-head">
          <strong>用户商业余额</strong>
          <span>可用积分倒序</span>
        </div>
        <div className="admin-data-grid admin-data-grid-head commercial-admin-balance-grid">
          <span>用户</span>
          <span>可用</span>
          <span>冻结</span>
          <span>累计购买</span>
          <span>累计消耗</span>
        </div>
        <div className="admin-data-stack">
          {creditBalances.map((balance) => (
            <div key={balance.userId} className="admin-data-grid commercial-admin-balance-grid">
              <strong>{balance.userId}</strong>
              <span>{formatCredits(balance.availableCredits)}</span>
              <span>{formatCredits(balance.frozenCredits)}</span>
              <span>{formatCredits(balance.lifetimePurchasedCredits)}</span>
              <span>{formatCredits(balance.lifetimeUsedCredits)}</span>
            </div>
          ))}
          {creditBalances.length === 0 ? <div className="auth-empty-state">暂无商业积分账户</div> : null}
        </div>
      </section>
    </div>
  );
}
