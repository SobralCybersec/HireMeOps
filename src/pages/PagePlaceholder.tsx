interface PagePlaceholderProps {
  title: string;
  widgets: string[];
}

/** Fallback stub - real layout is in each page's own component. */
export function PagePlaceholder({ title, widgets }: PagePlaceholderProps) {
  return (
    // ponytail: `.page-placeholder` (theme.css) has no flex/overflow of its
    // own; when this stub is mounted directly under `.page-outlet`
    // (overflow: hidden), a long widget list would clip instead of
    // scrolling. Structural, not a token - safe to set inline without
    // touching theme.css.
    <div className="page-placeholder" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <h1>{title}</h1>
      <p className="page-note">Phase 1 - layout in progress.</p>
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
