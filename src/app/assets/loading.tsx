import { PageBrandTitle } from "../_components/page-brand-title";

export default function AssetsLoading() {
  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName="Assets" />
            </div>
          </header>
        </section>

        <section className="panel product-archive-panel">
          <div className="product-archive-empty">
            <div>
              <strong>页面加载中...</strong>
              <div className="table-meta" style={{ marginTop: 8 }}>
                正在进入素材管理页面并加载当前账号的数据。
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
