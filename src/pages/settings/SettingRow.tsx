import type { ReactNode } from "react";

interface SettingRowProps {
  title: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Label-left / control-right card.
 * Mirrors the terax SettingRow recipe, using HireMeOps tokens:
 *   border → --color-border-subtle, bg → --color-surface-2,
 *   radius → --radius-sm (2px, WayneTech sharp corners).
 * CSS lives in terax-theme.css → ".settings-row" block.
 */
export function SettingRow({ title, description, children, className }: SettingRowProps) {
  return (
    <div className={["settings-row", className].filter(Boolean).join(" ")}>
      <div className="settings-row__label">
        <span className="settings-row__title">{title}</span>
        {description != null && <span className="settings-row__desc">{description}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}
