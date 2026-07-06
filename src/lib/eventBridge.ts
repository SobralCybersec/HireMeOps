import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEventStore } from "../stores/useEventStore";
import type { AppEvent } from "../types/events";

const EVENT_CHANNEL = "hiremeops://event";

let unlisten: UnlistenFn | null = null;

function isAppEvent(value: unknown): value is AppEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "createdAt" in value
  );
}

/**
 * Subscribes once to the "hiremeops://event" Tauri event channel and pipes
 * every payload into useEventStore. This is the ONLY live-data source for the
 * UI — no polling. Safe to call multiple times (no-op after the first).
 */
export async function startEventBridge(): Promise<void> {
  if (unlisten) return;

  try {
    unlisten = await listen<unknown>(EVENT_CHANNEL, (event) => {
      const payload = event.payload;

      if (isAppEvent(payload)) {
        useEventStore.getState().addEvent(payload);
        return;
      }

      // Backend sent something that doesn't match the AppEvent contract yet
      // (e.g. before the Rust side is wired up). Surface it as a raw log
      // event instead of dropping it silently.
      useEventStore.getState().addEvent({
        id: crypto.randomUUID(),
        type: "log",
        payload,
        createdAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    console.error(`[event-bridge] failed to subscribe to "${EVENT_CHANNEL}"`, error);
  }
}

export function stopEventBridge(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
