import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { memorySnapshot } from "./cloud-memory.mjs";

const reportPath =
  process.env.HIREMEOPS_MEMORY_REPORT_PATH ?? "reports/cloud-memory-host-synthetic.json";
const profileDir = await mkdtemp(join(tmpdir(), "hiremeops-memory-profile-"));
const html = `<!doctype html><title>synthetic workload</title><main>${"<article><h2>fixture role</h2><p>Fixture company · São Paulo · remote</p></article>".repeat(20)}</main>`;
const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const worker = spawn(process.execPath, [join(import.meta.dirname, "worker.js")], {
  cwd: import.meta.dirname,
  env: {
    ...process.env,
    HIREMEOPS_CLOUD: "1",
    HIREMEOPS_DISABLE_CAPTURE: "1",
    HIREMEOPS_PERF: "1",
    HIREMEOPS_PERF_INTERVAL_MS: "250",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  },
  stdio: ["pipe", "pipe", "ignore"],
});

const pending = new Map();
let sequence = 0;
let stdoutBuffer = "";
worker.stdout.setEncoding("utf8");
worker.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() ?? "";
  for (const line of lines.filter(Boolean)) {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (!resolve) continue;
    pending.delete(message.id);
    if (message.ok === false) resolve.reject(new Error("synthetic worker command failed"));
    else resolve.resolve(message);
  }
});

function rpc(payload) {
  return new Promise((resolve, reject) => {
    const id = `memory-${sequence++}`;
    pending.set(id, { resolve, reject });
    worker.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
  });
}

const stages = [];
const record = (stage) => stages.push(memorySnapshot(stage));
let handle;
try {
  record("startup");
  ({ handle } = await rpc({
    cmd: "open",
    user_data_dir: profileDir,
    extensions: [],
    headless: true,
  }));
  record("browser-open");
  for (let run = 0; run < 3; run += 1) {
    await rpc({ cmd: "navigate", handle, url });
    await rpc({ cmd: "probe", handle });
    await rpc({ cmd: "export_storage_state", handle });
    record(`scraping-${run + 1}`);
  }
} finally {
  if (handle) await rpc({ cmd: "close", handle }).catch(() => {});
  worker.stdin.end();
  await new Promise((resolve) => worker.once("exit", resolve));
  record("shutdown");
  await rm(profileDir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ workload: "synthetic-local-browser", stages }, null, 2)}\n`,
  );
}

const peak = stages.reduce(
  (max, stage) => Math.max(max, stage.cgroupPeakMb ?? stage.nodePssMb + stage.chromiumPssMb),
  0,
);
process.stdout.write(`${JSON.stringify({ reportPath, peakMb: peak, stages: stages.length })}\n`);
