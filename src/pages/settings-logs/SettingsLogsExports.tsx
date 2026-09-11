import { Button } from "../../components/ui";
import { SectionHeader } from "../settings/SectionHeader";

const EXPORTS = [
  {
    key: "profiles",
    label: "Export profiles JSON",
    body: "All profile configs and CV references",
  },
  {
    key: "jobs",
    label: "Export jobs CSV",
    body: "Job listings, match scores, and statuses",
  },
  {
    key: "applications",
    label: "Export applications CSV",
    body: "Application history, outcomes, and retry counts",
  },
  {
    key: "audit",
    label: "Export audit CSV",
    body: "Full audit log with timestamps and event types",
  },
] as const;

export type ExportKey = (typeof EXPORTS)[number]["key"];

interface SettingsLogsExportsProps {
  exportingKey: ExportKey | null;
  exportError: string | null;
  onExport: (key: ExportKey) => void;
}

export function SettingsLogsExports({
  exportingKey,
  exportError,
  onExport,
}: SettingsLogsExportsProps) {
  return (
    <div className="section-group">
      <SectionHeader
        title="Exports"
        description="Export your data as files. Each export downloads to your default Downloads folder."
      />

      {exportError && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-danger)",
          }}
        >
          {exportError}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "var(--sp-3)",
        }}
      >
        {EXPORTS.map((item) => (
          <div
            key={item.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)",
              padding: "var(--sp-3) var(--sp-4)",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: "var(--fw-medium)",
                color: "var(--color-text)",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                flex: 1,
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              {item.body}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={exportingKey !== null}
              onClick={() => onExport(item.key)}
            >
              {exportingKey === item.key ? "Exporting..." : "Export"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
