import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import pg from "pg";
import { memorySnapshot } from "./cloud-memory.mjs";
import {
  CloudRunnerError,
  ENCRYPTION_VERSION,
  STORAGE_STATE_VERSION,
  buildOperationRequest,
  decryptSessionState,
  encryptSessionState,
  summarizePlatformStatus,
} from "./cloud-runner-contract.mjs";

export {
  CloudRunnerError,
  ENCRYPTION_VERSION,
  STORAGE_STATE_VERSION,
  buildOperationRequest,
  decryptSessionState,
  encryptSessionState,
  summarizePlatformStatus,
} from "./cloud-runner-contract.mjs";

const { Pool } = pg;
export function platformStatuses(reply) {
  const raw =
    reply?.platform_status && typeof reply.platform_status === "object"
      ? reply.platform_status
      : Object.fromEntries(
          Object.entries(reply?.status ?? {}).map(([platform, valid]) => [
            platform,
            valid ? "valid" : "login_required",
          ]),
        );
  return Object.fromEntries(Object.entries(raw).filter(([platform]) => platform !== "infojobs"));
}

function targetStatus(statuses, platform) {
  if (platform && statuses[platform]) return statuses[platform];
  return summarizePlatformStatus(statuses);
}

async function persistInvalidSessionStatus(pool, row, status, statuses) {
  const { rowCount } = await pool.query(
    `UPDATE browser_sessions
        SET status = $1, platform_status = $2::jsonb, revision = revision + 1,
            updated_at = now(), last_validated_at = now()
      WHERE profile_id = $3 AND revision = $4 AND status <> 'revoked'`,
    [status, JSON.stringify(statuses), row.profile_id, row.revision],
  );
  if (rowCount !== 1) throw new CloudRunnerError("session_revision_conflict");
}

async function assertAndRecordTarget(pool, row, statuses, platform) {
  const status = targetStatus(statuses, platform);
  if (status === "valid") return;
  await persistInvalidSessionStatus(pool, row, status, statuses);
  throw new CloudRunnerError(status === "unknown" ? "session_status_unknown" : status);
}

function createRpc(child) {
  const pending = new Map();
  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok === false) waiter.reject(new CloudRunnerError("worker_command_failed"));
      else waiter.resolve(message);
    } catch {
      // Protocol diagnostics never include raw lines: a line may contain state data.
    }
  });
  const failPending = () => {
    for (const waiter of pending.values()) waiter.reject(new CloudRunnerError("worker_exited"));
    pending.clear();
  };
  child.once("exit", failPending);
  return (payload) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(new CloudRunnerError("worker_command_timeout"));
        },
        Number(process.env.HIREMEOPS_CLOUD_COMMAND_TIMEOUT_MS) || 120_000,
      );
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        reject(new CloudRunnerError("worker_exited"));
      }
    });
}

async function closeWorker(child, rpc, handle) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (handle) await rpc({ cmd: "close", handle }).catch(() => {});
  if (!child.stdin.destroyed) child.stdin.end();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function loadRun(pool, runId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.profile_id, r.intent, r.query_plan, r.status,
            s.encrypted_state, s.encryption_version, s.state_format_version,
            s.revision, s.status AS session_status
       FROM search_runs r
       LEFT JOIN browser_sessions s ON s.profile_id = r.profile_id
      WHERE r.id = $1`,
    [runId],
  );
  if (!rows[0]) throw new CloudRunnerError("search_run_missing");
  if (rows[0].status !== "started") throw new CloudRunnerError("search_run_not_started");
  if (!rows[0].profile_id || !rows[0].encrypted_state)
    throw new CloudRunnerError("session_missing");
  if (rows[0].session_status !== "valid") throw new CloudRunnerError("session_not_valid");
  if (rows[0].encryption_version !== ENCRYPTION_VERSION)
    throw new CloudRunnerError("encryption_version_unsupported");
  if (rows[0].state_format_version !== STORAGE_STATE_VERSION)
    throw new CloudRunnerError("storage_state_version_unsupported");
  return rows[0];
}

async function acquireProfileLock(pool, profileId) {
  const client = await pool.connect();
  let result;
  try {
    result = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [profileId],
    );
  } catch (error) {
    client.release();
    if (error instanceof CloudRunnerError) throw error;
    throw new CloudRunnerError("profile_lock_failed");
  }
  if (!result.rows[0]?.acquired) {
    client.release();
    throw new CloudRunnerError("profile_busy");
  }
  return client;
}

async function releaseProfileLock(client, profileId) {
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [profileId]);
  } finally {
    client.release();
  }
}

async function updateRun(pool, runId, status, error = null) {
  await pool.query(
    "UPDATE search_runs SET status = $2, finished_at = now(), error = $3 WHERE id = $1",
    [runId, status, error],
  );
}

function isResultJob(job) {
  return job && typeof job === "object";
}

function jobExternalId(job) {
  return String(job.job_id ?? job.apply_url ?? `${job.title ?? ""}:${job.company ?? ""}`);
}

function jobText(job, field, fallback) {
  return job[field] ? String(job[field]) : fallback;
}

function resultRow(job, platform) {
  const external = jobExternalId(job);
  const key = `${platform}\0${external}`;
  const id = `cloud-${createHash("sha256").update(key).digest("hex")}`;
  const title = jobText(job, "title", "Untitled role");
  const company = jobText(job, "company", "Unknown company");
  const description = String(job.description ?? job.title ?? "Cloud result");
  const contentHash = createHash("sha256")
    .update(`${job.title ?? ""}\0${description}`)
    .digest("hex");
  return [
    id,
    platform,
    title,
    company,
    job.location ? String(job.location) : null,
    job.remote_mode ? String(job.remote_mode) : null,
    description,
    job.apply_url ?? null,
    contentHash,
  ];
}

function resultRows(result, platform) {
  if (!Array.isArray(result?.jobs)) return [];
  return result.jobs.filter(isResultJob).map((job) => resultRow(job, platform));
}

async function persistResults(pool, row, result, platform) {
  const values = resultRows(result, platform);
  for (const [
    id,
    site,
    title,
    company,
    location,
    remoteMode,
    description,
    url,
    contentHash,
  ] of values) {
    await pool.query(
      `INSERT INTO shared_jobs
        (id, search_run_id, profile_id, platform, canonical_url, title, company, location,
         remote_mode, description, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         search_run_id = EXCLUDED.search_run_id, description = EXCLUDED.description,
         content_hash = EXCLUDED.content_hash`,
      [
        id,
        row.id,
        row.profile_id,
        site,
        url,
        title,
        company,
        location,
        remoteMode,
        description,
        contentHash,
      ],
    );
  }
  return values.length;
}

export async function persistRefreshedState(pool, row, encrypted, platformStatus) {
  const { rowCount } = await pool.query(
    `UPDATE browser_sessions
        SET encrypted_state = $1, encryption_version = $2, state_format_version = $3,
            status = 'valid', platform_status = $4::jsonb, revision = revision + 1,
            updated_at = now(), last_validated_at = now()
      WHERE profile_id = $5 AND revision = $6 AND status <> 'revoked'`,
    [
      encrypted,
      ENCRYPTION_VERSION,
      STORAGE_STATE_VERSION,
      JSON.stringify(platformStatus),
      row.profile_id,
      row.revision,
    ],
  );
  if (rowCount !== 1) throw new CloudRunnerError("session_revision_conflict");
}

async function spawnWorker(tempProfile) {
  const script = process.env.HIREMEOPS_WORKER_SCRIPT ?? join(import.meta.dirname, "worker.js");
  const child = spawn(process.execPath, [script], {
    cwd: join(import.meta.dirname),
    env: {
      ...process.env,
      HIREMEOPS_CLOUD: "1",
      HIREMEOPS_DISABLE_CAPTURE: "1",
      HIREMEOPS_PERF: "1",
      HIREMEOPS_PERF_INTERVAL_MS: process.env.HIREMEOPS_PERF_INTERVAL_MS ?? "1000",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
      HIREMEOPS_CLOUD_PROFILE: tempProfile,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  return { child, rpc: createRpc(child) };
}

function cloudConfig(runId) {
  if (!runId) throw new CloudRunnerError("HIREMEOPS_RUN_ID_required");
  const databaseUrl = process.env.HIREMEOPS_DATABASE_URL;
  const encodedKey = process.env.HIREMEOPS_SESSION_ENCRYPTION_KEY;
  if (!databaseUrl) throw new CloudRunnerError("HIREMEOPS_DATABASE_URL_required");
  if (!encodedKey) throw new CloudRunnerError("HIREMEOPS_SESSION_ENCRYPTION_KEY_required");
  return { runId, databaseUrl, encodedKey };
}

function createMemoryRecorder(report) {
  const record = (stage) => {
    const snapshot = memorySnapshot(stage);
    report.stages.push(snapshot);
    process.stderr.write(`[cloud-memory] ${JSON.stringify(snapshot)}\n`);
  };
  return record;
}

function cloudContext(config, pool) {
  const report = { runId: config.runId, stages: [] };
  return {
    ...config,
    pool,
    report,
    record: createMemoryRecorder(report),
    row: null,
    lock: null,
    worker: null,
    handle: null,
    tempProfile: null,
  };
}

async function openCloudBrowser(context) {
  context.tempProfile = await mkdtemp(join(tmpdir(), "hiremeops-cloud-profile-"));
  context.worker = await spawnWorker(context.tempProfile);
  const opened = await context.worker.rpc({
    cmd: "open",
    user_data_dir: context.tempProfile,
    extensions: [],
    headless: true,
  });
  context.handle = opened.handle;
  context.record("browser-open");
}

async function probeLogins(context, platform) {
  const reply = await context.worker.rpc({
    cmd: "check_logins",
    user_data_dir: context.tempProfile,
    reuse_page: true,
    sites: platform ? [platform] : undefined,
  });
  if (reply.platform_errors) {
    process.stderr.write(`[cloud-auth] ${JSON.stringify(reply.platform_errors)}\n`);
  }
  return platformStatuses(reply);
}

function requireStorageVersion(version) {
  if (version !== STORAGE_STATE_VERSION)
    throw new CloudRunnerError("storage_state_version_unsupported");
}

async function executeCloudRun(context) {
  const { pool, runId, encodedKey } = context;
  context.row = await loadRun(pool, runId);
  context.lock = await acquireProfileLock(pool, context.row.profile_id);
  const state = decryptSessionState(context.row.encrypted_state, encodedKey);
  await openCloudBrowser(context);
  await context.worker.rpc({
    cmd: "import_storage_state",
    handle: context.handle,
    version: context.row.state_format_version,
    storageState: state,
  });
  const platform = context.row.query_plan?.platform;
  const initialStatuses = await probeLogins(context, platform);
  await assertAndRecordTarget(pool, context.row, initialStatuses, platform);
  context.record("post-navigation");
  const result = await context.worker.rpc(
    buildOperationRequest(context.row.query_plan, context.handle),
  );
  context.record("scraping-peak");
  await persistResults(pool, context.row, result, platform ?? "unknown");
  const finalStatuses = await probeLogins(context, platform);
  await assertAndRecordTarget(pool, context.row, finalStatuses, platform);
  const refreshed = await context.worker.rpc({
    cmd: "export_storage_state",
    handle: context.handle,
  });
  requireStorageVersion(refreshed.version);
  await persistRefreshedState(
    pool,
    context.row,
    encryptSessionState(refreshed.storageState, encodedKey),
    finalStatuses,
  );
  await updateRun(pool, runId, "completed");
  return {
    runId,
    status: "completed",
    results: resultRows(result, platform ?? "unknown").length,
    memory: context.report,
  };
}

function cloudErrorCode(error) {
  return error instanceof CloudRunnerError ? error.code : "cloud_run_failed";
}

async function refreshInvalidStatus(context) {
  if (!context.row || !context.worker || !context.handle) return;
  const statuses = await probeLogins(context, context.row.query_plan?.platform);
  const target = targetStatus(statuses, context.row.query_plan?.platform);
  if (target === "valid") return;
  await persistInvalidSessionStatus(context.pool, context.row, target, statuses).catch(() => {});
}

async function failCloudRun(context, error) {
  const code = cloudErrorCode(error);
  if (code !== "session_revision_conflict") await refreshInvalidStatus(context).catch(() => {});
  await updateRun(context.pool, context.runId, "failed", code).catch(() => {});
  throw error instanceof CloudRunnerError ? error : new CloudRunnerError(code);
}

async function cleanupCloudRun(context, injectedPool) {
  await stopCloudWorker(context);
  context.record("shutdown");
  await removeCloudProfile(context);
  await releaseProfileLock(context.lock, context.row?.profile_id).catch(() => {});
  await closeCloudPool(context.pool, injectedPool);
  await writeMemoryReport(context);
}

async function stopCloudWorker(context) {
  if (!context.worker) return;
  await closeWorker(context.worker.child, context.worker.rpc, context.handle).catch(() => {});
}

async function removeCloudProfile(context) {
  if (!context.tempProfile) return;
  await rm(context.tempProfile, { recursive: true, force: true }).catch(() => {});
}

async function closeCloudPool(pool, injectedPool) {
  if (!injectedPool) await pool.end().catch(() => {});
}

async function writeMemoryReport(context) {
  const path =
    process.env.HIREMEOPS_MEMORY_REPORT_PATH ??
    join(tmpdir(), `hiremeops-memory-${context.runId}.json`);
  await writeFile(path, JSON.stringify(context.report, null, 2), "utf8").catch(() => {});
}

export async function runCloudJob({
  runId = process.env.HIREMEOPS_RUN_ID,
  pool: injectedPool,
} = {}) {
  const config = cloudConfig(runId);
  const pool =
    injectedPool ??
    new Pool({ connectionString: config.databaseUrl, max: 2, idleTimeoutMillis: 10_000 });
  const context = cloudContext(config, pool);
  context.record("startup");
  try {
    return await executeCloudRun(context);
  } catch (error) {
    return await failCloudRun(context, error);
  } finally {
    await cleanupCloudRun(context, injectedPool);
  }
}

if (import.meta.main) {
  runCloudJob().catch((error) => {
    process.stderr.write(
      `[cloud-runner] failed: ${error instanceof CloudRunnerError ? error.code : "cloud_run_failed"}\n`,
    );
    process.exitCode = 1;
  });
}
