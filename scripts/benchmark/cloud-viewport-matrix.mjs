import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_VIEWPORTS = ["1024x768", "900x675", "800x600"];
const DEFAULT_PLATFORMS = [
  "linkedin",
  "linkedin_posts",
  "google",
  "indeed",
  "gupy",
  "catho",
  "infojobs",
  "upwork",
  "freelas99",
  "programathor",
  "geekhunter",
];
const DEFAULTS = {
  image: "hiremeops-cloud-worker:quality",
  output: "reports/quality/viewport-benchmark.json",
  timeoutMs: 120_000,
  memory: "512m",
  cpus: "0.2",
  shmSize: "64m",
};

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = { ...DEFAULTS, platforms: DEFAULT_PLATFORMS, viewports: DEFAULT_VIEWPORTS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--image") options.image = nextValue(argv, index++, flag);
    else if (flag === "--output") options.output = nextValue(argv, index++, flag);
    else if (flag === "--timeout-ms") options.timeoutMs = Number(nextValue(argv, index++, flag));
    else if (flag === "--memory") options.memory = nextValue(argv, index++, flag);
    else if (flag === "--cpus") options.cpus = nextValue(argv, index++, flag);
    else if (flag === "--shm-size") options.shmSize = nextValue(argv, index++, flag);
    else if (flag === "--platforms") options.platforms = nextValue(argv, index++, flag).split(",");
    else if (flag === "--viewports") options.viewports = nextValue(argv, index++, flag).split(",");
    else throw new Error(`unknown option ${flag}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("--timeout-ms must be positive");
  }
  return options;
}

function runArgs(options, platform, viewport) {
  return [
    "run",
    "--rm",
    "--memory",
    options.memory,
    "--memory-swap",
    options.memory,
    "--cpus",
    options.cpus,
    "--shm-size",
    options.shmSize,
    "--entrypoint",
    "dumb-init",
    "-v",
    `${path.join(ROOT, "automation/cloud-viewport-benchmark.mjs")}:/app/automation/cloud-viewport-benchmark.mjs:ro`,
    options.image,
    "--",
    "node",
    "cloud-viewport-benchmark.mjs",
    "--platform",
    platform,
    "--viewport",
    viewport,
  ];
}

function parseRow(stdout) {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value.platform && value.viewport) return value;
    } catch {
      // Docker/Chromium diagnostics are intentionally ignored.
    }
  }
  return null;
}

function runCase(options, platform, viewport) {
  const started = performance.now();
  const child = spawnSync("docker", runArgs(options, platform, viewport), {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 1_000_000,
  });
  const row = parseRow(child.stdout ?? "");
  const exitCode = child.error?.code === "ETIMEDOUT" ? 124 : (child.status ?? 1);
  return {
    ...(row ?? {
      platform,
      viewport,
      durationMs: +(performance.now() - started).toFixed(1),
      count: 0,
      selectorsWorked: false,
      fieldsValid: false,
      pagination: false,
      responsiveLayout: "not-validated",
    }),
    exitCode,
    timeout: exitCode === 124 || Boolean(row?.timeout),
    oom: exitCode === 137 || Boolean(row?.oom),
    stderrLines: (child.stderr ?? "").trim() ? child.stderr.trim().split("\n").length : 0,
  };
}

function valid(row) {
  return row.exitCode === 0 && !row.timeout && !row.oom && row.selectorsWorked === true;
}

function smallestValid(rows, platform) {
  return (
    rows
      .filter((row) => row.platform === platform && valid(row))
      .sort(
        (left, right) =>
          DEFAULT_VIEWPORTS.indexOf(right.viewport) - DEFAULT_VIEWPORTS.indexOf(left.viewport),
      )[0]?.viewport ?? null
  );
}

export function summarizeViewportRuns(rows, options) {
  const platforms = [...new Set(rows.map((row) => row.platform))];
  const smallestByPlatform = Object.fromEntries(
    platforms.map((platform) => [platform, smallestValid(rows, platform)]),
  );
  const global =
    [...options.viewports]
      .reverse()
      .find((viewport) =>
        platforms.every((platform) =>
          rows.some((row) => row.platform === platform && row.viewport === viewport && valid(row)),
        ),
      ) ?? null;
  return {
    total: rows.length,
    valid: rows.filter(valid).length,
    failed: rows.filter((row) => !valid(row)).length,
    timeout: rows.filter((row) => row.timeout).length,
    oom: rows.filter((row) => row.oom).length,
    smallestValidViewport: global,
    smallestValidByPlatform: smallestByPlatform,
    platforms,
    viewports: options.viewports,
  };
}

function cell(row) {
  if (!row) return "—";
  return valid(row)
    ? `PASS (${row.count} results, ${row.durationMs} ms, ${row.cgroupPeakMb ?? "?"} MB)`
    : `FAIL (${row.error ?? `exit ${row.exitCode}`})`;
}

export function renderViewportReport(report) {
  const { options, runs, summary } = report;
  const header = [
    "| Platform",
    ...options.viewports.map((viewport) => ` ${viewport}`),
    " Smallest valid |",
  ].join(" |");
  const separator = ["| ---", ...options.viewports.map(() => " ---:"), " --- |"].join(" |");
  const rows = summary.platforms.map((platform) => {
    const cells = options.viewports.map((viewport) =>
      cell(runs.find((row) => row.platform === platform && row.viewport === viewport)),
    );
    return `| ${platform} | ${cells.join(" | ")} | ${summary.smallestValidByPlatform[platform] ?? "none"} |`;
  });
  return [
    "# Cloud viewport benchmark",
    "",
    `Image: \`${options.image}\`; limit: ${options.memory} RAM, ${options.cpus} CPU, ${options.shmSize} /dev/shm.`,
    "",
    header,
    separator,
    ...rows,
    "",
    `Runs: ${summary.valid}/${summary.total} valid; timeouts: ${summary.timeout}; OOM: ${summary.oom}.`,
    `Smallest valid viewport globally: ${summary.smallestValidViewport ?? "none"}.`,
    "",
    "Detailed JSON retains duration, cgroup peak/current, PSS, process count, result count, fields, pagination, and layout observations.",
  ].join("\n");
}

async function writeReport(report) {
  const output = path.resolve(ROOT, report.options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(output.replace(/\.json$/, ".md"), `${renderViewportReport(report)}\n`);
  return output;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runs = [];
  for (const platform of options.platforms) {
    for (const viewport of options.viewports) {
      process.stderr.write(`[viewport-matrix] ${platform} ${viewport}\n`);
      runs.push(runCase(options, platform, viewport));
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    workload: "synthetic browser fixture; no real credentials",
    options,
    runs,
    summary: summarizeViewportRuns(runs, options),
  };
  const output = await writeReport(report);
  process.stdout.write(`${JSON.stringify({ output, ...report.summary })}\n`);
  return report.summary.failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
