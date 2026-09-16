// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errMessage, invokeStrict, safeInvoke } from "./tauriInvoke";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_ENABLE_MOCKS", "false");
});

describe("tauri invoke wrappers", () => {
  it("returns values and collapses optional read failures", async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true });
    expect(await safeInvoke("read", { id: 1 })).toEqual({ ok: true });
    mockInvoke.mockRejectedValueOnce(new Error("offline"));
    expect(await safeInvoke("read")).toBeNull();
  });

  it("keeps strict command failures and normalizes errors", async () => {
    mockInvoke.mockRejectedValueOnce("backend failed");
    await expect(invokeStrict("write")).rejects.toBe("backend failed");
    expect(errMessage("text")).toBe("text");
    expect(errMessage(new Error("boom"))).toBe("boom");
    expect(errMessage({ code: "E_TEST" })).toBe('{"code":"E_TEST"}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errMessage(circular)).toBe("[object Object]");
  });

  it("uses known development mocks before crossing the Tauri boundary", async () => {
    vi.stubEnv("VITE_ENABLE_MOCKS", "true");
    expect(await safeInvoke("list_profiles")).toHaveLength(3);
    expect(await invokeStrict("create_first_time_cv_rewrite")).toBe("mock-first-cv-rewrite");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
