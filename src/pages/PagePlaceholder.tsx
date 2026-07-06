interface PagePlaceholderProps {
  title: string;
  widgets: string[];
}

/** Shared Phase 1 stub: title + status note + static list of planned widgets. */
export function PagePlaceholder({ title, widgets }: PagePlaceholderProps) {
  return (
    <div className="page-placeholder">
      <h1>{title}</h1>
      <p className="page-note">Phase 1 — coming soon.</p>
      <section aria-label={`${title} planned widgets`}>
        <h2>Planned widgets</h2>
        <ul>
          {widgets.map((widget) => (
            <li key={widget}>{widget}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
