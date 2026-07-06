import { create } from "zustand";
import type { AppEvent } from "../types/events";

const MAX_EVENTS = 200;

interface EventStoreState {
  events: AppEvent[];
  addEvent: (event: AppEvent) => void;
  clear: () => void;
}

/**
 * Rolling buffer of live automation/job/CV/application events, fed by
 * lib/eventBridge.ts. The AppLayout event log drawer shows the most recent
 * ~20; this store keeps a slightly larger buffer for future scrollback.
 */
export const useEventStore = create<EventStoreState>((set) => ({
  events: [],
  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));
