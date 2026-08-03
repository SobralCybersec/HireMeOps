// Tests perf.js in its default disabled state (HIREMEOPS_PERF unset): zero-overhead no-ops.
import { describe, it, expect } from "vitest";
import { perfEnabled, nowMs, logSpan, initPerf } from "./perf.js";

describe("perf (disabled by default)", () => {
  it("reports disabled when the env flag is unset", () => {
    expect(perfEnabled()).toBe(false);
  });

  it("nowMs returns a monotonic-ish millisecond number", () => {
    const a = nowMs();
    const b = nowMs();
    expect(typeof a).toBe("number");
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("logSpan is a no-op when disabled (no throw, no output)", () => {
    expect(() => logSpan("cmd", { cmd: "open", ms: 12.3 })).not.toThrow();
    expect(logSpan("x", {})).toBeUndefined();
  });

  it("initPerf returns { enabled: false } and starts nothing", () => {
    expect(initPerf()).toEqual({ enabled: false });
  });
});
