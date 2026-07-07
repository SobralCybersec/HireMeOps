interface PagePlaceholderProps {
  title: string;
  widgets: string[];
}

/** Fallback stub – real layout is in each page's own component. */
export function PagePlaceholder({ title, widgets }: PagePlaceholderProps) {
  return (
    <div className="page-placeholder">
      <h1>{title}</h1>
      <p className="page-note">Phase 1 — layout in progress.</p>
      <section aria-label={`${title} planned widgets`}>
        <h2>Planned widgets</h2>
        <ul>
          {widgets.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
