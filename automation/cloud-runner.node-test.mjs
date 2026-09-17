import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { dispatchCloudOperation } from "./cloud/cloud-dispatch.mjs";
import { createCgroupMemoryGuard } from "./cloud/cloud-memory-guard.mjs";
import { sessions } from "./core/worker/worker-context.js";
import {
  CloudRunnerError,
  buildOperationRequest,
  cloudResultCount,
  decryptSessionState,
  encryptSessionState,
  mergePlatformStatus,
  persistRefreshedState,
  platformStatuses,
  runCloudJob,
  shouldRefreshInvalidStatus,
  summarizePlatformStatus,
  withCloudDeadline,
} from "./cloud-runner.mjs";
import { memorySnapshot } from "./cloud-memory.mjs";

const key = `hex:${"11".repeat(32)}`;
const state = {
  cookies: [],
  origins: [
    { origin: "https://fixture.invalid", localStorage: [{ name: "auth", value: "synthetic" }] },
  ],
};

describe("cloud runner crypto boundary", () => {
  it("encrypts and decrypts a synthetic session fixture", () => {
    const encrypted = encryptSessionState(state, key);
    assert.notDeepEqual(encrypted, Buffer.from(JSON.stringify(state)));
    assert.deepEqual(decryptSessionState(encrypted, key), state);
  });

  it("rejects corrupted ciphertext and wrong keys", () => {
    const encrypted = encryptSessionState(state, key);
    const corrupted = Buffer.from(encrypted);
    corrupted[13] ^= 1;
    assert.throws(
      () => decryptSessionState(corrupted, key),
      (error) => error.code === "session_decryption_failed",
    );
    assert.throws(
      () => decryptSessionState(encrypted, `hex:${"22".repeat(32)}`),
      (error) => error.code === "session_decryption_failed",
    );
  });

  it("keeps status transitions explicit", () => {
    assert.equal(summarizePlatformStatus({ linkedin: "valid" }), "valid");
    assert.equal(summarizePlatformStatus({ linkedin: "login_required" }), "login_required");
    assert.equal(summarizePlatformStatus({ linkedin: "challenged", catho: "valid" }), "challenged");
    assert.equal(summarizePlatformStatus({}), "unknown");
  });

  it("does not repeat probes after an auth status was recorded", () => {
    assert.equal(shouldRefreshInvalidStatus("session_status_unknown"), false);
    assert.equal(shouldRefreshInvalidStatus("login_required"), false);
    assert.equal(shouldRefreshInvalidStatus("challenged"), false);
    assert.equal(shouldRefreshInvalidStatus("worker_command_timeout"), false);
    assert.equal(shouldRefreshInvalidStatus("worker_exited"), false);
    assert.equal(shouldRefreshInvalidStatus("session_revision_conflict"), false);
  });

  it("merges target status without deleting other platforms", () => {
    assert.deepEqual(
      mergePlatformStatus(
        { gupy: "valid", catho: "valid", indeed: "valid", linkedin: "valid" },
        "linkedin",
        "login_required",
      ),
      { gupy: "valid", catho: "valid", indeed: "valid", linkedin: "login_required" },
    );
  });

  it("excludes InfoJobs login status from cloud session decisions", () => {
    assert.deepEqual(
      platformStatuses({
        platform_status: { linkedin: "valid", infojobs: "login_required" },
      }),
      { linkedin: "valid" },
    );
  });

  it("keeps memory diagnostics metadata-only", () => {
    const snapshot = memorySnapshot("fixture");
    const log = JSON.stringify(snapshot);
    assert.ok("cgroupWorkingSetMb" in snapshot);
    assert.ok("inactiveFileMb" in snapshot);
    assert.ok("slabReclaimableMb" in snapshot);
    assert.doesNotMatch(log, /cookies|authorization|storageState|indexedDB|token/i);
  });
});

describe("cloud runner dispatch boundary", () => {
  it("builds only allowlisted worker operations", () => {
    assert.deepEqual(
      buildOperationRequest({ platform: "linkedin", args: { keywords: "Rust" } }, "h"),
      {
        cmd: "search_jobs",
        handle: "h",
        keywords: "Rust",
      },
    );
    assert.equal(cloudResultCount("search_jobs", { jobs: [] }), 0);
    assert.equal(cloudResultCount("search_indeed_jobs", { jobs: [] }), null);
    assert.throws(
      () => cloudResultCount("search_jobs", {}),
      (error) => error instanceof CloudRunnerError && error.code === "cloud_results_invalid",
    );
    assert.throws(
      () => buildOperationRequest({ command: "arbitrary", args: {} }, "h"),
      (error) => error instanceof CloudRunnerError && error.code === "unsupported_operation",
    );
  });

  it("dispatches LinkedIn without loading worker.js", async () => {
    const page = {
      goto: async () => {},
      url: () => "https://www.linkedin.com/jobs/search/",
      locator: () => ({
        first: () => ({ click: async () => {}, isVisible: async () => false }),
      }),
      waitForSelector: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () =>
        page.evaluateCalls++ === 0
          ? {
              url: "https://www.linkedin.com/jobs/search/",
              title: "Jobs",
              readyState: "complete",
              occludableCards: 1,
              jobViewLinks: 1,
              noResultsBanners: 0,
              bodyTextLength: 40,
            }
          : [{ job_id: null, title: "Synthetic role", apply_url: "https://fixture.invalid/job" }],
      evaluateCalls: 0,
    };
    sessions.set("cloud-dispatch-fixture", {
      browser: { cookies: async () => [] },
      page,
    });
    try {
      await assert.doesNotReject(
        dispatchCloudOperation({ cmd: "search_jobs", handle: "cloud-dispatch-fixture" }),
      );
    } finally {
      sessions.delete("cloud-dispatch-fixture");
    }
  });
});

describe("cloud runner lifecycle boundary", () => {
  it("rejects deadline and invokes browser cleanup callback", async () => {
    let closed = false;
    await assert.rejects(
      withCloudDeadline(() => new Promise(() => {}), {
        timeoutMs: 1,
        onTimeout: async () => {
          closed = true;
        },
      }),
      (error) => error instanceof CloudRunnerError && error.code === "cloud_operation_timeout",
    );
    assert.equal(closed, true);
  });

  it("trips memory guard only after sustained working-set pressure", async () => {
    let current = 89;
    let workingSet = 89;
    let tripped = 0;
    let reason;
    const guard = createCgroupMemoryGuard({
      ratio: 0.9,
      intervalMs: 60_000,
      readMemory: () => ({ current, workingSet, max: 100 }),
      onLimit: async (details) => {
        tripped += 1;
        reason = details.reason;
      },
    });
    await guard.check();
    assert.equal(tripped, 0);
    current = 91;
    workingSet = 50;
    await guard.check();
    await guard.check();
    assert.equal(tripped, 0);
    workingSet = 91;
    await guard.check();
    await guard.check();
    await guard.check();
    guard.stop();
    assert.equal(tripped, 1);
    assert.equal(reason, "working_set_sustained");
  });

  it("requires two hard-limit samples even when cache is reclaimable", async () => {
    let tripped = 0;
    let reason;
    const guard = createCgroupMemoryGuard({
      ratio: 0.9,
      hardRatio: 0.998,
      intervalMs: 60_000,
      readMemory: () => ({ current: 100, workingSet: 40, max: 100 }),
      sustainedSamples: 99,
      onLimit: async (details) => {
        tripped += 1;
        reason = details.reason;
      },
    });
    await guard.check();
    assert.equal(tripped, 0);
    await guard.check();
    guard.stop();
    assert.equal(tripped, 1);
    assert.equal(reason, "cgroup_hard_limit");
  });

  it("keeps cloud runner single-process and free of persistent profile calls", async () => {
    const source = await readFile(new URL("./cloud-runner.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /spawn\(/);
    assert.doesNotMatch(source, /worker\.js/);
    assert.doesNotMatch(source, /launchPersistentContext/);
  });
});

describe("cloud runner persistence boundary", () => {
  it("fails explicitly when a cloud run has no session", async () => {
    const previous = {
      database: process.env.HIREMEOPS_DATABASE_URL,
      key: process.env.HIREMEOPS_SESSION_ENCRYPTION_KEY,
    };
    process.env.HIREMEOPS_DATABASE_URL = "postgres://fixture.invalid/db";
    process.env.HIREMEOPS_SESSION_ENCRYPTION_KEY = key;
    const pool = {
      async query() {
        return {
          rows: [
            {
              id: "run-1",
              profile_id: "profile-1",
              query_plan: { platform: "linkedin" },
              status: "started",
            },
          ],
        };
      },
    };
    await assert.rejects(
      runCloudJob({ runId: "run-1", pool }),
      (error) => error instanceof CloudRunnerError && error.code === "session_missing",
    );
    if (previous.database === undefined) delete process.env.HIREMEOPS_DATABASE_URL;
    else process.env.HIREMEOPS_DATABASE_URL = previous.database;
    if (previous.key === undefined) delete process.env.HIREMEOPS_SESSION_ENCRYPTION_KEY;
    else process.env.HIREMEOPS_SESSION_ENCRYPTION_KEY = previous.key;
  });

  it("rejects a refreshed-state revision conflict", async () => {
    const pool = {
      async query() {
        return { rowCount: 0 };
      },
    };
    await assert.rejects(
      persistRefreshedState(pool, { profile_id: "profile-1", revision: 4 }, Buffer.from("x"), {}),
      (error) => error instanceof CloudRunnerError && error.code === "session_revision_conflict",
    );
  });
});
