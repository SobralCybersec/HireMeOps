import { chromium } from "patchright";
import { baseLaunchOptions } from "./browser-launch.js";
const jar = "/home/satu/.local/share/com.hiremeops.app/profiles/default/browser";
const REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const ctx = await chromium.launchPersistentContext(jar, baseLaunchOptions({ headless: true, executablePath: "/usr/bin/chromium", extraArgs: [`--user-agent=${REAL_UA}`] }));
const page = ctx.pages()[0] ?? await ctx.newPage();
const ua = await page.evaluate(() => navigator.userAgent);
console.log("UA now:", ua, "| hasHeadless:", /Headless/i.test(ua));
const chua = await page.evaluate(() => navigator.userAgentData ? JSON.stringify(navigator.userAgentData.brands) : "no uaData");
console.log("Sec-CH-UA brands:", chua);
const resp = await page.goto("https://www.catho.com.br/vagas/developer/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e => ({ err: e.message }));
console.log("catho status:", resp.err ? ("ERR "+resp.err) : resp.status());
if (!resp.err && resp.status() === 200) {
  const n = await page.locator("article.offer, li[data-offer-item]").count().catch(()=>-1);
  console.log("offer elements found:", n);
}
await ctx.close();
