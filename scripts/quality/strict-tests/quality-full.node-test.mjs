import assert from "node:assert/strict";
import test from "node:test";
import { fullQualityEnvironment } from "../quality-full.mjs";

test("full quality enables strict checks and both mutation baselines", () => {
  const environment = fullQualityEnvironment({ EXISTING: "keep" });
  assert.equal(environment.EXISTING, "keep");
  assert.equal(environment.QUALITY_RUN_MUTATION, "1");
  assert.equal(environment.QUALITY_RUN_MUTATION_RUST, "1");
  assert.equal(environment.QUALITY_RUN_RUNTIME_BENCHMARKS, "0");
  assert.equal(environment.QUALITY_RUN_STRICT, "1");
});
