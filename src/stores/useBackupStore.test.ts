import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBackupStore } from "./useBackupStore";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";

// vi.mock is hoisted above all imports by vitest's transform - the
// tauriInvoke module is replaced before useBackupStore is imported.
vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  // Preserve the real errMessage logic so error-string assertions are stable.
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

const MOCK_BACKUP = {
  file_name: "hiremeops-backup-2026-01-01T000000.sqlite3",
  path: "/home/satu/.hiremeops/backups/hiremeops-backup-2026-01-01T000000.sqlite3",
  size_bytes: 204_800,
  created_at: "2026-01-01T00:00:00Z",
};

describe("useBackupStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset data fields only - actions (functions) survive the merge.
    useBackupStore.setState({ backups: [], isLoading: false, error: null });
  });

  // ── listBackups ─────────────────────────────────────────────────────────
  describe("listBackups", () => {
    it("populates backups on success", async () => {
      mockSafeInvoke.mockResolvedValueOnce([MOCK_BACKUP]);

      await useBackupStore.getState().listBackups();

      expect(mockSafeInvoke).toHaveBeenCalledWith("list_backups");
      expect(useBackupStore.getState().backups).toEqual([MOCK_BACKUP]);
      expect(useBackupStore.getState().isLoading).toBe(false);
      expect(useBackupStore.getState().error).toBeNull();
    });

    it("sets error and keeps backups empty when safeInvoke returns null", async () => {
      mockSafeInvoke.mockResolvedValueOnce(null);

      await useBackupStore.getState().listBackups();

      expect(useBackupStore.getState().backups).toEqual([]);
      expect(useBackupStore.getState().error).not.toBeNull();
      expect(useBackupStore.getState().isLoading).toBe(false);
    });
  });

  // ── createBackup ─────────────────────────────────────────────────────────
  describe("createBackup", () => {
    it("calls create_backup then refreshes the list", async () => {
      mockInvokeStrict.mockResolvedValueOnce(MOCK_BACKUP); // create_backup
      mockSafeInvoke.mockResolvedValueOnce([MOCK_BACKUP]); // list_backups

      await useBackupStore.getState().createBackup();

      expect(mockInvokeStrict).toHaveBeenCalledWith("create_backup");
      expect(mockSafeInvoke).toHaveBeenCalledWith("list_backups");
      expect(useBackupStore.getState().backups).toEqual([MOCK_BACKUP]);
      expect(useBackupStore.getState().isLoading).toBe(false);
    });

    it("sets error on failure and does NOT call listBackups", async () => {
      mockInvokeStrict.mockRejectedValueOnce("disk full");

      await useBackupStore.getState().createBackup();

      expect(useBackupStore.getState().error).toMatch("Failed to create backup");
      expect(useBackupStore.getState().isLoading).toBe(false);
      // The early return prevents the listBackups() refresh call.
      expect(mockSafeInvoke).not.toHaveBeenCalled();
    });
  });

  // ── restoreBackup ─────────────────────────────────────────────────────────
  describe("restoreBackup", () => {
    it("calls restore_backup with camelCase backupPath (Tauri JS→Rust convention)", async () => {
      mockInvokeStrict.mockResolvedValueOnce(MOCK_BACKUP);

      await useBackupStore.getState().restoreBackup("/backups/test.sqlite3");

      // Tauri maps camelCase JS args → snake_case Rust params automatically.
      // backupPath → backup_path, same convention as profileId → profile_id.
      expect(mockInvokeStrict).toHaveBeenCalledWith("restore_backup", {
        backupPath: "/backups/test.sqlite3",
      });
      expect(useBackupStore.getState().isLoading).toBe(false);
      expect(useBackupStore.getState().error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockInvokeStrict.mockRejectedValueOnce("file not found");

      await useBackupStore.getState().restoreBackup("/backups/test.sqlite3");

      expect(useBackupStore.getState().error).toMatch("Failed to restore backup");
      expect(useBackupStore.getState().isLoading).toBe(false);
    });
  });
});
