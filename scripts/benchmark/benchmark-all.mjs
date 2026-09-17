import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_DIR = path.join(ROOT, "reports/quality");
const REPORTS = {
  changes: path.join(ROOT, "reports/todo-performance/benchmark-results.json"),
  "cloud-memory": path.join(ROOT, "reports/cloud-memory-host-synthetic.json"),
  "cloud-viewport": path.join(REPORT_DIR, "viewport-benchmark.json"),
  "cloud-performance": path.join(REPORT_DIR, "cloud-performance.json"),
};
const TASKS = [
  ["changes", ["run", "benchmark:changes", "--", "--create-clone"]],
  ["cloud-memory", ["run", "benchmark:cloud-memory"]],
  ["cloud-viewport", ["run", "benchmark:cloud-viewport"]],
  ["cloud-performance", ["run", "benchmark:cloud-performance"]],
];

export function benchmarkTasks() {
  return TASKS.map(([name, args]) => ({ name, command: "bun", args: [...args] }));
}

function runTask(task) {
  return new Promise((resolveTask) => {
    const child = spawn("bun", task.args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", (error) =>
      resolveTask({ ...task, status: "fail", exit_code: 127, error: error.message }),
    );
    child.on("close", (code, signal) =>
      resolveTask({ ...task, status: code === 0 ? "pass" : "fail", exit_code: code ?? 1, signal }),
    );
  });
}

async function readTaskReport(name) {
  try {
    return JSON.parse(await readFile(REPORTS[name], "utf8"));
  } catch {
    return null;
  }
}

export function taskSummary(name, report) {
  if (!report) return { name, status: "report-missing" };
  if (name === "changes") {
    return { name, status: "measured", cases: Object.keys(report.cases ?? {}).length };
  }
  if (name === "cloud-memory") {
    const stages = report.stages ?? [];
    return {
      name,
      status: "measured",
      peakMb:
        report.peakMb ?? Math.max(0, ...stages.map((stage) => Number(stage.cgroupPeakMb) || 0)),
      currentMaxMb: Math.max(0, ...stages.map((stage) => Number(stage.cgroupCurrentMb) || 0)),
      nodePssMaxMb: Math.max(0, ...stages.map((stage) => Number(stage.nodePssMb) || 0)),
      chromiumPssMaxMb: Math.max(0, ...stages.map((stage) => Number(stage.chromiumPssMb) || 0)),
      chromiumProcessesMax: Math.max(
        0,
        ...stages.map((stage) => Number(stage.chromiumProcesses) || 0),
      ),
      stages: stages.length,
    };
  }
  if (name === "cloud-viewport") {
    const summary = report.summary ?? {};
    return {
      name,
      status: "measured",
      valid: `${summary.valid ?? 0}/${summary.total ?? 0}`,
      smallestValidViewport: summary.smallestValidViewport ?? null,
      timeout: summary.timeout ?? 0,
      oom: summary.oom ?? 0,
    };
  }
  const summary = report.summary ?? {};
  return {
    name,
    status: "measured",
    peakMb: summary.cgroupPeakMb ?? null,
    durationMs: summary.maxOperationMs ?? null,
    chromiumPssMb: summary.chromiumPssMaxMb ?? null,
    chromiumProcesses: summary.chromiumProcessesMax ?? null,
    shutdownChromiumProcesses: summary.shutdownChromiumProcesses ?? null,
  };
}

function markdown(report) {
  return [
    "# Benchmark all",
    "",
    `Overall: **${report.status.toUpperCase()}**`,
    "",
    "| Benchmark | Status | Exit code |",
    "| --- | --- | ---: |",
    ...report.tasks.map((task) => `| ${task.name} | ${task.status} | ${task.exit_code} |`),
    "",
    "| Measurement | Value |",
    "| --- | --- |",
    ...report.measurements.map(
      (measurement) =>
        `| ${measurement.name} | ${Object.entries(measurement)
          .filter(([key]) => key !== "name")
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")} |`,
    ),
    "",
    "Detailed benchmark reports remain in `reports/quality/`.",
  ].join("\n");
}

export async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const tasks = [];
  for (const task of benchmarkTasks()) {
    process.stdout.write(`[benchmark] ${task.name}: running\n`);
    const result = await runTask(task);
    tasks.push(result);
    process.stdout.write(`[benchmark] ${task.name}: ${result.status} (exit ${result.exit_code})\n`);
  }
  const measurements = [];
  for (const task of tasks) {
    const measurement = taskSummary(task.name, await readTaskReport(task.name));
    measurements.push(measurement);
    process.stdout.write(
      `[benchmark-summary] ${measurement.name}: ${Object.entries(measurement)
        .filter(([key]) => key !== "name")
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}\n`,
    );
  }
  const report = {
    generated_at: new Date().toISOString(),
    status: tasks.every((task) => task.status === "pass") ? "pass" : "fail",
    tasks,
    measurements,
    reports: [
      "reports/todo-performance/benchmark-results.json",
      "reports/cloud-memory-host-synthetic.json",
      "reports/quality/viewport-benchmark.json",
      "reports/quality/cloud-performance.json",
    ],
  };
  await writeFile(
    path.join(REPORT_DIR, "benchmark-all.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(REPORT_DIR, "benchmark-all.md"), `${markdown(report)}\n`);
  process.stdout.write(`Benchmark all: ${report.status.toUpperCase()}\n`);
  process.stdout.write("Reports: reports/quality/benchmark-all.json\n");
  return report.status === "pass" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
