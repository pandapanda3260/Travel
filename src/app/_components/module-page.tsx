type ModulePageProps = {
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
};

export function ModulePage({ eyebrow, title, description, highlights }: ModulePageProps) {
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
            </div>
          </header>

          <section className="notice-bar compact">
            <strong>{eyebrow}</strong>
            <span>{description}</span>
          </section>
        </section>

        <section className="panel module-page-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h3>{title}</h3>
            </div>
          </div>

          <div className="module-page-hero">
            <div className="module-page-copy">
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
            <div className="module-page-grid">
              {highlights.map((item) => (
                <div key={item} className="module-page-card">
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
