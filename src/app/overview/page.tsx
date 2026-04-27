import { OverviewServiceReportPanel } from "./_components/overview-service-report-panel";
import { PageBrandTitle } from "../_components/page-brand-title";
import { buildOverviewPipelineModelMap, overviewPipelineStageGroups } from "../../lib/overview-pipeline-report";
import { buildOverviewServiceReport, type OverviewServiceReportEntry } from "../../lib/overview-service-report";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  let serviceReports: OverviewServiceReportEntry[] = [];
  let serviceReportError: string | null = null;

  try {
    serviceReports = buildOverviewServiceReport();
  } catch (error) {
    serviceReportError = error instanceof Error ? error.message : "概览服务统计加载失败";
  }

  const pipelineStages = buildOverviewPipelineModelMap();
  const groupedPipelineStages = overviewPipelineStageGroups
    .map((group) => ({
      group,
      items: pipelineStages.filter((item) => item.group === group),
    }))
    .filter((group) => group.items.length > 0);
  const totalStageCount = pipelineStages.length;
  const apiStageCount = pipelineStages.filter((item) => item.type === "调用大模型 API").length;
  const localStageCount = totalStageCount - apiStageCount;
  const readyStageCount = pipelineStages.filter((item) => item.statusTone === "success").length;
  const attentionStageCount = pipelineStages.filter((item) => item.statusTone !== "success").length;
  const warningStageCount = pipelineStages.filter((item) => item.statusTone === "warning").length;
  const dangerStageCount = pipelineStages.filter((item) => item.statusTone === "danger").length;
  const overviewHealthChips = [
    { label: `正常 ${readyStageCount} 个`, tone: "success" },
    { label: `Warning ${warningStageCount} 个`, tone: "warning" },
    { label: `Danger ${dangerStageCount} 个`, tone: "danger" },
    { label: `待关注链路 ${attentionStageCount} 个`, tone: "neutral" },
  ];
  const overviewMetrics = [
    { label: "主链路节点", value: `${totalStageCount} 个`, note: "按真实代码调用链汇总", tone: "primary" },
    { label: "模型 API 节点", value: `${apiStageCount} 个`, note: "直接走远端模型接口", tone: "info" },
    { label: "本地服务节点", value: `${localStageCount} 个`, note: "本机运行时与工具能力", tone: "neutral" },
    { label: "需关注环节", value: `${attentionStageCount} 个`, note: "兜底 / 条件触发 / 未启用", tone: "warning" },
  ];

  return (
    <main className="shell">
      <section className="content overview-page">
        <section className="header-panel overview-header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Overview" />
              <div className="topbar-actions compact">
                <button className="toolbar-button" type="button">
                  查看 API Key
                </button>
                <button className="toolbar-button" type="button">
                  使用说明
                </button>
              </div>
            </div>
          </header>

          <section className="overview-hero">
            <div className="overview-hero-copy">
              <p className="eyebrow">系统概览</p>
              <h3>模型链路与运行服务总览</h3>
              <p>
                按真实代码调用链查看从输入解析到成片输出的关键环节，再对照模型与本地服务的调用统计，快速判断当前整套生产链路是否稳定。
              </p>
              <div className="overview-inline-stats">
                {overviewHealthChips.map((item) => (
                  <span key={item.label} className={`overview-inline-stat ${item.tone}`}>
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="overview-hero-metrics">
              {overviewMetrics.map((item) => (
                <article key={item.label} className={`overview-metric-card ${item.tone}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>
          </section>
        </section>

        <div className="overview-dashboard">
          <OverviewServiceReportPanel reports={serviceReports} error={serviceReportError} />

          <section className="panel workflow-overview-panel overview-section-panel overview-main-panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">链路地图</p>
                <h3>AIGC 主链路模型地图</h3>
                <p className="overview-panel-desc">
                  按阶段查看每个关键节点的触发时机、所用模型或服务，以及当前是否处于正常运行状态。
                </p>
              </div>
              <span className="table-meta">{`${totalStageCount} 个节点`}</span>
            </div>

            <div className="overview-group-list">
              {groupedPipelineStages.map((group) => {
                const groupReadyCount = group.items.filter((item) => item.statusTone === "success").length;
                const groupAttentionCount = group.items.length - groupReadyCount;

                return (
                  <section
                    key={group.group}
                    className={`overview-group-block ${groupAttentionCount > 0 ? "attention" : "healthy"}`}
                  >
                    <div className="overview-group-header">
                      <div>
                        <p className="eyebrow">阶段分组</p>
                        <h4>{group.group}</h4>
                      </div>
                      <div className="overview-group-summary">
                        <span className="overview-group-pill">{`${group.items.length} 个节点`}</span>
                        <span className={`overview-group-pill ${groupAttentionCount > 0 ? "warning" : "success"}`}>
                          {groupAttentionCount > 0 ? `待关注 ${groupAttentionCount} 个` : "全部正常"}
                        </span>
                      </div>
                    </div>

                    <div className="overview-stage-grid">
                      {group.items.map((item) => (
                        <article key={item.id} className={`overview-stage-card ${item.statusTone}`}>
                          <div className="overview-stage-card-head">
                            <div>
                              <h5>{item.title}</h5>
                              <span className="table-meta">{item.type}</span>
                            </div>
                            <span className={`service-status-chip ${item.statusTone}`}>{item.status}</span>
                          </div>
                          <div className="overview-stage-details">
                            <div className="overview-stage-detail">
                              <span>触发时机</span>
                              <p>{item.trigger}</p>
                            </div>
                            <div className="overview-stage-detail">
                              <span>模型 / 服务</span>
                              <p>{item.modelOrService}</p>
                            </div>
                            <div className="overview-stage-detail">
                              <span>作用</span>
                              <p>{item.role}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
