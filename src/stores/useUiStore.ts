import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiStoreState {
  /** Whether the right-rail event-log drawer is visible. */
  eventLogVisible: boolean;
  toggleEventLog: () => void;
  setEventLogVisible: (visible: boolean) => void;
}

/** UI-shell prefs that outlive a session. Persisted to localStorage. */
export const useUiStore = create<UiStoreState>()(
  persist(
    (set) => ({
      eventLogVisible: true,
      toggleEventLog: () => set((s) => ({ eventLogVisible: !s.eventLogVisible })),
      setEventLogVisible: (eventLogVisible) => set({ eventLogVisible }),
    }),
    { name: "hiremeops-ui" },
  ),
);
