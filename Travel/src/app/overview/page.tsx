import { buildOverviewServiceReport } from "../../lib/overview-service-report";

export default function OverviewPage() {
  const serviceReports = buildOverviewServiceReport();

  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <div className="topbar-title brand-inline">
                <div className="brand-mark">AI</div>
                <div className="brand-name-row">
                  <h2>Hospitality AI Studio</h2>
                </div>
              </div>
              <div className="topbar-actions compact">
                <button className="toolbar-button" type="button">查看 API Key</button>
                <button className="toolbar-button" type="button">使用说明</button>
              </div>
            </div>
          </header>

          <section className="notice-bar task-workbench-note">
            <div className="task-workbench-note-main">
              <strong>工作台说明</strong>
              <span>当前聚焦导演模式主流程，独立工作台入口已收拢，后续按任务链路继续完善人物、模板与素材能力。</span>
            </div>
          </section>
        </section>

        <section className="panel workflow-overview-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">服务检索</p>
              <h3>本地服务与模型调用总览</h3>
            </div>
          </div>

          <div className="service-overview-stack">
            {serviceReports.map((item) => (
              <article key={item.id} className="service-overview-card">
                <div className="service-overview-head">
                  <div>
                    <p className="eyebrow">环节名称</p>
                    <h3>{item.title}</h3>
                  </div>
                  <span className="table-meta">{item.type}</span>
                </div>
                <div className="service-overview-meta">
                  <span>{`模型/服务：${item.modelOrService}`}</span>
                  <span>{`作用：${item.role}`}</span>
                  <span>{`本周调用次数：${item.thisWeekCount}`}</span>
                  <span>{`上周调用次数：${item.lastWeekCount}`}</span>
                  <span>{`昨天调用次数：${item.yesterdayCount}`}</span>
                  <span>{`消化数据量：${item.volume}`}</span>
                  <span className={`service-status-chip ${item.statusTone}`}>{`目前状态：${item.status}`}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

      </section>
    </main>
  );
}
