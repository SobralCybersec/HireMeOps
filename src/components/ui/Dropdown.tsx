import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Optional heading shown at the top of the popover (like the platform hub). */
  title?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

/**
 * Themed select replacement — a trigger button + a styled popover of options
 * (matches the platform-hub popover). Native `<select>` can't style its option
 * list (the OS paints it, hence the black background), so this renders the list
 * itself. Closes on select, outside-click, or Escape.
 */
export function Dropdown({
  value,
  options,
  onChange,
  title,
  placeholder = "Select…",
  disabled,
  className,
  style,
  "aria-label": ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const cls = ["dd", className].filter(Boolean).join(" ");

  return (
    <div className={cls} ref={ref} style={style}>
      <button
        type="button"
        className={open ? "dd__trigger is-open" : "dd__trigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={current ? "dd__value" : "dd__value dd__value--placeholder"}>
          {current?.label ?? placeholder}
        </span>
        <span className="dd__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="dd__pop" role="menu">
          {title && <span className="dd__pop-title">{title}</span>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              className={o.value === value ? "dd__action is-active" : "dd__action"}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
