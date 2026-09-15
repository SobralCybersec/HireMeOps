import { chromium } from "patchright";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const profile = fs.mkdtempSync(path.join(os.tmpdir(),"fa-"));
let ctx; try { ctx = await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1440,height:900},executablePath:"/usr/bin/chromium"}); }
catch { ctx = await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1440,height:900}}); }
await ctx.addInitScript(()=>{try{localStorage.setItem("hiremeops-onboarded","1")}catch{}});
const page = ctx.pages()[0]||await ctx.newPage();
await page.goto("http://localhost:5199/",{waitUntil:"networkidle",timeout:20000}).catch(()=>{});
await page.waitForTimeout(2500);
const loaded = await page.evaluate(()=>({
  Orbitron: document.fonts.check('700 24px "Orbitron"'),
  Rajdhani: document.fonts.check('500 16px "Rajdhani"'),
  RobotoCondensed: document.fonts.check('700 16px "Roboto Condensed"'),
  Inter: document.fonts.check('400 14px "Inter"'),
  JetBrainsMono: document.fonts.check('400 14px "JetBrains Mono"'),
}));
console.log("FONTS LOADED:", JSON.stringify(loaded));
await ctx.close().catch(()=>{}); fs.rmSync(profile,{recursive:true,force:true});
