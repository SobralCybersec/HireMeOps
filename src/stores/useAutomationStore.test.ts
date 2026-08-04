import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutomationStore } from "./useAutomationStore";
import { invokeStrict } from "../lib/tauriInvoke";

vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockInvokeStrict = vi.mocked(invokeStrict);

// Full data-field reset. Actions (functions) survive setState's shallow merge.
function resetStore() {
  useAutomationStore.setState({
    state: "Queued",
    currentTaskId: null,
    watchUrl: null,
    error: null,
    detail: null,
  });
}

describe("useAutomationStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── start ─────────────────────────────────────────────────────────────────
  describe("start", () => {
    it("paints the optimistic PreparingBrowser ack and clears error", async () => {
      mockInvokeStrict.mockResolvedValueOnce(undefined);
      // Pre-dirty the store so we can prove start() clears these.
      useAutomationStore.setState({ error: "old" });

      await useAutomationStore.getState().start();

      expect(mockInvokeStrict).toHaveBeenCalledWith("automation_start");
      const s = useAutomationStore.getState();
      expect(s.state).toBe("PreparingBrowser");
      expect(s.error).toBeNull();
      expect(s.detail).toBeNull();
    });

    it("sets the optimistic ack BEFORE awaiting so a mid-flight server event is never clobbered", async () => {
      // Reproduces the 'stuck Preparing Browser' regression guard: the backend's
      // terminal event can land while automation_start is still in flight. If the
      // optimistic ack were set AFTER the await, it would overwrite that terminal
      // state. Here we fire applyServerState(Completed) mid-invoke and assert the
      // final state is Completed, not PreparingBrowser.
      mockInvokeStrict.mockImplementationOnce(async () => {
        useAutomationStore.getState().applyServerState("Completed", null, "done");
        return undefined;
      });

      await useAutomationStore.getState().start();

      expect(useAutomationStore.getState().state).toBe("Completed");
    });

    it("surfaces an error but leaves the optimistic state in place on failure", async () => {
      mockInvokeStrict.mockRejectedValueOnce("engine offline");

      await useAutomationStore.getState().start();

      const s = useAutomationStore.getState();
      expect(s.error).toMatch("Failed to start automation");
      expect(s.error).toMatch("engine offline");
      // The optimistic ack was set before the await, so it remains.
      expect(s.state).toBe("PreparingBrowser");
    });
  });

  // ── pause / resume / stop ───────────────────────────────────────────────────
  describe("pause / resume / stop", () => {
    it("pause sets PausedByUser on success", async () => {
      mockInvokeStrict.mockResolvedValueOnce(undefined);
      await useAutomationStore.getState().pause();
      expect(mockInvokeStrict).toHaveBeenCalledWith("automation_pause");
      expect(useAutomationStore.getState().state).toBe("PausedByUser");
      expect(useAutomationStore.getState().error).toBeNull();
    });

    it("pause sets error and does NOT change state on failure", async () => {
      useAutomationStore.setState({ state: "Searching" });
      mockInvokeStrict.mockRejectedValueOnce("nope");
      await useAutomationStore.getState().pause();
      expect(useAutomationStore.getState().state).toBe("Searching");
      expect(useAutomationStore.getState().error).toMatch("Failed to pause automation");
    });

    it("resume sets Searching on success", async () => {
      mockInvokeStrict.mockResolvedValueOnce(undefined);
      await useAutomationStore.getState().resume();
      expect(mockInvokeStrict).toHaveBeenCalledWith("automation_resume");
      expect(useAutomationStore.getState().state).toBe("Searching");
    });

    it("stop sets Stopped on success", async () => {
      mockInvokeStrict.mockResolvedValueOnce(undefined);
      await useAutomationStore.getState().stop();
      expect(mockInvokeStrict).toHaveBeenCalledWith("automation_stop");
      expect(useAutomationStore.getState().state).toBe("Stopped");
    });

    it("stop sets error and preserves state on failure", async () => {
      useAutomationStore.setState({ state: "Searching" });
      mockInvokeStrict.mockRejectedValueOnce("busy");
      await useAutomationStore.getState().stop();
      expect(useAutomationStore.getState().state).toBe("Searching");
      expect(useAutomationStore.getState().error).toMatch("Failed to stop automation");
    });
  });

  // ── applyServerState (authoritative lifecycle) ──────────────────────────────
  describe("applyServerState", () => {
    it("adopts a backend-provided taskId", () => {
      useAutomationStore.getState().applyServerState("Searching", "task-42", "scanning");
      const s = useAutomationStore.getState();
      expect(s.state).toBe("Searching");
      expect(s.currentTaskId).toBe("task-42");
      expect(s.detail).toBe("scanning");
    });

    it("keeps the prior taskId on a non-terminal state when none is named", () => {
      useAutomationStore.setState({ currentTaskId: "task-keep" });
      useAutomationStore.getState().applyServerState("ScoringJob", null, null);
      expect(useAutomationStore.getState().currentTaskId).toBe("task-keep");
    });

    it("clears the taskId on a clean terminal state with no taskId", () => {
      useAutomationStore.setState({ currentTaskId: "task-done" });
      useAutomationStore.getState().applyServerState("Completed", null, null);
      expect(useAutomationStore.getState().currentTaskId).toBeNull();
    });
  });

  it("clearError clears only the error", () => {
    useAutomationStore.setState({ error: "boom", state: "Searching" });
    useAutomationStore.getState().clearError();
    expect(useAutomationStore.getState().error).toBeNull();
    expect(useAutomationStore.getState().state).toBe("Searching");
  });
});
