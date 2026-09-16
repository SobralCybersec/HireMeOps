import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./strict-tests/quality-metrics.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_DIR = path.join(ROOT, "reports/quality");

function countIssues(issues) {
  const counts = {};
  for (const issue of issues) {
    for (const [category, values] of Object.entries(issue)) {
      if (category === "file" || !Array.isArray(values)) continue;
      counts[category] = (counts[category] ?? 0) + values.length;
    }
  }
  return counts;
}

function markdown(report) {
  const rows = Object.entries(report.counts).map(
    ([category, count]) => `| ${category} | ${count} | report-only |`,
  );
  return [
    "# Knip inventory",
    "",
    `Files inspected: ${report.files_inspected ?? "not measured"}`,
    `Files with findings: ${report.files_with_findings}`,
    "",
    "| Category | Findings | Policy |",
    "| --- | ---: | --- |",
    ...rows,
    "",
    "Dynamic entrypoints, CSS imports and public barrel exports remain visible for review; this inventory does not delete code.",
  ].join("\n");
}

const result = await runCommand(
  "bun",
  ["x", "knip", "--config", "knip.jsonc", "--reporter", "json", "--no-exit-code"],
  { cwd: ROOT },
);
let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch {
  parsed = { issues: [] };
}
const report = {
  generated_at: new Date().toISOString(),
  status: result.code === 0 ? "pass" : "failed",
  files_inspected: parsed.files?.length ?? null,
  files_with_findings: new Set((parsed.issues ?? []).map((issue) => issue.file)).size,
  counts: countIssues(parsed.issues ?? []),
  issues: parsed.issues ?? [],
};
await mkdir(REPORT_DIR, { recursive: true });
await writeFile(path.join(REPORT_DIR, "knip.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(REPORT_DIR, "knip.md"), `${markdown(report)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, counts: report.counts })}\n`);
if (report.status !== "pass") process.exitCode = 1;
