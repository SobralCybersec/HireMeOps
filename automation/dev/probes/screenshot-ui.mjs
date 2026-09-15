// Dev-only: screenshot the running frontend (localhost:1420) to verify the design.
import { chromium } from "patchright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const OUT = "/tmp/claude-1000/-home-satu-Docs-HireMeOps/825c1b30-9c3a-4880-9756-164ba5ca89cf/scratchpad";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hmo-shot-"));
const log = (...a) => console.log("[shot]", ...a);

let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    executablePath: "/usr/bin/chromium",
  });
} catch {
  ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 900 } });
}
await ctx.addInitScript(() => { try { localStorage.setItem("hiremeops-onboarded","1"); } catch {} });
const page = ctx.pages()[0] || (await ctx.newPage());

async function shot(url, file) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
  } catch (e) {
    log("goto warn:", e.message);
  }
  await page.waitForTimeout(2500);
  const out = path.join(OUT, file);
  await page.screenshot({ path: out });
  log("saved", out);
}

try {
  await shot("http://localhost:5199/", "ui-command-center.png");
  await shot("http://localhost:5199/job-search", "ui-jobsearch.png");
} catch (e) {
  log("ERROR", e.message);
} finally {
  await ctx.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  log("done");
}
