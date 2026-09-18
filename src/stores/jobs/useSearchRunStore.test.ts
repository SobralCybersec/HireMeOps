import { beforeEach, describe, expect, it } from "vitest";
import { useSearchRunStore } from "./useSearchRunStore";
import type { AppEvent } from "../../types/events";

function event(type: AppEvent["type"], payload: Record<string, unknown>, seq: number): AppEvent {
  return {
    id: `${type}-${seq}`,
    type,
    payload: { runId: "run-1", profileId: "profile-1", platform: "linkedin", seq, ...payload },
    createdAt: `2026-01-01T00:00:0${seq}Z`,
  };
}

describe("useSearchRunStore", () => {
  beforeEach(() => useSearchRunStore.getState().clear());

  it("tracks phases and counters from durable events", () => {
    useSearchRunStore.getState().applyEvent(event("job.search.phase", { phase: "discovering" }, 1));
    useSearchRunStore
      .getState()
      .applyEvent(
        event("job.search.progress", { phase: "persisting", discovered: 3, persisted: 2 }, 2),
      );

    expect(useSearchRunStore.getState().runs["run-1"]).toMatchObject({
      phase: "persisting",
      discovered: 3,
      persisted: 2,
      lastSeq: 2,
    });
  });

  it("ignores stale replay and preserves terminal state", () => {
    useSearchRunStore
      .getState()
      .applyEvent(event("job.search.completed", { status: "completed" }, 4));
    useSearchRunStore.getState().applyEvent(event("job.search.phase", { phase: "discovering" }, 3));

    expect(useSearchRunStore.getState().runs["run-1"]).toMatchObject({
      phase: "completed",
      lastSeq: 4,
    });
  });

  it("keeps duplicate item events idempotent by sequence", () => {
    const item = event("job.search.item_found", { phase: "persisting", persisted: 1 }, 5);
    useSearchRunStore.getState().applyEvent(item);
    useSearchRunStore.getState().applyEvent(item);

    expect(Object.keys(useSearchRunStore.getState().runs)).toHaveLength(1);
    expect(useSearchRunStore.getState().runs["run-1"].lastSeq).toBe(5);
  });
});
