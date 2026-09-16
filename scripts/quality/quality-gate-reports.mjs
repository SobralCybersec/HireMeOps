import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTestResults, parseLcov, runCommand } from "./strict-tests/quality-metrics.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_ROOT = path.join(REPO_ROOT, "reports/quality");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".rs"]);
const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "coverage", "reports"]);
const OPTIONAL_TOOLS = [
  [
    "gitleaks",
    "gitleaks",
    ["detect", "--config", ".gitleaks.toml", "--no-banner", "--redact", "--exit-code", "1"],
  ],
  ["semgrep", "semgrep", ["scan", "--config", "auto", "--error", "--quiet"]],
  ["knip", "bun", ["x", "knip", "--reporter", "json"]],
  [
    "dependency-cruiser",
    "bun",
    ["x", "--bun", "depcruise", "--validate", ".dependency-cruiser.cjs", "src"],
  ],
  [
    "markdownlint",
    "bun",
    ["x", "markdownlint-cli2", "README.md", "README.pt-BR.md", "docs/**/*.md"],
  ],
  ["lychee", "lychee", ["--no-progress", "README.md", "README.pt-BR.md", "docs/**/*.md"]],
  ["hadolint", "hadolint", ["docker/Dockerfile.cloud-worker"]],
  ["actionlint", "actionlint", []],
  ["shellcheck", "shellcheck", ["docker/entrypoint.sh"]],
];
const RUST_TOOLS = [
  ["cargo-audit", "cargo", ["audit"]],
  ["cargo-deny", "cargo", ["deny", "check"]],
  ["cargo-machete", "cargo", ["machete"]],
  [
    "cargo-llvm-cov",
    "cargo",
    [
      "llvm-cov",
      "--all-features",
      "--workspace",
      "--lcov",
      "--output-path",
      "../reports/quality/rust-lcov.info",
    ],
  ],
];

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function isMissing(result) {
  if (
    result.missing ||
    /(?:command .* not found|no such command|no such file)/i.test(result.stderr)
  ) {
    return true;
  }
  return /(?:unable to resolve|could not resolve|module not found|package .* not found)/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

function statusFor(result, { optional = false } = {}) {
  if (isMissing(result)) return optional ? "not-installed" : "fail";
  return result.code === 0 ? "pass" : "fail";
}

async function writeJson(name, value) {
  await writeFile(path.join(REPORT_ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(name, value) {
  await writeFile(path.join(REPORT_ROOT, name), `${String(value).trim()}\n`);
}

async function actionlintArgs() {
  const workflowDir = path.join(REPO_ROOT, ".github/workflows");
  const files = await readdir(workflowDir);
  return files
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => path.join(".github/workflows", file));
}

function maxStage(stages, field) {
  return Math.max(0, ...stages.map((stage) => Number(stage[field]) || 0));
}

async function readReport(name) {
  try {
    return JSON.parse(await readFile(path.join(REPORT_ROOT, name), "utf8"));
  } catch {
    return null;
  }
}

export async function writeRuntimeReports(steps) {
  const hostEvidence = (await readReport("../cloud-memory-host-synthetic.json")) ?? { stages: [] };
  const hostStages = Array.isArray(hostEvidence.stages) ? hostEvidence.stages : [];
  const hostPeak = {
    cgroup_current_mb: maxStage(hostStages, "cgroupCurrentMb"),
    cgroup_peak_mb: maxStage(hostStages, "cgroupPeakMb"),
    node_pss_mb: maxStage(hostStages, "nodePssMb"),
    chromium_pss_mb: maxStage(hostStages, "chromiumPssMb"),
    chromium_processes: maxStage(hostStages, "chromiumProcesses"),
  };
  const dockerEvidence = await readReport("docker-memory-512m.json");
  const dockerStages = Array.isArray(dockerEvidence?.stages) ? dockerEvidence.stages : [];
  const dockerPeak = dockerEvidence
    ? {
        cgroup_current_mb: maxStage(dockerStages, "cgroupCurrentMb"),
        cgroup_peak_mb: Number(dockerEvidence.peakMb) || maxStage(dockerStages, "cgroupPeakMb"),
        node_pss_mb: maxStage(dockerStages, "nodePssMb"),
        chromium_pss_mb: maxStage(dockerStages, "chromiumPssMb"),
        chromium_processes: maxStage(dockerStages, "chromiumProcesses"),
      }
    : null;
  const performanceReport = await readReport("cloud-performance.json");
  const performanceSummary = performanceReport?.summary;
  const performanceEvidence = performanceSummary
    ? {
        cgroup_current_mb: Number(performanceSummary.cgroupCurrentMaxMb) || 0,
        cgroup_peak_mb: Number(performanceSummary.cgroupPeakMb) || 0,
        node_pss_mb: Number(performanceSummary.nodePssMaxMb) || 0,
        chromium_pss_mb: Number(performanceSummary.chromiumPssMaxMb) || 0,
        chromium_processes: Number(performanceSummary.chromiumProcessesMax) || 0,
      }
    : null;
  const selectedPeak = performanceEvidence ?? dockerPeak ?? hostPeak;
  const selectedShutdown =
    performanceReport?.stages?.find((stage) => stage.stage === "shutdown") ??
    dockerStages.find((stage) => stage.stage === "shutdown") ??
    hostStages.find((stage) => stage.stage === "shutdown");
  const benchmarkEvidence = {};
  for (const name of ["viewport-benchmark", "cloud-performance"]) {
    const report = await readReport(`${name}.json`);
    if (report) benchmarkEvidence[name] = report.summary ?? null;
  }
  const source = performanceEvidence
    ? "cloud-performance.json"
    : dockerEvidence
      ? "docker-memory-512m.json"
      : "cloud-memory-host-synthetic.json";
  await writeJson("performance.json", {
    generated_at: new Date().toISOString(),
    source,
    checkpoints: hostStages,
    peak: selectedPeak,
    host_peak: hostPeak,
    docker_peak: dockerPeak,
    benchmark_evidence: benchmarkEvidence,
    docker_build: steps.find((step) => step.name === "docker-cloud-build")?.status ?? "not-run",
  });
  await writeJson("resource-leaks.json", {
    generated_at: new Date().toISOString(),
    shutdown_chromium_processes: selectedShutdown?.chromiumProcesses ?? null,
    cleanup_verified: selectedShutdown?.chromiumProcesses === 0,
    source,
  });
  return {
    shutdown_chromium_processes: selectedShutdown?.chromiumProcesses ?? null,
    peak: selectedPeak,
  };
}

export async function rustCoverageReport() {
  try {
    const coverage = parseLcov(await readFile(path.join(REPORT_ROOT, "rust-lcov.info"), "utf8"));
    const measured = [coverage.lines.percent, coverage.functions.percent].filter(
      (value) => value != null,
    );
    const report = {
      generated_at: new Date().toISOString(),
      available: true,
      ...coverage,
      target_percent: 90,
      status:
        measured.length > 0 && measured.every((value) => value >= 90) ? "pass" : "below-target",
    };
    await writeJson("rust-coverage.json", report);
    return report;
  } catch {
    const report = {
      generated_at: new Date().toISOString(),
      available: false,
      status: "not-measured",
    };
    await writeJson("rust-coverage.json", report);
    return report;
  }
}

async function licenseReport() {
  const started = performance.now();
  const command = "bun";
  const args = ["x", "license-checker", "--json", "--production"];
  const result = await runCommand(command, args, { cwd: REPO_ROOT });
  const status = statusFor(result, { optional: true });
  let packages = [];
  if (status === "pass") {
    try {
      const inventory = JSON.parse(result.stdout);
      packages = Object.entries(inventory).map(([name, value]) => ({
        name,
        licenses: value.licenses ?? "UNKNOWN",
        repository: value.repository ?? null,
      }));
    } catch {
      return {
        status: "fail",
        packages: [],
        tool: toolResult(command, args, started, "fail", result.code),
      };
    }
  }
  return {
    status,
    packages,
    tool: toolResult(command, args, started, status, result.code),
  };
}

function toolResult(command, args, started, status, exitCode) {
  return {
    name: "license-checker",
    command: commandText(command, args),
    cwd: ".",
    status,
    exit_code: exitCode === 127 ? null : exitCode,
    duration_ms: Math.round(performance.now() - started),
    optional: true,
    blocking: false,
  };
}

export async function runStep(name, command, args, { cwd = REPO_ROOT, optional = false } = {}) {
  const started = performance.now();
  const result = await runCommand(command, args, { cwd });
  return {
    name,
    command: commandText(command, args),
    cwd: path.relative(REPO_ROOT, cwd) || ".",
    status: statusFor(result, { optional }),
    exit_code: isMissing(result) ? null : result.code,
    duration_ms: Math.round(performance.now() - started),
    optional,
    blocking: !optional,
  };
}

async function sourceFiles(dir, output = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(absolute, output);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

export function scanTechnicalDebt(text, file) {
  const markers = ["TODO", "FIXME", "HACK", "XXX"];
  return text
    .split("\n")
    .flatMap((line, index) =>
      markers
        .filter((marker) => new RegExp(`\\b${marker}\\b`, "i").test(line))
        .map((marker) => ({ file, marker, line: index + 1 })),
    );
}

export async function technicalDebtReport() {
  const findings = [];
  for (const file of await sourceFiles(REPO_ROOT)) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    findings.push(...scanTechnicalDebt(await readFile(file, "utf8"), relative));
  }
  const counts = Object.fromEntries(
    ["TODO", "FIXME", "HACK", "XXX"].map((marker) => [
      marker,
      findings.filter((item) => item.marker === marker).length,
    ]),
  );
  const report = {
    generated_at: new Date().toISOString(),
    baseline: null,
    counts,
    total: findings.length,
    findings,
  };
  await writeJson("technical-debt.json", report);
  await writeText(
    "technical-debt.md",
    [
      "# Technical debt",
      "",
      `Current markers: ${findings.length}`,
      "",
      ...Object.entries(counts).map(([marker, count]) => `- ${marker}: ${count}`),
      "",
      "Baseline: not configured; current inventory is informational.",
    ].join("\n"),
  );
  return report;
}

export async function testQualityReport() {
  const findings = [];
  for (const file of await sourceFiles(path.join(REPO_ROOT, "src"))) {
    if (!/(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    for (const marker of ["only", "skip", "todo"]) {
      const count = [...text.matchAll(new RegExp(`\\.(?:${marker})\\s*\\(`, "g"))].length;
      if (count) findings.push({ file: relative, marker, count });
    }
  }
  const junit = await collectTestResults(REPO_ROOT, ["reports/tests/junit.xml"]);
  const report = {
    generated_at: new Date().toISOString(),
    junit: junit.aggregate,
    skipped_or_todo: findings.filter((item) => item.marker !== "only"),
    only_tests: findings.filter((item) => item.marker === "only"),
  };
  await writeJson("test-quality.json", report);
  return report;
}

export async function architectureReport() {
  const cloudFiles = [
    path.join(REPO_ROOT, "automation/cloud-runner.mjs"),
    ...(await sourceFiles(path.join(REPO_ROOT, "automation/cloud"))).filter((file) =>
      file.endsWith(".mjs"),
    ),
  ];
  const forbidden = [];
  for (const file of cloudFiles) {
    const text = await readFile(file, "utf8");
    for (const token of [
      "worker-lifecycle",
      "worker-auth",
      "capture.js",
      "screencast",
      "human.js",
    ]) {
      if (text.includes(token)) forbidden.push({ file: path.relative(REPO_ROOT, file), token });
    }
  }
  const report = {
    generated_at: new Date().toISOString(),
    cloud_forbidden_imports: forbidden,
    dependency_cruiser: "configured",
    cycles: null,
    boundary_violations: forbidden.length,
  };
  await writeJson("architecture.json", report);
  await writeText(
    "architecture.md",
    `# Architecture\n\nCloud forbidden imports: ${forbidden.length}\nDependency-cruiser: configured; result is in tooling.json.`,
  );
  return report;
}

export async function optionalToolReports() {
  const tools = [];
  for (const [name, command, args] of OPTIONAL_TOOLS) {
    if (name === "dependency-cruiser") {
      try {
        await access(path.join(REPO_ROOT, ".dependency-cruiser.cjs"));
      } catch {
        tools.push({
          name,
          command: commandText(command, args),
          cwd: ".",
          status: "not-configured",
          exit_code: null,
          duration_ms: 0,
          optional: true,
          blocking: false,
        });
        continue;
      }
    }
    const toolArgs = name === "actionlint" ? await actionlintArgs() : args;
    const result = await runStep(name, command, toolArgs, { optional: true });
    result.blocking = name === "gitleaks";
    tools.push(result);
  }
  for (const [name, command, args] of RUST_TOOLS) {
    const result = await runStep(name, command, args, {
      cwd: path.join(REPO_ROOT, "src-tauri"),
      optional: true,
    });
    result.blocking = name === "cargo-audit";
    tools.push(result);
  }
  const licenses = await licenseReport();
  tools.push(licenses.tool);
  await writeJson("tooling.json", tools);
  await writeJson("security-gate.json", {
    generated_at: new Date().toISOString(),
    tools: tools.filter((tool) => ["gitleaks", "semgrep"].includes(tool.name)),
    secrets: tools.find((tool) => tool.name === "gitleaks")?.status === "pass" ? 0 : null,
  });
  await writeJson("dependencies.json", {
    generated_at: new Date().toISOString(),
    tools: tools.filter((tool) =>
      ["knip", "cargo-audit", "cargo-deny", "cargo-machete"].includes(tool.name),
    ),
  });
  await writeJson("licenses.json", {
    generated_at: new Date().toISOString(),
    status: licenses.status,
    tool: "license-checker",
    package_count: licenses.packages.length,
    unknown_count: licenses.packages.filter((item) => item.licenses === "UNKNOWN").length,
    packages: licenses.packages,
  });
  await writeJson("mutation.json", {
    generated_at: new Date().toISOString(),
    status: "not-run",
    reason: "Mutation tools are not installed; run StrykerJS/cargo-mutants in scheduled workflow.",
  });
  return tools;
}

export async function flakyReport(runs) {
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    results.push({ run, ...(await runStep(`flaky-test-${run}`, "bun", ["run", "test:unit"])) });
  }
  const report = {
    generated_at: new Date().toISOString(),
    runs,
    deterministic: results.every((result) => result.status === "pass"),
    results,
  };
  await writeJson("flaky.json", report);
  await writeText(
    "flaky.md",
    `# Flaky tests\n\nRuns: ${runs}\nDeterministic: ${report.deterministic}`,
  );
  return report;
}
