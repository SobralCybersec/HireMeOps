import { beforeEach, describe, expect, it } from "vitest";
import { useEventStore } from "./useEventStore";
import type { AppEvent } from "../types/events";

function makeEvent(id: string): AppEvent {
  return {
    id,
    type: "log",
    payload: { msg: id },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("useEventStore", () => {
  beforeEach(() => {
    useEventStore.setState({ events: [], bridgeStatus: "connecting" });
  });

  it("prepends new events (most-recent-first)", () => {
    useEventStore.getState().addEvent(makeEvent("a"));
    useEventStore.getState().addEvent(makeEvent("b"));
    const ids = useEventStore.getState().events.map((e) => e.id);
    expect(ids).toEqual(["b", "a"]);
  });

  it("ignores duplicate deliveries of the same backend event", () => {
    useEventStore.getState().addEvent(makeEvent("same"));
    useEventStore.getState().addEvent(makeEvent("same"));
    expect(useEventStore.getState().events.map((event) => event.id)).toEqual(["same"]);
  });

  it("caps the rolling buffer at 200 events, dropping the oldest", () => {
    for (let i = 0; i < 250; i += 1) {
      useEventStore.getState().addEvent(makeEvent(`e${i}`));
    }
    const events = useEventStore.getState().events;
    expect(events).toHaveLength(200);
    // Newest is at the head; the oldest 50 (e0..e49) were dropped.
    expect(events[0].id).toBe("e249");
    expect(events[199].id).toBe("e50");
  });

  it("setBridgeStatus updates the channel health", () => {
    useEventStore.getState().setBridgeStatus("live");
    expect(useEventStore.getState().bridgeStatus).toBe("live");
    useEventStore.getState().setBridgeStatus("error");
    expect(useEventStore.getState().bridgeStatus).toBe("error");
  });

  it("clear empties the buffer but leaves bridgeStatus untouched", () => {
    useEventStore.getState().addEvent(makeEvent("x"));
    useEventStore.getState().setBridgeStatus("live");
    useEventStore.getState().clear();
    expect(useEventStore.getState().events).toEqual([]);
    expect(useEventStore.getState().bridgeStatus).toBe("live");
  });
});
