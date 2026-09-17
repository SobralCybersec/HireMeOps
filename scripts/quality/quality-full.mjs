import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_DIR = path.join(ROOT, "reports/quality");

export function fullQualityEnvironment(environment = process.env) {
  return {
    ...environment,
    QUALITY_RUN_MUTATION: "1",
    QUALITY_RUN_MUTATION_RUST: "1",
    QUALITY_RUN_RUNTIME_BENCHMARKS: "0",
    QUALITY_RUN_STRICT: "1",
  };
}

async function readSummary() {
  try {
    return JSON.parse(await readFile(path.join(REPORT_DIR, "summary.json"), "utf8"));
  } catch {
    return null;
  }
}

function printSummary(summary) {
  if (!summary) return;
  const coverage = summary.coverage ?? {};
  const tests = summary.tests ?? {};
  const rust = summary.rust_coverage ?? {};
  const mutation = summary.mutation ?? {};
  const rustMutation = mutation.rust ?? {};
  const lines = [
    `[quality-summary] overall=${summary.overall}`,
    `[quality-summary] coverage lines=${coverage.lines_percent ?? "n/a"}% statements=${coverage.statements_percent ?? "n/a"}% branches=${coverage.branches_percent ?? "n/a"}% functions=${coverage.functions_percent ?? "n/a"}%`,
    `[quality-summary] rust lines=${rust.lines?.percent ?? "n/a"}% critical-production=${rust.critical_scope?.status ?? "n/a"}`,
    `[quality-summary] tests passed=${tests.passed ?? "n/a"} failed=${tests.failures ?? "n/a"} skipped=${tests.skipped ?? "n/a"}`,
    `[quality-summary] duplication=${summary.duplication_percent ?? "n/a"}% complexity=${summary.complexity_status ?? "n/a"} architecture=${summary.architecture_violations ?? "n/a"}`,
    `[quality-summary] violations errors=${summary.violations?.errors ?? "n/a"} warnings=${summary.violations?.warnings ?? "n/a"}`,
    `[quality-summary] mutation js=${mutation.javascript?.mutation_score_percent ?? "n/a"}% rust-raw=${rustMutation.raw_mutation_score_percent ?? "n/a"}% rust-scorable=${rustMutation.scorable_mutation_score_percent ?? "n/a"}%`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function run(command, args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    child.on("error", (error) => resolveRun({ code: 127, error: error.message }));
    child.on("close", (code, signal) => resolveRun({ code: code ?? 1, signal }));
  });
}

export async function main(argv = process.argv.slice(2)) {
  await mkdir(REPORT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await run("bun", ["run", "quality", ...argv], fullQualityEnvironment());
  const summary = await readSummary();
  printSummary(summary);
  const report = {
    generated_at: startedAt,
    command: ["bun", "run", "quality", ...argv].join(" "),
    enabled: [
      "tests",
      "coverage",
      "strict",
      "quality-tools",
      "javascript-mutation",
      "rust-mutation",
    ],
    exit_code: result.code,
    signal: result.signal ?? null,
    status: result.code === 0 ? "pass" : "fail",
    summary: "reports/quality/summary.json",
    quality_summary: summary,
  };
  await writeFile(
    path.join(REPORT_DIR, "quality-full.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(REPORT_DIR, "quality-full.md"),
    [
      "# Full quality run",
      "",
      `Status: **${report.status.toUpperCase()}**`,
      `Command: \`${report.command}\``,
      `Enabled: ${report.enabled.join(", ")}`,
      "",
      "Detailed results: `reports/quality/summary.json`.",
    ].join("\n") + "\n",
  );
  process.stdout.write(`Full quality: ${report.status.toUpperCase()}\n`);
  process.stdout.write("Reports: reports/quality/quality-full.json\n");
  return result.code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
