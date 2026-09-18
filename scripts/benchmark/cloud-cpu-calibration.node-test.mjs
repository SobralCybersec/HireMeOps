import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCpuCalibration } from "./cloud-cpu-calibration.mjs";

const limited = {
  cpuMax: "20000 100000",
  wallMs: 5000,
  processCpuMs: 1000,
  periods: 50,
  throttled: 49,
};

test("verifies an exercised fractional CPU quota", () => {
  assert.equal(classifyCpuCalibration(limited, "0.2"), "verified");
  assert.equal(
    classifyCpuCalibration({ ...limited, cpuMax: "50000 100000", processCpuMs: 2500 }, "0.5"),
    "verified",
  );
});

test("rejects the real local sample despite correct cpu.max", () => {
  assert.equal(
    classifyCpuCalibration({ ...limited, processCpuMs: 4993.52, periods: 0, throttled: 0 }, "0.2"),
    "quota_not_enforced",
  );
});

test("missing counters, short samples and insufficient load are inconclusive", () => {
  for (const sample of [
    { ...limited, cpuMax: "max 100000" },
    { ...limited, wallMs: 100 },
    { ...limited, processCpuMs: 300 },
    { ...limited, periods: 0, throttled: 0 },
    { ...limited, periods: undefined },
    { ...limited, throttled: undefined },
  ])
    assert.equal(classifyCpuCalibration(sample, "0.2"), "inconclusive");
  assert.equal(classifyCpuCalibration(limited, "1"), "inconclusive");
});

test("rejects a different configured quota", () => {
  assert.equal(classifyCpuCalibration(limited, "0.5"), "quota_mismatch");
});
