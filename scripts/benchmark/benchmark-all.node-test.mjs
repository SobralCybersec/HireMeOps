import assert from "node:assert/strict";
import test from "node:test";
import { benchmarkTasks, taskSummary } from "./benchmark-all.mjs";

test("benchmark all exposes deterministic benchmark order", () => {
  assert.deepEqual(
    benchmarkTasks().map((task) => task.name),
    ["changes", "cloud-memory", "cloud-viewport", "cloud-performance"],
  );
  assert.ok(benchmarkTasks().every((task) => task.command === "bun"));
});

test("benchmark all derives bounded measurements from nested reports", () => {
  const measurement = taskSummary("cloud-memory", {
    stages: [
      {
        cgroupPeakMb: 180,
        cgroupCurrentMb: 170,
        nodePssMb: 90,
        chromiumPssMb: 80,
        chromiumProcesses: 3,
      },
    ],
  });
  assert.deepEqual(measurement, {
    name: "cloud-memory",
    status: "measured",
    peakMb: 180,
    currentMaxMb: 170,
    nodePssMaxMb: 90,
    chromiumPssMaxMb: 80,
    chromiumProcessesMax: 3,
    stages: 1,
  });
});
