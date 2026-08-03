import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  checked: boolean;
  /** Tri-state visual; sets the DOM `indeterminate` flag (not reflected in HTML). */
  indeterminate?: boolean;
  /** Text/nodes rendered beside the box. Whole label is clickable. */
  children?: ReactNode;
}

/**
 * Native checkbox in a `.check-label`. `indeterminate` is a DOM-only property,
 * so it's applied via ref after render.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  className,
  children,
  id,
  ...rest
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const cls = ["check-label", className].filter(Boolean).join(" ");
  const input = <input ref={ref} type="checkbox" id={id} checked={checked} {...rest} />;
  const text = children != null && <span>{children}</span>;

  // When an external `id` is supplied - e.g. auto-injected by <Field>, which
  // also renders its own <label htmlFor={id}> - our own wrapping <label> would
  // create a SECOND label for the same input. That double-labels the control
  // (WCAG 1.3.1 / 4.1.2) and, because the input sits inside our <label>, a
  // click forwarded from the outer label can bubble back and re-toggle in some
  // engines. In that case fall back to a non-labelling <span> and let the
  // outer <label htmlFor> own the association.
  if (id != null) {
    return (
      <span className={cls}>
        {input}
        {text}
      </span>
    );
  }

  // Bare usage (no external id): the whole label is the clickable target.
  return (
    <label className={cls}>
      {input}
      {text}
    </label>
  );
}
