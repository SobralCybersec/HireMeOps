import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Marks the input as invalid. Adds `aria-invalid="true"` (unless caller
   * already set it) and paints the danger border via `.field__input`'s
   * attribute selector. Pair with a `<div class="field__error">` for the
   * message so screen readers get both the state and the reason.
   */
  invalid?: boolean;
}

/**
 * Text input styled with `.field__input`. Forwards ref so callers can focus,
 * blur, or measure the underlying element (used by CvViewer's rename-in-place
 * and by ApplicationDraftModal for autofocus on open).
 *
 * Pass any native `<input>` prop through - the wrapper is intentionally thin.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, "aria-invalid": ariaInvalid, ...rest },
  ref,
) {
  const cls = ["field__input", "fx-focus-glow", className].filter(Boolean).join(" ");
  return (
    <input
      ref={ref}
      className={cls}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...rest}
    />
  );
});
