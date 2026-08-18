import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUTPUT = resolve(repoRoot, "reports/quality/jscpd");
const DEFAULT_METRICS = resolve(repoRoot, "reports/quality/jscpd-metrics.json");
export const DEFAULT_REPORTERS = ["console", "json"];
export const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/target/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/generated/**",
  "**/*.generated.*",
  "**/*.min.*",
  "**/*.snap",
  "**/reports/**",
  "src-tauri/resources/node/**",
  "README.pt-BR.md",
];
export const DEFAULT_MIN_LINES = 10;
export const DEFAULT_THRESHOLD = 5;

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function percentage(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
    throw new Error(`${name} must be between 0 and 100`);
  return parsed;
}

function requiredValue(argv, index, argument) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
  return value;
}

function reporters(value) {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parsed.length === 0) throw new Error("--reporters requires at least one reporter");
  return parsed;
}

export function parseCliArgs(argv) {
  const options = {
    metrics: DEFAULT_METRICS,
    minLines: DEFAULT_MIN_LINES,
    output: DEFAULT_OUTPUT,
    reporters: [...DEFAULT_REPORTERS],
    threshold: DEFAULT_THRESHOLD,
    ignores: [...DEFAULT_IGNORES],
    paths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) {
      options.paths.push(argument);
      continue;
    }
    const value = requiredValue(argv, index, argument);
    if (argument === "--reporters") options.reporters = reporters(value);
    else if (argument === "--output") options.output = resolve(value);
    else if (argument === "--metrics") options.metrics = resolve(value);
    else if (argument === "--min-lines") options.minLines = positiveInteger(value, "--min-lines");
    else if (argument === "--threshold") options.threshold = percentage(value, "--threshold");
    else if (argument === "--ignore")
      options.ignores.push(
        ...value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }

  if (!options.reporters.includes("json")) options.reporters.push("json");
  if (options.paths.length === 0) options.paths.push(".");
  return options;
}

export function buildJscpdArgs(options) {
  return [
    ...options.paths,
    "--reporters",
    options.reporters.join(","),
    "--output",
    options.output,
    "--min-lines",
    String(options.minLines),
    "--threshold",
    String(options.threshold),
    "--ignore",
    options.ignores.join(","),
    "--no-colors",
    "--no-tips",
  ];
}

export function summarizeReport(report, options) {
  const total = report?.statistics?.total || {};
  return {
    generated_at: report?.statistics?.detectionDate || new Date().toISOString(),
    input: {
      min_lines: options.minLines,
      paths: options.paths,
      reporters: options.reporters,
      ignores: options.ignores,
      threshold_percent: options.threshold,
    },
    summary: {
      clones: total.clones || 0,
      duplicated_lines: total.duplicatedLines || 0,
      duplication_percent: total.percentage || 0,
      files: total.sources || 0,
      lines: total.lines || 0,
      tokens: total.tokens || 0,
    },
    tool: "jscpd",
    version: "5.0.16",
  };
}

function spawnJscpd(options) {
  const command = resolve(
    repoRoot,
    `node_modules/.bin/jscpd${process.platform === "win32" ? ".cmd" : ""}`,
  );
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, buildJscpdArgs(options), { cwd: repoRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolveRun(code ?? 1));
  });
}

export async function runJscpd(options) {
  await mkdir(options.output, { recursive: true });
  const exitCode = await spawnJscpd(options);
  const reportPath = resolve(options.output, "jscpd-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const metrics = summarizeReport(report, options);
  await mkdir(resolve(options.metrics, ".."), { recursive: true });
  await writeFile(options.metrics, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Metrics written to ${options.metrics}`);
  return { exitCode, metrics, reportPath };
}

export function helpText() {
  return `Usage: node scripts/jscpd.mjs [PATH...] [options]

Options:
  --reporters LIST  Comma-separated jscpd reporters (json is always added)
  --output PATH     jscpd report directory (default: reports/quality/jscpd)
  --metrics PATH    Summary metrics file (default: reports/quality/jscpd-metrics.json)
  --min-lines N     Minimum duplicated lines (default: 10)
  --threshold N     Maximum duplication percentage (default: 5)
  --ignore LIST     Additional comma-separated ignore globs`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(helpText());
    return 0;
  }
  const result = await runJscpd(options);
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
