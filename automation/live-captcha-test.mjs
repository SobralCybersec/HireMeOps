// Live, headed proof of the real captcha path: launches system Chromium via patchright, opens a
// live Cloudflare Turnstile demo, and drives it through our ACTUAL captcha.js + ShyMouse (CDP click).
// LO watches the window and confirms pass/fail. Not a mock — this is the shipping code.
//
// Run:  HIREMEOPS_AUTO_CAPTCHA=1 node automation/live-captcha-test.mjs [url]
import { chromium } from "patchright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { passCaptchaOnPage } from "./captcha.js";

const URL = process.argv[2] || "https://seleniumbase.io/apps/turnstile";
const SUCCESS = "img#captcha-success"; // SeleniumBase demo's success marker
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "hmo-captcha-"));

const log = (...a) => console.log("[live]", ...a);

async function launch() {
  const base = {
    headless: false, // headed — the only mode that passes (benchmark: headless = 40%)
    viewport: null, // patchright happy path: no viewport override
    args: ["--start-maximized"],
  };
  // Prefer the real system Chromium 150 (>=142 closes the CDP coordinate leak). Fall back to bundled.
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...base,
      executablePath: "/usr/bin/chromium",
    });
  } catch (e) {
    log("system chromium launch failed, using bundled:", e.message);
    return await chromium.launchPersistentContext(profileDir, base);
  }
}

const ctx = await launch();
const page = ctx.pages()[0] || (await ctx.newPage());

try {
  log("auto-captcha env:", process.env.HIREMEOPS_AUTO_CAPTCHA || "(unset — set HIREMEOPS_AUTO_CAPTCHA=1)");
  log("navigating:", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3_000); // let the widget render (mirrors SeleniumBase sb.sleep(3))

  log("running passCaptchaOnPage() — watch the checkbox…");
  const t0 = Date.now();
  const result = await passCaptchaOnPage(page);
  log("passCaptchaOnPage →", JSON.stringify(result), `(${Date.now() - t0}ms)`);

  // Independent confirmation via the demo's own success marker.
  let confirmed = false;
  try {
    await page.waitForSelector(SUCCESS, { timeout: 12_000 });
    confirmed = true;
  } catch {}

  log("=================================================");
  log(confirmed ? "✅ SUCCESS marker present — Turnstile cleared" : "❌ no success marker (may need human / OS-mouse fallback)");
  log("result.solved =", result.solved, "| kind =", result.kind, "| clicked =", result.clicked);
  log("=================================================");
  log("holding window open 25s so you can watch/confirm…");
  await page.waitForTimeout(25_000);
} catch (e) {
  log("ERROR:", e.stack || e.message);
} finally {
  await ctx.close().catch(() => {});
  fs.rmSync(profileDir, { recursive: true, force: true });
  log("closed. profile cleaned.");
}
