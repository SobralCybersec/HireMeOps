import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, EmptyState } from "../../components/ui";
import { useBackupStore } from "../../stores/useBackupStore";
import "./BackupRestorePanel.css";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Backup management panel - wired to create_backup / list_backups /
 * restore_backup via useBackupStore.
 *
 * File-dialog: reuses @tauri-apps/plugin-dialog `open` (same package + same
 * `typeof selected !== "string"` guard as CvLibrary.tsx).
 */
export function BackupRestorePanel() {
  const backups = useBackupStore((s) => s.backups);
  const isLoading = useBackupStore((s) => s.isLoading);
  const error = useBackupStore((s) => s.error);
  const listBackups = useBackupStore((s) => s.listBackups);
  const createBackup = useBackupStore((s) => s.createBackup);
  const restoreBackup = useBackupStore((s) => s.restoreBackup);

  useEffect(() => {
    void listBackups();
  }, [listBackups]);

  async function handleRestore() {
    // Same open() pattern as CvLibrary.tsx - `typeof !== "string"` handles
    // both null (cancelled) and string[] (won't occur with multiple:false).
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "SQLite backup", extensions: ["sqlite3"] }],
    });
    if (typeof selected !== "string") return;
    void restoreBackup(selected);
  }

  return (
    <div>
      <div className="backup-toolbar">
        <Button
          variant="ghost"
          disabled={isLoading}
          aria-label="Create database backup"
          onClick={() => void createBackup()}
        >
          {isLoading ? "Working..." : "Create backup"}
        </Button>
        <Button
          variant="ghost"
          disabled={isLoading}
          aria-label="Restore from backup file"
          onClick={() => void handleRestore()}
        >
          Restore from file...
        </Button>
      </div>

      {error && (
        <p
          style={{
            margin: 0,
            marginBottom: "var(--sp-3)",
            fontSize: "var(--text-xs)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}

      {backups.length === 0 ? (
        <EmptyState
          label="Backup history"
          title="No backups yet"
          body="Database-only backups will appear here once created. Backups do not include browser profiles or cached AI responses."
        />
      ) : (
        <div className="table-wrapper">
          <table className="data-table" aria-label="Backup history">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col" style={{ width: "6rem" }}>
                  Size
                </th>
                <th scope="col" style={{ width: "14rem" }}>
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.file_name}>
                  <td className="cell-mono" style={{ fontSize: "var(--text-xs)" }}>
                    {b.file_name}
                  </td>
                  <td>{formatBytes(b.size_bytes)}</td>
                  <td className="cell-mono" style={{ fontSize: "var(--text-xs)" }}>
                    {new Date(b.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
