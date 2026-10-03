/** Shared presentation primitives. Data and actions stay with each page. */
export function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return <header className={`page-heading lola-page-heading ${className}`}>
    <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="lede">{description}</p>}</div>
    {actions && <div className="detail-actions">{actions}</div>}
  </header>;
}

export function TabNavigation({ items, value, onChange, label = "Record sections", className = "" }) {
  return <nav className={`tabs workspace-tabs ${className}`} aria-label={label}>
    {items.map(item => {
      const key = typeof item === "string" ? item : item.value;
      const text = typeof item === "string" ? item : item.label;
      return <button type="button" key={key} className={value === key ? "active" : ""} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>;
    })}
  </nav>;
}

export function MetricCard({ label, value }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

export function DetailSection({ title, children }) {
  return <section className="panel detail-section"><h2>{title}</h2>{children}</section>;
}
