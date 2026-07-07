import type { StatusVariant } from "./status";

interface StatusDotProps {
  variant: StatusVariant;
  /** Diameter in px. Default 8. */
  size?: number;
  title?: string;
  className?: string;
}

/**
 * Small coloured status dot. `.dot--running` blinks unless reduced-effects
 * is active (both handled in theme.css). Decorative by default — pass a
 * `title` only when it carries meaning not present in adjacent text.
 */
export function StatusDot({ variant, size = 8, title, className }: StatusDotProps) {
  const cls = ["status-dot", `dot--${variant}`, className].filter(Boolean).join(" ");
  return (
    <span
      className={cls}
      style={{ width: size, height: size }}
      title={title}
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      aria-label={title}
    />
  );
}
