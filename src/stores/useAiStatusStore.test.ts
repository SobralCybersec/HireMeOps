import { describe, it, expect, beforeEach } from "vitest";
import { useAiStatusStore } from "./useAiStatusStore";

describe("useAiStatusStore", () => {
  beforeEach(() => {
    useAiStatusStore.setState({ phase: "idle", scope: null });
  });

  it("starts idle", () => {
    expect(useAiStatusStore.getState().phase).toBe("idle");
    expect(useAiStatusStore.getState().scope).toBeNull();
  });

  it("tracks the generating → ready lifecycle", () => {
    const { set } = useAiStatusStore.getState();
    set("generating", "application_draft");
    expect(useAiStatusStore.getState().phase).toBe("generating");
    expect(useAiStatusStore.getState().scope).toBe("application_draft");

    set("ready", "application_draft");
    expect(useAiStatusStore.getState().phase).toBe("ready");
  });
});
