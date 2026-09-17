import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./strict-tests/quality-metrics.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_DIR = path.join(ROOT, "reports/quality");

function findingsForReport(results) {
  return results.map((finding) => ({
    check_id: finding.check_id,
    path: finding.path,
    start_line: finding.start?.line ?? null,
    severity: finding.extra?.severity ?? "INFO",
    message: String(finding.extra?.message ?? "").slice(0, 240),
  }));
}

function markdown(report) {
  const rows = Object.entries(report.by_severity).map(
    ([severity, count]) => `| ${severity} | ${count} | report-only |`,
  );
  return [
    "# Semgrep inventory",
    "",
    `Status: **${report.status}**`,
    `Scanner execution: **${report.scanner_execution}**`,
    `Findings policy: **${report.findings_policy}**`,
    `Findings: ${report.findings.length}`,
    "",
    "| Severity | Findings | Policy |",
    "| --- | ---: | --- |",
    ...rows,
    "",
    "Findings are historical/static-analysis evidence; no autofix or authentication-bypass behavior is introduced.",
  ].join("\n");
}

const result = await runCommand(
  "semgrep",
  [
    "scan",
    "--config",
    "auto",
    "--json",
    "--quiet",
    "--exclude",
    ".stryker-tmp",
    "--exclude",
    "reports",
    "--exclude",
    "node_modules",
    "--exclude",
    "target",
    "--exclude",
    "dist",
    // GitHub Actions expressions are validated by actionlint; Semgrep's
    // auto-rules currently parse `${{ }}` snippets as shell and emit parser
    // errors before producing a complete report.
    "--exclude",
    ".github/workflows",
  ],
  { cwd: ROOT },
);
let parsed;
let parsedSuccessfully = false;
try {
  parsed = JSON.parse(result.stdout);
  parsedSuccessfully = true;
} catch {
  parsed = { results: [], errors: [{ message: "semgrep_json_missing" }] };
}
const findings = findingsForReport(parsed.results ?? []);
const bySeverity = Object.fromEntries(
  [...new Set(findings.map((finding) => finding.severity))].map((severity) => [
    severity,
    findings.filter((finding) => finding.severity === severity).length,
  ]),
);
const scannerExecution =
  result.code === 0 && parsedSuccessfully && (parsed.errors ?? []).length === 0 ? "pass" : "failed";
const errors = (parsed.errors ?? []).map((error) => String(error.message ?? error).slice(0, 240));
if (result.code !== 0) {
  errors.push(`semgrep_exit_${result.code}`);
}
const report = {
  generated_at: new Date().toISOString(),
  status: scannerExecution === "pass" ? "report-only" : "failed",
  scanner_execution: scannerExecution,
  findings_policy: "report-only",
  exit_code: result.code,
  by_severity: bySeverity,
  findings,
  errors,
};
await mkdir(REPORT_DIR, { recursive: true });
await writeFile(path.join(REPORT_DIR, "semgrep.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(REPORT_DIR, "semgrep.md"), `${markdown(report)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, findings: findings.length })}\n`);
if (report.status === "failed") process.exitCode = 1;
