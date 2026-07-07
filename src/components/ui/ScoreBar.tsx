import type { StatusVariant } from "./status";

interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
  /** Colours the fill via `--status-*-text`. Defaults to accent. */
  variant?: StatusVariant;
  /** Hide the numeric readout on the right. */
  hideValue?: boolean;
}

/** Labelled horizontal progress/score row. Wraps `.score-bar-row`. */
export function ScoreBar({ label, value, max = 100, variant, hideValue }: ScoreBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = variant ? `var(--status-${variant}-text)` : "var(--color-accent)";

  return (
    <div className="score-bar-row">
      <span className="score-bar-label">{label}</span>
      <div className="score-bar">
        <div
          className="score-bar__fill"
          style={{ width: `${pct}%`, background: fill }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label}
        />
      </div>
      {!hideValue && <span className="score-val">{Math.round(value)}</span>}
    </div>
  );
}
