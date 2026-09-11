import { Button } from "./ui/button";
import { SectionHeader } from "./SectionHeader";

const EXPORTS = [
  {
    key: "profiles",
    label: "Export profiles JSON",
    body: "All profile configs and CV references.",
  },
  { key: "jobs", label: "Export jobs CSV", body: "Job listings, match scores, and statuses." },
  {
    key: "applications",
    label: "Export applications CSV",
    body: "Application history, outcomes, and retry counts.",
  },
  {
    key: "audit",
    label: "Export audit CSV",
    body: "Full audit log with timestamps and event types.",
  },
] as const;

export type SettingsExportKey = (typeof EXPORTS)[number]["key"];

interface SettingsExportCardsProps {
  exportingKey: SettingsExportKey | null;
  exportError: string | null;
  onExport: (key: SettingsExportKey) => void;
}

export function SettingsExportCards({
  exportingKey,
  exportError,
  onExport,
}: SettingsExportCardsProps) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Exports"
        description="Export your data as files. Each export downloads to your default Downloads folder."
      />
      {exportError && <p className="text-[11px] text-destructive">{exportError}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EXPORTS.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-3"
          >
            <div className="text-[12.5px] font-medium">{item.label}</div>
            <div className="flex-1 text-[11px] text-muted-foreground">{item.body}</div>
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
