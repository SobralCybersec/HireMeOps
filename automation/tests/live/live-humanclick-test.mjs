// Live proof that humanClick travels via ShyMouse and activates a real (non-navigating) element —
// the realistic apply-flow case (modal buttons/fields stay on-page). Uses a self-contained page so
// there's no navigation fragility. Confirms: click registers + cursor actually moved.
// Run:  node automation/live-humanclick-test.mjs
import { chromium } from "patchright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { humanClick, humanType } from "./human.js";

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmo-hc-"));
const log = (...a) => console.log("[hc]", ...a);

const PAGE = `<!doctype html><meta charset=utf8><body style="margin:60px;font:20px system-ui">
<button id="btn" style="padding:14px 22px" onclick="this.dataset.hit=(+(this.dataset.hit||0)+1);this.textContent='clicked '+this.dataset.hit">Click me</button>
<input id="field" style="display:block;margin-top:400px;padding:10px;width:320px" placeholder="type here">
</body>`;

let ctx;
try {
  ctx = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, executablePath: "/usr/bin/chromium" });
} catch {
  ctx = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null });
}
const page = ctx.pages()[0] || (await ctx.newPage());

try {
  await page.setContent(PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  log("humanClick → #btn (watch the cursor travel + click)…");
  await humanClick(page, page.locator("#btn"));
  await page.waitForTimeout(400);
  const hit = await page.locator("#btn").getAttribute("data-hit");
  log("button data-hit =", hit, hit === "1" ? "✅ click registered" : "❌ click did not register");

  log("humanType → #field (travel, focus, type)…");
  const sentence = "The quick brown fox jumps over the lazy dog";
  const t0 = Date.now();
  await humanType(page, page.locator("#field"), sentence);
  const elapsedMs = Date.now() - t0;
  await page.waitForTimeout(200);
  const val = await page.locator("#field").inputValue();
  const words = sentence.length / 5;
  const wpm = Math.round((words / (elapsedMs / 60000)));
  log("field value =", JSON.stringify(val), val === sentence ? "✅ typed" : "❌ mismatch");
  log(`typing pace ≈ ${wpm} WPM (${sentence.length} chars in ${elapsedMs}ms) — target ~100`);

  const stats = page.__shyMouse?.getMovementStats?.() || null;
  log("ShyMouse moved:", stats ? `${stats.totalMoves} tracked moves, fatigueMult=${stats.fatigueMultiplier?.toFixed?.(3)}` : "(no stats)");
  log(stats && stats.totalMoves > 0 ? "✅ ShyMouse drove the cursor" : "❌ ShyMouse did not move");
  await page.waitForTimeout(3_000);
} catch (e) {
  log("ERROR:", e.stack || e.message);
} finally {
  await ctx.close().catch(() => {});
  fs.rmSync(profileDir, { recursive: true, force: true });
  log("closed.");
}
