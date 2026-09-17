import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { memorySnapshot } from "./cloud-memory.mjs";
import { createCgroupMemoryGuard } from "./cloud/cloud-memory-guard.mjs";
import {
  closeCloudBrowser,
  openCloudBrowser as createCloudBrowser,
} from "./cloud/cloud-browser.mjs";
import { authErrorCode, authStatusPlatform, classifyPageAuth } from "./cloud/cloud-auth.mjs";
import { dispatchCloudOperation } from "./cloud/cloud-dispatch.mjs";
import { sessions } from "./core/worker/worker-context.js";
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

export function mergePlatformStatus(existing, platform, status) {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  return platform ? { ...current, [platform]: status } : current;
}

function mergePlatformStatuses(existing, incoming) {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  return { ...current, ...next };
}

async function persistInvalidSessionStatus(pool, row, platform, status) {
  const platformStatus = mergePlatformStatus(row.platform_status, platform, status);
  const { rowCount } = await pool.query(
    `UPDATE browser_sessions
        SET status = $1, platform_status = $2::jsonb, revision = revision + 1,
            updated_at = now(), last_validated_at = now()
      WHERE profile_id = $3 AND revision = $4 AND status <> 'revoked'`,
    [
      summarizePlatformStatus(platformStatus),
      JSON.stringify(platformStatus),
      row.profile_id,
      row.revision,
    ],
  );
  if (rowCount !== 1) throw new CloudRunnerError("session_revision_conflict");
}

async function loadRun(pool, runId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.profile_id, r.intent, r.query_plan, r.status,
            s.encrypted_state, s.encryption_version, s.state_format_version,
            s.revision, s.status AS session_status, s.platform_status
       FROM search_runs r
       LEFT JOIN browser_sessions s ON s.profile_id = r.profile_id
      WHERE r.id = $1`,
    [runId],
  );
  return validateRunRow(rows[0]);
}

function validateRunRow(row) {
  if (!row) throw new CloudRunnerError("search_run_missing");
  if (row.status !== "started") throw new CloudRunnerError("search_run_not_started");
  if (!row.profile_id || !row.encrypted_state) throw new CloudRunnerError("session_missing");
  validateRunSession(row);
  if (row.encryption_version !== ENCRYPTION_VERSION)
    throw new CloudRunnerError("encryption_version_unsupported");
  if (row.state_format_version !== STORAGE_STATE_VERSION)
    throw new CloudRunnerError("storage_state_version_unsupported");
  return row;
}

function validateRunSession(row) {
  const platform = row.query_plan?.platform;
  const authPlatform = authStatusPlatform(platform);
  if (authPlatform) {
    const targetStatus = row.platform_status?.[authPlatform] ?? "unknown";
    if (targetStatus !== "valid") throw new CloudRunnerError(targetStatus);
    return;
  }
  if (row.session_status !== "valid") {
    throw new CloudRunnerError("session_not_valid");
  }
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

async function persistResults(pool, row, result, platform) {
  let count = 0;
  for (const job of result?.jobs ?? []) {
    if (!isResultJob(job)) continue;
    const [id, site, title, company, location, remoteMode, description, url, contentHash] =
      resultRow(job, platform);
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
    count += 1;
  }
  return count;
}

export async function persistRefreshedState(pool, row, encrypted, platformStatus) {
  const mergedStatus = mergePlatformStatuses(row.platform_status, platformStatus);
  const { rowCount } = await pool.query(
    `UPDATE browser_sessions
        SET encrypted_state = $1, encryption_version = $2, state_format_version = $3,
            status = $4, platform_status = $5::jsonb, revision = revision + 1,
            updated_at = now(), last_validated_at = now()
      WHERE profile_id = $6 AND revision = $7 AND status <> 'revoked'`,
    [
      encrypted,
      ENCRYPTION_VERSION,
      STORAGE_STATE_VERSION,
      summarizePlatformStatus(mergedStatus),
      JSON.stringify(mergedStatus),
      row.profile_id,
      row.revision,
    ],
  );
  if (rowCount !== 1) throw new CloudRunnerError("session_revision_conflict");
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
    snapshot.guardReason = report.guardReason;
    snapshot.pressureSamples = report.pressureSamples;
    report.stages.push(snapshot);
    process.stderr.write(`[cloud-memory] ${JSON.stringify(snapshot)}\n`);
  };
  return record;
}

function cloudContext(config, pool) {
  const report = {
    runId: config.runId,
    stages: [],
    guardReason: null,
    pressureSamples: 0,
  };
  return {
    ...config,
    pool,
    report,
    record: createMemoryRecorder(report),
    row: null,
    lock: null,
    runtime: null,
    handle: null,
    page: null,
    memoryGuard: null,
    memoryBudgetExceeded: false,
  };
}

function memorySoftLimitRatio() {
  const value = Number(process.env.HIREMEOPS_MEMORY_SOFT_LIMIT_RATIO ?? 0.9);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.9;
}

function memoryMb(bytes) {
  return +(bytes / 1_048_576).toFixed(1);
}

async function closeCloudRuntime(context) {
  if (context.handle) sessions.delete(context.handle);
  await closeCloudBrowser(context.runtime);
  context.runtime = null;
  context.page = null;
  context.handle = null;
}

async function openCloudBrowser(context, storageState) {
  context.runtime = await createCloudBrowser(storageState);
  context.page = context.runtime.page;
  context.handle = randomUUID();
  sessions.set(context.handle, {
    browser: context.runtime.context,
    page: context.page,
    user_data_dir: null,
  });
  context.record("browser-open");
  context.memoryGuard = createCgroupMemoryGuard({
    ratio: memorySoftLimitRatio(),
    intervalMs: 500,
    onLimit: async ({ current, max, workingSet, reason, pressureSamples }) => {
      report.guardReason = reason;
      report.pressureSamples = pressureSamples;
      context.memoryBudgetExceeded = true;
      context.report.memoryBudgetExceeded = {
        currentMb: memoryMb(current),
        maxMb: memoryMb(max),
        workingSetMb: memoryMb(workingSet),
        reason,
        pressureSamples,
      };
      process.stderr.write(
        `[cloud-memory] budget-exceeded reason=${reason} currentMb=${memoryMb(current)} workingSetMb=${memoryMb(workingSet)} maxMb=${memoryMb(max)} samples=${pressureSamples}\n`,
      );
      await closeCloudRuntime(context);
    },
  });
}

function operationTimeoutMs() {
  const value = Number(process.env.HIREMEOPS_CLOUD_OPERATION_TIMEOUT_MS ?? 480_000);
  return Number.isFinite(value) && value > 0 ? value : 480_000;
}

export async function withCloudDeadline(operation, { timeoutMs, onTimeout } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try {
        await onTimeout?.();
      } catch {}
      reject(new CloudRunnerError("cloud_operation_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function persistOperationAuthFailure(context, platform) {
  const authPlatform = authStatusPlatform(platform);
  if (!authPlatform) return null;
  const { status } = classifyPageAuth(platform, context.page);
  const code = authErrorCode(status);
  if (!code) return null;
  await persistInvalidSessionStatus(context.pool, context.row, authPlatform, code);
  return code;
}

async function executeCloudOperation(context, request, platform) {
  context.record("operation-start");
  try {
    const result = await withCloudDeadline(() => dispatchCloudOperation(request), {
      timeoutMs: operationTimeoutMs(),
      onTimeout: () => closeCloudRuntime(context),
    });
    if (context.memoryBudgetExceeded) throw new CloudRunnerError("memory_budget_exceeded");
    return result;
  } catch (error) {
    if (context.memoryBudgetExceeded) throw new CloudRunnerError("memory_budget_exceeded");
    const authCode = await persistOperationAuthFailure(context, platform);
    if (authCode) throw new CloudRunnerError(authCode);
    throw error;
  }
}

function assertMemoryBudget(context) {
  if (context.memoryBudgetExceeded) throw new CloudRunnerError("memory_budget_exceeded");
}

async function recordOperationStatus(context, platform) {
  const authPlatform = authStatusPlatform(platform);
  const { status } = classifyPageAuth(platform, context.page);
  if (status === "valid") return status;
  await persistInvalidSessionStatus(context.pool, context.row, authPlatform ?? platform, status);
  throw new CloudRunnerError(status === "unknown" ? "session_status_unknown" : status);
}

async function executeCloudRun(context) {
  const { pool, runId, encodedKey } = context;
  context.row = await loadRun(pool, runId);
  context.report.encryptedStateBytes = context.row.encrypted_state.byteLength;
  context.lock = await acquireProfileLock(pool, context.row.profile_id);
  let storageState = decryptSessionState(context.row.encrypted_state, encodedKey);
  context.report.storageStateBytes = Buffer.byteLength(JSON.stringify(storageState));
  await openCloudBrowser(context, storageState);
  storageState = null;
  context.row.encrypted_state = null;

  const platform = context.row.query_plan?.platform;
  const request = buildOperationRequest(context.row.query_plan, context.handle);
  let result = await executeCloudOperation(context, request, platform);
  assertMemoryBudget(context);
  await recordOperationStatus(context, platform);
  context.record("post-navigation");
  const persistedCount = await persistResults(pool, context.row, result, platform ?? "unknown");
  context.record("scraping-peak");
  result = null;
  assertMemoryBudget(context);

  let refreshedState = await context.runtime.context.storageState({ indexedDB: true });
  context.report.refreshedStorageStateBytes = Buffer.byteLength(JSON.stringify(refreshedState));
  context.record("state-exported");
  const encrypted = encryptSessionState(refreshedState, encodedKey);
  context.report.refreshedEncryptedStateBytes = encrypted.byteLength;
  refreshedState = null;
  const authPlatform = authStatusPlatform(platform);
  await persistRefreshedState(pool, context.row, encrypted, {
    ...(authPlatform ? { [authPlatform]: "valid" } : {}),
  });
  await updateRun(pool, runId, "completed");
  return { runId, status: "completed", results: persistedCount, memory: context.report };
}

function cloudErrorCode(error) {
  return error instanceof CloudRunnerError ? error.code : "cloud_run_failed";
}

const RECORDED_AUTH_FAILURES = new Set([
  "session_status_unknown",
  "login_required",
  "challenged",
  "worker_command_timeout",
  "worker_exited",
  "cloud_operation_timeout",
  "memory_budget_exceeded",
]);

export function shouldRefreshInvalidStatus(code) {
  return code !== "session_revision_conflict" && !RECORDED_AUTH_FAILURES.has(code);
}

async function failCloudRun(context, error) {
  const code = cloudErrorCode(error);
  await updateRun(context.pool, context.runId, "failed", code).catch(() => {});
  throw error instanceof CloudRunnerError ? error : new CloudRunnerError(code);
}

async function cleanupCloudRun(context, injectedPool) {
  context.memoryGuard?.stop();
  context.memoryGuard = null;
  context.record("pre-close");
  await closeCloudRuntime(context);
  context.record("shutdown");
  await releaseProfileLock(context.lock, context.row?.profile_id).catch(() => {});
  await closeCloudPool(context.pool, injectedPool);
  await writeMemoryReport(context);
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
