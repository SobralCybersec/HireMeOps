import assert from "node:assert/strict";
import test from "node:test";
import { parseQualityGateArgs, scanTechnicalDebt } from "./quality-gate.mjs";

test("quality gate parses report-only and bounded flaky options", () => {
  assert.deepEqual(parseQualityGateArgs(["--report-only", "--flaky-runs", "5"]), {
    only: null,
    reportOnly: true,
    flakyRuns: 5,
    strict: false,
  });
});

test("technical debt scanner returns marker metadata without source payload", () => {
  const findings = scanTechnicalDebt(
    "// TODO: remove fixture\n// FIXME: follow up",
    "src/example.ts",
  );
  assert.deepEqual(findings, [
    { file: "src/example.ts", marker: "TODO", line: 1 },
    { file: "src/example.ts", marker: "FIXME", line: 2 },
  ]);
  assert.equal(JSON.stringify(findings).includes("remove fixture"), false);
});
