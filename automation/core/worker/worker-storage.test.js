import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { chromium } from "patchright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { sessions } from "./worker-context.js";
import {
  cmdExportStorageState,
  cmdImportStorageState,
  STORAGE_STATE_VERSION,
} from "./worker-storage.js";
import { decryptSessionState, encryptSessionState } from "../../cloud-runner.mjs";

let server;
let origin;
const dirs = [];

beforeAll(async () => {
  server = await new Promise((resolve) => {
    const value = http.createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>fixture</title>");
    });
    value.listen(0, "127.0.0.1", () => resolve(value));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  for (const handle of ["a", "b"]) {
    const current = sessions.get(handle);
    await current?.browser.close();
    sessions.delete(handle);
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  await new Promise((resolve) => server.close(resolve));
});

async function openContext() {
  const dir = await mkdtemp(join(tmpdir(), "hiremeops-storage-test-"));
  dirs.push(dir);
  return chromium.launchPersistentContext(dir, {
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

describe("worker storage state commands", () => {
  it("exports IndexedDB/localStorage and imports them into another browser", async () => {
    const browserA = await openContext();
    const pageA = browserA.pages()[0] ?? (await browserA.newPage());
    await pageA.goto(origin);
    await pageA.evaluate(async () => {
      localStorage.setItem("synthetic-auth", "session-a");
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("synthetic-auth-db", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("tokens");
        request.onsuccess = () => {
          const tx = request.result.transaction("tokens", "readwrite");
          tx.objectStore("tokens").put("token-a", "access");
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    sessions.set("a", { browser: browserA, user_data_dir: "fixture-a" });

    const exported = await cmdExportStorageState({ handle: "a" });
    expect(exported.version).toBe(STORAGE_STATE_VERSION);
    expect(exported.storageState.cookies).toEqual([]);
    expect(exported.storageState.origins).toHaveLength(1);
    expect(exported.storageState.origins[0].localStorage).toContainEqual({
      name: "synthetic-auth",
      value: "session-a",
    });
    expect(exported.storageState.origins[0].indexedDB).toHaveLength(1);

    const persisted = {
      encryptedState: encryptSessionState(exported.storageState, `hex:${"33".repeat(32)}`),
    };
    const restoredState = decryptSessionState(persisted.encryptedState, `hex:${"33".repeat(32)}`);

    const browserB = await openContext();
    const pageB = browserB.pages()[0] ?? (await browserB.newPage());
    await pageB.goto(origin);
    await pageB.evaluate(() => localStorage.setItem("stale", "value"));
    sessions.set("b", { browser: browserB, user_data_dir: "fixture-b" });
    await expect(
      cmdImportStorageState({
        handle: "b",
        version: exported.version,
        storageState: restoredState,
      }),
    ).resolves.toMatchObject({
      version: STORAGE_STATE_VERSION,
      imported: true,
    });
    await expect(pageB.evaluate(() => localStorage.getItem("synthetic-auth"))).resolves.toBe(
      "session-a",
    );
    await expect(pageB.evaluate(() => localStorage.getItem("stale"))).resolves.toBeNull();
    await expect(
      pageB.evaluate(
        () =>
          new Promise((resolve) => {
            const request = indexedDB.open("synthetic-auth-db");
            request.onsuccess = () => {
              const get = request.result.transaction("tokens").objectStore("tokens").get("access");
              get.onsuccess = () => resolve(get.result);
            };
          }),
      ),
    ).resolves.toBe("token-a");
  });

  it("rejects unsupported and malformed state without exposing state", async () => {
    await expect(
      cmdImportStorageState({ handle: "missing", version: 2, storageState: {} }),
    ).rejects.toThrow("unsupported storage state version");
    await expect(cmdImportStorageState({ handle: "missing", storageState: {} })).rejects.toThrow(
      "storage state has unsupported format",
    );
  });
});
