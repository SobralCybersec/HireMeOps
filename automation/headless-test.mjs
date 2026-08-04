// Headless smoke/diagnostic harness for EVERY job-search automation.
//
// Two phases, one report:
//   • module phase — the board scrapers exported as ES modules (programathor,
//     geekhunter, freelas99, upwork, catho, gupy, infojobs). The harness owns the
//     page and writes the proof bundle itself.
//   • RPC phase — the searches that live inside worker.js (linkedin, linkedin
//     posts, google-dork, indeed). Driven through the REAL worker over stdio
//     JSON-RPC — exactly how the Rust app runs them — so a "does it work headless"
//     answer reflects the true automation path (session open w/ headless flag →
//     dispatch → scrape → auto-capture). These are CAPTURE_CMDS, so the worker
//     writes the proof bundle and returns its paths in `reply.capture`.
//
// Every site drops the same evidence the live automations do — .html + .png
// (full-page) + .pdf + .json + .mhtml — under automation/captures/.
//
// Run:
//   node automation/headless-test.mjs                     # all sites, query "developer"
//   node automation/headless-test.mjs linkedin,google     # only these
//   node automation/headless-test.mjs all "react"         # custom query
//   HMO_PROFILE_DIR=<jar> node automation/headless-test.mjs   # logged-in jar (linkedin/catho/…)
//   HMO_HEADED=1 node automation/headless-test.mjs        # watch it (headed vs headless)
//
// Exit code = number of sites that ERRORED (crash/timeout). A login-gated site
// returning 0 without a jar is noted, not an error. NOTE: hits live sites —
// maxPages/page_index stay at 1/0; don't loop.

import { chromium } from "patchright";
import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { captureDom, attachDiagnostics, attachNetworkCapture, CAPTURE_DIR } from "./capture.js";
import { gupySearchJobs } from "./gupy.js";
import { infojobsSearchJobs } from "./infojobs-jobs.js";
import { cathoSearchJobs } from "./catho-jobs.js";
import { upworkSearchJobs } from "./upwork-jobs.js";
import { freelas99SearchJobs } from "./freelas99-jobs.js";
import { programathorSearchJobs } from "./programathor-jobs.js";
import { geekhunterSearchJobs } from "./geekhunter-jobs.js";

const WORKER = fileURLToPath(new URL("./worker.js", import.meta.url));

// Module-exported board scrapers — the harness drives the page directly.
const MODULE_SITES = [
  { name: "programathor", fn: programathorSearchJobs, login: false },
  { name: "geekhunter", fn: geekhunterSearchJobs, login: false },
  { name: "freelas99", fn: freelas99SearchJobs, login: false },
  { name: "upwork", fn: upworkSearchJobs, login: false },
  { name: "catho", fn: cathoSearchJobs, login: true },
  { name: "gupy", fn: gupySearchJobs, login: true },
  { name: "infojobs", fn: infojobsSearchJobs, login: true },
];

// Searches that live inside worker.js — driven through the real worker RPC.
// `params(query)` builds the command payload; `pick` names the array field in
// the reply (linkedin/indeed → jobs, google → results, posts → posts).
const RPC_SITES = [
  {
    name: "linkedin",
    cmd: "search_jobs",
    login: true,
    pick: "jobs",
    params: (q) => ({
      keywords: q,
      location: "",
      page_index: 0,
      filters: { easy_apply_only: false },
    }),
  },
  {
    name: "linkedin_posts",
    cmd: "search_linkedin_posts",
    login: true,
    pick: "posts",
    params: (q) => ({ keywords: q, page_index: 0 }),
  },
  {
    name: "google_dork",
    cmd: "search_google",
    login: false,
    pick: "results",
    params: (q) => ({ query: `site:linkedin.com/jobs ${q}`, page_index: 0 }),
  },
  {
    name: "indeed",
    cmd: "search_indeed_jobs",
    login: false,
    pick: "jobs",
    params: (q) => ({ keywords: q, location: "Brasil", page_index: 0, remote_only: false }),
  },
];

const argv = process.argv.slice(2);
const pick = argv[0] && argv[0] !== "all" ? new Set(argv[0].split(",")) : null;
const query = argv[1] || "developer";
const headed = process.env.HMO_HEADED === "1";
const PER_SITE_TIMEOUT_MS = 70_000;

const moduleSites = MODULE_SITES.filter((s) => !pick || pick.has(s.name));
const rpcSites = RPC_SITES.filter((s) => !pick || pick.has(s.name));
const log = (...a) => console.log("[headless-test]", ...a);

const usingRealJar = !!process.env.HMO_PROFILE_DIR;
const profileDir = usingRealJar
  ? process.env.HMO_PROFILE_DIR
  : fs.mkdtempSync(path.join(os.tmpdir(), "hmo-headless-"));

log(
  `mode=${headed ? "HEADED" : "headless"} query=${JSON.stringify(query)} jar=${usingRealJar ? "real" : "temp"}`,
);
log(`module: ${moduleSites.map((s) => s.name).join(", ") || "(none)"}`);
log(`rpc:    ${rpcSites.map((s) => s.name).join(", ") || "(none)"}`);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const results = [];

// ── module phase ──────────────────────────────────────────────────────────
async function runModulePhase() {
  if (!moduleSites.length) return;
  const opts = { headless: !headed, viewport: null };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      ...opts,
      executablePath: "/usr/bin/chromium",
    });
  } catch {
    ctx = await chromium.launchPersistentContext(profileDir, opts);
  }
  attachNetworkCapture(ctx);
  try {
    for (const site of moduleSites) {
      const page = await ctx.newPage();
      attachDiagnostics(page);
      const t0 = Date.now();
      const rec = {
        name: site.name,
        ms: 0,
        count: 0,
        sample: null,
        error: null,
        login: site.login,
      };
      try {
        const out = await withTimeout(
          site.fn(page, { query, maxPages: 1 }),
          PER_SITE_TIMEOUT_MS,
          site.name,
        );
        const jobs = Array.isArray(out?.jobs) ? out.jobs : [];
        rec.count = jobs.length;
        rec.sample = jobs.find((j) => j.title)?.title ?? null;
      } catch (e) {
        rec.error = e?.message || String(e);
      } finally {
        rec.ms = Date.now() - t0;
        const cap = await captureDom(page, `headless-${site.name}`, {
          headless: !headed,
          query,
          jobCount: rec.count,
          error: rec.error,
        });
        rec.proof = cap && !cap.error ? { html: cap.html, png: cap.png, pdf: cap.pdf } : null;
        results.push(rec);
        await page.close().catch(() => {});
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── RPC phase (real worker.js over stdio) ───────────────────────────────────
function makeWorker() {
  const proc = spawn(process.execPath, [WORKER], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const pending = new Map();
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON worker log line
    }
    const p = msg.id != null && pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
    }
  });
  let seq = 0;
  const send = (obj, ms) =>
    new Promise((resolve, reject) => {
      const id = `h${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${obj.cmd} exceeded ${ms}ms`));
      }, ms);
      pending.set(id, { resolve, timer });
      proc.stdin.write(`${JSON.stringify({ id, ...obj })}\n`);
    });
  return { proc, send };
}

async function runRpcPhase() {
  if (!rpcSites.length) return;
  const { proc, send } = makeWorker();
  try {
    for (const site of rpcSites) {
      const t0 = Date.now();
      const rec = {
        name: site.name,
        ms: 0,
        count: 0,
        sample: null,
        error: null,
        login: site.login,
      };
      let handle = null;
      try {
        const open = await send(
          { cmd: "open", user_data_dir: profileDir, extensions: [], headless: !headed },
          30_000,
        );
        if (!open.ok || !open.handle) throw new Error(open.error || "open failed (no handle)");
        handle = open.handle;
        const reply = await send(
          { cmd: site.cmd, handle, ...site.params(query) },
          PER_SITE_TIMEOUT_MS,
        );
        if (!reply.ok) throw new Error(reply.error || `${site.cmd} failed`);
        const arr = Array.isArray(reply[site.pick]) ? reply[site.pick] : [];
        rec.count = arr.length;
        rec.sample = arr.find((j) => j.title)?.title ?? arr[0]?.title ?? null;
        // The worker auto-captures CAPTURE_CMDS and returns the paths inline.
        const cap = reply.capture;
        rec.proof = cap && !cap.error ? { html: cap.html, png: cap.png, pdf: cap.pdf } : null;
      } catch (e) {
        rec.error = e?.message || String(e);
        // A thrown search still leaves evidence: the worker's dispatch writes a
        // `<cmd>_throw` bundle on error. Point at it so the proof isn't "missing".
        rec.throwProof = `${CAPTURE_DIR}/*-${site.cmd}_throw.{html,png,pdf}`;
      } finally {
        rec.ms = Date.now() - t0;
        if (handle) await send({ cmd: "close", handle }, 15_000).catch(() => {});
        results.push(rec);
      }
    }
  } finally {
    await send({ cmd: "shutdown" }, 5_000).catch(() => {});
    proc.stdin.end();
    setTimeout(() => proc.kill("SIGKILL"), 3_000).unref?.();
  }
}

try {
  await runModulePhase();
  await runRpcPhase();
} finally {
  if (!usingRealJar) fs.rmSync(profileDir, { recursive: true, force: true });
}

// ── report ──────────────────────────────────────────────────────────────────
console.log("\n  site            jobs   ms     status");
console.log("  ──────────────────────────────────────────────────────────────");
let errored = 0;
for (const r of results) {
  let status;
  if (r.error) {
    status = `❌ ${r.error}`;
    errored++;
  } else if (r.count > 0) {
    status = `✅ e.g. "${String(r.sample).slice(0, 40)}"`;
  } else if (r.login && !usingRealJar) {
    status = "⚠ 0 (login-gated — pass HMO_PROFILE_DIR)";
  } else {
    status = "⚠ 0 jobs (selector drift / blocked / genuinely empty?)";
  }
  const proof = r.proof ? " · proof✓" : r.throwProof ? " · proof✓ (_throw)" : " · proof✗";
  console.log(
    `  ${r.name.padEnd(14)} ${String(r.count).padStart(4)}  ${String(r.ms).padStart(5)}  ${status}${proof}`,
  );
}
console.log("");
log(
  `${results.length} sites · ${errored} errored · ${results.filter((r) => !r.error && r.count > 0).length} returned jobs`,
);
log(`proof bundles (.html/.png/.pdf/.json/.mhtml) per site → ${CAPTURE_DIR}`);
process.exit(errored);
