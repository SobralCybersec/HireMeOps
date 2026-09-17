import { describe, expect, it } from "vitest";
import { deltaCpuStats, parseCpuMax, parseKeyValues, readCgroupCpu } from "../cloud-memory.mjs";

describe("cgroup CPU telemetry", () => {
  it("parses cpu.stat keys without relying on line order", () => {
    expect(
      parseKeyValues("nr_throttled 7\nusage_usec 1200\nnr_periods 9\nthrottled_usec 300"),
    ).toEqual({ nr_throttled: 7, usage_usec: 1200, nr_periods: 9, throttled_usec: 300 });
  });

  it("parses bounded cpu.max quota", () => {
    expect(parseCpuMax("20000 100000\n")).toEqual({
      quotaUsec: 20000,
      periodUsec: 100000,
      quotaCpus: 0.2,
    });
    expect(parseCpuMax("max 100000")).toMatchObject({
      quotaUsec: null,
      periodUsec: 100000,
      quotaCpus: null,
    });
  });

  it("calculates cpu.stat deltas between checkpoints", () => {
    expect(
      deltaCpuStats(
        { usage_usec: 180, nr_periods: 12, nr_throttled: 5, throttled_usec: 90 },
        { usage_usec: 100, nr_periods: 10, nr_throttled: 3, throttled_usec: 40 },
      ),
    ).toMatchObject({
      usageUsecDelta: 80,
      nrPeriodsDelta: 2,
      nrThrottledDelta: 2,
      throttledUsecDelta: 50,
    });
  });

  it("returns a safe shape when cgroup CPU files are unavailable", () => {
    const cpu = readCgroupCpu();
    expect(cpu).toHaveProperty("stat");
    expect(cpu).toHaveProperty("quotaCpus");
  });
});
