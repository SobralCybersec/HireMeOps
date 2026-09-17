import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { closeCloudBrowser, openCloudBrowser } from "./cloud/cloud-browser.mjs";
import { memorySnapshot } from "./cloud-memory.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = `<!doctype html><title>cloud performance fixture</title><main>${Array.from(
  { length: 200 },
  (_, index) =>
    `<article><h2>Role ${index}</h2><p>Client ${index} · São Paulo · remote</p><p>Description ${index}</p></article>`,
).join("")}</main>`;

function parseArgs(argv = process.argv.slice(2)) {
  const values = {
    iterations: 5,
    viewport: "1024x768",
    output: "reports/quality/cloud-performance.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (flag === "--iterations") values.iterations = Number(value);
    else if (flag === "--viewport") values.viewport = value;
    else if (flag === "--output") values.output = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!Number.isInteger(values.iterations) || values.iterations < 1)
    throw new Error("--iterations must be positive");
  const match = values.viewport.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error("--viewport must use WIDTHxHEIGHT");
  return { ...values, viewport: { width: Number(match[1]), height: Number(match[2]) } };
}

function cpuTotals() {
  const usage = process.resourceUsage();
  return {
    userMs: +(usage.userCPUTime / 1000).toFixed(1),
    systemMs: +(usage.systemCPUTime / 1000).toFixed(1),
  };
}

function reportMarkdown(report) {
  const { summary } = report;
  return [
    "# Cloud performance benchmark",
    "",
    `Runtime: ${report.runtime.image ?? "local"}; limit: ${report.runtime.memory ?? "unbounded"} RAM, ${report.runtime.cpus ?? "host"} CPU, ${report.runtime.shmSize ?? "host"} /dev/shm.`,
    `Viewport: ${report.viewport.width}x${report.viewport.height}; iterations: ${report.iterations}.`,
    "",
    "| Stage | Duration ms | Results | cgroup current MB | cgroup peak MB | Node PSS MB | Chromium PSS MB | Chromium processes |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.stages.map(
      (stage) =>
        `| ${stage.stage} | ${stage.durationMs ?? "—"} | ${stage.results ?? "—"} | ${stage.cgroupCurrentMb ?? "—"} | ${stage.cgroupPeakMb ?? "—"} | ${stage.nodePssMb ?? "—"} | ${stage.chromiumPssMb ?? "—"} | ${stage.chromiumProcesses ?? "—"} |`,
    ),
    "",
    `Peak cgroup: ${summary.cgroupPeakMb} MB; max operation: ${summary.maxOperationMs} ms; CPU: ${summary.cpu.userMs} user / ${summary.cpu.systemMs} system ms.`,
    `Cleanup: Chromium processes at shutdown = ${summary.shutdownChromiumProcesses}.`,
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  const started = performance.now();
  const stages = [];
  const operations = [];
  const record = (stage, data = {}) =>
    stages.push({
      stage,
      durationMs: +(performance.now() - started).toFixed(1),
      ...memorySnapshot(stage),
      ...data,
    });
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  let runtime;
  let error = null;
  try {
    record("startup");
    runtime = await openCloudBrowser({ cookies: [], origins: [] }, { viewport: args.viewport });
    record("browser-open");
    for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
      const operationStart = performance.now();
      await runtime.page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      await runtime.page.locator("article").first().waitFor({ state: "visible" });
      const results = await runtime.page.locator("article").count();
      operations.push({
        iteration,
        durationMs: +(performance.now() - operationStart).toFixed(1),
        results,
      });
      record(iteration === 1 ? "post-navigation" : `iteration-${iteration}`, { results });
    }
    record("scraping-peak", { results: operations.at(-1)?.results ?? 0 });
    await runtime.context.storageState({ indexedDB: true });
    record("state-exported");
  } catch (caught) {
    error = {
      name: caught?.name ?? "Error",
      message: String(caught?.message ?? caught).slice(0, 240),
    };
  } finally {
    record("pre-close");
    await closeCloudBrowser(runtime);
    record("shutdown");
    await new Promise((resolve) => server.close(resolve));
  }
  const peak = Math.max(0, ...stages.map((stage) => stage.cgroupPeakMb ?? 0));
  const maxStage = (field) => Math.max(0, ...stages.map((stage) => Number(stage[field]) || 0));
  const shutdown = stages.find((stage) => stage.stage === "shutdown");
  const report = {
    generatedAt: new Date().toISOString(),
    workload: "synthetic repeated navigation and extraction; no real credentials",
    runtime: {
      image: process.env.HIREMEOPS_BENCHMARK_IMAGE ?? null,
      memory: process.env.HIREMEOPS_BENCHMARK_MEMORY ?? null,
      cpus: process.env.HIREMEOPS_BENCHMARK_CPUS ?? null,
      shmSize: process.env.HIREMEOPS_BENCHMARK_SHM_SIZE ?? null,
    },
    viewport: args.viewport,
    iterations: args.iterations,
    durationMs: +(performance.now() - started).toFixed(1),
    exitCode: error ? 1 : 0,
    error,
    operations,
    stages,
    summary: {
      cgroupPeakMb: +peak.toFixed(1),
      cgroupCurrentMaxMb: +maxStage("cgroupCurrentMb").toFixed(1),
      nodePssMaxMb: +maxStage("nodePssMb").toFixed(1),
      chromiumPssMaxMb: +maxStage("chromiumPssMb").toFixed(1),
      chromiumProcessesMax: maxStage("chromiumProcesses"),
      maxOperationMs: Math.max(0, ...operations.map((operation) => operation.durationMs)),
      cpu: cpuTotals(),
      shutdownChromiumProcesses: shutdown?.chromiumProcesses ?? null,
    },
  };
  const output = path.resolve(ROOT, args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(output.replace(/\.json$/, ".md"), `${reportMarkdown(report)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, ...report.summary, exitCode: report.exitCode })}\n`,
  );
  if (error) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[cloud-performance] ${String(error?.message ?? error).slice(0, 240)}\n`);
  process.exitCode = 2;
});
