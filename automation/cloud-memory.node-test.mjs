import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { closeCloudBrowser, openCloudBrowser } from "./cloud/cloud-browser.mjs";
import { memorySnapshot } from "./cloud-memory.mjs";

const reportPath =
  process.env.HIREMEOPS_MEMORY_REPORT_PATH ?? "reports/cloud-memory-host-synthetic.json";
const html = `<!doctype html><title>synthetic workload</title><main>${"<article><h2>fixture role</h2><p>Fixture company · São Paulo · remote</p></article>".repeat(
  20,
)}</main>`;
const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/fixture`;
const stages = [];
const record = (stage) => stages.push(memorySnapshot(stage));
let runtime;
try {
  record("startup");
  runtime = await openCloudBrowser({ cookies: [], origins: [] });
  record("browser-open");
  for (let run = 0; run < 3; run += 1) {
    await runtime.page.goto(url, { waitUntil: "commit" });
    await runtime.page.locator("article").first().waitFor({ state: "visible" });
    if (run === 0) {
      record("operation-start");
      record("post-navigation");
    }
  }
  record("scraping-peak");
  await runtime.context.storageState({ indexedDB: true });
  record("state-exported");
} finally {
  record("pre-close");
  await closeCloudBrowser(runtime);
  record("shutdown");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ workload: "synthetic-cloud-browser", stages }, null, 2)}\n`,
  );
  await new Promise((resolve) => server.close(resolve));
}

const peak = stages.reduce(
  (max, stage) => Math.max(max, stage.cgroupPeakMb ?? stage.nodePssMb + stage.chromiumPssMb),
  0,
);
process.stdout.write(`${JSON.stringify({ reportPath, peakMb: peak, stages: stages.length })}\n`);
