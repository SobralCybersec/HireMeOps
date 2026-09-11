import type { ReactNode } from "react";

// Also accept legacy TeX groups and JSON-decoded TAB/BACKSPACE command prefixes.
export function renderInlineBold(text: string): ReactNode[] {
  text = text.split("\textbf").join("\\textbf").split("\bf").join("\\bf");
  const markers = /\*\*|\\(?:textbf|bfseries|bf)\s*\{|\{\s*\\bf(?:series)?\s+/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (let marker = markers.exec(text); marker; marker = markers.exec(text)) {
    const contentStart = markers.lastIndex;
    const end = boldEnd(text, marker.index, marker[0]);
    if (end === null) continue;
    nodes.push(<span key={`plain-${cursor}`}>{text.slice(cursor, marker.index)}</span>);
    nodes.push(
      <strong className="font-bold" key={`bold-${marker.index}`}>
        {text.slice(contentStart, end.contentEnd)}
      </strong>,
    );
    cursor = end.after;
    markers.lastIndex = cursor;
  }
  nodes.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return nodes;
}

function boldEnd(text: string, start: number, marker: string) {
  if (marker === "**") {
    const end = text.indexOf("**", start + 2);
    return end < 0 ? null : { contentEnd: end, after: end + 2 };
  }
  const open = marker.startsWith("{") ? start : start + marker.length - 1;
  const end = matchingBrace(text, open);
  return end === null ? null : { contentEnd: end, after: end + 1 };
}

function matchingBrace(text: string, open: number): number | null {
  let depth = 0;
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (text[i] === "\\") {
      escaped = true;
      continue;
    }
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}
