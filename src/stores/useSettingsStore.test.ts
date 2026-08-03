import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./useSettingsStore";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";
import type { AppSettings } from "../types/settings";

vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

const MOCK_SETTINGS: AppSettings = {
  activeProfileId: "profile-1",
  appLanguage: "en",
  startupBehavior: "normal",
  portableMode: false,
  theme: "dark",
  reducedEffects: "auto",
  aiProviders: [],
  defaultAiProviderIndex: 0,
  browserProfileRootPath: "/home/satu/.hiremeops/browser",
  databasePath: "/home/satu/.hiremeops/db.sqlite3",
  auditLogRetentionDays: 90,
  automationEvidenceRetentionDays: 30,
  browserExtensions: [],
  automationHeadless: true,
  automationHeadlessOverrides: {},
  aiAutoInit: true,
};

describe("useSettingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
  });

  // ── loadSettings ─────────────────────────────────────────────────────────
  describe("loadSettings", () => {
    it("populates settings on success", async () => {
      mockSafeInvoke.mockResolvedValueOnce(MOCK_SETTINGS);
      await useSettingsStore.getState().loadSettings();
      expect(mockSafeInvoke).toHaveBeenCalledWith("get_settings");
      const s = useSettingsStore.getState();
      expect(s.settings).toEqual(MOCK_SETTINGS);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it("sets an error and leaves settings null when the command is unavailable", async () => {
      mockSafeInvoke.mockResolvedValueOnce(null);
      await useSettingsStore.getState().loadSettings();
      const s = useSettingsStore.getState();
      expect(s.settings).toBeNull();
      expect(s.error).not.toBeNull();
      expect(s.isLoading).toBe(false);
    });
  });

  // ── updateSettings ──────────────────────────────────────────────────────
  describe("updateSettings", () => {
    it("no-ops when there are no loaded settings", async () => {
      await useSettingsStore.getState().updateSettings({ appLanguage: "de" });
      expect(mockInvokeStrict).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().settings).toBeNull();
    });

    it("optimistically merges the patch and persists via update_settings", async () => {
      useSettingsStore.setState({ settings: MOCK_SETTINGS });
      mockInvokeStrict.mockResolvedValueOnce(undefined);

      await useSettingsStore.getState().updateSettings({ appLanguage: "fr" });

      const expected: AppSettings = { ...MOCK_SETTINGS, appLanguage: "fr" };
      expect(mockInvokeStrict).toHaveBeenCalledWith("update_settings", {
        settings: expected,
      });
      expect(useSettingsStore.getState().settings).toEqual(expected);
      expect(useSettingsStore.getState().error).toBeNull();
    });

    it("rolls back to the previous settings when the write fails", async () => {
      useSettingsStore.setState({ settings: MOCK_SETTINGS });
      mockInvokeStrict.mockRejectedValueOnce("disk read-only");

      await useSettingsStore.getState().updateSettings({ portableMode: true });

      const s = useSettingsStore.getState();
      // Optimistic value was reverted - store never diverges from what persisted.
      expect(s.settings).toEqual(MOCK_SETTINGS);
      expect(s.settings?.portableMode).toBe(false);
      expect(s.error).toMatch("Failed to save settings");
    });
  });
});
