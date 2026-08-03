/**
 * PreviewViewer — the preview pane with two tabs:
 *   • Live Automation — the CDP screencast of the running automation session (BrowserPreview).
 *   • Browser         — an interactive embedded browser (EmbeddedBrowser).
 *
 * Each tab mounts lazily (and unmounts on switch), so the automation screencast only attaches while
 * it's shown and the embedded Chromium only launches when the Browser tab is opened.
 */
import { useState } from "react";
import BrowserPreview from "./BrowserPreview";
import EmbeddedBrowser from "./EmbeddedBrowser";

type Tab = "automation" | "browser";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
        (active
          ? "bg-hover text-fg shadow-[inset_0_-2px_0_0_var(--color-accent)]"
          : "text-fg-muted hover:bg-hover hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

export function PreviewViewer({
  automationActive,
  className,
}: {
  automationActive: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>(automationActive ? "automation" : "browser");

  return (
    <div
      className={
        "flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-bd/60 bg-surf " +
        (className ?? "")
      }
      style={{ height: 480 }}
    >
      <div
        className="flex min-h-9 shrink-0 items-center gap-1 border-b border-bd/60 bg-surf-2/50 px-1.5 py-1"
        role="tablist"
        aria-label="Preview"
      >
        <TabButton active={tab === "automation"} onClick={() => setTab("automation")}>
          Live Automation
        </TabButton>
        <TabButton active={tab === "browser"} onClick={() => setTab("browser")}>
          Browser
        </TabButton>
      </div>

      <div className="min-h-0 flex-1">
        {/* Always mount BrowserPreview on the automation tab — it attaches to the driver's
            current_session (set by EVERY automation now, not just LinkedIn apply) and shows its own
            connecting/live/idle state. Gating it behind `automationActive` meant non-LinkedIn runs
            (auto-connect, InfoJobs/Catho, searches, fills) never attached and read "no automation
            running" even while live. `automationActive` now only chooses the DEFAULT tab. */}
        {tab === "automation" ? (
          <BrowserPreview className="block h-full w-full" />
        ) : (
          <EmbeddedBrowser />
        )}
      </div>
    </div>
  );
}

export default PreviewViewer;
