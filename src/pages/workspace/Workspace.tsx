import { useEffect, useRef, useState } from "react";
import { Profiles } from "./Profiles";
import { ProfileVariants } from "./ProfileVariants";
import "./Workspace.css";

type Tab = "profiles" | "variants";
const TABS: { key: Tab; label: string }[] = [
  { key: "profiles", label: "Profiles" },
  { key: "variants", label: "Variants" },
];

/**
 * Profiles workspace — the merged Profiles + Variants surface. One page, two
 * animated tabs: a sliding accent "ink" that measures the active tab, and a
 * cross-fade between the two full-featured panels (both stay mounted so each
 * keeps its own state when you flip between them).
 */
export function Workspace() {
  const [tab, setTab] = useState<Tab>("profiles");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  // Measure the active tab so the ink underline slides to its exact position/width
  // (tabs are different widths, so a fixed-width slide wouldn't line up).
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  return (
    <div className="ws">
      <div className="ws-tabs" role="tablist" aria-label="Profiles workspace" ref={tabsRef}>
        {TABS.map((t) => (
          <button
            key={t.key}
            data-tab={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "ws-tab is-active" : "ws-tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <span
          className="ws-tabs__ink"
          style={{ transform: `translateX(${ink.left}px)`, width: ink.width }}
        />
      </div>

      <div className="ws-stage">
        <div
          className={tab === "profiles" ? "ws-panel is-active" : "ws-panel"}
          aria-hidden={tab !== "profiles"}
        >
          <Profiles />
        </div>
        <div
          className={tab === "variants" ? "ws-panel is-active" : "ws-panel"}
          aria-hidden={tab !== "variants"}
        >
          <ProfileVariants />
        </div>
      </div>
    </div>
  );
}
