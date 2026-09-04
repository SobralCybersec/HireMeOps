import React from "react";
import { renderInlineBold } from "../cv/markdown";
import type { CvEducationEntry, CvExperienceEntry } from "../../types/domain";

function EntryCard({
  title,
  subParts,
  bullets,
}: {
  title: string;
  subParts: (string | null | undefined)[];
  bullets: string[];
}) {
  const sub = subParts.filter((part) => part && part.trim()).join(" · ");
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderLeft: "2px solid var(--color-accent)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-1)",
          padding: "var(--sp-3) var(--sp-4)",
          background: "var(--color-surface-2)",
          borderBottom: bullets.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-semibold)" }}>
          {title || "—"}
        </span>
        {sub && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            {sub}
          </span>
        )}
      </div>
      {bullets.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: "var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-1)",
          }}
        >
          {bullets.map((bullet, index) => (
            <li
              key={index}
              style={{ fontSize: "var(--text-xs)", color: "var(--color-text)", lineHeight: 1.5 }}
            >
              {renderInlineBold(bullet)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function experienceCards(entries: CvExperienceEntry[]) {
  const cards: React.ReactNode[] = [];
  let index = 0;
  for (const entry of entries) {
    cards.push(
      React.createElement(EntryCard, {
        key: index,
        title: entry.title,
        subParts: [entry.organization, entry.location, entry.dates],
        bullets: entry.bullets,
      }),
    );
    index += 1;
  }
  return cards;
}

const EMPTY_EXPERIENCE_PROPS = {
  style: { margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" },
};

export function ExperienceEntries({ entries }: { entries: CvExperienceEntry[] }) {
  if (entries.length > 0) {
    return React.createElement(React.Fragment, null, ...experienceCards(entries));
  }
  return React.createElement("p", EMPTY_EXPERIENCE_PROPS, "No experience entries in this variant.");
}

function educationCards(entries: CvEducationEntry[]) {
  const cards: React.ReactNode[] = [];
  let index = 0;
  for (const entry of entries) {
    cards.push(
      React.createElement(EntryCard, {
        key: index,
        title: entry.degree,
        subParts: [entry.institution, entry.location, entry.dates],
        bullets: entry.bullets,
      }),
    );
    index += 1;
  }
  return cards;
}

const EMPTY_EDUCATION_PROPS = {
  style: { margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" },
};

export function EducationEntries({ entries }: { entries: CvEducationEntry[] }) {
  if (entries.length > 0) {
    return React.createElement(React.Fragment, null, ...educationCards(entries));
  }
  return React.createElement("p", EMPTY_EDUCATION_PROPS, "No education entries in this variant.");
}
