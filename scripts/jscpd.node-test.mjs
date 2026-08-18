import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJscpdArgs,
  DEFAULT_IGNORES,
  DEFAULT_THRESHOLD,
  parseCliArgs,
  summarizeReport,
} from "./jscpd.mjs";

test("parseCliArgs applies quality options and preserves paths", () => {
  const options = parseCliArgs([
    "src",
    "--min-lines",
    "12",
    "--threshold",
    "4.5",
    "--reporters",
    "console,json",
    "--ignore",
    "vendor/**",
  ]);
  assert.deepEqual(options.paths, ["src"]);
  assert.equal(options.minLines, 12);
  assert.equal(options.threshold, 4.5);
  assert.deepEqual(options.reporters, ["console", "json"]);
  assert.deepEqual(options.ignores.slice(-1), ["vendor/**"]);
});

test("buildJscpdArgs emits a deterministic command line", () => {
  const args = buildJscpdArgs(parseCliArgs(["src"]));
  assert.deepEqual(args.slice(0, 3), ["src", "--reporters", "console,json"]);
  assert.ok(args.includes("--no-colors"));
});

test("default policy ignores generated/vendor output and caps duplication", () => {
  const options = parseCliArgs([]);
  assert.equal(options.threshold, DEFAULT_THRESHOLD);
  assert.ok(options.ignores.includes("**/generated/**"));
  assert.deepEqual(options.ignores, DEFAULT_IGNORES);
});

test("summarizeReport extracts the total duplication metrics", () => {
  const summary = summarizeReport(
    {
      statistics: {
        detectionDate: "2026-01-01T00:00:00.000Z",
        total: {
          clones: 2,
          duplicatedLines: 8,
          percentage: 1.5,
          sources: 4,
          lines: 500,
          tokens: 900,
        },
      },
    },
    parseCliArgs(["src"]),
  );
  assert.deepEqual(summary.summary, {
    clones: 2,
    duplicated_lines: 8,
    duplication_percent: 1.5,
    files: 4,
    lines: 500,
    tokens: 900,
  });
});
