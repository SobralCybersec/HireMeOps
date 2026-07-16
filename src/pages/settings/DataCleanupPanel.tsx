import { useState } from "react";
import { Button } from "../../components/ui";
import "./DataCleanupPanel.css";

interface CleanupItem {
  key: string;
  label: string;
  body: string;
  retention: string;
}

const ITEMS: CleanupItem[] = [
  {
    key: "ai_cache",
    label: "Clear AI cache",
    body: "Removes cached AI responses. Provider settings and API keys are not affected.",
    retention: "Manual clear",
  },
  {
    key: "old_audit_logs",
    label: "Clear old audit logs",
    body: "Removes audit log entries older than the configured retention window.",
    retention: "Default: 30 days",
  },
  {
    key: "old_evidence",
    label: "Clear old evidence",
    body: "Removes automation evidence files older than the evidence retention window.",
    retention: "Default: 1 day",
  },
  {
    key: "old_screenshots",
    label: "Clear old screenshots",
    body: "Removes screenshots captured during previous automation runs.",
    retention: "Manual clear",
  },
  {
    key: "dom_snapshots",
    label: "Clear old DOM snapshots",
    body: "Removes stored DOM snapshots from previous automation sessions.",
    retention: "Manual clear",
  },
  {
    key: "unused_artifacts",
    label: "Clear unused artifacts",
    body: "Removes application artifacts no longer referenced by any application record.",
    retention: "Manual clear",
  },
];

/**
 * Cleanup panel. Every destructive action requires an inline confirmation
 * before execution. Factory reset lives in the danger zone at the bottom.
 */
export function DataCleanupPanel() {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  function execute(key: string) {
    // ponytail: cleanup backend commands not wired yet - stub only
    console.debug("[DataCleanupPanel] stub:", key);
    setConfirmKey(null);
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gap: "var(--sp-2)",
          marginBottom: "var(--sp-6)",
        }}
      >
        {ITEMS.map((item) => (
          <div key={item.key} className="cleanup-row">
            <div className="cleanup-row__info">
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--fw-medium)",
                  color: "var(--color-text)",
                  marginBottom: "var(--sp-1)",
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                  lineHeight: 1.45,
                }}
              >
                {item.body}{" "}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-2xs)",
                    color: "var(--color-accent-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.retention}
                </span>
              </div>
            </div>

            <div className="cleanup-row__action">
              {confirmKey === item.key ? (
                <div className="cleanup-row__confirm">
                  <Button variant="danger" size="sm" onClick={() => execute(item.key)}>
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmKey(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmKey(item.key)}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <div className="danger-zone">
        <p className="danger-zone__title">Factory reset</p>
        <p className="danger-zone__body">
          Permanently wipes all profiles, jobs, applications, settings, and stored data. This cannot
          be undone.
        </p>
        {confirmKey === "factory_reset" ? (
          <div className="danger-zone__actions">
            <Button variant="danger" onClick={() => execute("factory_reset")}>
              Confirm factory reset
            </Button>
            <Button variant="ghost" onClick={() => setConfirmKey(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmKey("factory_reset")}>
            Factory reset...
          </Button>
        )}
      </div>
    </div>
  );
}
