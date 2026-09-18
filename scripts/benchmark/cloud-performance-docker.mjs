import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calibrateDockerCpu } from "./cloud-cpu-calibration.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULTS = {
  image: "hiremeops-cloud-worker:quality",
  output: "reports/quality/cloud-performance.json",
  iterations: 5,
  viewport: "800x600",
  memory: "512000000",
  cpus: "0.2",
  shmSize: "64m",
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (flag === "--image") options.image = value;
    else if (flag === "--output") options.output = value;
    else if (flag === "--iterations") options.iterations = Number(value);
    else if (flag === "--viewport") options.viewport = value;
    else if (flag === "--memory") options.memory = value;
    else if (flag === "--cpus") options.cpus = value;
    else if (flag === "--shm-size") options.shmSize = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error("--iterations must be positive");
  }
  return options;
}

function dockerArgs(options, outputDir) {
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
    "-e",
    `HIREMEOPS_BENCHMARK_IMAGE=${options.image}`,
    "-e",
    `HIREMEOPS_BENCHMARK_MEMORY=${options.memory}`,
    "-e",
    `HIREMEOPS_BENCHMARK_CPUS=${options.cpus}`,
    "-e",
    `HIREMEOPS_BENCHMARK_SHM_SIZE=${options.shmSize}`,
    "-v",
    `${outputDir}:/app/reports/quality`,
    options.image,
    "--",
    "node",
    "--max-old-space-size=96",
    "cloud-performance-benchmark.mjs",
    "--iterations",
    String(options.iterations),
    "--viewport",
    options.viewport,
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const calibration = calibrateDockerCpu(options);
  const output = path.resolve(ROOT, options.output);
  const outputDir = path.dirname(output);
  await mkdir(outputDir, { recursive: true });
  await unlink(output).catch(() => {});
  const child = spawnSync("docker", dockerArgs(options, outputDir), {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  const report = JSON.parse(await readFile(output, "utf8"));
  report.runtime = {
    calibration,
    image: options.image,
    memory: options.memory,
    cpus: options.cpus,
    shmSize: options.shmSize,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, ...report.summary, dockerExitCode: child.status ?? 1 })}\n`,
  );
  if (child.status !== 0 || report.exitCode !== 0)
    process.exitCode = child.status || report.exitCode || 1;
}

main().catch((error) => {
  process.stderr.write(
    `[cloud-performance-docker] ${String(error?.message ?? error).slice(0, 240)}\n`,
  );
  process.exitCode = 2;
});
