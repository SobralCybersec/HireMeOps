import type { InputHTMLAttributes, ReactNode } from "react";

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  checked: boolean;
  children?: ReactNode;
}

/** Single native radio in a `.check-label`. Use inside a <RadioGroup>. */
export function Radio({ checked, className, children, ...rest }: RadioProps) {
  const cls = ["check-label", className].filter(Boolean).join(" ");
  return (
    <label className={cls}>
      <input type="radio" checked={checked} {...rest} />
      {children != null && <span>{children}</span>}
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface RadioGroupProps {
  /** Shared `name` - ties the radios into one exclusive group. */
  name: string;
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  /** Accessible group name; rendered on the radiogroup wrapper. */
  label: string;
  className?: string;
}

/** Controlled radio set. Wrapper carries `role="radiogroup"` + aria-label. */
export function RadioGroup({ name, value, options, onChange, label, className }: RadioGroupProps) {
  const cls = ["check-group", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <Radio
          key={opt.value}
          name={name}
          value={opt.value}
          checked={value === opt.value}
          disabled={opt.disabled}
          onChange={() => onChange(opt.value)}
        >
          {opt.label}
        </Radio>
      ))}
    </div>
  );
}
