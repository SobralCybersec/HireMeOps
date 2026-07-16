import type { ReactNode } from "react";

export type KpiTone = "default" | "accent" | "danger" | "success" | "review";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Small caption under the value (e.g. "this session"). */
  meta?: ReactNode;
  tone?: KpiTone;
  className?: string;
  /**
   * Final value string for AT. When provided the visual value span is
   * aria-hidden (so SR never hears in-flight count-up frames) and this
   * string is announced instead via a sr-only sibling.
   *
   * Pass the raw target number as a string, not the animated display value:
   *   accessibleValue={String(submitted)}  // not String(dSubmitted)
   */
  accessibleValue?: string;
}

/**
 * Single metric tile for the stat grid. Wrap a set of these in
 * `<div className="stat-grid">`. Uses `.stat-tile` + `.stat-tile--*`.
 */
export function KpiCard({
  label,
  value,
  meta,
  tone = "default",
  className,
  accessibleValue,
}: KpiCardProps) {
  const cls = ["stat-tile", tone !== "default" ? `stat-tile--${tone}` : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value" aria-hidden={accessibleValue != null ? true : undefined}>
        {value}
      </span>
      {accessibleValue != null && <span className="sr-only">{accessibleValue}</span>}
      {meta != null && <span className="stat-tile__meta">{meta}</span>}
    </div>
  );
}
