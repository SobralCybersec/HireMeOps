import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Marks the textarea as invalid - see <Input>. Paints the danger border.
   */
  invalid?: boolean;
}

/**
 * Multiline text input styled with `.field__textarea`.
 * Monospace by default (matches the cockpit's log-style copy in cover
 * letters and prompt overrides). Vertical resize is on; horizontal is
 * locked to avoid layout blow-outs in narrow drawers.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, "aria-invalid": ariaInvalid, ...rest },
  ref,
) {
  const cls = ["field__textarea", className].filter(Boolean).join(" ");
  return (
    <textarea
      ref={ref}
      className={cls}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...rest}
    />
  );
});
