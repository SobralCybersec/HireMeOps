import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  /**
   * Heading level.
   * 2 (default) — main tab-section title: Roboto Condensed UPPERCASE + accent tick.
   * 3           — sub-section within a tab: smaller, no accent tick, muted color.
   */
  level?: 2 | 3;
}

/**
 * Settings section header — accent-tick title + optional description.
 * Mirrors the terax SectionHeader recipe, but applies HireMeOps WayneTech tokens:
 *   --font-title (Roboto Condensed), uppercase, 3px accent bar ::before.
 * CSS lives in terax-theme.css → ".settings-section-header" block.
 */
export function SectionHeader({ title, description, level = 2 }: SectionHeaderProps) {
  const Tag = `h${level}` as "h2" | "h3";
  const titleCls =
    level === 3
      ? "settings-section-header__title settings-section-header__title--sub"
      : "settings-section-header__title";

  return (
    <div className="settings-section-header">
      <Tag className={titleCls}>{title}</Tag>
      {description != null && <p className="settings-section-header__desc">{description}</p>}
    </div>
  );
}
