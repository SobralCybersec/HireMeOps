import { spawnSync } from "node:child_process";

// Executed inside an otherwise idle container, not alongside the browser.
function measureCpu() {
  const fs = require("node:fs");
  const stat = () =>
    Object.fromEntries(
      fs
        .readFileSync("/sys/fs/cgroup/cpu.stat", "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const [key, value] = line.split(/\s+/);
          return [key, Number(value)];
        }),
    );
  const cpuMax = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim();
  const memoryMax = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
  const before = stat();
  const start = performance.now();
  const usage = process.cpuUsage();
  while (performance.now() - start < 5000) {
    /* CPU-bound calibration */
  }
  const cpu = process.cpuUsage(usage);
  const wallMs = performance.now() - start;
  const after = stat();
  console.log(
    JSON.stringify({
      cpuMax,
      memoryMax,
      wallMs,
      processCpuMs: (cpu.user + cpu.system) / 1000,
      cgroupUsageMs: (after.usage_usec - before.usage_usec) / 1000,
      periods: after.nr_periods - before.nr_periods,
      throttled: after.nr_throttled - before.nr_throttled,
    }),
  );
}

function quotaWasExercised(sample, cpus) {
  return (
    sample.wallMs >= 4000 &&
    sample.periods >= 10 &&
    sample.throttled >= 1 &&
    sample.processCpuMs / sample.wallMs >= cpus * 0.7
  );
}

export function classifyCpuCalibration(sample, requestedCpus) {
  const [quota, period] = String(sample.cpuMax).split(/\s+/).map(Number);
  const cpus = Number(requestedCpus);
  const observedCpus = sample.processCpuMs / sample.wallMs;
  const configuredCpus = quota / period;
  const measurements = [
    cpus,
    observedCpus,
    configuredCpus,
    sample.wallMs,
    sample.periods,
    sample.throttled,
  ];
  if (!measurements.every(Number.isFinite)) return "inconclusive";
  if (cpus <= 0 || cpus >= 1 || sample.wallMs < 4000) return "inconclusive";
  if (Math.abs(configuredCpus - cpus) > 0.001) return "quota_mismatch";
  // Allow two quota periods of burst plus 10% measurement margin.
  const upperBound = cpus * 1.1 + (2 * period) / 1000 / sample.wallMs;
  if (observedCpus > upperBound) return "quota_not_enforced";
  return quotaWasExercised(sample, cpus) ? "verified" : "inconclusive";
}

export function calibrateDockerCpu({ image, cpus, memory }) {
  const child = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--cpus",
      String(cpus),
      "--memory",
      memory,
      "--memory-swap",
      memory,
      "--entrypoint",
      "node",
      image,
      "-",
    ],
    {
      input: `(${measureCpu.toString()})();`,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 100_000,
    },
  );
  if (child.error || child.status !== 0) throw new Error("cpu_calibration_container_failed");
  const sample = JSON.parse(child.stdout.trim());
  const result = {
    ...sample,
    requestedCpus: Number(cpus),
    status: classifyCpuCalibration(sample, cpus),
  };
  process.stdout.write(`[cloud-cpu-calibration] ${JSON.stringify(result)}\n`);
  if (result.status !== "verified") throw new Error(`cpu_calibration_${result.status}`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [image = "hiremeops-cloud-worker:quality", cpus = "0.2", memory = "512000000"] =
    process.argv.slice(2);
  try {
    calibrateDockerCpu({ image, cpus, memory });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
