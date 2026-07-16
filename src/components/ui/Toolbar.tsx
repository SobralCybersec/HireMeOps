import type { ReactNode } from "react";

interface ToolbarProps {
  children: ReactNode;
  /** Adds the bordered/padded surface variant used at the top of full-fill pages. */
  border?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Horizontal action row. Wraps `.toolbar` (+ `.toolbar--border`). */
export function Toolbar({ children, border, className, ...rest }: ToolbarProps) {
  const cls = ["toolbar", border ? "toolbar--border" : null, className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="toolbar" {...rest}>
      {children}
    </div>
  );
}

/** Flexible gap that pushes following items to the right. */
export function ToolbarSpacer() {
  return <div className="toolbar-spacer" />;
}

/** Thin vertical rule between toolbar groups. */
export function ToolbarSep() {
  return <div className="toolbar-sep" aria-hidden="true" />;
}
