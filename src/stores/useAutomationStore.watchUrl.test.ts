import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutomationStore } from "./useAutomationStore";

// Store touches invokeStrict for its command actions; stub the whole IPC module
// so the store can be exercised without a backend.
vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

function resetStore() {
  useAutomationStore.setState({
    state: "Queued",
    currentTaskId: null,
    isEmergencyStopped: false,
    watchUrl: null,
    error: null,
    detail: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// watchUrl is the field the cockpit maps onto <BrowserPreview url=...>. Its real
// contract today: null by default (Evidence Viewer shows the standby
// placeholder), and applyServerState must not fabricate one - it is only set
// once the automation engine drives a real page (P2). These tests pin that.
describe("useAutomationStore - watchUrl", () => {
  it("defaults to null so the cockpit renders the standby placeholder", () => {
    expect(useAutomationStore.getState().watchUrl).toBeNull();
  });

  it("does not invent a watchUrl on a server state transition", () => {
    useAutomationStore.getState().applyServerState("Searching", "task-1", "scanning");

    const s = useAutomationStore.getState();
    expect(s.state).toBe("Searching");
    expect(s.watchUrl).toBeNull();
  });

  it("preserves an already-set watchUrl across a lifecycle transition", () => {
    useAutomationStore.setState({ watchUrl: "https://jobs.example/app/1" });

    useAutomationStore.getState().applyServerState("Completed", null, "done");

    // applyServerState omits watchUrl from its patch, so zustand's shallow merge
    // keeps the live url until something explicitly clears it.
    expect(useAutomationStore.getState().watchUrl).toBe("https://jobs.example/app/1");
  });
});
