import type { ReactNode } from "react";

/**
 * Render inline `**markdown bold**` as `<strong>`. The AI marks the 1–3
 * highest-impact phrases in summaries and bullets with `**` so they pop in the
 * exported PDF (`\textbf{…}`); on screen we honour the same markers instead of
 * showing literal asterisks. Splitting on a capturing group puts the bolded
 * captures at the odd indices.
 */
export function renderInlineBold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>,
  );
}
