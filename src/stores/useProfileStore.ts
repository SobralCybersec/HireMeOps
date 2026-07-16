import { create } from "zustand";
import type { Profile } from "../types/domain";
import { safeInvoke } from "../lib/tauriInvoke";
import { useSettingsStore } from "./useSettingsStore";

interface ProfileStoreState {
  profiles: Profile[];
  activeProfileId: string | null;
  isLoading: boolean;
  loadProfiles: () => Promise<void>;
  /**
   * Set the active profile in-memory AND persist the choice through the
   * settings store so it survives app reruns. Returns the settled promise
   * to let callers await the write when they care about visible errors.
   */
  setActiveProfile: (id: string) => Promise<void>;
}

/**
 * Resolve the id we should mark active after loading the profile list.
 *
 * Precedence:
 *   1. An explicit in-memory choice made earlier in this session.
 *   2. The `activeProfileId` persisted in `app_settings` (survives reruns).
 *   3. The first profile in the list - so pages like JobPreferences that
 *      gate load/save on `activeProfileId` are usable on a fresh install.
 *   4. `null` when there are no profiles yet.
 *
 * Guard: a persisted id that no longer resolves to a real profile row
 * (deleted since last launch) is treated as stale and ignored.
 */
function resolveInitialActiveId(
  currentActive: string | null,
  profiles: Profile[],
  persisted: string | null,
): string | null {
  if (currentActive && profiles.some((p) => p.id === currentActive)) {
    return currentActive;
  }
  if (persisted && profiles.some((p) => p.id === persisted)) {
    return persisted;
  }
  return profiles[0]?.id ?? null;
}

export const useProfileStore = create<ProfileStoreState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  isLoading: false,

  loadProfiles: async () => {
    set({ isLoading: true });
    const profiles = await safeInvoke<Profile[]>("list_profiles");
    const list = profiles ?? [];
    // Hydrate the active profile from persisted settings so a rerun lands
    // the user on the same profile they last used - this is the linchpin
    // of the JobPreferences load→hydrate→save→reload cycle.
    const persisted = useSettingsStore.getState().settings?.activeProfileId ?? null;
    set({
      profiles: list,
      activeProfileId: resolveInitialActiveId(get().activeProfileId, list, persisted),
      isLoading: false,
    });
  },

  setActiveProfile: async (id) => {
    // Optimistically reflect the pick so the UI feels instant, then persist
    // via updateSettings - the same code path that survives app reruns.
    set({ activeProfileId: id });
    const { settings, updateSettings } = useSettingsStore.getState();
    if (settings && settings.activeProfileId !== id) {
      await updateSettings({ activeProfileId: id });
    }
  },
}));

/**
 * Cross-store bridge: if `loadSettings` completes AFTER `loadProfiles`
 * (both fire concurrently at bootstrap), and the profile store still has
 * no active id, adopt whatever id the settings row remembered.
 *
 * Registered at module load; runs cheaply - the guard exits fast when
 * either the id didn't change or the profile store is already hydrated.
 */
useSettingsStore.subscribe((state, prev) => {
  const nextId = state.settings?.activeProfileId ?? null;
  const prevId = prev.settings?.activeProfileId ?? null;
  if (!nextId || nextId === prevId) return;
  const { activeProfileId, profiles } = useProfileStore.getState();
  if (activeProfileId != null) return;
  if (!profiles.some((p) => p.id === nextId)) return;
  useProfileStore.setState({ activeProfileId: nextId });
});
