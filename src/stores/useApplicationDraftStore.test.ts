/**
 * Unit tests for the application-draft zustand store.
 *
 * Exercises the pure factory from `applicationDraftCore` with an injected
 * `invoker`/`errMsg` - no Tauri IPC, no webview. Runs under vitest like every
 * other store test (`vitest run`).
 */
import { describe, it, beforeEach, expect, vi } from "vitest";
import { createApplicationDraftStore } from "./applicationDraftCore";

const DRAFT_ID = "00000000-0000-0000-0000-000000000001";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeErrMsg() {
  return vi.fn((e: unknown) => (typeof e === "string" ? e : String(e)));
}

function makeInvoker(resolveWith = DRAFT_ID) {
  return vi.fn(async (_cmd: string, _args: Record<string, unknown>) => resolveWith);
}

function makeRejectingInvoker(reason: string) {
  return vi.fn(async (_cmd: string, _args: Record<string, unknown>) => {
    throw reason;
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("createApplicationDraftStore", () => {
  let invoker: ReturnType<typeof makeInvoker>;
  let errMsg: ReturnType<typeof makeErrMsg>;
  let store: ReturnType<typeof createApplicationDraftStore>;

  beforeEach(() => {
    invoker = makeInvoker();
    errMsg = makeErrMsg();
    store = createApplicationDraftStore(
      invoker as (cmd: string, args: Record<string, unknown>) => Promise<string>,
      errMsg as (e: unknown) => string,
    );
  });

  it("starts with clean initial state", () => {
    const s = store.getState();
    expect(s.draftId).toBe(null);
    expect(s.isDrafting).toBe(false);
    expect(s.isSubmitting).toBe(false);
    expect(s.runId).toBe(null);
    expect(s.error).toBe(null);
  });

  it("sets isDrafting=true while in-flight and resolves draftId on success", async () => {
    let midFlightIsDrafting = false;

    const captureInvoker = vi.fn(async (_cmd: string, _args: Record<string, unknown>) => {
      midFlightIsDrafting = store.getState().isDrafting;
      return DRAFT_ID;
    });
    store = createApplicationDraftStore(
      captureInvoker as (cmd: string, args: Record<string, unknown>) => Promise<string>,
      errMsg as (e: unknown) => string,
    );

    await store.getState().draft("match-abc");

    expect(midFlightIsDrafting).toBeTruthy();

    const s = store.getState();
    expect(s.isDrafting).toBe(false);
    expect(s.draftId).toBe(DRAFT_ID);
    expect(s.error).toBe(null);
  });

  it("invokes draft_application with camelCase jobMatchId arg", async () => {
    await store.getState().draft("match-xyz");

    expect(invoker.mock.calls.length).toBe(1);
    const [cmd, args] = invoker.mock.calls[0] as [string, Record<string, unknown>];
    expect(cmd).toBe("draft_application");
    expect(args).toEqual({ jobMatchId: "match-xyz" });
  });

  it("sets error and clears isDrafting on backend failure", async () => {
    const rejectInvoker = makeRejectingInvoker("AI provider not configured");
    store = createApplicationDraftStore(
      rejectInvoker as (cmd: string, args: Record<string, unknown>) => Promise<string>,
      errMsg as (e: unknown) => string,
    );

    await store.getState().draft("match-123");

    const s = store.getState();
    expect(s.isDrafting).toBe(false);
    expect(s.draftId).toBe(null);
    expect(s.error).toBe("AI provider not configured");
  });

  it("submits the current draft and stores the application run id", async () => {
    await store.getState().draft("match-123");
    await store.getState().submit();

    expect(invoker).toHaveBeenLastCalledWith("submit_application", {
      applicationDraftId: DRAFT_ID,
    });
    expect(store.getState().runId).toBe(DRAFT_ID);
    expect(store.getState().isSubmitting).toBe(false);
  });

  it("does not submit before a draft exists", async () => {
    await store.getState().submit();
    expect(invoker).not.toHaveBeenCalled();
  });

  it("clearDraft resets draftId, isDrafting, and error", async () => {
    await store.getState().draft("match-abc");
    expect(store.getState().draftId).toBe(DRAFT_ID);

    store.getState().clearDraft();

    const s = store.getState();
    expect(s.draftId).toBe(null);
    expect(s.isDrafting).toBe(false);
    expect(s.isSubmitting).toBe(false);
    expect(s.runId).toBe(null);
    expect(s.error).toBe(null);
  });

  it("clearError clears error and preserves draftId", async () => {
    // Put a known draftId into state, then inject an error via setState.
    await store.getState().draft("match-ok");
    expect(store.getState().draftId).toBe(DRAFT_ID);

    store.setState({ error: "transient error" });
    expect(store.getState().error).toBe("transient error");

    store.getState().clearError();

    const s = store.getState();
    expect(s.error).toBe(null);
    expect(s.draftId).toBe(DRAFT_ID); // preserved
  });

  it("a second draft call for a different match replaces draftId", async () => {
    const SECOND_ID = "00000000-0000-0000-0000-000000000002";
    let callCount = 0;
    const twoResultInvoker = vi.fn(async (_cmd: string, _args: Record<string, unknown>) => {
      callCount += 1;
      return callCount === 1 ? DRAFT_ID : SECOND_ID;
    });
    store = createApplicationDraftStore(
      twoResultInvoker as (cmd: string, args: Record<string, unknown>) => Promise<string>,
      errMsg as (e: unknown) => string,
    );

    await store.getState().draft("match-1");
    expect(store.getState().draftId).toBe(DRAFT_ID);

    await store.getState().draft("match-2");
    const s = store.getState();
    expect(s.draftId).toBe(SECOND_ID);
    expect(s.error).toBe(null);
    expect(s.isDrafting).toBe(false);
  });
});
