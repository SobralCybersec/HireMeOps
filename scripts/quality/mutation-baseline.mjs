import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./strict-tests/quality-metrics.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const QUALITY_DIR = path.join(ROOT, "reports/quality");
const MUTATION_DIR = path.join(ROOT, "reports/mutation");

function mutationSummary(report) {
  const mutants = Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? []);
  const statuses = Object.fromEntries(
    [...new Set(mutants.map((mutant) => mutant.status))].map((status) => [
      status,
      mutants.filter((mutant) => mutant.status === status).length,
    ]),
  );
  const excluded = mutants.filter((mutant) => ["NoCoverage", "Ignored"].includes(mutant.status));
  const scorable = mutants.length - excluded.length;
  const killed = mutants.filter((mutant) => mutant.status === "Killed").length;
  return {
    files: Object.keys(report.files ?? {}).length,
    mutants: mutants.length,
    scorable,
    killed,
    mutation_score_percent: scorable ? Math.round((killed / scorable) * 10000) / 100 : null,
    statuses,
  };
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function runJavaScriptMutation() {
  const result = await runCommand("bun", ["x", "stryker", "run", "stryker.config.mjs"], {
    cwd: ROOT,
  });
  const reportPath = path.join(MUTATION_DIR, "stryker.json");
  if (!(await fileExists(reportPath))) {
    return { status: "failed", exit_code: result.code, error: "stryker_report_missing" };
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  return {
    status: result.code === 0 ? "pass" : "failed",
    exit_code: result.code,
    ...mutationSummary(report),
    artifacts: ["reports/mutation/stryker.json", "reports/mutation/index.html"],
  };
}

async function runRustMutation() {
  if (process.argv.includes("--rust-report-only")) return readRustMutationOutcome();
  const result = await runCommand(
    "cargo",
    [
      "mutants",
      "--file",
      "src/storage/session_crypto.rs",
      "--jobs",
      "1",
      "--no-shuffle",
      "--baseline",
      "run",
    ],
    { cwd: path.join(ROOT, "src-tauri") },
  );
  return {
    status: result.code === 0 ? "pass" : "failed",
    exit_code: result.code,
    scope: ["src-tauri/src/storage/session_crypto.rs"],
  };
}

async function readRustMutationOutcome() {
  const file = path.join(ROOT, "src-tauri/mutants.out/outcomes.json");
  try {
    const outcome = JSON.parse(await readFile(file, "utf8"));
    return {
      status: "baseline",
      exit_code: outcome.missed === 0 && outcome.timeout === 0 ? 0 : 1,
      total_mutants: outcome.total_mutants,
      caught: outcome.caught,
      missed: outcome.missed,
      timeout: outcome.timeout,
      unviable: outcome.unviable,
      mutation_score_percent:
        outcome.total_mutants > 0
          ? Math.round((outcome.caught / outcome.total_mutants) * 10000) / 100
          : null,
      scope: ["src-tauri/src/storage/session_crypto.rs"],
    };
  } catch {
    return {
      status: "not-run",
      scope: ["src-tauri/src/storage/session_crypto.rs"],
      error: "cargo_mutants_outcome_missing",
    };
  }
}

function markdownReport(report) {
  const javascript = report.javascript;
  const rust = report.rust;
  return [
    "# Mutation baseline",
    "",
    `JavaScript status: **${javascript.status}**`,
    `- Files: ${javascript.files ?? "not measured"}`,
    `- Mutants: ${javascript.mutants ?? "not measured"}`,
    `- Scorable: ${javascript.scorable ?? "not measured"}`,
    `- Killed: ${javascript.killed ?? "not measured"}`,
    `- Score: ${javascript.mutation_score_percent ?? "not measured"}%`,
    "",
    `Rust status: **${rust.status}**`,
    `- Scope: ${rust.scope.join(", ")}`,
    `- Mutants: ${rust.total_mutants ?? "not measured"}`,
    `- Caught: ${rust.caught ?? "not measured"}`,
    `- Missed: ${rust.missed ?? "not measured"}`,
    `- Score: ${rust.mutation_score_percent ?? "not measured"}%`,
    "",
    "Mutation score is baseline evidence, not a coverage substitute. No production threshold is enforced yet.",
  ].join("\n");
}

const includeRust =
  process.argv.includes("--rust") ||
  process.argv.includes("--rust-report-only") ||
  process.env.QUALITY_RUN_RUST_MUTATION === "1";
const rustReportOnly = process.argv.includes("--rust-report-only");
await mkdir(QUALITY_DIR, { recursive: true });
await mkdir(MUTATION_DIR, { recursive: true });
const javascript = rustReportOnly
  ? (await fileExists(path.join(QUALITY_DIR, "mutation.json")))
    ? JSON.parse(await readFile(path.join(QUALITY_DIR, "mutation.json"), "utf8")).javascript
    : { status: "not-run" }
  : await runJavaScriptMutation();
const rust = includeRust
  ? await runRustMutation()
  : { status: "not-run", scope: ["src-tauri/src/storage/session_crypto.rs"] };
const report = {
  generated_at: new Date().toISOString(),
  status: javascript.status === "pass" ? "pass" : "failed",
  javascript,
  rust,
  policy: { threshold_percent: null, rust_scope_is_focused: true },
};
await writeFile(path.join(QUALITY_DIR, "mutation.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(QUALITY_DIR, "mutation.md"), `${markdownReport(report)}\n`);
console.log(JSON.stringify({ status: report.status, javascript, rust }, null, 2));
