import { chromium } from "patchright";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const OUT="/tmp/claude-1000/-home-satu-Docs-HireMeOps/825c1b30-9c3a-4880-9756-164ba5ca89cf/scratchpad";
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"nw-"));
let ctx; try{ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:965,height:1000},executablePath:"/usr/bin/chromium"});}
catch{ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:965,height:1000}});}
await ctx.addInitScript(()=>{try{localStorage.setItem("hiremeops-onboarded","1")}catch{}});
const page=ctx.pages()[0]||await ctx.newPage();
await page.goto("http://localhost:5199/profiles",{waitUntil:"networkidle",timeout:20000}).catch(()=>{});
await page.waitForTimeout(2500);
// check for horizontal overflow
const of=await page.evaluate(()=>({docW:document.documentElement.scrollWidth,winW:window.innerWidth,overflow:document.documentElement.scrollWidth>window.innerWidth+2}));
console.log("OVERFLOW CHECK:", JSON.stringify(of));
await page.screenshot({path:path.join(OUT,"ui-profiles-narrow.png")});
await ctx.close().catch(()=>{}); fs.rmSync(profile,{recursive:true,force:true});
console.log("saved ui-profiles-narrow.png");
