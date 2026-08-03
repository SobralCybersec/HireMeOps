import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProfileStore } from "./useProfileStore";
import { useSettingsStore } from "./useSettingsStore";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";
import type { Profile } from "../types/domain";
import type { AppSettings } from "../types/settings";

vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

const MOCK_PROFILES: Profile[] = [
  { id: "p1", name: "Default", isActive: true },
  { id: "p2", name: "Backend roles", isActive: false },
];

const BASE_SETTINGS: AppSettings = {
  activeProfileId: "p2",
  appLanguage: "en",
  startupBehavior: "normal",
  portableMode: false,
  theme: "dark",
  reducedEffects: "auto",
  aiProviders: [],
  defaultAiProviderIndex: 0,
  browserProfileRootPath: "/tmp/hiremeops/browser",
  databasePath: "/tmp/hiremeops/db.sqlite3",
  auditLogRetentionDays: 90,
  automationEvidenceRetentionDays: 30,
  browserExtensions: [],
  automationHeadless: true,
  automationHeadlessOverrides: {},
  aiAutoInit: true,
};

describe("useProfileStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({ profiles: [], activeProfileId: null, isLoading: false });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
  });

  describe("loadProfiles", () => {
    it("populates profiles on success", async () => {
      mockSafeInvoke.mockResolvedValueOnce(MOCK_PROFILES);
      await useProfileStore.getState().loadProfiles();
      expect(mockSafeInvoke).toHaveBeenCalledWith("list_profiles");
      expect(useProfileStore.getState().profiles).toEqual(MOCK_PROFILES);
      expect(useProfileStore.getState().isLoading).toBe(false);
    });

    it("falls back to an empty list when the command is unavailable", async () => {
      mockSafeInvoke.mockResolvedValueOnce(null);
      await useProfileStore.getState().loadProfiles();
      expect(useProfileStore.getState().profiles).toEqual([]);
      expect(useProfileStore.getState().isLoading).toBe(false);
      expect(useProfileStore.getState().activeProfileId).toBeNull();
    });

    // ── Persistence-bug regression: on rerun, the JobPreferences page reads
    //    `activeProfileId` from this store to trigger `list_job_preferences`.
    //    If it stays null after boot, no preferences load and the Save button
    //    stays disabled → the user perceives "nothing saved". ────────────
    it(
      "hydrates activeProfileId from persisted settings when the settings row " +
        "already loaded before loadProfiles ran",
      async () => {
        // Simulate: loadSettings finished first, then loadProfiles runs.
        useSettingsStore.setState({ settings: BASE_SETTINGS });
        mockSafeInvoke.mockResolvedValueOnce(MOCK_PROFILES);

        await useProfileStore.getState().loadProfiles();

        expect(useProfileStore.getState().activeProfileId).toBe("p2");
      },
    );

    it(
      "falls back to the first profile when no persisted activeProfileId is " +
        "available - fresh install still enables JobPreferences save",
      async () => {
        // Settings loaded but never had an active profile chosen.
        useSettingsStore.setState({
          settings: { ...BASE_SETTINGS, activeProfileId: null },
        });
        mockSafeInvoke.mockResolvedValueOnce(MOCK_PROFILES);

        await useProfileStore.getState().loadProfiles();

        expect(useProfileStore.getState().activeProfileId).toBe("p1");
      },
    );

    it(
      "ignores a stale persisted id whose profile row no longer exists and " +
        "falls back to the first profile in the list",
      async () => {
        useSettingsStore.setState({
          settings: { ...BASE_SETTINGS, activeProfileId: "deleted-profile" },
        });
        mockSafeInvoke.mockResolvedValueOnce(MOCK_PROFILES);

        await useProfileStore.getState().loadProfiles();

        expect(useProfileStore.getState().activeProfileId).toBe("p1");
      },
    );

    it("preserves an in-session explicit pick across a reload", async () => {
      useProfileStore.setState({ activeProfileId: "p2" });
      useSettingsStore.setState({ settings: BASE_SETTINGS });
      mockSafeInvoke.mockResolvedValueOnce(MOCK_PROFILES);

      await useProfileStore.getState().loadProfiles();

      expect(useProfileStore.getState().activeProfileId).toBe("p2");
    });
  });

  describe("setActiveProfile", () => {
    it("optimistically records the selected id in-memory", async () => {
      await useProfileStore.getState().setActiveProfile("p2");
      expect(useProfileStore.getState().activeProfileId).toBe("p2");
    });

    // Persistence-bug regression: without this write the user's choice
    // never reaches SQLite → next launch the store starts null again.
    it("persists the choice through update_settings when settings are loaded", async () => {
      useSettingsStore.setState({ settings: BASE_SETTINGS });
      mockInvokeStrict.mockResolvedValueOnce(undefined);

      await useProfileStore.getState().setActiveProfile("p1");

      expect(mockInvokeStrict).toHaveBeenCalledWith("update_settings", {
        settings: { ...BASE_SETTINGS, activeProfileId: "p1" },
      });
    });

    it("skips the write when settings haven't loaded yet", async () => {
      useSettingsStore.setState({ settings: null });
      await useProfileStore.getState().setActiveProfile("p2");
      expect(mockInvokeStrict).not.toHaveBeenCalled();
      expect(useProfileStore.getState().activeProfileId).toBe("p2");
    });

    it("is a no-op write when the picked id already matches the persisted one", async () => {
      useSettingsStore.setState({ settings: BASE_SETTINGS });
      await useProfileStore.getState().setActiveProfile(BASE_SETTINGS.activeProfileId!);
      expect(mockInvokeStrict).not.toHaveBeenCalled();
    });
  });

  describe("settings-store subscription bridge", () => {
    it(
      "adopts a fresh activeProfileId when settings load AFTER loadProfiles " +
        "and the profile store had no pick yet",
      () => {
        // Profiles already loaded, no active pick - mirrors the concurrent
        // bootstrap where loadProfiles finished before loadSettings.
        useProfileStore.setState({
          profiles: MOCK_PROFILES,
          activeProfileId: null,
        });

        useSettingsStore.setState({ settings: BASE_SETTINGS });

        expect(useProfileStore.getState().activeProfileId).toBe("p2");
      },
    );

    it("does not clobber an existing in-memory pick", () => {
      useProfileStore.setState({
        profiles: MOCK_PROFILES,
        activeProfileId: "p1",
      });
      useSettingsStore.setState({ settings: BASE_SETTINGS });
      expect(useProfileStore.getState().activeProfileId).toBe("p1");
    });

    it("ignores a persisted id that no longer resolves to a loaded profile", () => {
      useProfileStore.setState({
        profiles: MOCK_PROFILES,
        activeProfileId: null,
      });
      useSettingsStore.setState({
        settings: { ...BASE_SETTINGS, activeProfileId: "deleted" },
      });
      expect(useProfileStore.getState().activeProfileId).toBeNull();
    });
  });
});
