import { Button, EmptyState } from "../../components/ui";

/**
 * Backup management panel.
 * All actions are disabled until the backend create_backup / restore_backup
 * commands are wired. Backup history will populate from get_backup_history.
 */
export function BackupRestorePanel() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "var(--sp-2)",
          marginBottom: "var(--sp-4)",
        }}
      >
        <Button variant="ghost" disabled aria-label="Create database backup">
          Create backup
        </Button>
        <Button variant="ghost" disabled aria-label="Restore from backup file">
          Restore from file…
        </Button>
      </div>

      <EmptyState
        label="Backup history"
        title="No backups yet"
        body="Database-only backups will appear here once created. Backups do not include browser profiles or cached AI responses."
      />
    </div>
  );
}
