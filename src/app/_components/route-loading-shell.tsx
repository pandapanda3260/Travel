import { PageBrandTitle } from "./page-brand-title";

type RouteLoadingShellProps = {
  pageName: string;
  title: string;
  description: string;
};

export function RouteLoadingShell({ pageName, title, description }: RouteLoadingShellProps) {
  return (
    <main className="shell">
      <section className="content">
        <section className="header-panel">
          <header className="topbar">
            <div className="topbar-main compact">
              <PageBrandTitle pageName={pageName} />
            </div>
          </header>
        </section>

        <section className="panel product-archive-panel">
          <div className="product-archive-empty">
            <div>
              <strong>{title}</strong>
              <div className="table-meta" style={{ marginTop: 8 }}>
                {description}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
