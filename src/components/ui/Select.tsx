import type { SelectHTMLAttributes, ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  /** Controlled value. */
  value: string;
  /** Options render as <option>. Pass `children` instead for optgroups. */
  options?: SelectOption[];
  /** Optional placeholder shown as a disabled first row when value is "". */
  placeholder?: string;
  children?: ReactNode;
}

/** Native <select> styled with `.field__select`. Controlled via value/onChange. */
export function Select({ value, options, placeholder, className, children, ...rest }: SelectProps) {
  const cls = ["field__select", className].filter(Boolean).join(" ");

  return (
    <select value={value} className={cls} {...rest}>
      {placeholder != null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options?.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
      {children}
    </select>
  );
}
