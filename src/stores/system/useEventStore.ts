import { create } from "zustand";
import type { AppEvent } from "../types/events";

const MAX_EVENTS = 200;

/**
 * Health of the live event channel subscription (lib/eventBridge.ts):
 *  - "connecting": attempting to subscribe (initial or during backoff retry)
 *  - "live":       subscribed; events are flowing
 *  - "error":      subscription failed and retries are exhausted
 */
export type BridgeStatus = "connecting" | "live" | "error";

interface EventStoreState {
  events: AppEvent[];
  bridgeStatus: BridgeStatus;
  addEvent: (event: AppEvent) => void;
  setBridgeStatus: (status: BridgeStatus) => void;
  clear: () => void;
}

/**
 * Rolling buffer of live automation/job/CV/application events, fed by
 * lib/eventBridge.ts. The AppLayout event log drawer shows the most recent
 * ~20; this store keeps a slightly larger buffer for future scrollback.
 */
export const useEventStore = create<EventStoreState>((set) => ({
  events: [],
  bridgeStatus: "connecting",
  addEvent: (event) =>
    set((state) => {
      if (state.events.some((existing) => existing.id === event.id)) return state;
      return { events: [event, ...state.events].slice(0, MAX_EVENTS) };
    }),
  setBridgeStatus: (status) => set({ bridgeStatus: status }),
  clear: () => set({ events: [] }),
}));
