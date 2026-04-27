import { PageBrandTitle } from "../_components/page-brand-title";

export default function SettingsLoading() {
  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Settings" />
            </div>
          </header>
        </section>

        <section className="panel product-archive-panel">
          <div className="product-archive-empty">
            <div>
              <strong>设置页面加载中...</strong>
              <div className="table-meta" style={{ marginTop: 8 }}>
                正在进入系统设置并同步当前账号的数据。
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
