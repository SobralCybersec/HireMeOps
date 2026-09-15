import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, summarize } from "./benchmark-changes.mjs";

describe("benchmark-changes", () => {
  it("parses benchmark dimensions", () => {
    assert.deepEqual(parseArgs(["--rows", "12", "--rewrites", "4", "--iterations", "3"]), {
      rows: 12,
      rewrites: 4,
      warmup: 2,
      iterations: 3,
      profile: "smoke",
      output: "reports/todo-performance/benchmark-results.json",
      baselineRef: "HEAD",
      candidateRef: null,
      fixture: "reports/todo-performance/sanitized-fixture.sqlite3",
      buildRelease: false,
      createClone: false,
      keepClone: false,
    });
  });

  it("summarizes robust timing statistics", () => {
    assert.deepEqual(summarize([4, 1, 3, 2]), {
      samples: 4,
      minMs: 1,
      p50Ms: 3,
      p90Ms: 4,
      p95Ms: 4,
      p99Ms: 4,
      maxMs: 4,
      meanMs: 2.5,
      stddevMs: 1.118,
    });
  });

  it("selects performance profile defaults", () => {
    const args = parseArgs(["--profile", "performance"]);
    assert.equal(args.warmup, 10);
    assert.equal(args.iterations, 30);
  });
});
