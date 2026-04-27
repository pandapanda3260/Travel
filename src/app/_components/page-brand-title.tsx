type PageBrandTitleProps = {
  pageName: string;
};

export function PageBrandTitle({ pageName }: PageBrandTitleProps) {
  return (
    <div className="topbar-title brand-inline">
      <div className="brand-mark">AI</div>
      <div className="brand-name-row">
        <h2>{pageName}</h2>
      </div>
    </div>
  );
}
