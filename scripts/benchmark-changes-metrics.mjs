import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

function fileBytes(file) {
  return existsSync(file) ? statSync(file).size : 0;
}

export function ftsDiagnostics(makeDb, { currentFtsSelect, sqliteMetadata, queryPlan }) {
  const diagnostics = {};
  for (const [name, current, sql] of [
    [
      "baseline",
      false,
      `SELECT jp.id FROM job_posts_fts JOIN job_posts jp ON jp.rowid = job_posts_fts.rowid
       WHERE job_posts_fts MATCH ? AND jp.profile_id = ?
       ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?`,
    ],
    [
      "current",
      true,
      `${currentFtsSelect} WHERE job_posts_fts MATCH ? AND jp.profile_id = ?
       ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?`,
    ],
  ]) {
    const db = makeDb(current);
    diagnostics[name] = {
      plan: queryPlan(db, sql, ['"rust"*', "profile-a", 200]),
      ftsBytes: sqliteMetadata(db, ":memory:").ftsBytes,
    };
    db.close();
  }
  return diagnostics;
}

export function measureHarnessStartup(root, args, summarize) {
  const script = path.join(root, "scripts/benchmark-changes.mjs");
  const samples = [];
  for (let i = 0; i < Math.max(5, Math.min(args.iterations, 30)); i += 1) {
    const started = performance.now();
    const child = spawnSync(process.execPath, [script, "--help"], {
      cwd: root,
      stdio: "ignore",
    });
    if (child.status !== 0) throw new Error(`startup probe failed with status ${child.status}`);
    samples.push(performance.now() - started);
  }
  return {
    command: `${process.execPath} ${script} --help`,
    timing: summarize(samples),
  };
}

function releaseBinaryName(root) {
  const cargo = readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  return cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "hiremeops";
}

function releaseBuild(root, label, resourceTemplate) {
  const target = mkdtempSync(path.join(tmpdir(), `hiremeops-${label}-release-`));
  const started = performance.now();
  try {
    const resources = path.join(root, "src-tauri/resources/node_modules");
    if (!existsSync(resources) && resourceTemplate) {
      cpSync(resourceTemplate, resources, { recursive: true });
    }
    const child = spawnSync(
      "cargo",
      [
        "build",
        "--release",
        "--manifest-path",
        path.join(root, "src-tauri/Cargo.toml"),
        "--target-dir",
        target,
      ],
      { cwd: root, stdio: "ignore" },
    );
    const elapsedMs = performance.now() - started;
    const binary = path.join(target, "release", releaseBinaryName(root));
    if (child.status !== 0 || !existsSync(binary)) {
      return { status: "failed", elapsedMs: Number(elapsedMs.toFixed(3)), exitCode: child.status };
    }
    return {
      status: "passed",
      elapsedMs: Number(elapsedMs.toFixed(3)),
      binaryBytes: fileBytes(binary),
    };
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

export function releaseBuilds(root, baselinePath, args) {
  if (!args.buildRelease) return { status: "not-run", reason: "pass --build-release" };
  return {
    baseline: releaseBuild(
      baselinePath,
      "baseline",
      path.join(root, "src-tauri/resources/node_modules"),
    ),
    current: releaseBuild(root, "current", null),
  };
}

export function directoryBytes(directory) {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const entryPath = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(entryPath) : fileBytes(entryPath));
  }, 0);
}
