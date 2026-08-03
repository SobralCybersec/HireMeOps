import type { ButtonHTMLAttributes, ReactNode } from "react";

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional visible label; when omitted, supply `aria-label` via ...rest. */
  children?: ReactNode;
}

/**
 * Toggle switch built on a <button role="switch">. `aria-checked` carries the
 * state; the sliding knob is CSS-only (`.switch__track` / `.switch__thumb`).
 * Space/Enter fire the native button click, so no extra key handling needed.
 */
export function Switch({ checked, onChange, className, children, disabled, ...rest }: SwitchProps) {
  const cls = ["switch", className].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cls}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      {children != null && <span className="switch__label">{children}</span>}
    </button>
  );
}
