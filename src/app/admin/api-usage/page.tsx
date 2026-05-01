import { formatDateTime } from "../../../lib/auth-display";
import { getModelUsageAdminSnapshot } from "../../../lib/model-usage-service";
import { ApiUsageAdminControls } from "./ApiUsageAdminControls";

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

function formatStrictModeSource(source: "env" | "config" | "off") {
  switch (source) {
    case "env":
      return "环境变量";
    case "config":
      return "后台配置";
    default:
      return "未开启";
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
  const reconciliationRisk =
    snapshot.reconciliation.overview.unmatchedBills + snapshot.reconciliation.overview.mismatchBills;
  const openRiskEvents = snapshot.riskEvents.overview.openEvents;

  return (
    <div className="admin-page admin-auth-page">
      <header className="admin-page-header">
        <p className="eyebrow">Usage Billing</p>
        <div className="admin-page-header-row">
          <div>
            <h1>模型用量与成本审计</h1>
            <p className="admin-page-desc">按真实模型调用记录成本，实际扣费以商业积分账本为准，参考口径为 108 积分 = 1 元。</p>
          </div>
          <div className="admin-page-pill-row">
            <span className="admin-page-pill">{snapshot.billingConfig.billingEnabled ? "计费已开启" : "计费已关闭"}</span>
            <span className={`admin-page-pill ${snapshot.billingPolicy.strictModeEnabled ? "" : "subtle"}`}>
              严格模式 {snapshot.billingPolicy.strictModeEnabled ? "已开启" : "未开启"}
            </span>
            <span className={`admin-page-pill ${snapshot.billingPolicy.requirePricingRule ? "" : "subtle"}`}>
              定价必填 {snapshot.billingPolicy.requirePricingRule ? "是" : "否"}
            </span>
            <span className="admin-page-pill subtle">美元汇率 {snapshot.billingConfig.usdToCnyRate}</span>
            <span className="admin-page-pill subtle">规则 {enabledRules.length}</span>
          </div>
        </div>
      </header>

      <ApiUsageAdminControls initialSnapshot={snapshot} />

      <section className="admin-summary-grid">
        <article className="admin-summary-card primary">
          <span>近 30 天调用</span>
          <strong>{snapshot.overview.totalCalls}</strong>
          <p>活跃用户 {snapshot.overview.activeUsers}</p>
        </article>
        <article className="admin-summary-card success">
          <span>已计费金额</span>
          <strong>{formatCurrency(snapshot.overview.totalAmountRmb)}</strong>
          <p>参考折算 {formatPoints(snapshot.overview.totalPoints)} 积分</p>
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
        <article className="admin-summary-card danger">
          <span>跳过计费调用</span>
          <strong>{snapshot.overview.skippedCalls}</strong>
          <p>缺少定价或上下文时会产生风险</p>
        </article>
        <article className="admin-summary-card danger">
          <span>对账异常</span>
          <strong>{reconciliationRisk}</strong>
          <p>供应商账单未匹配或金额不一致</p>
        </article>
        <article className="admin-summary-card danger">
          <span>阻断事件</span>
          <strong>{openRiskEvents}</strong>
          <p>严格模式、余额或日限额触发</p>
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
            <strong>用户汇总</strong>
            <span>近 30 天</span>
          </div>
          <div className="admin-data-grid admin-data-grid-head">
            <span>用户</span>
            <span>调用</span>
            <span>风险</span>
            <span>积分</span>
          </div>
          <div className="admin-data-stack">
            {snapshot.userSummaries.map((item) => (
              <div key={item.userId} className="admin-data-grid">
                <strong>{item.userId}</strong>
                <span>{item.totalCalls}</span>
                <span>{item.unpricedCalls + item.skippedCalls}</span>
                <span>{formatPoints(item.totalPoints)}</span>
              </div>
            ))}
            {snapshot.userSummaries.length === 0 ? <div className="auth-empty-state">暂无用户用量</div> : null}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>生产风控</strong>
            <span>{formatStrictModeSource(snapshot.billingPolicy.strictModeSource)}</span>
          </div>
          <div className="admin-feed-list">
            <div className="admin-feed-row">
              <div className="admin-feed-copy">
                <strong>风险调用</strong>
                <p>
                  近 30 天待定价 {snapshot.riskOverview.unpricedCalls} 次，跳过计费{" "}
                  {snapshot.riskOverview.skippedCalls} 次。
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{snapshot.riskOverview.riskyCalls > 0 ? "需处理" : "正常"}</span>
              </div>
            </div>
            <div className="admin-feed-row">
              <div className="admin-feed-copy">
                <strong>阻断策略</strong>
                <p>
                  严格模式下，缺少用户上下文或缺少启用定价规则的模型调用会被阻止，避免生产成本无法归因；余额校验和扣费由商业积分网关处理。
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{snapshot.billingPolicy.strictModeEnabled ? "已保护" : "观察模式"}</span>
              </div>
            </div>
            <div className="admin-feed-row">
              <div className="admin-feed-copy">
                <strong>供应商对账</strong>
                <p>
                  近 30 天导入账单 {snapshot.reconciliation.overview.totalBills} 条，未匹配{" "}
                  {snapshot.reconciliation.overview.unmatchedBills} 条，金额差异{" "}
                  {snapshot.reconciliation.overview.mismatchBills} 条。
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{reconciliationRisk > 0 ? "需核对" : "正常"}</span>
              </div>
            </div>
            <div className="admin-feed-row">
              <div className="admin-feed-copy">
                <strong>阻断审计</strong>
                <p>
                  近 30 天风险事件 {snapshot.riskEvents.overview.totalEvents} 条，严重{" "}
                  {snapshot.riskEvents.overview.criticalEvents} 条，待处理 {openRiskEvents} 条。
                </p>
              </div>
              <div className="admin-feed-side">
                <span>{openRiskEvents > 0 ? "需查看" : "正常"}</span>
              </div>
            </div>
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

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>对账流水</strong>
            <span>最近 {snapshot.reconciliation.recentBills.length} 条</span>
          </div>
          <div className="admin-feed-list">
            {snapshot.reconciliation.recentBills.map((item) => (
              <div key={item.billId} className="admin-feed-row">
                <div className="admin-feed-copy">
                  <div className="admin-inline-badges">
                    <span className={`admin-status-badge ${item.status === "matched" ? "success" : "warning"}`}>
                      {item.status === "matched" ? "已匹配" : item.status === "mismatch" ? "金额差异" : "未匹配"}
                    </span>
                    <span className="admin-mini-chip">{item.provider}</span>
                  </div>
                  <strong>{item.serviceName}</strong>
                  <p>{item.mismatchReason ?? item.externalUsageId ?? item.requestId ?? "无外部单号"}</p>
                  <p>
                    金额 {formatCurrency(item.amountRmb)} · 积分 {formatPoints(item.pointsCost)}
                  </p>
                </div>
                <div className="admin-feed-side">
                  <span>{item.pricingKey ?? "未绑定规则"}</span>
                  <span>{formatDateTime(item.importedAt)}</span>
                </div>
              </div>
            ))}
            {snapshot.reconciliation.recentBills.length === 0 ? <div className="auth-empty-state">暂无供应商对账流水</div> : null}
          </div>
        </article>

        <article className="admin-subsection-card">
          <div className="admin-subsection-head">
            <strong>风险事件</strong>
            <span>最近 {snapshot.riskEvents.recentEvents.length} 条</span>
          </div>
          <div className="admin-feed-list">
            {snapshot.riskEvents.recentEvents.map((item) => (
              <div key={item.eventId} className="admin-feed-row">
                <div className="admin-feed-copy">
                  <div className="admin-inline-badges">
                    <span className={`admin-status-badge ${item.severity === "critical" ? "danger" : "warning"}`}>
                      {item.severity === "critical" ? "严重" : "提醒"}
                    </span>
                    <span className="admin-mini-chip">{item.code}</span>
                  </div>
                  <strong>{item.serviceName}</strong>
                  <p>{item.message}</p>
                  <p>
                    用户 {item.userId ?? "未知"}
                    {item.routePath ? ` · ${item.routePath}` : ""}
                  </p>
                </div>
                <div className="admin-feed-side">
                  <span>{item.pricingKey ?? "无定价 Key"}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            {snapshot.riskEvents.recentEvents.length === 0 ? <div className="auth-empty-state">暂无风险事件</div> : null}
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
