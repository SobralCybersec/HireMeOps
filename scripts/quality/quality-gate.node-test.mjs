import assert from "node:assert/strict";
import test from "node:test";
import { parseQualityGateArgs, scanTechnicalDebt } from "./quality-gate.mjs";
import { productionScopeCoverage } from "./quality-gate-reports.mjs";

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

test("rust coverage scopes production functions before test module", () => {
  const source = "fn encrypt() {}\n\n#[cfg(test)]\nmod tests {}\n";
  const record = [
    "SF:src-tauri/src/storage/session_crypto.rs",
    "FN:1,encrypt",
    "FN:4,test",
    "FNDA:1,encrypt",
    "FNDA:0,test",
    "FNF:2",
    "FNH:1",
    "DA:1,1",
    "DA:4,0",
    "LF:2",
    "LH:1",
    "end_of_record",
  ].join("\n");
  const coverage = productionScopeCoverage(record, source);
  assert.equal(coverage.lines.percent, 100);
  assert.equal(coverage.functions.percent, 100);
  assert.equal(coverage.status, "pass");
});
