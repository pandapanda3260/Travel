import { formatDateTime } from "../../../lib/auth-display";
import { getModelUsageAdminSnapshot } from "../../../lib/model-usage-service";

export const dynamic = "force-dynamic";

function formatCurrency(value: number) {
  return `¥${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPricingSource(source: string | null) {
  switch (source) {
    case "official":
      return "官方";
    case "official_archived":
      return "官方历史刊例";
    case "official_product":
      return "官方产品页";
    case "manual":
      return "人工维护";
    case "inferred":
      return "推断值";
    default:
      return "未配置";
  }
}

function getStatusTone(status: "charged" | "unpriced" | "skipped") {
  switch (status) {
    case "charged":
      return "success";
    case "unpriced":
      return "warning";
    default:
      return "neutral";
  }
}

function getStatusLabel(status: "charged" | "unpriced" | "skipped") {
  switch (status) {
    case "charged":
      return "已扣费";
    case "unpriced":
      return "待定价";
    default:
      return "跳过";
  }
}

export default function ApiUsagePage() {
  const snapshot = getModelUsageAdminSnapshot();
  const enabledRules = snapshot.pricingRules.filter((item) => item.enabled);
  const inferredRules = snapshot.pricingRules.filter((item) => item.source === "inferred");

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">Usage Billing</p>
        <div className="admin-page-header-row">
          <div>
            <h1>模型用量与积分扣费</h1>
            <p className="admin-page-desc">按真实模型调用用量记账，按金额比例折算积分，当前规则为 100 积分 = 1 元。</p>
          </div>
          <div className="admin-page-pill-row">
            <span className="admin-page-pill">
              {snapshot.billingConfig.billingEnabled ? "计费已开启" : "计费已关闭"}
            </span>
            <span className="admin-page-pill subtle">美元汇率 {snapshot.billingConfig.usdToCnyRate}</span>
            <span className="admin-page-pill subtle">规则 {enabledRules.length}</span>
          </div>
        </div>
      </header>

      <section className="admin-summary-grid">
        <article className="admin-summary-card primary">
          <span>近 30 天调用</span>
          <strong>{snapshot.overview.totalCalls}</strong>
          <p>活跃用户 {snapshot.overview.activeUsers}</p>
        </article>
        <article className="admin-summary-card success">
          <span>已计费金额</span>
          <strong>{formatCurrency(snapshot.overview.totalAmountRmb)}</strong>
          <p>累计扣减 {formatPoints(snapshot.overview.totalPoints)} 积分</p>
        </article>
        <article className="admin-summary-card info">
          <span>已扣费调用</span>
          <strong>{snapshot.overview.chargedCalls}</strong>
          <p>命中定价规则并完成扣分</p>
        </article>
        <article className="admin-summary-card danger">
          <span>待定价调用</span>
          <strong>{snapshot.overview.unpricedCalls}</strong>
          <p>需要补充官方价格或人工刊例</p>
        </article>
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>服务汇总</strong>
            <span>最近 50 条</span>
          </div>
          <div className="admin-data-grid admin-data-grid-head">
            <span>服务</span>
            <span>调用</span>
            <span>金额</span>
            <span>积分</span>
          </div>
          <div className="admin-data-stack">
            {snapshot.recentByService.map((item) => (
              <div key={item.serviceName} className="admin-data-grid">
                <strong>{item.serviceName}</strong>
                <span>{item.calls}</span>
                <span>{formatCurrency(item.amountRmb)}</span>
                <span>{formatPoints(item.pointsCost)}</span>
              </div>
            ))}
            {snapshot.recentByService.length === 0 ? <div className="auth-empty-state">暂无用量记录</div> : null}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>定价规则</strong>
            <span>
              推断值 {inferredRules.length} / 总计 {snapshot.pricingRules.length}
            </span>
          </div>
          <div className="admin-feed-list">
            {snapshot.pricingRules.map((item) => (
              <div key={item.pricingKey} className="admin-feed-row">
                <div className="admin-feed-copy">
                  <div className="admin-inline-badges">
                    <span className={`admin-status-badge ${item.enabled ? "success" : "neutral"}`}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                    <span className={`admin-status-badge ${item.source === "inferred" ? "warning" : "info"}`}>
                      {formatPricingSource(item.source)}
                    </span>
                  </div>
                  <strong>{item.label}</strong>
                  <p>{item.pricingKey}</p>
                  <p>{item.notes}</p>
                </div>
                <div className="admin-feed-side">
                  <span>{item.serviceName}</span>
                  <span>{item.modelId ?? "未绑定模型 ID"}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel admin-overview-panel">
        <div className="panel-header compact">
          <div>
            <h3>最近用量流水</h3>
            <p className="admin-panel-desc">待定价的调用会保留流水，但不会扣分，方便后续补充官方价格后追平规则。</p>
          </div>
        </div>
        <div className="admin-feed-list">
          {snapshot.recentUsage.map((item) => (
            <div key={item.usageId} className="admin-feed-row">
              <div className="admin-feed-copy">
                <div className="admin-inline-badges">
                  <span className={`admin-status-badge ${getStatusTone(item.status)}`}>
                    {getStatusLabel(item.status)}
                  </span>
                  <span className="admin-mini-chip">{item.serviceName}</span>
                </div>
                <strong>{item.pricingSnapshot.label ?? item.modelId ?? item.pricingKey ?? "未命名模型"}</strong>
                <p>
                  用户 {item.userId}
                  {item.objectId ? ` · 对象 ${item.objectId}` : ""}
                  {item.routePath ? ` · ${item.routePath}` : ""}
                </p>
                <p>
                  金额 {formatCurrency(item.amountRmb)} · 扣减 {formatPoints(item.pointsCost)} 积分
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{formatPricingSource(item.pricingSource)}</span>
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
            </div>
          ))}
          {snapshot.recentUsage.length === 0 ? <div className="auth-empty-state">暂无模型调用流水</div> : null}
        </div>
      </section>
    </div>
  );
}
