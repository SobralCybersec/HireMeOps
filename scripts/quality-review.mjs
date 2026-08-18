import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkFileSizes,
  formatFileSizeReport,
  HARD_LIMIT,
  REVIEW_LIMIT,
} from "./check-file-size.mjs";
import { DEFAULT_IGNORES, DEFAULT_MIN_LINES, DEFAULT_THRESHOLD, runJscpd } from "./jscpd.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportRoot = resolve(repoRoot, "reports/quality");
const sourcePaths = ["src", "scripts", "automation", "src-tauri/src"];
const LIZARD_REVIEW = { length: 50, arguments: 4 };
const LIZARD_GATE = { length: 80, arguments: 6 };

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      resolveRun({
        code: 127,
        missing: error.code === "ENOENT",
        stdout,
        stderr: `${stderr}${error.message}`,
      }),
    );
    child.on("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

async function runLizardWithLimits(limits) {
  const args = [
    ...sourcePaths,
    "--CCN",
    "10",
    "--length",
    String(limits.length),
    "--arguments",
    String(limits.arguments),
    "--warnings_only",
  ];
  const direct = await run("lizard", args);
  if (!direct.missing) return markLizardFindings(direct);
  const fallback = await run("python", ["-m", "lizard", ...args]);
  if (/No module named lizard/.test(fallback.stderr)) fallback.missing = true;
  return markLizardFindings(fallback);
}

function markLizardFindings(result) {
  if (result.code === 0 && result.stdout.trim()) result.code = 1;
  return result;
}

async function runLizard(strict) {
  const review = await runLizardWithLimits(LIZARD_REVIEW);
  const gate = strict || review.missing ? review : await runLizardWithLimits(LIZARD_GATE);
  return { review, gate };
}

async function writeReport(name, content) {
  await writeFile(resolve(reportRoot, name), `${content.trim()}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const strict = argv.includes("--strict");
  await mkdir(reportRoot, { recursive: true });

  const fileSize = await checkFileSizes();
  await writeReport("file-size.txt", formatFileSizeReport(fileSize));

  let jscpd;
  try {
    jscpd = await runJscpd({
      paths: sourcePaths,
      output: resolve(reportRoot, "jscpd"),
      metrics: resolve(reportRoot, "jscpd-metrics.json"),
      reporters: ["json"],
      minLines: DEFAULT_MIN_LINES,
      threshold: DEFAULT_THRESHOLD,
      ignores: DEFAULT_IGNORES,
    });
    await writeReport("jscpd.txt", JSON.stringify(jscpd.metrics, null, 2));
  } catch (error) {
    jscpd = { exitCode: 1, error: error.message };
    await writeReport("jscpd.txt", error.message);
  }

  const lizard = await runLizard(strict);
  await writeReport(
    "lizard-review.txt",
    lizard.review.stdout || lizard.review.stderr || "lizard: no findings",
  );
  await writeReport(
    "lizard-gate.txt",
    lizard.gate.stdout || lizard.gate.stderr || "lizard: no findings",
  );

  const summary = {
    mode: strict ? "strict" : "default",
    file_size: {
      files: fileSize.files.length,
      review: fileSize.review.length,
      oversized: fileSize.oversized.length,
    },
    jscpd: {
      exit_code: jscpd.exitCode,
      duplication_percent: jscpd.metrics?.summary?.duplication_percent ?? null,
    },
    policy: {
      duplication_percent_max: DEFAULT_THRESHOLD,
      cyclomatic_complexity_max: 10,
      function_length_review: LIZARD_REVIEW.length,
      function_length_hard: LIZARD_GATE.length,
      parameters_review: LIZARD_REVIEW.arguments,
      parameters_hard: LIZARD_GATE.arguments,
      file_lines_review: REVIEW_LIMIT,
      file_lines_hard: HARD_LIMIT,
    },
    lizard: {
      exit_code: lizard.gate.code,
      review_exit_code: lizard.review.code,
      available: !lizard.gate.missing && lizard.gate.code !== 127,
    },
  };
  await writeReport("summary.json", JSON.stringify(summary, null, 2));
  return fileSize.oversized.length || jscpd.exitCode || lizard.gate.code ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
