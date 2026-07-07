import type { ReactNode } from "react";

export type KpiTone = "default" | "accent" | "danger" | "success" | "review";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Small caption under the value (e.g. "this session"). */
  meta?: ReactNode;
  tone?: KpiTone;
  className?: string;
}

/**
 * Single metric tile for the stat grid. Wrap a set of these in
 * `<div className="stat-grid">`. Uses `.stat-tile` + `.stat-tile--*`.
 */
export function KpiCard({ label, value, meta, tone = "default", className }: KpiCardProps) {
  const cls = [
    "stat-tile",
    tone !== "default" ? `stat-tile--${tone}` : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{value}</span>
      {meta != null && <span className="stat-tile__meta">{meta}</span>}
    </div>
  );
}
