import type { ReactNode } from "react";

interface CardProps {
  /** Header title (rendered uppercase/mono via `.card__title`). Omit for a headerless card. */
  title?: ReactNode;
  /** Right-aligned header slot (badges, buttons). */
  actions?: ReactNode;
  children: ReactNode;
  /** `compact` removes body padding and lets the body scroll (lists, tables). */
  compact?: boolean;
  className?: string;
  bodyClassName?: string;
}

/** Panel with an optional titled header. Wraps `.card` family in theme.css. */
export function Card({ title, actions, children, compact, className, bodyClassName }: CardProps) {
  const cardCls = ["card", className].filter(Boolean).join(" ");
  const bodyCls = ["card__body", compact ? "card__body--compact" : null, bodyClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardCls}>
      {(title != null || actions != null) && (
        <div className="card__header">
          {title != null ? <h2 className="card__title">{title}</h2> : <span />}
          {actions}
        </div>
      )}
      <div className={bodyCls}>{children}</div>
    </div>
  );
}
