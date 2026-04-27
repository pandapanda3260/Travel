import type { OverviewServiceReportEntry } from "../../../lib/overview-service-report";

type OverviewServiceReportPanelProps = {
  reports: OverviewServiceReportEntry[];
  error?: string | null;
};

export function OverviewServiceReportPanel({ reports, error = null }: OverviewServiceReportPanelProps) {
  const groupedServiceReports = [
    {
      group: "调用大模型 API",
      description: "远端模型与云端能力",
      items: reports.filter((item) => item.type === "调用大模型 API"),
    },
    {
      group: "本地服务",
      description: "本机运行时与工具链",
      items: reports.filter((item) => item.type === "本地服务"),
    },
  ].filter((group) => group.items.length > 0);

  const apiServiceCount = reports.filter((item) => item.type === "调用大模型 API").length;
  const localServiceCount = reports.length - apiServiceCount;
  const readyServiceCount = reports.filter((item) => item.statusTone === "success").length;
  const hasReports = reports.length > 0;

  return (
    <section className="panel workflow-overview-panel overview-section-panel overview-side-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">调用统计</p>
          <h3>模型与服务运行总览</h3>
          <p className="overview-panel-desc">
            聚合展示远端模型和本地服务的最近调用情况，方便快速判断资源使用强度和运行健康度。
          </p>
        </div>
        <span className="table-meta">{hasReports ? `${reports.length} 项服务` : error ? "加载失败" : "暂无数据"}</span>
      </div>

      <div className="overview-service-summary overview-service-summary-row">
        <article className="overview-service-summary-card primary">
          <span>服务与模型</span>
          <strong>{hasReports ? `${reports.length} 项` : "—"}</strong>
        </article>
        <article className="overview-service-summary-card info">
          <span>API 服务</span>
          <strong>{hasReports ? `${apiServiceCount} 项` : "—"}</strong>
        </article>
        <article className="overview-service-summary-card neutral">
          <span>本地服务</span>
          <strong>{hasReports ? `${localServiceCount} 项` : "—"}</strong>
        </article>
        <article className="overview-service-summary-card success">
          <span>状态正常</span>
          <strong>{hasReports ? `${readyServiceCount} 项` : "—"}</strong>
        </article>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {!hasReports ? (
        <div className="voice-empty-state">{error ? "服务统计暂时不可用" : "暂无服务统计"}</div>
      ) : (
        <div className="overview-service-group-list">
          {groupedServiceReports.map((group) => (
            <section
              key={group.group}
              className={`overview-service-group ${group.group === "调用大模型 API" ? "is-api" : "is-local"}`}
            >
              <div className="overview-service-group-head">
                <div>
                  <p className="eyebrow">服务分组</p>
                  <h4>{group.group}</h4>
                </div>
                <span className="table-meta">{`${group.items.length} 项`}</span>
              </div>
              <p className="overview-service-group-note">{group.description}</p>
              <div className="overview-service-list">
                {group.items.map((item) => (
                  <article key={item.id} className="service-overview-card overview-service-card">
                    <div className="service-overview-head">
                      <div>
                        <p className="eyebrow">环节名称</p>
                        <h3>{item.title}</h3>
                      </div>
                      <span className={`service-status-chip ${item.statusTone}`}>{item.status}</span>
                    </div>
                    <div className="overview-service-main">
                      <div className="overview-service-line">
                        <span>类型</span>
                        <p>{item.type}</p>
                      </div>
                      <div className="overview-service-line">
                        <span>模型 / 服务</span>
                        <p>{item.modelOrService}</p>
                      </div>
                      <div className="overview-service-line">
                        <span>作用</span>
                        <p>{item.role}</p>
                      </div>
                    </div>
                    {group.group === "调用大模型 API" ? (
                      <div className="overview-service-stats-text">
                        <div className="overview-service-stat-line">
                          <span>本周</span>
                          <strong>{item.thisWeekCount}</strong>
                        </div>
                        <div className="overview-service-stat-line">
                          <span>上周</span>
                          <strong>{item.lastWeekCount}</strong>
                        </div>
                        <div className="overview-service-stat-line">
                          <span>昨天</span>
                          <strong>{item.yesterdayCount}</strong>
                        </div>
                        <div className="overview-service-stat-line">
                          <span>数据量</span>
                          <strong>{item.volume}</strong>
                        </div>
                      </div>
                    ) : (
                      <div className="overview-service-stats">
                        <div className="overview-service-stat">
                          <span>本周</span>
                          <strong>{item.thisWeekCount}</strong>
                        </div>
                        <div className="overview-service-stat">
                          <span>上周</span>
                          <strong>{item.lastWeekCount}</strong>
                        </div>
                        <div className="overview-service-stat">
                          <span>昨天</span>
                          <strong>{item.yesterdayCount}</strong>
                        </div>
                        <div className="overview-service-stat">
                          <span>数据量</span>
                          <strong>{item.volume}</strong>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
