import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, homedir, platform, release, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import {
  directoryBytes,
  ftsDiagnostics,
  measureHarnessStartup,
  releaseBuilds,
} from "./benchmark-changes-metrics.mjs";

const DEFAULTS = { rows: 5_000, rewrites: 500, warmup: 2, iterations: 5 };
const PERFORMANCE_PROFILE = { warmup: 10, iterations: 30 };
const JOB_COLUMNS = `
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, title TEXT NOT NULL,
  company TEXT NOT NULL, location TEXT, description TEXT NOT NULL,
  summary TEXT, discovered_at TEXT NOT NULL, status TEXT NOT NULL,
  search_query_id TEXT`;
const FULL_JOB_SELECT = `
  SELECT id, profile_id, title, company, location, description, summary,
         discovered_at, status, search_query_id FROM job_posts`;
const SHORT_JOB_SELECT = `
  SELECT id, profile_id, title, company, location,
         substr(COALESCE(description, summary), 1, 320) AS description,
         substr(summary, 1, 320) AS summary,
         discovered_at, status, search_query_id FROM job_posts`;
const CURRENT_FTS_SELECT = `
  SELECT jp.id, jp.profile_id, jp.title, jp.company, jp.location,
         substr(COALESCE(jp.description, jp.summary), 1, 320) AS description,
         substr(jp.summary, 1, 320) AS summary,
         jp.discovered_at, jp.status, jp.search_query_id
  FROM job_posts_fts
  JOIN job_posts jp ON jp.rowid = job_posts_fts.rowid`;
const WHITESPACE = new RegExp("\\s+");

function applyBenchmarkOption(args, arg, value, state) {
  const key = arg.slice(2);
  if (["rows", "rewrites", "warmup", "iterations"].includes(key)) {
    args[key] = Number(value);
    if (key === "warmup") state.warmupExplicit = true;
    if (key === "iterations") state.iterationsExplicit = true;
    if (!Number.isInteger(args[key]) || args[key] < 1)
      throw new Error(`${arg} must be a positive integer`);
    return;
  }
  if (key === "profile") {
    if (!["smoke", "performance"].includes(value))
      throw new Error(`${arg} must be smoke or performance`);
    args.profile = value;
    state.profileExplicit = true;
    return;
  }
  const fields = {
    "baseline-ref": "baselineRef",
    "candidate-ref": "candidateRef",
    fixture: "fixture",
    output: "output",
  };
  if (fields[key]) {
    args[fields[key]] = value;
    return;
  }
  throw new Error(`unknown option ${arg}`);
}

function applyBenchmarkFlag(args, arg) {
  const flags = {
    "--create-clone": "createClone",
    "--keep-clone": "keepClone",
    "--build-release": "buildRelease",
  };
  const key = flags[arg];
  if (!key) return false;
  args[key] = true;
  return true;
}

export function parseArgs(argv) {
  const args = {
    ...DEFAULTS,
    profile: "smoke",
    output: "reports/todo-performance/benchmark-results.json",
    baselineRef: "HEAD",
    candidateRef: null,
    fixture: "reports/todo-performance/sanitized-fixture.sqlite3",
    buildRelease: false,
    createClone: false,
    keepClone: false,
  };
  const state = { profileExplicit: false, warmupExplicit: false, iterationsExplicit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    if (applyBenchmarkFlag(args, arg)) continue;
    if (arg.startsWith("--")) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      applyBenchmarkOption(args, arg, value, state);
    } else throw new Error(`unexpected argument ${arg}`);
  }
  if (state.profileExplicit && args.profile === "performance") {
    if (!state.warmupExplicit) args.warmup = PERFORMANCE_PROFILE.warmup;
    if (!state.iterationsExplicit) args.iterations = PERFORMANCE_PROFILE.iterations;
  }
  return args;
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const stddev = Math.sqrt(
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length,
  );
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: Number(pick(0.5).toFixed(3)),
    p90Ms: Number(pick(0.9).toFixed(3)),
    p95Ms: Number(pick(0.95).toFixed(3)),
    p99Ms: Number(pick(0.99).toFixed(3)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
    meanMs: Number(mean.toFixed(3)),
    stddevMs: Number(stddev.toFixed(3)),
  };
}

function gitText(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function candidateTree(root) {
  const temp = mkdtempSync(path.join(tmpdir(), "hiremeops-index-"));
  const index = path.join(temp, "index");
  try {
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync("git", ["read-tree", "HEAD"], { cwd: root, env });
    execFileSync(
      "git",
      [
        "add",
        "-A",
        "--",
        ".",
        ":(exclude)reports",
        ":(exclude)reports/**",
        ":(exclude)ISSUE.md",
        ":(exclude)FullIssue.md",
        ":(exclude)PROGRESS.md",
      ],
      { cwd: root, env },
    );
    return gitTextWithEnv(root, ["write-tree"], env);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function gitTextWithEnv(root, args, env) {
  return execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
}

function gitMetadata(root, args) {
  const baselineCommit = gitText(root, ["rev-parse", `${args.baselineRef}^{commit}`]);
  const candidateCommit = args.candidateRef
    ? gitText(root, ["rev-parse", `${args.candidateRef}^{commit}`])
    : null;
  return {
    baselineRef: args.baselineRef,
    baselineCommit,
    candidateRef: args.candidateRef,
    candidateCommit,
    candidateTree: candidateTree(root),
    dirtyWorktree: gitText(root, ["status", "--porcelain=v1"]).length > 0,
  };
}

function createBaselineClone(root, baselineCommit, requestedDir) {
  const target = requestedDir
    ? path.resolve(root, requestedDir)
    : mkdtempSync(path.join(tmpdir(), "hiremeops-old-clone-"));
  mkdirSync(target, { recursive: true });
  const archive = execFileSync("git", ["archive", "--format=tar", baselineCommit], {
    cwd: root,
    maxBuffer: 128 * 1024 * 1024,
  });
  execFileSync("tar", ["-xf", "-", "-C", target], { input: archive });
  return {
    path: target,
    files: `git archive ${baselineCommit}`,
    commit: baselineCommit,
    verified: true,
    temporary: !requestedDir,
  };
}

function prepareBaseline(root, createClone = false, baselineRef = "HEAD") {
  const baselineCommit = gitText(root, ["rev-parse", `${baselineRef}^{commit}`]);
  let snapshot = null;
  const manifest = path.join(root, "reports/todo-performance/original.sha256");
  if (!createClone && baselineRef === "HEAD" && existsSync(manifest)) {
    const entries = readFileSync(manifest, "utf8").trim().split("\n").filter(Boolean);
    for (const line of entries) {
      const parts = line.trim().split(WHITESPACE);
      const expected = parts.shift();
      const listedFile = parts.join(" ");
      const marker = "reports/todo-performance/original/";
      const markerIndex = listedFile.indexOf(marker);
      const file =
        markerIndex >= 0
          ? path.join(root, listedFile.slice(markerIndex))
          : path.resolve(listedFile);
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (actual !== expected) throw new Error(`baseline snapshot hash mismatch: ${file}`);
    }
    snapshot = { path: path.dirname(manifest), files: entries.length, verified: true };
  }
  if (snapshot) {
    return { ...snapshot, commit: baselineCommit, source: "reports/todo-performance/original" };
  }
  return { ...createBaselineClone(root, baselineCommit), source: `git archive ${baselineCommit}` };
}

function fileBytes(file) {
  return existsSync(file) ? statSync(file).size : 0;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packageMetadata(root) {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const cargo = readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const sqlxMatch = cargo.match(new RegExp('sqlx\\s*=\\s*\\{[^}]*version\\s*=\\s*"([^"]+)"', "s"));
  return {
    packageManager: packageJson.packageManager ?? null,
    node: process.version,
    sqlite: process.versions.sqlite,
    sqlx: sqlxMatch?.[1] ?? null,
  };
}

function hostEnvironment() {
  const cpu = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuCount: cpu.length,
    cpuModel: cpu[0]?.model ?? null,
    totalMemoryBytes: totalmem(),
  };
}

function benchmarkEnvironment(root, args) {
  return {
    cwd: root,
    profile: args.profile,
    poolSize: process.env.SQLX_POOL_SIZE ?? "default",
    statementCacheCapacity: process.env.SQLX_STATEMENT_CACHE_CAPACITY ?? "default",
    cacheSize: "-16384 KiB",
    mmapSize: process.env.SQLITE_MMAP_SIZE ?? "default",
    tempStore: "2 (memory)",
    walAutocheckpoint: process.env.SQLITE_WAL_AUTOCHECKPOINT ?? "default",
    journalMode: "WAL for persisted fixture; MEMORY for in-memory cases",
    synchronous: "NORMAL for persisted fixture; OFF during seed only",
  };
}

function collectEnvironment(root, args) {
  return {
    host: hostEnvironment(),
    runtime: packageMetadata(root),
    benchmark: benchmarkEnvironment(root, args),
    userHome: homedir(),
  };
}

function seedJobs(db, rows, current) {
  db.exec("PRAGMA cache_size = -16384; PRAGMA temp_store = 2; PRAGMA synchronous = OFF;");
  db.exec(`CREATE TABLE job_posts (${JOB_COLUMNS});`);
  db.exec("CREATE INDEX idx_jobs_profile_status ON job_posts(profile_id, status);");
  db.exec("CREATE INDEX idx_jobs_discovered ON job_posts(discovered_at);");
  if (current) {
    db.exec(
      "CREATE INDEX idx_jobs_profile_discovered_id ON job_posts(profile_id, discovered_at DESC, id DESC);",
    );
    db.exec(
      "CREATE INDEX idx_jobs_profile_status_discovered_id ON job_posts(profile_id, status, discovered_at DESC, id DESC);",
    );
    db.exec(
      "CREATE INDEX idx_jobs_search_discovered ON job_posts(search_query_id, discovered_at ASC, id ASC) WHERE status = 'discovered';",
    );
  }
  const insert = db.prepare(`INSERT INTO job_posts
    (id, profile_id, title, company, location, description, summary, discovered_at, status, search_query_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const description =
    "Built reliable data services with Rust, PostgreSQL, Kubernetes and measurable latency improvements. ".repeat(
      6,
    );
  const summary = "Backend platform role using Rust and distributed systems.";
  db.exec("BEGIN");
  for (let i = 0; i < rows; i += 1) {
    const id = `job-${String(i).padStart(6, "0")}`;
    const title = i % 5 === 0 ? `Rust Backend Engineer ${i}` : `Platform Engineer ${i}`;
    insert.run(
      id,
      "profile-a",
      title,
      `Company ${i % 97}`,
      "Remote",
      description,
      summary,
      String(100_000 - i).padStart(6, "0"),
      i % 9 === 0 ? "saved" : "discovered",
      `search-${i % 8}`,
    );
  }
  db.exec("COMMIT");
  const prefix = current ? ", prefix='2 3 4'" : "";
  db.exec(`CREATE VIRTUAL TABLE job_posts_fts USING fts5(
    title, company, location, description, summary,
    content='job_posts', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'${prefix}
  );`);
  db.exec(
    "INSERT INTO job_posts_fts(rowid, title, company, location, description, summary) SELECT rowid, title, company, location, description, summary FROM job_posts;",
  );
  return db;
}

function seedRewrites(db, rewrites, current) {
  db.exec("PRAGMA cache_size = -16384; PRAGMA temp_store = 2; PRAGMA synchronous = OFF;");
  db.exec(
    `CREATE TABLE cv_documents (id TEXT PRIMARY KEY, file_name TEXT);
     CREATE TABLE profile_variants (id TEXT PRIMARY KEY, name TEXT);`,
  );
  db.exec(`CREATE TABLE cv_rewrites (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, cv_document_id TEXT,
    role_variant_id TEXT, model_provider TEXT, model_name TEXT,
    language TEXT, rewrite_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
    source_text TEXT, created_at TEXT NOT NULL
  );`);
  if (current) {
    db.exec(
      "CREATE INDEX idx_cv_rewrites_profile_created ON cv_rewrites(profile_id, created_at DESC);",
    );
  }
  db.exec(
    "INSERT INTO cv_documents VALUES ('doc-1', 'resume.pdf'); INSERT INTO profile_variants VALUES ('variant-1', 'Backend');",
  );
  const insert = db.prepare(`INSERT INTO cv_rewrites
    VALUES (?, 'profile-a', 'doc-1', 'variant-1', 'provider', 'model', 'en', ?, ?, ?, ?)`);
  const body = JSON.stringify({
    summary: "x".repeat(1_000),
    experience: ["achievement ".repeat(250)],
    skills: ["Rust", "SQL", "Cloud"],
  });
  const metadata = JSON.stringify({
    title: "Backend Engineer",
    keywords: ["Rust", "SQL", "Cloud"],
  });
  const source = "source CV text ".repeat(500);
  db.exec("BEGIN");
  for (let i = 0; i < rewrites; i += 1) {
    insert.run(
      `rewrite-${String(i).padStart(6, "0")}`,
      body,
      metadata,
      source,
      String(100_000 - i).padStart(6, "0"),
    );
  }
  db.exec("COMMIT");
  return db;
}

function pragma(db, name) {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return row?.[Object.keys(row)[0]] ?? null;
}

function sqliteMetadata(db, file) {
  let ftsBytes = null;
  try {
    ftsBytes = db
      .prepare(
        "SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name LIKE 'job_posts_fts%'",
      )
      .get().bytes;
  } catch {
    ftsBytes = null;
  }
  return {
    pragmas: {
      pageSize: pragma(db, "page_size"),
      journalMode: pragma(db, "journal_mode"),
      synchronous: pragma(db, "synchronous"),
      cacheSize: pragma(db, "cache_size"),
      mmapSize: pragma(db, "mmap_size"),
      tempStore: pragma(db, "temp_store"),
      walAutocheckpoint: pragma(db, "wal_autocheckpoint"),
      pageCount: pragma(db, "page_count"),
    },
    databaseBytes: fileBytes(file),
    walBytes: fileBytes(`${file}-wal`),
    shmBytes: fileBytes(`${file}-shm`),
    ftsBytes,
  };
}

function queryPlan(db, sql, params) {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => Object.values(row).join(" | "));
}

function persistedFixture(root, args) {
  const file = path.resolve(root, args.fixture);
  mkdirSync(path.dirname(file), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
  seedJobs(db, args.rows, true);
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 1000;");
  const metadata = sqliteMetadata(db, file);
  const samples = [];
  for (let i = 0; i < args.warmup; i += 1) currentFts(db);
  for (let i = 0; i < args.iterations; i += 1) {
    const started = performance.now();
    currentFts(db);
    samples.push(performance.now() - started);
  }
  const plan = queryPlan(
    db,
    `${CURRENT_FTS_SELECT} WHERE job_posts_fts MATCH ? AND jp.profile_id = ? ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?`,
    ['"rust"*', "profile-a", 200],
  );
  const resultInfo = currentFts(db);
  const beforeCheckpoint = {
    databaseBytes: fileBytes(file),
    walBytes: fileBytes(`${file}-wal`),
    shmBytes: fileBytes(`${file}-shm`),
  };
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
  return {
    path: file,
    sanitized: true,
    rows: args.rows,
    sha256: sha256File(file),
    metadata: {
      ...metadata,
      beforeCheckpoint,
      databaseBytes: fileBytes(file),
      walBytes: fileBytes(`${file}-wal`),
      shmBytes: fileBytes(`${file}-shm`),
    },
    ftsProfile: {
      timing: summarize(samples),
      resultRows: resultInfo.rowCount,
      plan,
    },
  };
}

function makeImportDb(current) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE imported_jobs (id TEXT PRIMARY KEY, batch TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL);",
  );
  if (current)
    db.exec("CREATE INDEX idx_imported_jobs_batch_status ON imported_jobs(batch, status);");
  return db;
}

function importRows(db, batch, units, transactional) {
  const insert = db.prepare(
    "INSERT INTO imported_jobs(id, batch, title, status) VALUES (?, ?, ?, 'discovered')",
  );
  if (transactional) db.exec("BEGIN");
  for (let i = 0; i < units; i += 1) {
    insert.run(`${batch}-${String(i).padStart(4, "0")}`, batch, `Imported role ${i}`);
  }
  if (transactional) db.exec("COMMIT");
  return result(db.prepare("SELECT id FROM imported_jobs WHERE batch = ? ORDER BY id").all(batch));
}

function makeWriteDb(current, units) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE job_posts (id TEXT PRIMARY KEY, status TEXT NOT NULL); CREATE TABLE job_matches (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, score REAL NOT NULL);",
  );
  const insert = db.prepare("INSERT INTO job_posts(id, status) VALUES (?, 'discovered')");
  db.exec("BEGIN");
  for (let i = 0; i < units; i += 1) insert.run(`job-${i}`);
  db.exec("COMMIT");
  if (current) db.exec("CREATE INDEX idx_job_matches_job ON job_matches(job_id);");
  return db;
}

function batchWrites(db, batch, units, transactional) {
  const insert = db.prepare("INSERT INTO job_matches(id, job_id, score) VALUES (?, ?, ?)");
  const update = db.prepare("UPDATE job_posts SET status = 'matched' WHERE id = ?");
  if (transactional) db.exec("BEGIN");
  for (let i = 0; i < units; i += 1) {
    insert.run(`${batch}-${String(i).padStart(4, "0")}`, `job-${i}`, i / units);
    update.run(`job-${i}`);
  }
  if (transactional) db.exec("COMMIT");
  return result(
    db.prepare("SELECT id FROM job_matches WHERE id LIKE ? ORDER BY id").all(`${batch}-%`),
  );
}

function measureThroughputPair(makeDb, oldRun, currentRun, args, units, unitName) {
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const oldDb = makeDb(false);
  const currentDb = makeDb(true);
  for (let i = 0; i < args.warmup; i += 1) {
    oldRun(oldDb, `warmup-${i}`, units);
    currentRun(currentDb, `warmup-${i}`, units);
  }
  const oldSamples = [];
  const currentSamples = [];
  let oldResult;
  let currentResult;
  for (let i = 0; i < args.iterations; i += 1) {
    const runs =
      i % 2 === 0
        ? [
            [oldRun, oldDb, oldSamples, `batch-${i}`],
            [currentRun, currentDb, currentSamples, `batch-${i}`],
          ]
        : [
            [currentRun, currentDb, currentSamples, `batch-${i}`],
            [oldRun, oldDb, oldSamples, `batch-${i}`],
          ];
    for (const [run, db, samples, batch] of runs) {
      const started = performance.now();
      const value = run(db, batch, units);
      samples.push(performance.now() - started);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (run === oldRun) oldResult = value;
      else currentResult = value;
    }
  }
  oldDb.close();
  currentDb.close();
  assertEquivalent(oldResult, currentResult);
  const oldTiming = summarize(oldSamples);
  const currentTiming = summarize(currentSamples);
  const rssAfter = process.memoryUsage().rss;
  return {
    baseline: { timing: oldTiming, rowCount: oldResult.rowCount },
    current: { timing: currentTiming, rowCount: currentResult.rowCount },
    equivalence: currentResult.equivalence,
    throughput: {
      unit: unitName,
      batchSize: units,
      baseline: Number((units / (oldTiming.p50Ms / 1_000)).toFixed(3)),
      current: Number((units / (currentTiming.p50Ms / 1_000)).toFixed(3)),
    },
    resources: {
      rssBeforeBytes: rssBefore,
      peakRssBytes: peakRss,
      rssAfterBytes: rssAfter,
      rssDeltaBytes: rssAfter - rssBefore,
    },
  };
}

const EQUIVALENCE_KEYS = [
  "id",
  "profile_id",
  "title",
  "company",
  "location",
  "description",
  "summary",
  "discovered_at",
  "status",
  "search_query_id",
  "created_at",
];

function equivalenceFields(row) {
  return Object.fromEntries(
    EQUIVALENCE_KEYS.filter((key) => key in row).map((key) => [
      key,
      String(row[key] ?? "").slice(0, 320),
    ]),
  );
}

function boundaryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    discoveredAt: row.discovered_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

function result(rows) {
  const equivalenceRows = rows.map(equivalenceFields);
  const orderedIds = rows.map((row) => row.id).join("|");
  const boundary = {
    first: boundaryRow(rows[0]),
    last: boundaryRow(rows.at(-1)),
  };
  return {
    rowCount: rows.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(rows)),
    identity: orderedIds,
    equivalence: {
      orderedIdsSha256: createHash("sha256").update(orderedIds).digest("hex"),
      requiredFieldsSha256: createHash("sha256")
        .update(JSON.stringify(equivalenceRows))
        .digest("hex"),
      boundaries: boundary,
    },
  };
}

function oldFts(db, limit = 200) {
  const ids = db
    .prepare(
      `SELECT jp.id FROM job_posts_fts
      JOIN job_posts jp ON jp.rowid = job_posts_fts.rowid
      WHERE job_posts_fts MATCH ? AND jp.profile_id = ?
      ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?`,
    )
    .all('"rust"*', "profile-a", limit);
  const get = db.prepare(`${FULL_JOB_SELECT} WHERE id = ?`);
  return result(ids.map(({ id }) => get.get(id)));
}

function currentFts(db, limit = 200) {
  return result(
    db
      .prepare(
        `${CURRENT_FTS_SELECT} WHERE job_posts_fts MATCH ? AND jp.profile_id = ?
        ORDER BY bm25(job_posts_fts, 10.0, 5.0, 2.0, 1.5, 1.0) ASC LIMIT ?`,
      )
      .all('"rust"*', "profile-a", limit),
  );
}

function oldList(db, offset = 0) {
  return result(
    db
      .prepare(
        `${FULL_JOB_SELECT} WHERE profile_id = ? ORDER BY discovered_at DESC, id DESC LIMIT 50 OFFSET ?`,
      )
      .all("profile-a", offset),
  );
}

function currentList(db, offset = 0) {
  const cursorIndex = Math.max(0, offset - 1);
  const cursor = String(100_000 - cursorIndex).padStart(6, "0");
  const where = offset ? " AND (discovered_at < ? OR (discovered_at = ? AND id < ?))" : "";
  const args = offset
    ? ["profile-a", cursor, cursor, `job-${String(cursorIndex).padStart(6, "0")}`]
    : ["profile-a"];
  return result(
    db
      .prepare(
        `${SHORT_JOB_SELECT} WHERE profile_id = ?${where} ORDER BY discovered_at DESC, id DESC LIMIT 50`,
      )
      .all(...args),
  );
}

function oldRewriteList(db) {
  return result(
    db
      .prepare(
        `SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
        r.model_provider, r.model_name, r.language, r.rewrite_json, r.metadata_json, r.source_text, r.created_at
        FROM cv_rewrites r LEFT JOIN cv_documents d ON d.id = r.cv_document_id
        LEFT JOIN profile_variants v ON v.id = r.role_variant_id
        WHERE r.profile_id = ? ORDER BY r.created_at DESC`,
      )
      .all("profile-a"),
  );
}

function currentRewriteList(db) {
  return result(
    db
      .prepare(
        `SELECT r.id, r.cv_document_id, d.file_name, r.role_variant_id, v.name,
        r.model_provider, r.model_name, r.language, r.created_at
        FROM cv_rewrites r LEFT JOIN cv_documents d ON d.id = r.cv_document_id
        LEFT JOIN profile_variants v ON v.id = r.role_variant_id
        WHERE r.profile_id = ? ORDER BY r.created_at DESC`,
      )
      .all("profile-a"),
  );
}

function oldSearchBatchRead(db) {
  const ids = db
    .prepare(
      "SELECT id FROM job_posts WHERE search_query_id = ? AND status = 'discovered' ORDER BY discovered_at ASC",
    )
    .all("search-1");
  const job = db.prepare(`${FULL_JOB_SELECT} WHERE id = ?`);
  const pref = db.prepare(
    "SELECT id, required_skills_json FROM job_preferences WHERE profile_id = ?",
  );
  return result(ids.map(({ id }) => ({ ...job.get(id), preference: pref.get("profile-a") })));
}

function currentSearchBatchRead(db) {
  const pref = db
    .prepare("SELECT id, required_skills_json FROM job_preferences WHERE profile_id = ?")
    .get("profile-a");
  db.prepare(
    "SELECT id, target_title, keywords_json FROM profile_variants WHERE profile_id = ?",
  ).all("profile-a");
  const jobs = db
    .prepare(
      `${FULL_JOB_SELECT} WHERE search_query_id = ? AND status = 'discovered' ORDER BY discovered_at ASC, id ASC`,
    )
    .all("search-1");
  return result(jobs.map((job) => ({ ...job, preference: pref })));
}

function addSearchTables(db) {
  db.exec(
    "CREATE TABLE job_preferences (id TEXT PRIMARY KEY, profile_id TEXT, required_skills_json TEXT); CREATE TABLE profile_variants (id TEXT PRIMARY KEY, profile_id TEXT, target_title TEXT, keywords_json TEXT);",
  );
  db.exec(
    "INSERT INTO job_preferences VALUES ('pref-1', 'profile-a', '[\"Rust\",\"SQL\"]'); INSERT INTO profile_variants VALUES ('variant-1', 'profile-a', 'Backend', '[\"Rust\",\"SQL\"]');",
  );
}

function assertEquivalent(baseline, current) {
  const keys = ["rowCount", "identity"];
  for (const key of keys) {
    if (baseline[key] !== current[key]) throw new Error(`result mismatch: ${key}`);
  }
  if (JSON.stringify(baseline.equivalence) !== JSON.stringify(current.equivalence)) {
    throw new Error("result mismatch: semantic equivalence fields or pagination boundary");
  }
}

function measurePair(makeDb, oldRun, currentRun, args, units = 1) {
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const oldDb = makeDb(false);
  const currentDb = makeDb(true);
  for (let i = 0; i < args.warmup; i += 1) {
    oldRun(oldDb);
    currentRun(currentDb);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const oldSamples = [];
  const currentSamples = [];
  let oldResult;
  let currentResult;
  for (let i = 0; i < args.iterations; i += 1) {
    const first =
      i % 2 === 0
        ? [
            [oldRun, oldDb, oldSamples],
            [currentRun, currentDb, currentSamples],
          ]
        : [
            [currentRun, currentDb, currentSamples],
            [oldRun, oldDb, oldSamples],
          ];
    for (const [run, db, samples] of first) {
      const started = performance.now();
      const value = run(db);
      samples.push(performance.now() - started);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (run === oldRun) oldResult = value;
      else currentResult = value;
    }
  }
  oldDb.close();
  currentDb.close();
  assertEquivalent(oldResult, currentResult);
  const oldTiming = summarize(oldSamples);
  const currentTiming = summarize(currentSamples);
  const rssAfter = process.memoryUsage().rss;
  return {
    baseline: {
      timing: oldTiming,
      rowCount: oldResult.rowCount,
      payloadBytes: oldResult.payloadBytes,
    },
    current: {
      timing: currentTiming,
      rowCount: currentResult.rowCount,
      payloadBytes: currentResult.payloadBytes,
    },
    equivalence: currentResult.equivalence,
    throughput: {
      unit: "rows/sec",
      baseline: Number((units / (oldTiming.p50Ms / 1_000)).toFixed(3)),
      current: Number((units / (currentTiming.p50Ms / 1_000)).toFixed(3)),
    },
    resources: {
      rssBeforeBytes: rssBefore,
      peakRssBytes: peakRss,
      rssAfterBytes: rssAfter,
      rssDeltaBytes: rssAfter - rssBefore,
    },
    speedup: Number((oldTiming.p50Ms / currentTiming.p50Ms).toFixed(3)),
    payloadReduction: Number((1 - currentResult.payloadBytes / oldResult.payloadBytes).toFixed(3)),
  };
}

function runCase(name, makeDb, oldRun, currentRun, args, units = 1) {
  return { name, ...measurePair(makeDb, oldRun, currentRun, args, units) };
}

export function runBenchmark(root, args) {
  const commits = gitMetadata(root, args);
  const baseline = prepareBaseline(root, args.createClone || args.buildRelease, args.baselineRef);
  const makeJobs = (current) => seedJobs(new DatabaseSync(":memory:"), args.rows, current);
  const makeSearchJobs = (current) => {
    const db = seedJobs(new DatabaseSync(":memory:"), args.rows, current);
    addSearchTables(db);
    return db;
  };
  const deepOffset = Math.max(1, Math.floor(args.rows * 0.75));
  const searchUnits = Array.from({ length: args.rows }, (_, i) => i).filter(
    (i) => i % 8 === 1 && i % 9 !== 0,
  ).length;
  const batchUnits = Math.max(100, Math.min(args.rows, 1_000));
  const cases = [
    runCase("fts-search-join-vs-n-plus-one", makeJobs, oldFts, currentFts, args, 200),
    runCase("job-list-bounded-summary", makeJobs, oldList, currentList, args, 50),
    runCase(
      "job-list-deep-keyset-vs-offset",
      makeJobs,
      (db) => oldList(db, deepOffset),
      (db) => currentList(db, deepOffset),
      args,
      50,
    ),
    runCase(
      "search-batch-preload-vs-per-row-reads",
      makeSearchJobs,
      oldSearchBatchRead,
      currentSearchBatchRead,
      args,
      searchUnits,
    ),
    runCase(
      "cv-rewrite-summary-vs-full-history",
      (current) => seedRewrites(new DatabaseSync(":memory:"), args.rewrites, current),
      oldRewriteList,
      currentRewriteList,
      args,
      args.rewrites,
    ),
  ];
  const throughputCases = [
    {
      name: "job-import-throughput",
      ...measureThroughputPair(
        makeImportDb,
        (db, batch, units) => importRows(db, batch, units, false),
        (db, batch, units) => importRows(db, batch, units, true),
        args,
        batchUnits,
        "imported rows/sec",
      ),
    },
    {
      name: "batched-match-write-throughput",
      ...measureThroughputPair(
        (current) => makeWriteDb(current, batchUnits),
        (db, batch, units) => batchWrites(db, batch, units, false),
        (db, batch, units) => batchWrites(db, batch, units, true),
        args,
        batchUnits,
        "matched rows/sec",
      ),
    },
  ];
  const fixture = persistedFixture(root, args);
  return {
    generatedAt: new Date().toISOString(),
    commits,
    baseline,
    environment: collectEnvironment(root, args),
    startup: measureHarnessStartup(root, args, summarize),
    artifacts: {
      frontendDistBytes: directoryBytes(path.join(root, "dist")),
      baselineFrontendDistBytes: directoryBytes(path.join(baseline.path, "dist")),
      releaseBuilds: releaseBuilds(root, baseline.path, args),
    },
    fixture,
    ftsDiagnostics: ftsDiagnostics(makeJobs, {
      currentFtsSelect: CURRENT_FTS_SELECT,
      sqliteMetadata,
      queryPlan,
    }),
    config: args,
    cases,
    throughputCases,
  };
}

function printReport(report) {
  console.log(`baseline=${report.baseline.source} files=${report.baseline.files}`);
  console.log("case | baseline p50 ms | current p50 ms | speedup | payload reduction");
  for (const item of report.cases) {
    console.log(
      `${item.name} | ${item.baseline.timing.p50Ms} | ${item.current.timing.p50Ms} | ${item.speedup}x | ${item.payloadReduction * 100}%`,
    );
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "usage: node scripts/benchmark-changes.mjs [--profile smoke|performance] [--rows N] [--rewrites N] [--iterations N] [--warmup N] [--baseline-ref REF] [--candidate-ref REF] [--fixture FILE] [--output FILE] [--create-clone] [--keep-clone] [--build-release]",
    );
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let report;
  let createdClone;
  try {
    report = runBenchmark(root, args);
    createdClone = report.baseline.temporary ? report.baseline.path : null;
    const output = path.resolve(root, args.output);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    printReport(report);
    console.log(`results=${output}`);
  } finally {
    if (createdClone && !args.keepClone) rmSync(createdClone, { recursive: true, force: true });
  }
}

export { prepareBaseline };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
