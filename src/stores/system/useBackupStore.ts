import { create } from "zustand";
import { errMessage, invokeStrict, safeInvoke } from "../lib/tauriInvoke";

// snake_case matches the wire format - BackupInfo has NO serde rename in Rust.
export interface BackupInfo {
  file_name: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

interface BackupStoreState {
  backups: BackupInfo[];
  isLoading: boolean;
  error: string | null;
  listBackups: () => Promise<void>;
  createBackup: () => Promise<void>;
  restoreBackup: (backupPath: string) => Promise<void>;
}

export const useBackupStore = create<BackupStoreState>((set, get) => ({
  backups: [],
  isLoading: false,
  error: null,

  listBackups: async () => {
    set({ isLoading: true, error: null });
    const backups = await safeInvoke<BackupInfo[]>("list_backups");
    if (backups !== null) {
      set({ backups, isLoading: false });
    } else {
      set({ isLoading: false, error: "Could not load backups." });
    }
  },

  createBackup: async () => {
    set({ isLoading: true, error: null });
    try {
      await invokeStrict<BackupInfo>("create_backup");
    } catch (e) {
      set({
        isLoading: false,
        error: `Failed to create backup: ${errMessage(e)}`,
      });
      return;
    }
    // Refresh list on success; listBackups owns the final isLoading: false.
    await get().listBackups();
  },

  restoreBackup: async (backupPath: string) => {
    set({ isLoading: true, error: null });
    try {
      // Tauri maps camelCase JS key → snake_case Rust param automatically.
      // Confirmed pattern: { profileId } → profile_id (see cv.rs / library.ts:36).
      await invokeStrict<BackupInfo>("restore_backup", { backupPath });
      set({ isLoading: false });
    } catch (e) {
      set({
        isLoading: false,
        error: `Failed to restore backup: ${errMessage(e)}`,
      });
    }
  },
}));
