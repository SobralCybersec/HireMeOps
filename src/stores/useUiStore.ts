import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiStoreState {
  /** Whether the right-rail event-log drawer is visible. */
  eventLogVisible: boolean;
  toggleEventLog: () => void;
  setEventLogVisible: (visible: boolean) => void;
  /** Whether the AI assistant modal is visible. */
  assistantOpen: boolean;
  toggleAssistant: () => void;
  setAssistantOpen: (open: boolean) => void;
}

/** UI-shell prefs that outlive a session. Persisted to localStorage. */
export const useUiStore = create<UiStoreState>()(
  persist(
    (set) => ({
      eventLogVisible: true,
      toggleEventLog: () => set((s) => ({ eventLogVisible: !s.eventLogVisible })),
      setEventLogVisible: (eventLogVisible) => set({ eventLogVisible }),
      assistantOpen: false,
      toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
    }),
    { name: "hiremeops-ui" },
  ),
);
