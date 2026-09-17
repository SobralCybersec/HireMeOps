import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  architectureReport,
  flakyReport,
  mutationReport,
  optionalToolReports,
  runStep,
  rustCoverageReport,
  technicalDebtReport,
  testQualityReport,
  writeRuntimeReports,
} from "./quality-gate-reports.mjs";
export { scanTechnicalDebt } from "./quality-gate-reports.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_ROOT = path.join(REPO_ROOT, "reports/quality");
const COVERAGE_ARGS = [
  "--coverage",
  "reports/coverage/lcov.info",
  "--coverage",
  "reports/coverage/coverage-summary.json",
  "--test-report",
  "reports/tests/junit.xml",
  "--coverage-min",
  "90",
  "--require-tools",
  "--require-evidence",
];
export function parseQualityGateArgs(argv = []) {
  const options = { only: null, reportOnly: false, flakyRuns: 3, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report-only") options.reportOnly = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--only") options.only = argv[++index];
    else if (arg === "--flaky-runs") options.flakyRuns = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.flakyRuns) || options.flakyRuns < 1) {
    throw new Error("--flaky-runs must be a positive integer");
  }
  return options;
}

async function writeJson(name, value) {
  await writeFile(path.join(REPORT_ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(name, value) {
  await writeFile(path.join(REPORT_ROOT, name), `${String(value).trim()}\n`);
}

async function loadStrictSummary() {
  for (const name of ["strict-summary.json", "summary.json"]) {
    try {
      return JSON.parse(await readFile(path.join(REPORT_ROOT, name), "utf8"));
    } catch {
      // Continue with next evidence location.
    }
  }
  return {};
}

function stepViolations(step) {
  if (step.status === "fail") {
    return [
      {
        severity: step.blocking ? "error" : "warning",
        source: step.name,
        message: "command failed",
      },
    ];
  }
  if (["not-installed", "not-configured"].includes(step.status)) {
    return [
      {
        severity: "warning",
        source: step.name,
        message: step.status === "not-configured" ? "tool not configured" : "tool not installed",
      },
    ];
  }
  return [];
}

function reviewViolations(strictSummary) {
  const gate = strictSummary.gate ?? {};
  return [
    ...(gate.failures ?? []).map((message) => ({
      severity: "error",
      source: "quality-review",
      message,
    })),
    ...(gate.warnings ?? []).map((message) => ({
      severity: "warning",
      source: "quality-review",
      message,
    })),
  ];
}

function buildViolations(steps, reports, strictSummary, rustCoverage = null) {
  const testViolations = reports.testQuality.only_tests.length
    ? [{ severity: "error", source: "test-quality", message: ".only test marker found" }]
    : [];
  const rustViolations =
    rustCoverage?.status === "below-target"
      ? [
          {
            severity: "warning",
            source: "rust-coverage",
            message: `full workspace coverage below 90% (${rustCoverage.lines?.percent ?? "n/a"}% lines, ${rustCoverage.functions?.percent ?? "n/a"}% functions)`,
          },
        ]
      : [];
  return [
    ...steps.flatMap(stepViolations),
    ...reviewViolations(strictSummary),
    ...testViolations,
    ...rustViolations,
  ];
}

function markdownSummary(summary) {
  const coverage = summary.coverage ?? {};
  const rows = [
    ["Lines coverage", coverage.lines_percent, ">=90%"],
    ["Statements coverage", coverage.statements_percent, ">=90%"],
    ["Branches coverage", coverage.branches_percent, ">=90%"],
    ["Functions coverage", coverage.functions_percent, ">=90%"],
    ["Rust lines coverage", summary.rust_coverage?.lines?.percent, ">=90% full workspace"],
    ["Rust functions coverage", summary.rust_coverage?.functions?.percent, ">=90% full workspace"],
    [
      "Rust critical production scope",
      summary.rust_coverage?.critical_scope?.status,
      ">=90% lines/functions",
    ],
    ["Duplication", summary.duplication_percent, "<=3% target"],
    ["Complexity", summary.complexity_status, "reviewed"],
    ["Test failures", summary.tests?.failures ?? null, "0"],
    ["Architecture violations", summary.architecture_violations, "0"],
    ["Chromium leaks", summary.chromium_leaks, "0"],
    ["Mutation baseline", summary.mutation?.javascript?.mutation_score_percent, "informational"],
  ];
  return [
    "# Unified quality summary",
    "",
    `Overall: **${summary.overall.toUpperCase()}**`,
    "",
    "| Gate | Result | Threshold |",
    "| --- | ---: | --- |",
    ...rows.map(
      ([name, value, threshold]) => `| ${name} | ${value ?? "not measured"} | ${threshold} |`,
    ),
    "",
    `Errors: ${summary.violations.errors}; warnings: ${summary.violations.warnings}`,
    "",
    "See JSON reports in `reports/quality/` for machine-readable evidence.",
  ].join("\n");
}

async function reportOnly(options) {
  const strictSummary = await loadStrictSummary();
  const testQuality = await testQualityReport();
  const architecture = await architectureReport();
  const debt = await technicalDebtReport();
  const runtime = await writeRuntimeReports([]);
  const rustCoverage = await rustCoverageReport();
  const mutation = await mutationReport();
  const violations = buildViolations([], { testQuality }, strictSummary, rustCoverage);
  return finalizeSummary({
    options,
    steps: [],
    strictSummary,
    testQuality,
    architecture,
    debt,
    rustCoverage,
    mutation,
    runtime,
    violations,
  });
}

function countViolations(violations) {
  return violations.reduce(
    (counts, item) => {
      if (item.severity === "error") counts.errors += 1;
      if (item.severity === "warning") counts.warnings += 1;
      return counts;
    },
    { errors: 0, warnings: 0 },
  );
}

function buildSummary(context, counts) {
  const {
    options,
    steps,
    strictSummary,
    testQuality,
    architecture,
    debt,
    runtime = null,
    violations,
    mutation,
  } = context;
  return {
    generated_at: new Date().toISOString(),
    mode: options.reportOnly ? "report-only" : "full",
    overall: counts.errors || (options.strict && counts.warnings) ? "fail" : "pass",
    coverage: strictSummary.coverage ?? {},
    rust_coverage: context.rustCoverage ?? { available: false, status: "not-measured" },
    mutation: mutation ?? { status: "not-run" },
    duplication_percent: strictSummary.jscpd?.duplication_percent ?? null,
    complexity_status: strictSummary.lizard?.hard_findings ? "findings" : "pass",
    tests: testQuality.junit,
    architecture_violations: architecture.boundary_violations,
    chromium_leaks: runtime?.shutdown_chromium_processes ?? null,
    performance: runtime?.peak ?? null,
    technical_debt: { total: debt.total, counts: debt.counts },
    commands: steps,
    violations: { ...counts, items: violations },
    evidence: {
      junit: "reports/tests/junit.xml",
      lcov: "reports/coverage/lcov.info",
      coverage_summary: "reports/coverage/coverage-summary.json",
    },
  };
}

function violationsMarkdown(violations, counts) {
  const lines = violations.map((item) => `- ${item.severity}: ${item.source}: ${item.message}`);
  return [
    "# Violations",
    "",
    `Errors: ${counts.errors}`,
    `Warnings: ${counts.warnings}`,
    "",
    lines.length ? lines.join("\n") : "No violations.",
  ].join("\n");
}

async function finalizeSummary(context) {
  const counts = countViolations(context.violations);
  const summary = buildSummary(context, counts);
  await writeJson("violations.json", summary.violations);
  await writeText("violations.md", violationsMarkdown(context.violations, counts));
  await writeJson("summary.json", summary);
  await writeText("summary.md", markdownSummary(summary));
  return summary;
}

async function runFull(options) {
  const steps = [];
  const add = async (name, command, args, config) => {
    const step = await runStep(name, command, args, config);
    steps.push(step);
    process.stdout.write(`[quality] ${name}: ${step.status} (${step.duration_ms} ms)\n`);
  };
  await add("coverage", "bun", ["run", "test:coverage"]);
  await add("tests", "bun", ["run", "test"]);
  await add("typecheck", "bun", ["run", "typecheck"]);
  await add("lint", "bun", ["run", "lint"]);
  await add("strict-tests", "bun", ["run", "test:strict-tests"]);
  await add("quality-review", "bun", ["run", "quality:review"]);
  await add("quality-evidence", "node", [
    "scripts/quality/strict-tests/quality-review.mjs",
    "src",
    ...COVERAGE_ARGS,
  ]);
  if (process.env.QUALITY_RUN_STRICT === "1") {
    await add("strict-quality", "bun", ["run", "quality:strict"]);
  }
  const strictSummary = await loadStrictSummary();
  await writeJson("strict-summary.json", strictSummary);
  await add("frontend-build", "bun", ["run", "build"]);
  await add("agent-typecheck", "bun", ["run", "agent:typecheck"]);
  await add("format-check", "bun", ["run", "format:check"]);
  await add("rust-fmt", "cargo", ["fmt", "--all", "--", "--check"], {
    cwd: path.join(REPO_ROOT, "src-tauri"),
  });
  await add(
    "rust-clippy",
    "cargo",
    ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"],
    { cwd: path.join(REPO_ROOT, "src-tauri") },
  );
  await add("rust-tests", "cargo", ["test", "--all-features"], {
    cwd: path.join(REPO_ROOT, "src-tauri"),
  });
  if (process.env.QUALITY_RUN_RUNTIME_BENCHMARKS !== "0") {
    await add("cloud-memory", "bun", ["run", "benchmark:cloud-memory"]);
    await add("benchmark", "bun", ["run", "benchmark:changes", "--", "--create-clone"]);
  }
  if (!process.env.QUALITY_SKIP_DOCKER) {
    await add("docker-cloud-build", "docker", [
      "build",
      "--progress=plain",
      "-f",
      "docker/Dockerfile.cloud-worker",
      "-t",
      "hiremeops-cloud-worker:quality",
      ".",
    ]);
  }
  if (process.env.QUALITY_RUN_CLOUD_BENCHMARKS === "1") {
    await add("cloud-viewport-benchmark", "bun", ["run", "benchmark:cloud-viewport"]);
    await add("cloud-performance-benchmark", "bun", ["run", "benchmark:cloud-performance"]);
  }
  if (process.env.QUALITY_RUN_MUTATION === "1") {
    await add("mutation", "bun", ["run", "quality:mutation"]);
  }
  if (process.env.QUALITY_RUN_MUTATION_RUST === "1") {
    await add("mutation-rust", "bun", ["run", "quality:mutation:rust"]);
  }
  const flaky = await flakyReport(options.flakyRuns);
  const tools = await optionalToolReports();
  for (const tool of tools) {
    process.stdout.write(`[quality-tool] ${tool.name}: ${tool.status} (${tool.duration_ms} ms)\n`);
  }
  const testQuality = await testQualityReport();
  const architecture = await architectureReport();
  const debt = await technicalDebtReport();
  const reports = { testQuality };
  const rustCoverage = await rustCoverageReport();
  const violations = buildViolations(
    [...steps, ...flaky.results, ...tools],
    reports,
    strictSummary,
    rustCoverage,
  );
  const runtime = await writeRuntimeReports(steps);
  const mutation = await mutationReport();
  const summary = await finalizeSummary({
    options,
    steps,
    strictSummary,
    testQuality,
    architecture,
    debt,
    rustCoverage,
    mutation,
    runtime,
    violations,
  });
  await writeJson("reliability.json", {
    generated_at: new Date().toISOString(),
    tests: testQuality.junit,
    cleanup_evidence: "cloud-memory checkpoints",
  });
  await writeJson("error-handling.json", {
    generated_at: new Date().toISOString(),
    status: "static checks delegated to ESLint, TypeScript, Clippy, and SonarJS when installed",
  });
  await writeJson("consistency.json", {
    generated_at: new Date().toISOString(),
    format_check: steps.find((step) => step.name === "format-check")?.status ?? "not-run",
  });
  await writeJson("documentation.json", {
    generated_at: new Date().toISOString(),
    markdownlint: tools.find((tool) => tool.name === "markdownlint")?.status ?? "not-run",
    links: tools.find((tool) => tool.name === "lychee")?.status ?? "not-run",
  });
  await writeJson("observability.json", {
    generated_at: new Date().toISOString(),
    checkpoints: [
      "startup",
      "browser-open",
      "operation-start",
      "post-navigation",
      "scraping-peak",
      "state-exported",
      "shutdown",
    ],
  });
  await writeJson("build.json", {
    generated_at: new Date().toISOString(),
    steps: steps.filter((step) =>
      ["frontend-build", "docker-cloud-build", "rust-fmt", "rust-clippy", "rust-tests"].includes(
        step.name,
      ),
    ),
  });
  await writeJson("code-smells.json", {
    generated_at: new Date().toISOString(),
    source: ["ESLint", "Lizard", "JSCPD"],
    lizard_findings: strictSummary.lizard?.hard_findings ?? null,
  });
  await writeJson("complexity.json", {
    generated_at: new Date().toISOString(),
    lizard: strictSummary.lizard ?? {},
    policy: strictSummary.policy ?? {},
  });
  await writeText(
    "complexity.md",
    `# Complexity\n\nLizard hard findings: ${strictSummary.lizard?.hard_findings ?? "not measured"}\nInput files: ${strictSummary.lizard?.input_files ?? "not measured"}\n`,
  );
  await writeText(
    "maintainability.md",
    `# Maintainability\n\nSource size, churn, complexity, and duplication are reported by quality-review.\nHotspots: ${strictSummary.churn?.hotspots?.length ?? 0}.\n`,
  );
  await writeJson("maintainability.json", {
    generated_at: new Date().toISOString(),
    source: "quality-review",
    hotspots: strictSummary.churn?.hotspots ?? [],
    duplication_percent: summary.duplication_percent,
  });
  await writeJson("integration.json", {
    generated_at: new Date().toISOString(),
    postgres: "run cargo postgres_schema_smoke when HIREMEOPS_DATABASE_URL is configured",
    docker: steps.find((step) => step.name === "docker-cloud-build")?.status ?? "not-run",
    cloud_memory: steps.find((step) => step.name === "cloud-memory")?.status ?? "not-run",
  });
  await writeJson("flaky.json", flaky);
  return summary;
}

async function runSelected(options) {
  if (options.reportOnly) return reportOnly(options);
  if (!options.only) return runFull(options);
  if (options.only === "complexity") {
    const step = await runStep("complexity", "bun", ["run", "quality:review"]);
    const strictSummary = await loadStrictSummary();
    const testQuality = { junit: {}, only_tests: [] };
    const architecture = { boundary_violations: 0 };
    const debt = { total: 0, counts: {} };
    return finalizeSummary({
      options,
      steps: [step],
      strictSummary,
      testQuality,
      architecture,
      debt,
      violations: buildViolations([step], { testQuality }, strictSummary),
    });
  }
  if (options.only === "security") {
    const tools = await optionalToolReports();
    const strictSummary = await loadStrictSummary();
    const testQuality = { junit: {}, only_tests: [] };
    const architecture = { boundary_violations: 0 };
    const debt = { total: 0, counts: {} };
    return finalizeSummary({
      options,
      steps: tools,
      strictSummary,
      testQuality,
      architecture,
      debt,
      violations: buildViolations(tools, { testQuality }, strictSummary),
    });
  }
  throw new Error(`Unsupported quality gate: ${options.only}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseQualityGateArgs(argv);
  await mkdir(REPORT_ROOT, { recursive: true });
  const summary = await runSelected(options);
  process.stdout.write(`Quality gate: ${summary.overall.toUpperCase()}\n`);
  process.stdout.write(`Reports: ${path.relative(REPO_ROOT, REPORT_ROOT)}\n`);
  return summary.overall === "pass" ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`quality-gate: ${error.message}\n`);
      process.exitCode = 1;
    });
}
