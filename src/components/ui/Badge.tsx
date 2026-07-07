import type { HTMLAttributes, ReactNode } from "react";
import type { StatusVariant } from "./status";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StatusVariant;
  children: ReactNode;
}

/** Compact status pill. Wraps `.badge` + `.badge--*` from theme.css. */
export function Badge({ variant = "neutral", className, children, ...rest }: BadgeProps) {
  const cls = ["badge", `badge--${variant}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
