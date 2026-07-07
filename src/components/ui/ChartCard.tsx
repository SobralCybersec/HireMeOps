import type { ReactNode } from "react";
import { Card } from "./Card";

interface ChartCardProps {
  title?: ReactNode;
  actions?: ReactNode;
  /** Chart content (svg/canvas). When absent, a placeholder caption shows. */
  children?: ReactNode;
  /** Minimum canvas height in px. Default 160 (from `.chart-card__canvas`). */
  minHeight?: number;
  /** Caption shown when there is no chart yet. */
  placeholder?: string;
  className?: string;
}

/**
 * Titled container for a chart/visualisation. Keeps a stable min-height so
 * dashboards don't reflow while data loads. Bring your own renderer as
 * children; charts are intentionally dependency-free at the foundation layer.
 */
export function ChartCard({
  title,
  actions,
  children,
  minHeight,
  placeholder = "No data",
  className,
}: ChartCardProps) {
  return (
    <Card title={title} actions={actions} className={className}>
      <div className="chart-card__canvas" style={minHeight ? { minHeight } : undefined}>
        {children ?? placeholder}
      </div>
    </Card>
  );
}
