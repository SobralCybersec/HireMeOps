import {
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type HTMLAttributes,
} from "react";

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Visible label above the control. Passed through to a `<label htmlFor>`. */
  label?: ReactNode;
  /**
   * Explicit id for the labelled control. If omitted, a fresh useId() is
   * generated and auto-applied to the FIRST child element that has no `id`
   * of its own (Input / Textarea / Select / RadioGroup / Switch). This keeps
   * label→control association clickable and AT-visible without callers
   * remembering to plumb `htmlFor` every time.
   */
  htmlFor?: string;
  /** Muted helper copy - advisory, non-blocking. */
  helper?: ReactNode;
  /**
   * Error copy - when set, hides the helper, paints control border red
   * and sets `aria-invalid` on the wired child. Mirrors the visual pattern
   * from Radix / shadcn Field but stays framework-free.
   */
  error?: ReactNode;
  /** Marks the label with an asterisk. Purely visual - set `required` on the child too. */
  required?: boolean;
  /** Span multiple grid columns when placed inside `.form-row`. */
  span?: 2 | "full";
  children: ReactNode;
}

/**
 * Labelled form column. Wraps children in `.field`, renders the label,
 * and appends either a helper line or an error line below.
 *
 * Usage:
 *   <Field label="Email" helper="Used for offer replies">
 *     <Input type="email" value={email} onChange={...} />
 *   </Field>
 *
 * The `htmlFor` / control-id wiring is automatic - no need to plumb ids
 * through every call site. If you *do* pass `htmlFor`, it wins and no
 * mutation of children is attempted.
 */
export function Field(props: FieldProps) {
  const { label, htmlFor, helper, error, required, span, className, children, ...rest } = props;
  const autoId = useId();
  const controlId = htmlFor ?? autoId;
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const wiredChildren = wireFieldChildren(children, {
    controlId,
    error,
    errorId,
    helper,
    helperId,
  });

  const spanCls = span === "full" ? "field--span-full" : span === 2 ? "field--span-2" : null;
  const cls = ["field", spanCls, className].filter(Boolean).join(" ");

  return (
    <div className={cls} {...rest}>
      {label != null && (
        <label
          htmlFor={controlId}
          className={"field__label" + (required ? " field__label--required" : "")}
        >
          {label}
        </label>
      )}
      {wiredChildren}
      {error != null ? (
        <div id={errorId} className="field__error" role="alert">
          {error}
        </div>
      ) : helper != null ? (
        <div id={helperId} className="field__helper">
          {helper}
        </div>
      ) : null}
    </div>
  );
}

function fieldControlType(child: ReactElement) {
  const type = child.type;
  return typeof type === "string" ? ["input", "select", "textarea", "button"].includes(type) : true;
}

function wireFieldChild(
  child: ReactNode,
  context: {
    controlId: string;
    error: ReactNode;
    errorId: string;
    helper: ReactNode;
    helperId: string;
  },
) {
  if (!isValidElement(child) || !fieldControlType(child as ReactElement))
    return { child, wired: false };
  const props = (child as ReactElement<Record<string, unknown>>).props;
  const nextProps: Record<string, unknown> = {};
  if (!props.id) nextProps.id = context.controlId;
  if (context.error != null && props["aria-invalid"] === undefined)
    nextProps["aria-invalid"] = true;
  const describedBy = [
    props["aria-describedby"] as string | undefined,
    context.error != null ? context.errorId : context.helper != null ? context.helperId : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (describedBy) nextProps["aria-describedby"] = describedBy;
  return { child: cloneElement(child, nextProps), wired: true };
}

function wireFieldChildren(
  children: ReactNode,
  context: {
    controlId: string;
    error: ReactNode;
    errorId: string;
    helper: ReactNode;
    helperId: string;
  },
) {
  let wired = false;
  return Children.map(children, (child) => {
    if (wired) return child;
    const result = wireFieldChild(child, context);
    wired ||= result.wired;
    return result.child;
  });
}

interface FormRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Column count. Default 2; also has 3 and 4. */
  cols?: 2 | 3 | 4;
  children: ReactNode;
}

/**
 * Grid row for pairs (or triples/quads) of side-by-side <Field>s. Collapses
 * to a single column below 720px - see `.form-row` in theme.css.
 */
export function FormRow({ cols = 2, className, children, ...rest }: FormRowProps) {
  const cls = [
    "form-row",
    cols === 3 ? "form-row--3" : null,
    cols === 4 ? "form-row--4" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
