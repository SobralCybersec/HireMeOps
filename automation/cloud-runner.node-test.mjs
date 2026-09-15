import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CloudRunnerError,
  buildOperationRequest,
  decryptSessionState,
  encryptSessionState,
  persistRefreshedState,
  runCloudJob,
  summarizePlatformStatus,
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

  it("keeps memory diagnostics metadata-only", () => {
    const log = JSON.stringify(memorySnapshot("fixture"));
    assert.doesNotMatch(log, /cookies|authorization|storageState|indexedDB|token/i);
  });
});

describe("cloud runner lifecycle boundary", () => {
  it("builds only allowlisted worker operations", () => {
    assert.deepEqual(
      buildOperationRequest({ platform: "linkedin", args: { keywords: "Rust" } }, "h"),
      {
        cmd: "search_jobs",
        handle: "h",
        keywords: "Rust",
      },
    );
    assert.throws(
      () => buildOperationRequest({ command: "arbitrary", args: {} }, "h"),
      (error) => error instanceof CloudRunnerError && error.code === "unsupported_operation",
    );
  });

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
