import { create } from "zustand";
import type { Profile } from "../types/domain";
import { safeInvoke } from "../lib/tauriInvoke";

interface ProfileStoreState {
  profiles: Profile[];
  activeProfileId: string | null;
  isLoading: boolean;
  loadProfiles: () => Promise<void>;
  setActiveProfile: (id: string) => void;
}

export const useProfileStore = create<ProfileStoreState>((set) => ({
  profiles: [],
  activeProfileId: null,
  isLoading: false,

  loadProfiles: async () => {
    set({ isLoading: true });
    const profiles = await safeInvoke<Profile[]>("list_profiles");
    set({ profiles: profiles ?? [], isLoading: false });
  },

  setActiveProfile: (id) => set({ activeProfileId: id }),
}));
