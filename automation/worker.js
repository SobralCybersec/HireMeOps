// Patchright automation worker: a long-lived Node process that receives newline-delimited JSON commands on stdin (one Chromium session per `handle`) and drives job-board automation — LinkedIn Easy Apply, Indeed SmartApply, Gupy/Catho/InfoJobs resume push, job search scraping, and Gmail send — replying one JSON line per command on stdout.
// Key: dispatch/route — command dispatch table; dispatch wraps route() with capture-on-failure diagnostics for CAPTURE_CMDS
// Key: cmdOpen — launches a persistent Chromium context per session, keyed by handle, stored in `sessions`
// Key: cmdFillEasyApply/cmdAnswerEasyApply/cmdConfirmSubmit/cmdRejectSubmit — LinkedIn Easy Apply flow; fills the form and PARKS at Submit, never auto-submits until cmdConfirmSubmit
// Key: reapDir/recycleSweep — zombie Chromium cleanup: reapDir SIGKILLs stragglers still holding a profile dir before relaunch, recycleSweep periodically drops sessions with no live Chromium
// Key: human.js (humanClick/humanType/thinkTime) — human-like input timing/movement wired into form-filling to defeat bot-detection heuristics
// Key: cmdSearchJobs and the *SearchJobs/*Apply imports (gupy/infojobs/catho/upwork/freelas99) — per-site job search and apply routines invoked through the same dispatch table

import { chromium } from "patchright";
import readline from "readline";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parseDates } from "./linkedin-helpers.js";
import { cathoPushProfile } from "./catho.js";
import { gupyPushProfile, gupySearchJobs, gupyStartLogin } from "./gupy.js";
import { infojobsPushProfile } from "./infojobs.js";
import { infojobsSearchJobs, infojobsApply } from "./infojobs-jobs.js";
import { cathoSearchJobs, cathoApply } from "./catho-jobs.js";
import { upworkSearchJobs } from "./upwork-jobs.js";
import { freelas99SearchJobs } from "./freelas99-jobs.js";
import { initPerf, perfEnabled, nowMs, logSpan, descendantPids } from "./perf.js";
import { classifyIndeedQuestion } from "./indeed-helpers.js";
import { attachDiagnostics, attachNetworkCapture, captureDom, captureResult } from "./capture.js";
import { passCaptchaOnPage, captchaSolvingEnabled } from "./captcha.js";
import { humanClick, humanType, thinkTime } from "./human.js";

const HUMAN_TYPE_MAX = 120;

initPerf();

const sessions = new Map();

const indeedPopups = new Map();

const RECYCLE_EVERY = Number(process.env.HIREMEOPS_RECYCLE_EVERY ?? 25) || 0;
let openCount = 0;

function procComm(pid) {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

function userDataDirOf(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    const m = /--user-data-dir=(\S+)/.exec(raw);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const isChromiumComm = (pid) => /chrom|headless_shell/i.test(procComm(pid));

function reapDir(userDataDir) {
  if (!userDataDir) return 0;
  let killed = 0;
  for (const pid of descendantPids(process.pid)) {
    if (!isChromiumComm(pid)) continue;
    if (userDataDirOf(pid) !== userDataDir) continue;
    for (const d of descendantPids(pid)) {
      try {
        process.kill(d, "SIGKILL");
        killed++;
      } catch {
      }
    }
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {
    }
  }
  return killed;
}

async function recycleSweep() {
  const liveDirs = new Set();
  for (const pid of descendantPids(process.pid)) {
    if (!isChromiumComm(pid)) continue;
    const d = userDataDirOf(pid);
    if (d) liveDirs.add(d);
  }
  let staleSessions = 0;
  for (const [h, s] of [...sessions.entries()]) {
    if (s.user_data_dir && !liveDirs.has(s.user_data_dir)) {
      sessions.delete(h);
      indeedPopups.delete(h);
      staleSessions++;
      for (const n of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        await fs.rm(path.join(s.user_data_dir, n), { force: true }).catch(() => {});
      }
    }
  }
  logSpan("recycle", {
    opens: openCount,
    staleSessions,
    liveBrowsers: liveDirs.size,
    sessions: sessions.size,
  });
  if (staleSessions) {
    process.stderr.write(`[worker] recycle: dropped ${staleSessions} dead session(s)\n`);
  }
}

const APPLY_BTN_SEL =
  'button[aria-label="Candidatar-se com o Indeed"], ' +
  'button[aria-label*="Candidatar-se com o Indeed" i], ' +
  'button[aria-label*="Apply with Indeed" i], ' +
  'button[aria-label*="Apply now" i], ' +
  '#indeedApplyButton, [data-testid="indeedApplyButton-test"]';
const INDEED_SUBMIT_SEL =
  'button[name="submit-application"], button[data-testid="submit-application-button"], ' +
  'button:has-text("Enviar candidatura"), button:has-text("Submit application")';
const INDEED_CONTINUE_SEL =
  'button:has-text("Continuar"), button:has-text("Continue"), ' +
  'button[data-testid*="continue" i], button[data-testid*="next" i]';

async function clickIndeedContinue(form) {
  const canonical = form.locator('button[data-testid="continue-button"]').first();
  if (await canonical.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await thinkTime();
    await humanClick(form, canonical).catch(() => {});
    return true;
  }
  const fallback = form.locator(INDEED_CONTINUE_SEL).first();
  if (await fallback.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await thinkTime();
    await humanClick(form, fallback).catch(() => {});
    return true;
  }
  return false;
}

const LI_EASY_APPLY_SEL = [
  'button[aria-label*="Easy Apply" i]',
  'button[aria-label*="Candidatura simplificada" i]',
  ".jobs-apply-button--top-card button",
  ".jobs-s-apply button",
].join(",");
const LI_SUBMIT_SEL = [
  'button[aria-label*="Submit application" i]',
  'button[aria-label*="Enviar candidatura" i]',
  'button:has-text("Enviar candidatura")',
  'button:has-text("Submit application")',
  'button:has-text("Enviar solicitud")',
].join(",");
const LI_NEXT_SEL = [
  'button[aria-label*="Continue to next step" i]',
  'button[aria-label*="Avançar para a próxima etapa" i]',
  'button[aria-label*="Review your application" i]',
  'button[aria-label*="Revisar sua candidatura" i]',
  'button:has-text("Avançar")',
  'button:has-text("Próxima")',
  'button:has-text("Next")',
  'button:has-text("Continue")',
  'button:has-text("Continuar")',
  'button:has-text("Siguiente")',
  'button:has-text("Avaliar")',
  'button:has-text("Revisar")',
  'button:has-text("Review")',
].join(",");
const LI_MODAL_SEL =
  'dialog[data-testid="dialog"], [data-test-modal-id="easy-apply-modal"], ' +
  '.jobs-easy-apply-content, div[role="dialog"]';

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (raw) => {
  const line = raw.trim();
  if (!line) return;

  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch (e) {
    process.stderr.write(`[worker] parse error: ${e.message}\n`);
    return;
  }

  const { id } = cmd;
  const t0 = perfEnabled() ? nowMs() : 0;
  try {
    const data = await dispatch(cmd);
    if (perfEnabled()) {
      logSpan("cmd", { cmd: cmd.cmd, ms: +(nowMs() - t0).toFixed(1), rssMb: rssMb() });
    }
    writeLine({ id, ok: true, ...data });
  } catch (err) {
    if (perfEnabled()) {
      logSpan("cmd", { cmd: cmd.cmd, ms: +(nowMs() - t0).toFixed(1), error: true });
    }
    writeLine({ id, ok: false, error: err?.message ?? String(err) });
  }
});

function rssMb() {
  return +(process.memoryUsage.rss() / 1_048_576).toFixed(1);
}

rl.on("close", async () => {
  await closeAll();
  process.exit(0);
});

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const CAPTURE_CMDS = new Set([
  "fill_easy_apply", "answer_easy_apply", "confirm_submit", "reject_submit", "extract_hr",
  "search_jobs", "search_linkedin_posts", "search_google", "push_profile",
  "catho_push_profile", "gupy_push_profile", "infojobs_push_profile",
  "search_gupy_jobs", "gupy_start_login", "catho_search_jobs", "catho_apply",
  "infojobs_search_jobs", "infojobs_apply",
  "upwork_search_jobs", "freelas99_search_jobs",
  "auto_connect", "search_indeed_jobs", "fill_indeed_apply",
  "answer_indeed_free_text", "confirm_indeed_submit", "reject_indeed_submit",
]);

async function dispatch(cmd) {
  if (!CAPTURE_CMDS.has(cmd.cmd) || cmd.handle == null) return route(cmd);
  let page = null;
  try {
    page = await activePage(cmd.handle);
    attachDiagnostics(page);
  } catch {
  }
  try {
    const result = await route(cmd);
    return page ? await captureResult(page, cmd.cmd, result) : result;
  } catch (e) {
    if (page) await captureDom(page, `${cmd.cmd}_throw`, { error: String(e?.message ?? e) }).catch(() => {});
    throw e;
  }
}

async function route(cmd) {
  switch (cmd.cmd) {
    case "open":
      return cmdOpen(cmd);
    case "navigate":
      return cmdNavigate(cmd);
    case "probe":
      return cmdProbe(cmd);
    case "fill_easy_apply":
      return cmdFillEasyApply(cmd);
    case "answer_easy_apply":
      return cmdAnswerEasyApply(cmd);
    case "confirm_submit":
      return cmdConfirmSubmit(cmd);
    case "reject_submit":
      return cmdRejectSubmit(cmd);
    case "screenshot":
      return cmdScreenshot(cmd);
    case "dom_snapshot":
      return cmdDomSnapshot(cmd);
    case "capture":
      return cmdCapture(cmd);
    case "close":
      return cmdClose(cmd);
    case "shutdown":
      return cmdShutdown();
    case "extract_hr":
      return cmdExtractHr(cmd);
    case "search_jobs":
      return cmdSearchJobs(cmd);
    case "search_linkedin_posts":
      return cmdSearchLinkedInPosts(cmd);
    case "search_google":
      return cmdSearchGoogle(cmd);
    case "push_profile":
      return cmdPushProfile(cmd);
    case "catho_push_profile":
      return cmdCathoPushProfile(cmd);
    case "gupy_push_profile":
      return cmdGupyPushProfile(cmd);
    case "search_gupy_jobs":
      return cmdSearchGupyJobs(cmd);
    case "gupy_start_login":
      return cmdGupyStartLogin(cmd);
    case "infojobs_push_profile":
      return cmdInfojobsPushProfile(cmd);
    case "catho_search_jobs":
      return cmdCathoSearchJobs(cmd);
    case "catho_apply":
      return cmdCathoApply(cmd);
    case "infojobs_search_jobs":
      return cmdInfojobsSearchJobs(cmd);
    case "infojobs_apply":
      return cmdInfojobsApply(cmd);
    case "upwork_search_jobs":
      return cmdUpworkSearchJobs(cmd);
    case "freelas99_search_jobs":
      return cmdFreelas99SearchJobs(cmd);
    case "auto_connect":
      return cmdAutoConnect(cmd);
    case "search_indeed_jobs":
      return cmdSearchIndeedJobs(cmd);
    case "fill_indeed_apply":
      return cmdFillIndeedApply(cmd);
    case "answer_indeed_free_text":
      return cmdAnswerIndeedFreeText(cmd);
    case "confirm_indeed_submit":
      return cmdConfirmIndeedSubmit(cmd);
    case "reject_indeed_submit":
      return cmdRejectIndeedSubmit(cmd);
    case "check_login":
      return cmdCheckLogin(cmd);
    case "open_login_tabs":
      return cmdOpenLoginTabs(cmd);
    case "check_logins":
      return cmdCheckLogins(cmd);
    case "solve_captcha":
      return cmdSolveCaptcha(cmd);
    case "start_screencast":
      return cmdStartScreencast(cmd);
    case "stop_screencast":
      return cmdStopScreencast(cmd);
    case "gmail_send":
      return cmdGmailSend(cmd);
    default:
      throw new Error(`Unknown command: ${cmd.cmd}`);
  }
}

function resolveChromiumExec() {
  const FALLBACK_PATHS = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/brave-browser",
  ];
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    FALLBACK_PATHS.find((p) => existsSync(p)) ||
    undefined
  );
}

async function reclaimProfileDir(userDataDir) {
  if (!userDataDir) return;
  for (const [h, s] of [...sessions.entries()]) {
    if (s.user_data_dir !== userDataDir) continue;
    sessions.delete(h);
    const popup = indeedPopups.get(h);
    if (popup) {
      indeedPopups.delete(h);
      await popup.close().catch(() => {});
    }
    await s.browser.close().catch(() => {});
  }
  const reaped = reapDir(userDataDir);
  if (reaped) {
    process.stderr.write(
      `[worker] reclaim: killed ${reaped} lingering Chromium proc(s) on ${userDataDir}\n`,
    );
  }
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(userDataDir, name), { force: true }).catch(() => {});
  }
}

let xvfbDisplay = null;

async function ensureHiddenDisplay() {
  if (xvfbDisplay) return xvfbDisplay;
  const display = process.env.HIREMEOPS_XVFB_DISPLAY || ":99";
  const sock = `/tmp/.X11-unix/X${display.replace(":", "")}`;
  if (existsSync(sock)) {
    xvfbDisplay = display;
    return display;
  }
  await new Promise((resolve, reject) => {
    const proc = spawn(
      "Xvfb",
      [display, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
      { stdio: "ignore", detached: true },
    );
    proc.on("error", (e) =>
      reject(
        new Error(
          `Xvfb launch failed (install it: 'pacman -S xorg-server-xvfb'): ${e.message}`,
        ),
      ),
    );
    const startedAt = Date.now();
    const poll = () => {
      if (existsSync(sock)) {
        proc.unref();
        xvfbDisplay = display;
        resolve();
      } else if (Date.now() - startedAt > 5000) {
        reject(new Error("Xvfb did not come up within 5s"));
      } else {
        setTimeout(poll, 100);
      }
    };
    proc.on("spawn", poll);
  });
  return xvfbDisplay;
}

async function cmdOpen({ user_data_dir = "", extensions = [], headless = true, hidden = false }) {
  const handle = randomUUID();

  await reclaimProfileDir(user_data_dir);

  const args = [
    "--no-sandbox",
    "--disable-features=DevToolsDebuggingRestrictions,CalculateNativeWinOcclusion",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--class=HireMeOpsBot",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--mute-audio",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-client-side-phishing-detection",
  ];

  let launchEnv;
  let runHeadless = headless;
  if (hidden) {
    runHeadless = false;
    args.push(
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--enable-unsafe-webgl",
      "--ignore-gpu-blocklist",
      "--enable-gpu",
    );
    try {
      launchEnv = { ...process.env, DISPLAY: await ensureHiddenDisplay() };
    } catch (e) {
      process.stderr.write(`worker: ${e.message} — opening a VISIBLE window instead\n`);
      launchEnv = undefined;
    }
  }

  const validExtensions = extensions.filter((p) => {
    if (existsSync(path.join(p, "manifest.json"))) return true;
    process.stderr.write(`worker: skipping invalid extension path (no manifest.json): ${p}\n`);
    return false;
  });
  if (validExtensions.length > 0) {
    const extPaths = validExtensions.join(",");
    args.push(`--disable-extensions-except=${extPaths}`);
    args.push(`--load-extension=${extPaths}`);
  }

  const resolvedExec = resolveChromiumExec();

  const browser = await chromium.launchPersistentContext(user_data_dir, {
    headless: runHeadless,
    ...(launchEnv ? { env: launchEnv } : {}),
    channel: resolvedExec ? undefined : "chrome",
    viewport: null,
    args,
    ignoreDefaultArgs: ["--enable-automation"],
    executablePath: resolvedExec,
  });

  const page = browser.pages()[0] ?? (await browser.newPage());

  if (hidden && launchEnv) {
    try {
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
      });
      const software = /swiftshader|llvmpipe|software/i.test(renderer);
      process.stderr.write(
        `worker: hidden GPU renderer = ${renderer}` +
          (software ? " [SOFTWARE — Akamai may block; GPU didn't attach under Xvfb]\n" : " [hardware ok]\n"),
      );
    } catch {
    }
  }

  attachDiagnostics(page);
  browser.on("page", attachDiagnostics);
  attachNetworkCapture(browser);

  sessions.set(handle, { browser, page, user_data_dir });

  openCount += 1;
  if (RECYCLE_EVERY > 0 && openCount % RECYCLE_EVERY === 0) {
    recycleSweep().catch(() => {});
  }
  return { handle };
}

async function cmdNavigate({ handle, url }) {
  const { page } = session(handle);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return {};
}

async function cmdProbe({ handle }) {
  const { page } = session(handle);

  const classification = await page.evaluate(() => {
    const captchaEl = document.querySelector(
      [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="arkoselabs"]',
        'iframe[src*="funcaptcha"]',
        'iframe[src*="datadome"]',
        'iframe[title*="challenge" i]',
        "div.g-recaptcha",
        "#cf-chl-widget",
        "#challenge-form",
        "#px-captcha",
      ].join(","),
    );
    const captchaRect = captchaEl && captchaEl.getBoundingClientRect();
    const hasCaptcha = !!captchaRect && captchaRect.width > 0 && captchaRect.height > 0;
    if (hasCaptcha) return "captcha";

    const hasDailyLimit = !![
      ...document.querySelectorAll(".artdeco-inline-feedback__message"),
    ].some((el) =>
      (el.textContent ?? "").toLowerCase().includes("exceeded the daily application limit"),
    );
    if (hasDailyLimit) return "daily_limit";

    const hasApply = !!document.querySelector(
      [
        'button[aria-label*="Easy Apply" i]',
        'button[aria-label*="Candidatura simplificada" i]',
        ".jobs-apply-button--top-card button",
        ".jobs-s-apply button",
        ".jobs-easy-apply-content",
        '[data-test-modal-id="easy-apply-modal"]',
      ].join(","),
    );
    if (hasApply) return "apply";

    return "none";
  });

  if (classification === "captcha" && captchaSolvingEnabled()) {
    const res = await passCaptchaOnPage(page).catch((e) => ({ solved: false, reason: String(e) }));
    process.stderr.write(`worker: captcha auto-pass → ${JSON.stringify(res)}\n`);
    if (res.solved) return { state: "NoAction" };
  }

  const map = {
    captcha: "CaptchaWall",
    apply: "ApplyForm",
    daily_limit: "DailyLimitReached",
    none: "NoAction",
  };
  return { state: map[classification] ?? "NoAction" };
}

async function cmdSolveCaptcha({ handle }) {
  const { page } = session(handle);
  return passCaptchaOnPage(page);
}

async function cmdFillEasyApply({ handle, answers = [], cover_letter, cv_path }) {
  const { page } = session(handle);

  try {
    const btn = page.locator(LI_EASY_APPLY_SEL).filter({ visible: true }).first();
    const isVisible = await btn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (isVisible) {
      await humanClick(page, btn);
      await page.waitForSelector(
        '.jobs-easy-apply-content, [data-test-modal-id="easy-apply-modal"]',
        { timeout: 10_000 },
      );
    }
  } catch {
  }

  const unansweredByLabel = new Map();
  const MAX_STEPS = 15;
  let resumeDone = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!resumeDone) resumeDone = await handleResumeStep(page, cv_path);
    const stepUnanswered = (await fillStep(page, answers, cover_letter)) || [];
    for (const q of stepUnanswered) {
      if (q.label && !unansweredByLabel.has(q.label)) unansweredByLabel.set(q.label, q);
    }

    const modal = page.locator(LI_MODAL_SEL).last();
    const root = (await modal.count().catch(() => 0)) > 0 ? modal : page;

    const nextBtn = root.locator(LI_NEXT_SEL).first();
    const hasNext = await nextBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    if (!hasNext) break;

    await thinkTime();
    await humanClick(page, nextBtn);
    await page.waitForTimeout(600);

    const hasError = await page
      .locator(
        [
          ".artdeco-inline-feedback--error",
          "[data-test-form-element-error-messages]",
          ".fb-dash-form-element__error-field",
          ".fb-dash-form-element__error-text",
        ].join(","),
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasError) break;
  }

  return { unanswered: [...unansweredByLabel.values()] };
}

async function cmdAnswerEasyApply({ handle, questions = {} }) {
  const { page } = session(handle);
  const answers = Object.entries(questions).map(([label, value]) => ({ label, value: String(value) }));
  if (answers.length === 0) return { unanswered: [], parked: true };

  let leftover = [];
  const MAX_STEPS = 15;
  for (let step = 0; step < MAX_STEPS; step++) {
    leftover = (await fillStep(page, answers, undefined)) || [];

    const modal = page.locator(LI_MODAL_SEL).last();
    const root = (await modal.count().catch(() => 0)) > 0 ? modal : page;
    const isSubmit = await root
      .locator(LI_SUBMIT_SEL)
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (isSubmit) break;

    const nextBtn = root.locator(LI_NEXT_SEL).first();
    const hasNext = await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasNext) break;
    await thinkTime();
    await humanClick(page, nextBtn);
    await page.waitForTimeout(900);

    const hasError = await page
      .locator(
        [
          ".artdeco-inline-feedback--error",
          "[data-test-form-element-error-messages]",
          ".fb-dash-form-element__error-field",
          ".fb-dash-form-element__error-text",
        ].join(","),
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasError) break;
  }

  return { unanswered: leftover, parked: true };
}

async function cmdConfirmSubmit({ handle }) {
  const { page } = session(handle);
  const btn = page.locator(LI_SUBMIT_SEL).first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await thinkTime();
  await humanClick(page, btn, { timeout: 5_000 }).catch(async () => {
    await btn.click({ force: true }).catch(() => {});
  });

  // POSITIVE success signal: LinkedIn shows a post-apply modal ("Candidatura
  // enviada" / "Application sent", signal-success icon, "Concluído" button) when
  // the application actually goes through. Wait for it FIRST — the old code only
  // used the negative "is submit still visible?" heuristic, which false-flagged a
  // real success as a bounce because the review page's submit button lingered in
  // the DOM behind the success modal → the app showed an error on a sent apply.
  const successSel = [
    '[aria-labelledby="post-apply-modal"]',
    '[data-test-modal] [data-test-icon="signal-success"]',
    '[data-test-modal] h2:has-text("enviada")',
    '[data-test-modal] h2:has-text("sent")',
    '[data-test-modal] h3:has-text("enviada")',
    '[data-test-modal] h3:has-text("sent")',
  ].join(",");
  const submitted = await page
    .locator(successSel)
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  // Dismiss the dialog (success "Concluído"/"Done" or any leftover) so the modal
  // closes instead of sitting there.
  await page
    .locator(
      [
        'button:has-text("Concluído")',
        'button:has-text("Concluir")',
        'button:has-text("Done")',
        'button[aria-label*="Dismiss" i]',
        'button[aria-label*="Fechar" i]',
        "button[data-test-modal-close-btn]",
      ].join(","),
    )
    .first()
    .click({ timeout: 2_000 })
    .catch(() => {});

  if (submitted) return { submitted: true };

  // No success modal → distinguish a real bounce (required field blank, submit
  // still on screen) from the modal simply having closed.
  await page.waitForTimeout(800);
  const stillAtSubmit = await page
    .locator(LI_SUBMIT_SEL)
    .first()
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  return { submitted: !stillAtSubmit };
}

async function cmdRejectSubmit({ handle }) {
  const { page } = session(handle);
  const dismissSel = [
    'button[aria-label*="Dismiss" i]',
    'button[aria-label*="Fechar" i]',
    'button[aria-label*="Cerrar" i]',
    'button[aria-label*="Close" i]',
    'button[aria-label*="Cancelar" i]',
    "button[data-test-modal-close-btn]",
    ".artdeco-modal__dismiss",
  ].join(",");
  try {
    const btn = page.locator(dismissSel).first();
    if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await btn.click();
    }
  } catch {
  }
  try {
    const discard = page
      .locator(
        'button:has-text("Descartar"), button:has-text("Discard"), ' +
          'button[aria-label*="Discard" i], button[data-test-dialog-secondary-btn]',
      )
      .first();
    if (await discard.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await discard.click();
    }
  } catch {
  }
  return {};
}

async function cmdScreenshot({ handle, path: filePath, phone = true }) {
  const { page } = session(handle);
  const dest = filePath ?? `/tmp/hiremeops-${randomUUID()}.png`;
  await fs.mkdir(path.dirname(dest), { recursive: true });

  let restore = null;
  if (phone) {
    restore = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
  }
  try {
    await page.screenshot({ path: dest, fullPage: true });
  } finally {
    if (restore) await page.setViewportSize(restore).catch(() => {});
  }
  return { path: dest };
}

async function cmdDomSnapshot({ handle }) {
  const { page } = session(handle);
  const dom = await page.content();
  return { dom };
}

async function cmdExtractHr({ handle }) {
  const { page } = session(handle);

  const result = await page.evaluate(() => {
    const card = document.querySelector(
      [
        ".hirer-card__hirer-information",
        ".job-details-jobs-unified-top-card__hiring-manager",
        '[data-test-job-insight-type="hiring-manager"]',
      ].join(","),
    );
    if (!card) return null;

    const nameEl = card.querySelector(
      'span[aria-hidden="true"], .hirer-card__hirer-name, .app-aware-link span',
    );
    const linkEl = card.querySelector('a[href*="linkedin.com/in/"]');
    if (!nameEl && !linkEl) return null;

    return {
      name: (nameEl?.textContent ?? "").trim() || null,
      profile_url: linkEl?.href ?? null,
    };
  });

  return {
    hr_name: result?.name ?? null,
    hr_profile_url: result?.profile_url ?? null,
  };
}

async function cmdSearchJobs({
  handle,
  keywords = "",
  location = "",
  page_index = 0,
  filters = {},
}) {
  const sess = session(handle);
  const { page } = sess;

  const params = new URLSearchParams({
    keywords,
    location,
    start: String(page_index * 25),
  });

  if (filters.easy_apply_only !== false) params.set("f_AL", "true");
  if (filters.remote_only) params.set("f_WT", "2");

  if (filters.date_posted === "24h") params.set("f_TPR", "r86400");
  if (filters.date_posted === "week") params.set("f_TPR", "r604800");

  const url = `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    throw new Error("LinkedIn session expired — use the Login LinkedIn button to re-authenticate");
  }

  await page
    .locator(
      [
        "button.msg-overlay-bubble-header__control--close",
        "button.artdeco-toast-item__dismiss",
      ].join(","),
    )
    .first()
    .click({ timeout: 2_000 })
    .catch(() => {});

  await Promise.race([
    page.waitForSelector("li[data-occludable-job-id]", { timeout: 15_000 }).catch(() => {}),
    page
      .waitForSelector(".jobs-search-no-results-banner, .jobs-search-two-pane__no-results-banner", {
        timeout: 15_000,
      })
      .catch(() => {}),
  ]);

  const noResults = await page.evaluate(() => {
    if (
      document.querySelector(
        ".jobs-search-no-results-banner, .jobs-search-two-pane__no-results-banner",
      )
    ) {
      return true;
    }
    const text = document.body?.innerText ?? "";
    return /Nenhuma vaga corresponde|No matching jobs|No results found|Aucune offre/i.test(text);
  });
  if (noResults) {
    return { jobs: [], has_next_page: false };
  }

  await page.waitForTimeout(400 + Math.floor(Math.random() * 400));

  const jobs = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("li[data-occludable-job-id]"));

    return cards
      .map((card) => {
        const jobId = card.getAttribute("data-occludable-job-id") ?? null;

        const titleEl =
          card.querySelector(
            ".job-card-list__title--link, .job-card-container__link, .job-card-list__title, .artdeco-entity-lockup__title a, a[href*='/jobs/view/']",
          ) || card.querySelector(".artdeco-entity-lockup__title");
        let title = null;
        if (titleEl) {
          const fromHidden = (
            titleEl.querySelector('span[aria-hidden="true"]')?.textContent ?? ""
          ).trim();
          const fromAria = (titleEl.getAttribute("aria-label") ?? "").trim();
          const fromText =
            (titleEl.textContent ?? "")
              .split("\n")
              .map((s) => s.trim())
              .find((s) => s.length > 0) ?? "";
          title = fromHidden || fromAria || fromText || null;
        }

        const subtitleEl = card.querySelector(".artdeco-entity-lockup__subtitle");
        const subtitleText = (subtitleEl?.textContent ?? "").trim();
        let company = null;
        let location = null;
        if (subtitleText) {
          const dotIdx = subtitleText.indexOf(" · ");
          if (dotIdx !== -1) {
            company = subtitleText.slice(0, dotIdx).trim();
            const rawLoc = subtitleText.slice(dotIdx + 3).trim();
            const parenIdx = rawLoc.lastIndexOf("(");
            location = parenIdx !== -1 ? rawLoc.slice(0, parenIdx).trim() : rawLoc;
          } else {
            company = subtitleText;
          }
        }
        if (!company) {
          const compEl = card.querySelector(
            ".job-card-container__primary-description, .job-card-container__company-name",
          );
          company = (compEl?.textContent ?? "").trim() || null;
        }
        if (!location) {
          const locEl = card.querySelector(".job-card-container__metadata-item");
          location = (locEl?.textContent ?? "").trim() || null;
        }

        const linkEl = card.querySelector('a[href*="/jobs/view/"]');
        const applyUrl =
          linkEl?.href ?? (jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null);

        const hasEasyApplyLabel = !!card.querySelector('[aria-label*="Easy Apply"]');
        const hasSDUILink = !!card.querySelector('a[href*="openSDUIApplyFlow=true"]');
        const hasApplyClass = !!card.querySelector(".job-card-container__apply-method");
        const isEasyApply = hasEasyApplyLabel || hasSDUILink || hasApplyClass;

        if (!jobId && !title) return null;
        return {
          job_id: jobId,
          title,
          company,
          location,
          apply_url: applyUrl,
          is_easy_apply: isEasyApply,
        };
      })
      .filter(Boolean);
  });

  const csrf = (
    (await sess.browser.cookies("https://www.linkedin.com")).find((c) => c.name === "JSESSIONID")
      ?.value ?? ""
  ).replace(/"/g, "");
  const DECO = "com.linkedin.voyager.deco.jobs.web.shared.WebLightJobPosting-23";

  const parseDetail = (json) => ({
    title: (json?.title ?? "").trim() || null,
    description: (json?.description?.text ?? "").trim() || null,
    location: (json?.formattedLocation ?? "").trim() || null,
  });

  async function fetchJobDetail(jobId) {
    const attempts = [
      `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}?decorationId=${DECO}`,
      `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}`,
    ];
    let best = null;
    for (const u of attempts) {
      try {
        const res = await page.request.get(u, {
          headers: {
            "csrf-token": csrf,
            "x-restli-protocol-version": "2.0.0",
            accept: "application/json",
          },
          timeout: 10_000,
        });
        if (!res.ok()) continue;
        const parsed = parseDetail(await res.json());
        best = {
          title: best?.title ?? parsed.title,
          description: parsed.description ?? best?.description ?? null,
          location: parsed.location ?? best?.location ?? null,
        };
        if (best.description) break;
      } catch {
      }
    }
    return best;
  }

  let cursor = 0;
  const runPool = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const detail = job.job_id ? await fetchJobDetail(job.job_id) : null;
      job.description = detail?.description ?? null;
      if (!job.title && detail?.title) job.title = detail.title;
      if (detail?.location) job.location = detail.location;
      await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, () => runPool()));

  if (jobs.length === 0) {
    return { jobs, has_next_page: false };
  }

  const hasNextPage = await page
    .locator(
      [
        'button[aria-label="View next page"]',
        ".jobs-search-pagination__button--next",
        'button[aria-label^="Page "]:not([aria-current])',
      ].join(", "),
    )
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  return { jobs, has_next_page: hasNextPage };
}

async function cmdSearchLinkedInPosts({ handle, keywords = "", page_index = 0 }) {
  const { page } = session(handle);

  const base = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywords)}&sortBy=%22date_posted%22&origin=FACETED_SEARCH`;
  const url = page_index > 0 ? `${base}&page=${page_index + 1}` : base;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    throw new Error("LinkedIn session expired — use the Login LinkedIn button to re-authenticate");
  }

  await page
    .waitForSelector(
      'span[data-testid="expandable-text-box"], .feed-shared-update-v2, li.reusable-search__result-container',
      { timeout: 12_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);

  const harvest = () =>
    page
      .evaluate(() => {
        const out = [];
        const textBoxes = Array.from(
          document.querySelectorAll('span[data-testid="expandable-text-box"]'),
        );
        if (textBoxes.length > 0) {
          for (const span of textBoxes) {
            const text = (span.innerText ?? "").trim().slice(0, 3000);
            if (!text) continue;
            let container = span.closest("[componentkey]");
            if (!container) {
              container = span.parentElement;
              for (let i = 0; i < 11 && container?.parentElement; i++) {
                container = container.parentElement;
                if (container.hasAttribute("componentkey") || container.hasAttribute("data-urn"))
                  break;
              }
            }
            const authorLink = container?.querySelector('a[href*="/in/"]');
            const author = authorLink ? (authorLink.innerText ?? "").trim() || null : null;
            const html = container?.outerHTML ?? span.outerHTML;
            let postUrl = null;
            const actM = html.match(/urn:li:activity:(\d+)/);
            if (actM) {
              postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${actM[1]}/`;
            } else {
              const shrM = html.match(/shareId=(\d{10,})/) ?? html.match(/urn:li:share:(\d+)/);
              if (shrM) postUrl = `https://www.linkedin.com/feed/update/urn:li:share:${shrM[1]}/`;
            }
            out.push({ url: postUrl, text, author });
          }
          return out;
        }
        for (const el of document.querySelectorAll(
          "div.feed-shared-update-v2, li.reusable-search__result-container, div[data-urn*='activity']",
        )) {
          const textEl = el.querySelector(
            ".update-components-text, .feed-shared-update-v2__description, .break-words",
          );
          const text = ((textEl ?? el).innerText ?? "").trim().slice(0, 3000);
          if (!text) continue;
          const authorEl = el.querySelector(
            ".update-components-actor__title, .update-components-actor__name",
          );
          const author = authorEl ? (authorEl.innerText ?? "").trim() || null : null;
          const linkEl =
            el.querySelector('a[href*="/feed/update/"]') ?? el.querySelector('a[href*="/posts/"]');
          let postUrl = linkEl?.href ?? null;
          if (!postUrl) {
            const urn = el.getAttribute("data-urn") ?? "";
            const m = urn.match(/urn:li:activity:(\d+)/);
            if (m) postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`;
          }
          out.push({ url: postUrl, text, author });
        }
        return out;
      })
      .catch(() => []);

  const byKey = new Map();
  let stale = 0;
  for (let i = 0; i < 40 && stale < 3; i++) {
    const before = byKey.size;

    await page
      .evaluate(() => {
        document.querySelectorAll('button[data-testid="expandable-text-button"]').forEach((b) => {
          try {
            b.click();
          } catch {
          }
        });
      })
      .catch(() => {});

    for (const p of await harvest()) {
      const key = p.url || (p.text ? p.text.slice(0, 140) : null);
      if (key && !byKey.has(key)) byKey.set(key, p);
    }

    const fetchWait = page
      .waitForResponse((r) => r.url().includes("voyagerSearchDashClusters") && r.status() === 200, {
        timeout: 4_000,
      })
      .catch(() => null);

    await page.mouse.move(500, 400).catch(() => {});
    await page.mouse.wheel(0, 400 + Math.floor(Math.random() * 400)).catch(() => {});
    await fetchWait;
    await page.waitForTimeout(600 + Math.floor(Math.random() * 800));

    stale = byKey.size === before ? stale + 1 : 0;
    const empty = await page
      .locator(".artdeco-empty-state, .search-no-results")
      .count()
      .catch(() => 0);
    if (empty) break;
  }

  const posts = [...byKey.values()];

  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  for (const post of posts) {
    const m = emailRe.exec(post.text);
    post.email = m ? m[0] : null;
  }

  return { posts, has_next_page: false };
}

async function cmdSearchGoogle({ handle, query, page_index = 0 }) {
  const { page } = session(handle);

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${page_index * 10}&hl=pt-BR&num=10`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  for (const sel of [
    "button#L2AGLb",
    'button[aria-label*="Aceitar" i]',
    'button[aria-label*="Accept" i]',
    "#introAgreeButton",
  ]) {
    await page.click(sel, { timeout: 3_000 }).catch(() => {});
  }
  await page.waitForTimeout(400);

  const currentUrl = page.url();
  const pageText = await page.evaluate(() => document.documentElement.innerText ?? "");
  if (
    currentUrl.includes("/sorry/") ||
    /recaptcha|unusual traffic|tráfego incomum|antes de continuar|not a robot|detected unusual/i.test(
      pageText,
    )
  ) {
    return { results: [], blocked: true, has_next_page: false };
  }

  try {
    const { results, has_next_page } = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const SKIP = [
        "google.com",
        "googleadservices.com",
        "youtube.com",
        "googleusercontent.com",
        "gstatic.com",
      ];
      for (const h3 of document.querySelectorAll("a h3, h3")) {
        const a = h3.closest("a[href^='http']") || h3.parentElement?.closest("a[href^='http']");
        const url = a?.href;
        if (!url || SKIP.some((d) => url.includes(d)) || seen.has(url)) continue;
        seen.add(url);

        const container = a.closest("div.g, div[data-hveid], div[jscontroller]") || a.parentElement;
        const snippet = (
          container?.querySelector("div[data-sncf], .VwiC3b, div[role='text']")?.innerText ??
          container?.innerText ??
          ""
        )
          .trim()
          .slice(0, 2000);

        out.push({ url, title: (h3.innerText ?? "").trim(), snippet });
      }

      const has_next_page = !!document.querySelector(
        'a#pnnext, a[aria-label="Next page"], td.b a[aria-label*="Próxima" i]',
      );

      return { results: out, has_next_page };
    });

    const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    for (const r of results) {
      const m = emailRe.exec(`${r.title} ${r.snippet}`);
      r.email = m ? m[0] : null;
    }

    await page.waitForTimeout(600 + Math.floor(Math.random() * 600));
    return { results, blocked: false, has_next_page };
  } catch {
    return { results: [], blocked: false, has_next_page: false };
  }
}

async function cmdCheckLogin({ user_data_dir }) {
  const isLoggedInUrl = (url) => !/\/login|\/authwall|\/checkpoint|\/uas\/login/.test(url);

  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) {
    let probe;
    try {
      probe = await existing.browser.newPage();
      await probe.goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      return { logged_in: isLoggedInUrl(probe.url()) };
    } catch {
      return { logged_in: false };
    } finally {
      if (probe) await probe.close().catch(() => {});
    }
  }

  await reclaimProfileDir(user_data_dir);
  const resolvedExec = resolveChromiumExec();
  let browser;
  try {
    browser = await chromium.launchPersistentContext(user_data_dir, {
      headless: true,
      channel: resolvedExec ? undefined : "chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: resolvedExec,
    });
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return { logged_in: isLoggedInUrl(page.url()) };
  } catch {
    return { logged_in: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const LOGIN_URLS = {
  linkedin: "https://www.linkedin.com/login",
  catho: "https://www.catho.com.br/signin/",
  infojobs: "https://www.infojobs.com.br/candidate/cv/insert2.aspx",
  indeed: "https://secure.indeed.com/auth",
  gupy: "https://login.gupy.io/candidates/signin",
  gpt: "https://chatgpt.com/auth/login",
};

const LOGIN_PROBES = {
  linkedin: { url: "https://www.linkedin.com/feed/", out: /\/login|\/authwall|\/checkpoint|\/uas\/login/ },
  catho: { url: "https://www.catho.com.br/area-candidato/", out: /\/login|\/signin|\/entrar|account\.catho/ },
  infojobs: { url: "https://www.infojobs.com.br/candidate/cv/insert2.aspx", out: /\/login|\/entrar|\/candidate\/login/ },
  indeed: { url: "https://myjobs.indeed.com/", out: /\/auth|\/account\/login|secure\.indeed\.com/ },
  gupy: { url: "https://login.gupy.io/candidates/curriculum", out: /\/candidates\/(sign-?in|login)/ },
};

async function cmdOpenLoginTabs({ handle, sites }) {
  const sess = sessions.get(handle);
  if (!sess) throw new Error(`open_login_tabs: unknown handle ${handle}`);
  const { browser, page } = sess;
  const wanted = (sites && sites.length ? sites : Object.keys(LOGIN_URLS)).filter((s) => LOGIN_URLS[s]);
  const opened = [];
  for (let i = 0; i < wanted.length; i++) {
    const p = i === 0 ? page : await browser.newPage();
    attachDiagnostics(p);
    await p.goto(LOGIN_URLS[wanted[i]], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    opened.push(wanted[i]);
  }
  return { opened };
}

async function cmdCheckLogins({ user_data_dir }) {
  const status = { linkedin: false, catho: false, infojobs: false, indeed: false, gupy: false };
  const probeOne = async (browser, site) => {
    const { url, out } = LOGIN_PROBES[site];
    let tab;
    try {
      tab = await browser.newPage();
      await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      status[site] = !out.test(tab.url());
    } catch {
      status[site] = false;
    } finally {
      if (tab) await tab.close().catch(() => {});
    }
  };

  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) {
    for (const site of Object.keys(LOGIN_PROBES)) await probeOne(existing.browser, site);
    return { status };
  }
  await reclaimProfileDir(user_data_dir);
  const resolvedExec = resolveChromiumExec();
  let browser;
  try {
    browser = await chromium.launchPersistentContext(user_data_dir, {
      headless: true,
      channel: resolvedExec ? undefined : "chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: resolvedExec,
    });
    for (const site of Object.keys(LOGIN_PROBES)) await probeOne(browser, site);
  } catch {
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { status };
}

async function cmdClose({ handle }) {
  const popup = indeedPopups.get(handle);
  if (popup) {
    indeedPopups.delete(handle);
    await popup.close().catch(() => {});
  }
  const sess = sessions.get(handle);
  if (sess) {
    sessions.delete(handle);
    await sess.browser.close().catch(() => {});
  }
  return {};
}

async function cmdSearchIndeedJobs({
  handle,
  keywords = "",
  location = "Brasil",
  page_index = 0,
  remote_only = false,
}) {
  const { page } = session(handle);

  const start = String(page_index * 15);

  const passes = remote_only
    ? [
        { q: keywords, l: location, limit: "15", start, sc: "0kf:attr(DSQF7);" },
        { q: keywords, l: "Remoto", radius: "25", limit: "15", start },
      ]
    : [{ q: keywords, l: location, limit: "15", start }];

  const scrapeOne = async (paramObj) => {
    const url = `https://br.indeed.com/jobs?${new URLSearchParams(paramObj).toString()}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (e) {
      throw new Error(
        `Indeed search navigation failed (the browser may have closed) — retry. [${String(e?.message ?? e)}]`,
      );
    }

    const isChallenged = () =>
      page
        .evaluate(() => {
          if (
            document.querySelector(
              "#challenge-form, #challenge-stage, #challenge-running, #cf-chl-widget, " +
                '[id^="cf-chl-widget"], input[name="cf-turnstile-response"], ' +
                'input[name="cf_challenge_response"], #px-captcha, ' +
                'script[src*="challenges.cloudflare.com/turnstile"], ' +
                'iframe[src*="challenges.cloudflare.com"]',
            )
          )
            return true;
          const t = (document.title || "").toLowerCase();
          if (/just a moment|um momento|aguarde/.test(t)) return true;
          const body = (document.body?.innerText || "").toLowerCase();
          return /verif\w* (que )?voc[eê] [eé] humano|confirme que voc[eê] [eé] um humano|antes de continuar|verificando se a conex[aã]o|precisamos verificar se voc[eê]|verify you are human|checking your browser|additional verification/.test(
            body,
          );
        })
        .catch(() => false);

    await page
      .waitForFunction(
        () =>
          !!window.mosaic?.providerData?.["mosaic-provider-jobcards"] ||
          !!document.querySelector('a[data-jk], [data-testid="slider_item"], #mosaic-provider-jobcards'),
        { timeout: 15_000 },
      )
      .catch(() => {});

    if (await isChallenged()) {
      await passCaptchaOnPage(page).catch(() => {});
      await page.waitForTimeout(2_500);
      if (await isChallenged()) {
        throw new Error(
          "Indeed is asking to verify you're human (Cloudflare). Solve the check in the Indeed window once, then retry — it'll stay cleared for a while.",
        );
      }
    }

    const jobs = await page.evaluate(() => {
    const card = (jk, title, company, loc, easyApply) => ({
      job_id: jk,
      title: (title ?? "").trim() || null,
      company: (company ?? "").trim() || null,
      location: (loc ?? "").trim() || null,
      apply_url: `https://br.indeed.com/viewjob?jk=${jk}`,
      is_easy_apply: easyApply === true,
    });

    const readMosaicResults = () => {
      const g = window.mosaic?.providerData?.["mosaic-provider-jobcards"];
      const fromGlobal = g?.metaData?.mosaicProviderJobCardsModel?.results ?? g?.results;
      if (Array.isArray(fromGlobal) && fromGlobal.length) return fromGlobal;

      for (const s of document.scripts) {
        const t = s.textContent || "";
        const at = t.indexOf('providerData["mosaic-provider-jobcards"]=');
        if (at === -1) continue;
        const start = t.indexOf("{", at);
        if (start === -1) continue;
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let k = start; k < t.length; k++) {
          const c = t[k];
          if (esc) { esc = false; continue; }
          if (c === "\\") { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === "{") depth++;
          else if (c === "}" && --depth === 0) { end = k + 1; break; }
        }
        if (end === -1) continue;
        try {
          const obj = JSON.parse(t.slice(start, end));
          const r = obj?.metaData?.mosaicProviderJobCardsModel?.results ?? obj?.results;
          if (Array.isArray(r)) return r;
        } catch {
        }
      }
      return null;
    };

    const results = readMosaicResults();
    if (Array.isArray(results) && results.length) {
      return results
        .filter((r) => r && r.jobkey)
        .map((r) =>
          card(
            r.jobkey,
            r.displayTitle ?? r.title,
            r.company ?? r.truncatedCompany,
            r.formattedLocation ?? r.jobLocationCity,
            r.indeedApplyEnabled === true || r.indeedApplyable === true,
          ),
        );
    }

    const cards = Array.from(document.querySelectorAll('h3.jobTitle, [class*="jobTitle"]'));
    return cards.flatMap((h3) => {
      const link = h3.querySelector("a[data-jk]");
      if (!link) return [];
      const jobId = link.getAttribute("data-jk");
      const titleSpan = link.querySelector("span[id], span[title]");
      const container =
        h3.closest(
          '[data-testid="slider_item"], [class*="resultContent"], [class*="job_seen_beacon"]',
        ) ?? h3.parentElement?.parentElement?.parentElement;
      const easyApply = !!container?.querySelector('[data-testid="indeedApply"]');
      return [
        card(
          jobId,
          titleSpan?.textContent ?? link.textContent,
          container?.querySelector('[data-testid="company-name"], [class*="companyName"]')
            ?.textContent,
          container?.querySelector('[data-testid="text-location"], [class*="companyLocation"]')
            ?.textContent,
          easyApply,
        ),
      ];
    });
  });

    if (jobs.length === 0) {
      const hasShell = await page
        .evaluate(
          () =>
            !!document.querySelector(
              '#mosaic-provider-jobcards, a[data-jk], [data-testid="slider_item"]',
            ),
        )
        .catch(() => false);
      if (!hasShell) {
        throw new Error(
          "Indeed returned no job data (likely a 'verify you're human' block). Open the Indeed window, solve any check, then retry.",
        );
      }
    }

    const hasNext = await page
      .locator(
        '[data-testid="pagination-page-next"], [aria-label*="próxima" i], [aria-label*="next" i]',
      )
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    return { jobs, hasNext };
  };

  const byId = new Map();
  let hasNextPage = false;
  for (const paramObj of passes) {
    const { jobs: passJobs, hasNext } = await scrapeOne(paramObj);
    for (const j of passJobs) if (j.job_id && !byId.has(j.job_id)) byId.set(j.job_id, j);
    hasNextPage = hasNextPage || hasNext;
  }

  return { jobs: [...byId.values()], has_next_page: hasNextPage };
}

async function cmdFillIndeedApply({ handle, url, answers = {} }) {
  const { browser, page } = session(handle);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  if (/[/]jobs(\?|$)/.test(page.url())) {
    throw new Error(
      "Indeed sent us to the search page instead of the job — your Indeed session isn't logged in (or expired). Run 'Login Indeed' first, then retry the application.",
    );
  }

  const applyBtn = page.locator(APPLY_BTN_SEL).first();
  await applyBtn.waitFor({ state: "visible", timeout: 15_000 });
  await applyBtn.scrollIntoViewIfNeeded().catch(() => {});

  const popupPromise = browser.waitForEvent("page", { timeout: 8_000 }).catch(() => null);
  await applyBtn.click({ noWaitAfter: true }).catch(() => {});
  const popup = await popupPromise;
  const form = popup ?? page;

  await form.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  const mounted = await form
    .locator('button, input:not([type="hidden"]), textarea, select, [role="main"], form')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  if (!mounted) {
    const onSmartApply = /smartapply\.indeed\.com|indeedapply|\/form\/questions/i.test(form.url());
    throw new Error(
      onSmartApply
        ? "Indeed SmartApply opened but its form never rendered — likely a Cloudflare check or an expired single-use apply URL. Retry from the job page (headful) so a fresh apply link is minted."
        : "Indeed SmartApply did not open after clicking Apply — you may need to log in to Indeed (Login Indeed) or the job uses an external application.",
    );
  }

  const MAX_STEPS = 20;
  let unanswered = [];
  let needsHuman = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    await form.waitForTimeout(900);

    if (
      await form
        .locator(INDEED_SUBMIT_SEL)
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
    ) {
      indeedPopups.set(handle, form);
      return { parked: true, steps_taken: step, unanswered, needsHuman };
    }

    const res = await fillIndeedStep(form, answers);
    if (res.unanswered.length) unanswered = res.unanswered;
    if (res.needsHuman.length) needsHuman = res.needsHuman;

    if (!(await clickIndeedContinue(form))) {
      const altBtn = form.locator('button[type="submit"]').first();
      if (await altBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await altBtn.click();
      } else {
        break;
      }
    }
  }

  indeedPopups.set(handle, form);
  return { parked: true, steps_taken: MAX_STEPS, unanswered, needsHuman };
}

async function cmdAnswerIndeedFreeText({ handle, answers = {} }) {
  const popup = indeedPopups.get(handle);
  if (!popup) throw new Error("no Indeed popup parked for this handle");

  let unanswered = [];
  let needsHuman = [];
  const MAX_STEPS = 10;
  for (let step = 0; step < MAX_STEPS; step++) {
    await popup.waitForTimeout(400);
    if (await popup.locator(INDEED_SUBMIT_SEL).isVisible({ timeout: 1_000 }).catch(() => false)) {
      indeedPopups.set(handle, popup);
      return { parked: true, unanswered, needsHuman };
    }
    const res = await answerIndeedQuestions(popup, answers);
    unanswered = res.unanswered;
    needsHuman = res.needsHuman;

    if (!(await clickIndeedContinue(popup))) break;
  }
  indeedPopups.set(handle, popup);
  return { parked: true, unanswered, needsHuman };
}

async function fillIndeedStep(popup, answers) {
  const fieldMap = [
    { testid: "input-firstName", key: "firstName" },
    { testid: "input-lastName", key: "lastName" },
    { testid: "input-phoneNumber", key: "phone" },
    { testid: "input-email", key: "email" },
    { testid: "location-fields-postal-code-input", key: "postalCode" },
    { testid: "location-fields-locality-input", key: "locality" },
    { testid: "location-fields-address-input", key: "address" },
  ];

  for (const { testid, key } of fieldMap) {
    const value = answers[key];
    if (!value) continue;
    const input = popup.locator(`[data-testid="${testid}"]`);
    if (!(await input.isVisible({ timeout: 500 }).catch(() => false))) continue;
    const current = await input.inputValue().catch(() => "");
    if (!current) await humanType(popup, input, String(value)).catch(() => input.fill(value));
  }

  return answerIndeedQuestions(popup, answers);
}

async function answerIndeedQuestions(popup, answers = {}) {
  const provided = answers.questions || {};
  const items = popup.locator(".ia-Questions-item");
  const count = await items.count().catch(() => 0);
  const unanswered = [];

  const needsHuman = [];

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);

    if (await item.locator('[data-testid="information-question"]').count()) continue;

    const qLabel = (
      (await item.locator('[data-testid="safe-markup"]').first().textContent().catch(() => "")) || ""
    ).trim();
    const bucket = classifyIndeedQuestion(qLabel);
    const isConsent = bucket === "consent";
    const isAuth = bucket === "auth";
    const isUnverifiable = bucket === "unverifiable";

    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const YESRE = /^\s*(sim|yes|true|verdadeiro)\s*$/i;
    const NORE = /^\s*(n[aã]o|no|false|falso)\s*$/i;
    const readOpts = async (type) => {
      const labels = item.locator(`label:has(input[type='${type}'])`);
      const n = await labels.count();
      const out = [];
      for (let k = 0; k < n; k++) {
        const t = norm(await labels.nth(k).textContent().catch(() => ""));
        if (t) out.push({ text: t, el: labels.nth(k) });
      }
      return out;
    };
    const provAns = provided[qLabel] || provided[qLabel.trim()];

    if ((await item.locator('input[type="radio"]').count()) > 0) {
      const opts = await readOpts("radio");
      const isYesNo =
        opts.length > 0 && opts.length <= 3 && opts.every((o) => YESRE.test(o.text) || NORE.test(o.text));

      if (provAns) {
        const want = norm(provAns);
        const wy = YESRE.test(want);
        const wn = NORE.test(want);
        const hit = opts.find(
          (o) =>
            o.text.includes(want) ||
            want.includes(o.text) ||
            (wy && YESRE.test(o.text)) ||
            (wn && NORE.test(o.text)),
        );
        if (hit) {
          await hit.el.click().catch(() => {});
          continue;
        }
      }
      if (isConsent || isUnverifiable) {
        needsHuman.push({ label: qLabel, kind: "radio" });
        continue;
      }
      if (isYesNo) {
        const q = norm(qLabel);
        const wantYes = isAuth || /(dispon|remoto|remote|home ?office)/.test(q);
        const re = wantYes ? YESRE : NORE;
        const hit = opts.find((o) => re.test(o.text));
        if (hit) await hit.el.click().catch(() => {});
        else needsHuman.push({ label: qLabel, kind: "radio" });
        continue;
      }
      unanswered.push({ name: "", label: qLabel, kind: "radio", options: opts.map((o) => o.text) });
      continue;
    }

    if ((await item.locator('input[type="checkbox"]').count()) > 0) {
      const opts = await readOpts("checkbox");
      if (provAns) {
        const wanted = String(provAns)
          .split("|")
          .map((s) => norm(s))
          .filter(Boolean);
        for (const o of opts) {
          if (wanted.some((w) => o.text.includes(w) || w.includes(o.text))) {
            await o.el.click().catch(() => {});
          }
        }
        continue;
      }
      if (opts.length === 1) {
        await opts[0].el.click().catch(() => {});
        continue;
      }
      if (isConsent || isUnverifiable) {
        needsHuman.push({ label: qLabel, kind: "checkbox" });
        continue;
      }
      unanswered.push({
        name: "",
        label: qLabel,
        kind: "checkbox",
        options: opts.map((o) => o.text),
        multi: true,
      });
      continue;
    }

    if ((await item.locator('[role="combobox"]').count()) > 0) {
      await item.locator('[role="combobox"]').first().click().catch(() => {});
      const search = item.locator('input[aria-controls^="Listbox"], input[placeholder*="esquis" i]').first();
      if (await search.count()) {
        await search.fill("Brasil").catch(() => {});
        await popup.waitForTimeout(350);
      }
      const opt = item.locator('li[role="option"]', { hasText: /brasil \(br\)|^\s*brasil/i }).first();
      if (await opt.count()) await opt.click().catch(() => {});
      continue;
    }

    const textarea = item.locator("textarea").first();
    const input = item.locator('input[type="text"]').first();
    const field = (await textarea.count()) ? textarea : (await input.count()) ? input : null;
    if (!field) continue;

    if ((await field.inputValue().catch(() => ""))) continue;

    const name = (await field.getAttribute("name").catch(() => null)) || "";
    const ll = qLabel.toLowerCase();

    let value = null;
    if (/linkedin/.test(ll)) value = answers.linkedinUrl || answers.linkedin || null;
    else if (/pretens|sal[aá]ri|salary/.test(ll)) value = answers.salary || null;
    else if (provided[name]) value = provided[name];
    else if (provided[qLabel]) value = provided[qLabel];

    if (value) {
      const str = String(value);
      if (str.length <= HUMAN_TYPE_MAX) {
        await humanType(popup, field, str).catch(() => field.fill(str).catch(() => {}));
      } else {
        await field.fill(str).catch(() => {});
      }
    } else {
      const kind = (await textarea.count()) ? "textarea" : "text";
      unanswered.push({ name, label: qLabel, kind });
    }
  }

  return { unanswered, needsHuman };
}

async function cmdConfirmIndeedSubmit({ handle }) {
  const popup = indeedPopups.get(handle);
  if (!popup) throw new Error(`No parked Indeed application for handle ${handle}`);

  const submitBtn = popup.locator(INDEED_SUBMIT_SEL).first();
  await submitBtn.waitFor({ state: "visible", timeout: 10_000 });
  await thinkTime();
  await humanClick(popup, submitBtn).catch(() => submitBtn.click().catch(() => {}));
  await popup.waitForTimeout(2_500);
  indeedPopups.delete(handle);
  return {};
}

async function cmdRejectIndeedSubmit({ handle }) {
  const popup = indeedPopups.get(handle);
  if (!popup) throw new Error(`No parked Indeed application for handle ${handle}`);

  try {
    const closeBtn = popup
      .locator(
        '[data-testid="ExitLinkWithModalComponent-exitButton"], button:has(span:text("Salvar e fechar"))',
      )
      .first();
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await popup.close();
    }
  } catch {
    await popup.close().catch(() => {});
  }
  indeedPopups.delete(handle);
  return {};
}

async function cmdShutdown() {
  await closeAll();
  process.nextTick(() => process.exit(0));
  return {};
}

// Live Evidence Viewer: CDP-screencast the ACTIVE automation page (not a throwaway browser) and
// stream frames to Rust as unsolicited `screencast_frame` events (no `id`), which the Rust reader
// routes to the preview channel. Uses only the Page domain over a fresh CDP session — no
// Runtime.enable, so it doesn't reintroduce the patchright stealth leak.
async function cmdStartScreencast({ handle }) {
  const sess = sessions.get(handle);
  if (!sess || !sess.page) throw new Error(`start_screencast: unknown handle ${handle}`);
  if (sess.screencastCdp) return {}; // already streaming
  const cdp = await sess.page.context().newCDPSession(sess.page);
  sess.screencastCdp = cdp;
  cdp.on("Page.screencastFrame", async (e) => {
    try {
      writeLine({
        event: "screencast_frame",
        handle,
        data: e.data,
        width: e.metadata?.deviceWidth ?? 0,
        height: e.metadata?.deviceHeight ?? 0,
      });
      await cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, everyNthFrame: 2 });
  return {};
}

async function cmdStopScreencast({ handle }) {
  const sess = sessions.get(handle);
  const cdp = sess?.screencastCdp;
  if (cdp) {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
    sess.screencastCdp = null;
  }
  return {};
}

function session(handle) {
  const sess = sessions.get(handle);
  if (!sess) throw new Error(`No session for handle: ${handle}`);
  return sess;
}

async function activePage(handle) {
  const { browser } = session(handle);
  const pages = browser.pages().filter((p) => !p.isClosed());
  if (pages.length > 0) return pages[pages.length - 1];
  return browser.newPage();
}

async function closeAll() {
  const handles = [...sessions.keys()];
  for (const h of handles) {
    const sess = sessions.get(h);
    sessions.delete(h);
    await sess?.browser.close().catch(() => {});
  }
}

async function handleResumeStep(page, cvPath) {
  const container = page.locator("#easyApplyUploadedResumeRef");
  const resumeCards = container.locator('[role="radio"], input[type=radio]');
  // SDUI renders the résumé list async — wait briefly for a card to attach
  // (isVisible at 250ms was flaky, so we fell through to UPLOAD even though a
  // résumé was already there → the OS file window kept popping).
  const hasResume = await resumeCards
    .first()
    .waitFor({ state: "attached", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (hasResume) {
    // A résumé already exists on the account. SELECT it, NEVER upload (LinkedIn
    // keeps prior uploads). If none is checked yet, check the first; if one is
    // already checked (the common case), we're done.
    const checked = await container
      .locator('[role="radio"][aria-checked="true"], input[type=radio]:checked')
      .count()
      .catch(() => 0);
    if (checked === 0) {
      const first = resumeCards.first();
      await first.check({ timeout: 1_000 }).catch(async () => {
        await first.click().catch(() => {});
      });
      await page.waitForTimeout(400);
    }
    return true;
  }

  // No résumé present at all → upload only if we actually have a file.
  if (!cvPath) return true;

  const uploadBtn = page
    .locator(
      'button:has-text("Carregar currículo"), button:has-text("Upload resume"), ' +
        'button[aria-label*="currículo" i], button[aria-label*="resume" i]',
    )
    .first();
  if (!(await uploadBtn.isVisible({ timeout: 250 }).catch(() => false))) return false;

  const fileInput = page.locator('input[type=file]').first();
  if ((await fileInput.count().catch(() => 0)) > 0) {
    await fileInput.setInputFiles(cvPath).catch(() => {});
    await page.waitForTimeout(1_800);
    return true;
  }

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null),
    uploadBtn.click().catch(() => {}),
  ]);
  if (chooser) await chooser.setFiles(cvPath).catch(() => {});
  await page.waitForTimeout(1_800);
  return true;
}

async function fieldMaxLen(field) {
  return await field
    .evaluate((el) => {
      const ml = el.maxLength;
      if (typeof ml === "number" && ml > 0 && ml < 100000) return ml;
      const descId = el.getAttribute("aria-describedby");
      const help = descId ? document.getElementById(descId) : null;
      const txt = (help?.textContent || "").replace(/\s+/g, " ");
      const m =
        txt.match(/de\s+(\d+)\s+caracteres/i) ||
        txt.match(/\/\s*(\d+)\b/) ||
        txt.match(/max(?:imum)?\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    })
    .catch(() => null);
}

function clampAnswer(value, maxLen) {
  const v = String(value ?? "");
  if (!maxLen || v.length <= maxLen) return v;
  const num = v.match(/\d+/);
  if (maxLen <= 12 && num) return num[0].slice(0, maxLen);
  return v.slice(0, maxLen);
}

// Reduce a free/verbose answer to yes/no POLARITY. The AI often replies with a
// sentence ("Sim, tenho experiência com Java") which never equals the strict
// "Sim"/"Yes" radio option, so the option stays blank ("campo obrigatório").
// Negation is checked FIRST so "não tenho experiência" → no despite containing
// "tenho". Returns "yes" | "no" | null (null = not a yes/no answer). Accent-
// stripped so "não" and "nao" both match.
function answerPolarity(raw) {
  const s = String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!s) return null;
  if (
    /\b(nao|not|nunca|nenhum|nenhuma|nope|negativo|jamais|discordo|false|falso)\b/.test(s) ||
    /\bn['’]?t\b/.test(s) ||
    /^n(o)?$/.test(s)
  ) {
    return "no";
  }
  if (
    /\b(sim|yes|yeah|yep|tenho|possuo|have|has|claro|certeza|afirmativo|positivo|true|verdadeiro|concordo|correto|correct|agree)\b/.test(
      s,
    ) ||
    /^y$/.test(s)
  ) {
    return "yes";
  }
  return null;
}

async function fillStep(page, answers, coverLetter) {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const unanswered = [];

  const fields = await page
    .locator(
      "input:not([type=hidden]):not([type=submit]):not([type=button])" +
        ":not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select",
    )
    .all();

  for (const field of fields) {
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    const label = await fieldLabel(field);
    const maxLen = tag === "select" ? null : await fieldMaxLen(field);

    if (coverLetter && label.includes("cover letter")) {
      await setVal(field, tag, clampAnswer(coverLetter, maxLen));
      continue;
    }

    const match = answers.find((a) => {
      const want = norm(a.label);
      return want && (label.includes(want) || want.includes(label));
    });
    if (match) {
      await setVal(field, tag, clampAnswer(match.value, maxLen));
      continue;
    }
    if (!label) continue;
    const curVal = await field.evaluate((el) => String(el.value ?? "")).catch(() => "");
    const empty = !curVal.trim();
    const overLimit = !!maxLen && curVal.length > maxLen;
    if (!empty && !overLimit) continue;
    const options =
      tag === "select"
        ? await field
            .evaluate((el) =>
              Array.from(el.options)
                .map((o) => o.textContent.trim())
                .filter(Boolean),
            )
            .catch(() => [])
        : undefined;
    unanswered.push({
      label,
      kind: tag === "select" ? "select" : "text",
      options,
      maxLength: maxLen ?? undefined,
    });
  }

  const radioGroups = await page
    .locator(
      'fieldset[data-test-form-builder-radio-button-form-component="true"], fieldset[role="radiogroup"], fieldset:has(input[type=radio])',
    )
    .all();
  for (const group of radioGroups) {
    // The résumé-selection step is ALSO a role=radiogroup, but it's owned by
    // handleResumeStep. Never treat it as a Q&A radio — doing so pushed it to
    // the AI-answer step, which then re-clicked into the résumé/upload UI (the
    // OS file window popping repeatedly).
    const isResumeGroup = await group
      .evaluate(
        (fs) =>
          !!fs.querySelector(
            '#easyApplyUploadedResumeRef, [componentkey="easyApplyUploadedResumeRef"], input[type=file]',
          ),
      )
      .catch(() => false);
    if (isResumeGroup) continue;

    const qLabel = norm(
      await group
        .evaluate((fs) => {
          const inner = fs.querySelector(
            "[data-test-form-builder-radio-button-form-component__title], legend, .fb-dash-form-element__label",
          );
          if (inner?.textContent?.trim()) return inner.textContent;
          let p = fs.previousElementSibling;
          while (p && !(p.textContent ?? "").trim()) p = p.previousElementSibling;
          return p?.textContent ?? "";
        })
        .catch(() => ""),
    );
    if (!qLabel) continue;

    const roleRadios = await group.locator('[role="radio"]').all();
    const useRole = roleRadios.length > 0;
    const optionEls = useRole ? roleRadios : await group.locator("input[type=radio]").all();
    const optText = async (el) =>
      useRole
        ? norm(await el.evaluate((d) => d.querySelector("p")?.textContent ?? "").catch(() => ""))
        : await fieldLabel(el);

    const match = answers.find((a) => {
      const want = norm(a.label);
      return want && (qLabel.includes(want) || want.includes(qLabel));
    });
    if (!match) {
      const optLabels = [];
      for (const el of optionEls) {
        const t = await optText(el);
        if (t) optLabels.push(t);
      }
      unanswered.push({ label: qLabel, kind: "radio", options: optLabels });
      continue;
    }

    const wantVal = norm(match.value);
    const YES = ["yes", "sim", "true", "1", "verdadeiro", "yeah", "y"];
    const NO = ["no", "não", "nao", "false", "0", "falso", "n"];
    const sameChoice = (a, b) =>
      (YES.includes(a) && YES.includes(b)) || (NO.includes(a) && NO.includes(b));
    // Polarity match handles VERBOSE answers ("Sim, tenho experiência…") that
    // never equal the strict "Sim"/"Yes" option — reduce both to yes/no first.
    const wantPol = answerPolarity(match.value);
    for (const el of optionEls) {
      const t = await optText(el);
      if (!t) continue;
      const optPol = answerPolarity(t);
      if (
        (wantPol && optPol && wantPol === optPol) ||
        t.includes(wantVal) ||
        wantVal.includes(t) ||
        sameChoice(t, wantVal)
      ) {
        if (useRole) {
          // SDUI keeps state on the div's aria-checked (React), NOT the decorative
          // native <input> — verifying isChecked()/check() on that input fights the
          // React state and can leave the option unselected ("campo obrigatório").
          // Click the div, confirm via aria-checked, retry on the inner text/input.
          const isChecked = async () =>
            (await el.getAttribute("aria-checked").catch(() => null)) === "true";
          await el.click().catch(() => {});
          if (!(await isChecked())) {
            await el.locator('p, input[type=radio], label').first().click().catch(() => {});
          }
          if (!(await isChecked())) {
            await el.evaluate((d) => d.click()).catch(() => {});
          }
        } else {
          await el.check({ timeout: 1_500 }).catch(async () => {
            const id = await el.getAttribute("id");
            if (id) await group.locator(`label[for="${id}"]`).click().catch(() => {});
          });
        }
        break;
      }
    }
  }

  for (const ans of answers) {
    if (String(ans.value).toLowerCase() !== "true" && ans.value !== "1") continue;
    const wantLabel = norm(ans.label);
    const boxes = await page.locator("input[type=checkbox]").all();
    for (const box of boxes) {
      const bLabel = await fieldLabel(box);
      if (bLabel.includes(wantLabel) || wantLabel.includes(bLabel)) {
        await box.check().catch(() => {});
        break;
      }
    }
  }

  return unanswered;
}

async function fieldLabel(locator) {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  try {
    return norm(
      await locator.evaluate((el) => {
        const attr =
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name");
        if (attr) return attr;

        if (el.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lbl?.textContent) return lbl.textContent;
        }

        const wrap = el.closest("label");
        if (wrap?.textContent) return wrap.textContent;

        const liWrap = el.closest(
          ".fb-form-element, .artdeco-text-input--container, .jobs-easy-apply-form-element",
        );
        if (liWrap) {
          const lbl = liWrap.querySelector("label, legend, .fb-form-element-label");
          if (lbl?.textContent) return lbl.textContent;
        }

        return "";
      }),
    );
  } catch {
    return "";
  }
}

async function setVal(locator, tag, value) {
  try {
    if (tag === "select") {
      await locator
        .selectOption({ label: value })
        .catch(() => locator.selectOption(value).catch(() => {}));
      return;
    }
    const str = String(value);
    if (str.length <= HUMAN_TYPE_MAX) {
      await humanType(locator.page(), locator, str);
    } else {
      await locator.fill(str);
    }
  } catch {
    await locator
      .evaluate((el, val) => {
        const proto =
          el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor?.set) {
          descriptor.set.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, String(value))
      .catch(() => {});
  }
}

async function pushHeadline(browser, text) {
  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  await page.goto("https://www.linkedin.com/in/me/edit/intro/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const editor = page
    .locator(
      [
        '.tiptap[contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'input[name="headline"]',
        'input[name="title"]',
      ].join(", "),
    )
    .first();

  await editor.waitFor({ state: "visible", timeout: 15_000 });

  await editor.click({ clickCount: 3 });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);

  const saveBtn = page.getByRole("button", { name: /^(save|salvar)$/i }).first();
  await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
  await saveBtn.click();

  await editor.waitFor({ state: "hidden", timeout: 12_000 });
  return { kind: "headline", status: "ok" };
}

async function pushAbout(browser, text) {
  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  await page
    .goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 20_000 })
    .catch((e) => {
      if (!page.url().includes("linkedin.com")) throw e;
    });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const aboutEditLink = page
    .locator(
      [
        'a[aria-label="Editar sobre"]',
        'a[aria-label="Edit about"]',
        'a[componentkey*="about_edit"]',
        'a[aria-label*="Editar" i][aria-label*="sobre" i]',
        'a[aria-label*="Edit" i][aria-label*="about" i]',
      ].join(", "),
    )
    .first();

  const editLinkExists = (await aboutEditLink.count()) > 0;

  const editorReadyFn = () =>
    [...document.querySelectorAll('[contenteditable="true"], textarea')].some((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
    });

  if (editLinkExists) {
    await aboutEditLink.click({ force: true });
    await Promise.race([
      page.waitForURL((u) => u.href.includes("/edit/forms/summary"), { timeout: 12_000 }),
      page.waitForFunction(editorReadyFn, { timeout: 12_000 }),
    ]).catch(() => {});
  } else {
    const addSectionBtn = page
      .getByRole("button", {
        name: /adicionar\s+se[çc][aã]o|add\s+(profile\s+)?section/i,
      })
      .first();
    await addSectionBtn.waitFor({ state: "visible", timeout: 10_000 });
    await addSectionBtn.click();

    const aboutMenuItem = page
      .getByRole("menuitem", { name: /^(about|sobre)$/i })
      .or(page.getByRole("option", { name: /^(about|sobre)$/i }))
      .or(page.locator("li").filter({ hasText: /^(about|sobre)$/i }))
      .first();
    await aboutMenuItem.waitFor({ state: "visible", timeout: 8_000 });
    await aboutMenuItem.click();

    await aboutEditLink.waitFor({ timeout: 10_000 });
    await aboutEditLink.click({ force: true });
    await Promise.race([
      page.waitForURL((u) => u.href.includes("/edit/forms/summary"), { timeout: 12_000 }),
      page.waitForFunction(editorReadyFn, { timeout: 12_000 }),
    ]).catch(() => {});
  }

  await page.waitForFunction(editorReadyFn, { timeout: 20_000 });

  const editor = page.locator('[contenteditable="true"], textarea').first();
  await editor.click({ clickCount: 3, force: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);

  const saveBtn = page.getByRole("button", { name: /^(save|salvar|continuar|continue)$/i }).first();
  await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
  await saveBtn.click();

  await Promise.race([
    page.waitForURL((u) => !u.href.includes("/edit/forms/summary"), { timeout: 15_000 }),
    editor.waitFor({ state: "hidden", timeout: 15_000 }),
  ]).catch(() => {});
  return { kind: "about", status: "ok" };
}

async function pushSkills(browser, skillsCsv) {
  const skills = skillsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (skills.length === 0) return { kind: "skills", status: "ok" };

  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  await page
    .goto("https://www.linkedin.com/in/me/", { waitUntil: "load", timeout: 25_000 })
    .catch((e) => {
      if (!page.url().includes("linkedin.com")) throw e;
    });
  await page.waitForURL((u) => !u.href.includes("/in/me/"), { timeout: 8_000 }).catch(() => {});
  const urlMatch = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  let handle = urlMatch && urlMatch[1] !== "me" ? urlMatch[1] : null;
  if (!handle) {
    handle = await page
      .evaluate(() => {
        for (const a of document.querySelectorAll('header a[href*="/in/"], nav a[href*="/in/"]')) {
          const m = a.getAttribute("href")?.match(/\/in\/([^/?#]+)/);
          if (m && m[1] !== "me") return m[1];
        }
        return null;
      })
      .catch(() => null);
  }
  handle = handle || "me";
  const skillFormUrl = `https://www.linkedin.com/in/${handle}/skills/edit/forms/new/`;

  const SKILL_INPUT_SEL = [
    'input[data-testid="typeahead-input"]',
    'input[aria-label*="Competência" i]',
    'input[aria-label*="Skill" i]',
    'input[placeholder*="Competência" i]',
    'input[placeholder*="skill" i]',
  ].join(", ");

  const ADD_MORE = page
    .getByRole("button", {
      name: /adicionar mais competências|add more skills/i,
    })
    .first();

  const alreadyOnProfile = page
    .locator('[role="alert"]')
    .filter({
      hasText: /Esta competência já está|skill is already/i,
    })
    .first();

  let formState = "first";
  let i = 0;
  while (i < skills.length) {
    if (formState === "first") {
      await page.evaluate((url) => {
        window.location.href = url;
      }, skillFormUrl);
      await page.waitForURL((u) => u.href.includes("/skills/edit/forms/new"), { timeout: 15_000 });
      formState = "open";
    } else if (formState === "addMore") {
      const addMoreFound = await ADD_MORE.waitFor({ state: "visible", timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      if (addMoreFound) {
        await ADD_MORE.click({ force: true });
        await page
          .waitForURL((u) => u.href.includes("/skills/edit/forms/new"), { timeout: 12_000 })
          .catch(() => {});
      } else {
        await page.evaluate((url) => {
          window.location.href = url;
        }, skillFormUrl);
        await page.waitForURL((u) => u.href.includes("/skills/edit/forms/new"), {
          timeout: 15_000,
        });
      }
      formState = "open";
    }

    const skillDialog = page.locator('dialog[data-testid="dialog"]');
    await skillDialog.waitFor({ state: "visible", timeout: 12_000 });
    const input = skillDialog.locator(SKILL_INPUT_SEL).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.click();
    await input.fill(skills[i]);

    const focusInDialog = await page
      .evaluate(() => document.activeElement?.closest('dialog[data-testid="dialog"]') !== null)
      .catch(() => false);
    if (!focusInDialog) {
      await input.click();
      await page.waitForTimeout(300);
    }

    const suggestion = page.locator('[role="option"]').first();
    const hasSuggestion = await suggestion
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasSuggestion) {
      i++;
      continue;
    }
    await suggestion.click();

    const isDuplicate = await alreadyOnProfile
      .waitFor({ state: "visible", timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (isDuplicate) {
      await page
        .locator('[role="alert"] button[aria-label="Fechar"]')
        .first()
        .click()
        .catch(() => {});
      i++;
      continue;
    }

    const saveBtn = skillDialog.getByRole("button", { name: /^(save|salvar)$/i }).first();
    await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
    await saveBtn.click();
    i++;
    formState = "addMore";

    await Promise.race([
      ADD_MORE.waitFor({ state: "visible", timeout: 10_000 }),
      page.waitForURL((u) => !u.href.includes("/skills/edit/forms"), { timeout: 10_000 }),
    ]).catch(() => {});
  }

  return { kind: "skills", status: "ok" };
}

async function pushEducationEntry(browser, entry) {
  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  if (!page.url().includes("linkedin.com")) {
    await page
      .goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch((e) => {
        if (!page.url().includes("linkedin.com")) throw e;
      });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }

  const matchH = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  const handle = matchH ? matchH[1] : "me";
  await page.evaluate((url) => {
    window.location.href = url;
  }, `https://www.linkedin.com/in/${handle}/edit/forms/education/new/`);
  await page.waitForURL((u) => u.href.includes("/edit/forms/education/new"), { timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  async function fillTypeahead(locator, text) {
    if (!text) return;
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    await locator.fill(text);
    const sugg = page.locator('[role="option"]').first();
    const found = await sugg
      .waitFor({ state: "visible", timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    if (found) await sugg.click();
    await page.waitForTimeout(500);
  }

  if (entry.institution) {
    await fillTypeahead(
      page.locator('input[data-testid="typeahead-input"]').first(),
      entry.institution.trim(),
    );
    await page.waitForTimeout(300);
  }

  if (entry.degree) {
    const commaIdx = entry.degree.indexOf(",");
    const degreePart = (commaIdx > -1 ? entry.degree.slice(0, commaIdx) : entry.degree).trim();
    const fieldPart = (commaIdx > -1 ? entry.degree.slice(commaIdx + 1) : "").trim();

    const degreeInput = page
      .locator('input[aria-label="Diploma"], input[aria-label="Degree"]')
      .first();
    if ((await degreeInput.count()) > 0) await fillTypeahead(degreeInput, degreePart);

    if (fieldPart) {
      const fieldInput = page
        .locator('input[aria-label="Área de estudo"], input[aria-label="Field of study"]')
        .first();
      if ((await fieldInput.count()) > 0) await fillTypeahead(fieldInput, fieldPart);
    }
  }

  const { startMonth, startYear, endMonth, endYear } = parseDates(entry.dates);
  async function setSelect(sel, value) {
    if (!value) return;
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) await el.selectOption(value).catch(() => {});
  }
  await setSelect(
    'div[aria-label="Mês de Data de início"] select, div[aria-label="Start date month"] select',
    startMonth,
  );
  await setSelect(
    'div[aria-label="Ano de Data de início"] select, div[aria-label="Start date year"] select',
    startYear,
  );
  await setSelect(
    'div[aria-label*="Mês de Data de término"] select, div[aria-label*="End date month"] select',
    endMonth,
  );
  await setSelect(
    'div[aria-label*="Ano de Data de término"] select, div[aria-label*="End date year"] select',
    endYear,
  );

  if (entry.bullets && entry.bullets.length > 0) {
    const desc = entry.bullets.join("\n");
    const descArea = page
      .locator('textarea[aria-label*="Descrição" i], textarea[aria-label*="Description" i]')
      .first();
    if ((await descArea.count()) > 0) {
      await descArea.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await descArea.fill(desc);
    }
  }

  const saveBtn = page.getByRole("button", { name: /^(salvar|save)$/i }).first();
  await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
  await saveBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await saveBtn.click();

  await page
    .waitForURL((u) => !u.href.includes("/edit/forms/education"), { timeout: 15_000 })
    .catch(() => {});
}

async function pushExperienceEntry(browser, entry) {
  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  if (!page.url().includes("linkedin.com")) {
    await page
      .goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch((e) => {
        if (!page.url().includes("linkedin.com")) throw e;
      });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }

  const title = (entry.title ?? "").trim();
  const org = (entry.organization ?? "").trim();

  if (title) {
    const alreadyPresent = await page.evaluate(
      ({ t, o }) => {
        const section = document.querySelector(
          '[componentkey*="ExperienceTopLevelSection"], ' +
            'section[aria-label*="Experiência" i], section[aria-label*="Experience" i]',
        );
        if (!section) return false;
        const text = (section.textContent ?? "").toLowerCase();
        return text.includes(t.toLowerCase()) && (!o || text.includes(o.toLowerCase()));
      },
      { t: title, o: org },
    );
    if (alreadyPresent) {
      return { kind: "experience", status: "skipped", label: `${title} @ ${org}` };
    }
  }

  const matchH = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  const handle = matchH ? matchH[1] : "me";
  await page.evaluate((url) => {
    window.location.href = url;
  }, `https://www.linkedin.com/in/${handle}/edit/forms/position/new/`);
  await page.waitForURL((u) => u.href.includes("/edit/forms/position/new"), { timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  async function setSelect(sel, value) {
    if (!value) return;
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) await el.selectOption(value).catch(() => {});
  }

  async function fillTypeahead(locator, text) {
    if (!text) return;
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    await locator.fill(text);
    const sugg = page.locator('[role="option"]').first();
    const found = await sugg
      .waitFor({ state: "visible", timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    if (found) await sugg.click();
    await page.waitForTimeout(500);
  }

  await fillTypeahead(page.locator('input[data-testid="typeahead-input"]').nth(0), title);
  await fillTypeahead(page.locator('input[data-testid="typeahead-input"]').nth(1), org);

  const { startMonth, startYear, endMonth, endYear } = parseDates(entry.dates);
  const isCurrent =
    !endYear ||
    (entry.dates ?? "").toLowerCase().includes("momento") ||
    (entry.dates ?? "").toLowerCase().includes("present");

  if (!isCurrent) {
    const cb = page.locator('[role="checkbox"][aria-label*="Trabalho atualmente" i]').first();
    const checked = (await cb.getAttribute("aria-checked").catch(() => "false")) === "true";
    if (checked) {
      await cb.click({ force: true });
      await page.waitForTimeout(500);
    }
  }

  await setSelect('div[aria-label*="Mês de Data de início"] select', startMonth);
  await setSelect('div[aria-label*="Ano de Data de início"] select', startYear);
  if (!isCurrent) {
    await setSelect('div[aria-label*="Mês de Data de término"] select', endMonth);
    await setSelect('div[aria-label*="Ano de Data de término"] select', endYear);
  }

  if (entry.location) {
    const locStr = entry.location.replace(/[·•].*$/, "").trim();
    const locInput = page
      .locator(
        'input[aria-label*="Localidade" i], input[aria-label*="Location" i], ' +
          'input[placeholder*="Localidade" i], input[placeholder*="Location" i]',
      )
      .first();
    if ((await locInput.count()) > 0) await fillTypeahead(locInput, locStr);

    const locLower = entry.location.toLowerCase();
    let locType = "";
    if (locLower.includes("remote") || locLower.includes("remoto")) locType = "LocationType_REMOTE";
    else if (locLower.includes("hybrid") || locLower.includes("híbrido"))
      locType = "LocationType_HYBRID";
    if (locType) {
      for (const sel of await page.locator("select").all()) {
        const has = await sel
          .evaluate((el) => [...el.options].some((o) => o.value.startsWith("LocationType_")))
          .catch(() => false);
        if (has) {
          await sel.selectOption(locType).catch(() => {});
          break;
        }
      }
    }
  }

  if (entry.bullets && entry.bullets.length > 0) {
    const editor = page
      .locator('[contenteditable="true"][role="textbox"][aria-label*="Descrição" i]')
      .first();
    if ((await editor.count()) > 0) {
      await editor.click({ clickCount: 3, force: true });
      await page.keyboard.press("Control+a");
      await page.keyboard.type(
        entry.bullets
          .map((b) => (b.trim().startsWith("•") ? b.trim() : `• ${b.trim()}`))
          .join("\n"),
      );
    }
  }

  const saveBtn = page.getByRole("button", { name: /^(salvar|save)$/i }).first();
  await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
  await saveBtn.click();

  await Promise.race([
    page.waitForURL((u) => !u.href.includes("/edit/forms/position/new"), { timeout: 15_000 }),
    saveBtn.waitFor({ state: "hidden", timeout: 15_000 }),
  ]).catch(() => {});

  return { kind: "experience", status: "ok", label: `${title} @ ${org}` };
}

async function cmdPushProfile({ handle, sections }) {
  const { browser } = session(handle);
  const results = [];

  for (const sec of sections) {
    try {
      switch (sec.kind) {
        case "headline":
          results.push(await pushHeadline(browser, sec.copyText ?? sec.copy_text));
          break;
        case "about":
          results.push(await pushAbout(browser, sec.copyText ?? sec.copy_text));
          break;
        case "skills":
          results.push(await pushSkills(browser, sec.copyText ?? sec.copy_text));
          break;
        case "education": {
          const raw = sec.metadata ?? sec.copyText ?? sec.copy_text ?? "{}";
          const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
          await pushEducationEntry(browser, entry);
          results.push({ kind: "education", status: "ok", label: sec.label });
          break;
        }
        case "experience": {
          const raw = sec.metadata ?? sec.copyText ?? sec.copy_text;
          const entry = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
          const result = await pushExperienceEntry(browser, entry);
          results.push({ ...result, label: result.label ?? sec.label });
          break;
        }
        default:
          results.push({
            kind: sec.kind,
            status: "manual",
            copyText: sec.copyText ?? sec.copy_text,
            editUrl: sec.editUrl ?? sec.edit_url,
            label: sec.label,
          });
      }
    } catch (e) {
      results.push({ kind: sec.kind, status: "error", reason: String(e.message || e) });
    }
  }

  return { results };
}

async function cmdCathoPushProfile({ handle, sections = [] }) {
  const page = await activePage(handle);
  return cathoPushProfile(page, sections);
}

async function cmdGupyPushProfile({ handle, profile = {} }) {
  const page = await activePage(handle);
  return gupyPushProfile(page, profile);
}

async function cmdSearchGupyJobs({ handle, query = "", remote_only = false, max_pages }) {
  const page = await activePage(handle);
  return gupySearchJobs(page, { query, remoteOnly: remote_only, maxPages: max_pages });
}

async function cmdGupyStartLogin({ handle }) {
  const page = await activePage(handle);
  return gupyStartLogin(page);
}

async function cmdInfojobsPushProfile({ handle, profile = {} }) {
  const page = await activePage(handle);
  return infojobsPushProfile(page, profile);
}

async function cmdCapture({ handle, label = "manual" }) {
  const page = await activePage(handle);
  attachDiagnostics(page);
  return captureDom(page, label);
}

async function cmdCathoSearchJobs({
  handle,
  query = "",
  area_ids = [],
  work_models = [],
  last_days,
  max_pages,
}) {
  const page = await activePage(handle);
  return cathoSearchJobs(page, {
    query,
    areaIds: area_ids,
    workModels: work_models,
    lastDays: last_days,
    maxPages: max_pages,
  });
}

async function cmdCathoApply({ handle, offer_id, apply_url }) {
  const page = await activePage(handle);
  return cathoApply(page, { offerId: offer_id, applyUrl: apply_url });
}

async function cmdUpworkSearchJobs({ handle, query = "", sort = "recency", contractor_tier = [], job_type = [], max_pages }) {
  const page = await activePage(handle);
  return upworkSearchJobs(page, {
    query,
    sort,
    contractorTier: contractor_tier,
    jobType: job_type,
    maxPages: max_pages,
  });
}

async function cmdFreelas99SearchJobs({ handle, query = "", max_pages }) {
  const page = await activePage(handle);
  return freelas99SearchJobs(page, { query, maxPages: max_pages });
}

async function cmdInfojobsSearchJobs({
  handle,
  query = "",
  location = "",
  work_models = [],
  last_days,
  max_pages,
}) {
  const page = await activePage(handle);
  return infojobsSearchJobs(page, {
    query,
    location,
    workModels: work_models,
    lastDays: last_days,
    maxPages: max_pages,
  });
}

async function cmdInfojobsApply({ handle, offer_id, apply_url, answers }) {
  const page = await activePage(handle);
  return infojobsApply(page, { offerId: offer_id, applyUrl: apply_url, answers });
}

async function cmdAutoConnect({ handle, max_count = 200, delay_ms = 2000, max_refreshes = 25 }) {
  const { browser } = session(handle);
  const pages = browser.pages().filter((p) => !p.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

  // Two sources of Conectar buttons — checked in order as fallbacks. The received-invitations
  // manager ("Sugestões para você") is the reliable one; /mynetwork/grow/ ("People you may know")
  // usually shows Follow suggestions but sometimes surfaces Connect cards too, so it's a useful
  // second net before we conclude the batch is dry.
  const URLS = [
    "https://www.linkedin.com/mynetwork/invitation-manager/received/",
    "https://www.linkedin.com/mynetwork/grow/",
  ];
  const gotoNetwork = async (u) => {
    await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  };
  let urlIdx = 0;
  await gotoNetwork(URLS[urlIdx]);

  // The live button is `componentkey="ConnectButtonstate:invitation:urn:li:member:<id>_connect"`
  // (LO's 2026-08-03 sample), aria-label "Convidar <name> para se conectar", text span "Conectar".
  // Match the componentkey prefix + the PT/EN invite aria-label + the exact visible TEXT
  // "Conectar"/"Connect" — the text guard means we never fire a "Seguir"/Follow suggestion.
  const connectByAttr = page.locator(
    [
      'button[componentkey^="ConnectButton"]',
      'button[aria-label*="Convidar" i][aria-label*="conectar" i]',
      'button[aria-label*="Invite" i][aria-label*="connect" i]',
    ].join(", "),
  );
  const connectByText = page.getByRole("button", { name: /^\s*(Conectar|Connect)\s*$/ });
  const connectLoc = connectByAttr.or(connectByText);

  // Return the next Conectar button we haven't already tried this run, keyed by its UNIQUE
  // aria-label ("Convidar <name> para se conectar"). Deduping by person is what stops us from
  // re-clicking the same stuck card and inflating the count. Cards lazy-load, so scroll until a
  // fresh one shows or we hit bottom.
  const findConnect = async (attempted) => {
    for (let s = 0; s < 12; s++) {
      for (const btn of await connectLoc.all().catch(() => [])) {
        const key = await btn.getAttribute("aria-label").catch(() => null);
        if (key && !attempted.has(key)) return { btn, key };
      }
      const atBottom = await page.evaluate(() => {
        const before = window.scrollY;
        window.scrollBy(0, window.innerHeight);
        return window.scrollY === before;
      });
      await page.waitForTimeout(1_200);
      if (atBottom) return null;
    }
    return null;
  };

  const SEND_SEL = [
    'button[aria-label*="Send without a note" i]',
    'button[aria-label*="Enviar sem nota" i]',
    'button[aria-label*="Send now" i]',
    'button[aria-label*="Enviar agora" i]',
  ].join(", ");

  const LIMIT_STRINGS = [
    "weekly invitation limit",
    "limite semanal de convites",
    "more invitations next week",
    "mais convites na próxima semana",
    "more invitations on",
    "mais convites em",
  ];
  const atWeeklyLimit = () =>
    page.evaluate((strs) => {
      const text = (document.body.textContent ?? "").toLowerCase();
      return strs.some((s) => text.includes(s.toLowerCase()));
    }, LIMIT_STRINGS);

  const DISMISS_SEL = [
    'button[aria-label*="Dismiss" i]',
    'button[aria-label*="Fechar" i]',
    'button[aria-label="Close" i]',
    ".artdeco-modal__dismiss",
  ].join(", ");
  const dismissModal = () =>
    page.locator(DISMISS_SEL).first().click({ force: true }).catch(() => {});

  const attempted = new Set();
  let sent = 0;
  let refreshes = 0;
  let status = "ok";
  let stuck = 0;

  while (sent < max_count) {
    const next = await findConnect(attempted);

    // Current page is dry. First fall back to the OTHER network URL; only once both are exhausted
    // do we count a refresh round and reload from the top (LinkedIn rotates the suggestions each load).
    if (!next) {
      urlIdx += 1;
      if (urlIdx < URLS.length) {
        await gotoNetwork(URLS[urlIdx]);
        await page.waitForTimeout(1_000);
        continue;
      }
      if (refreshes >= max_refreshes) break;
      refreshes += 1;
      urlIdx = 0;
      attempted.clear(); // a fresh load may re-surface people; their sent cards no longer show Conectar
      await gotoNetwork(URLS[urlIdx]);
      await page.waitForTimeout(1_500);
      continue;
    }

    const { btn, key } = next;
    attempted.add(key); // never retry this person this round, sent or not

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1_000);

    if (await atWeeklyLimit()) {
      await dismissModal();
      status = "limit";
      // Real-time alert: LinkedIn's weekly connection limit was hit (e.g. "atingiu o limite semanal de
      // convites"). Push it immediately so the UI can surface the cap the moment it happens.
      writeLine({ event: "auto_connect_progress", sent, status: "limit" });
      break;
    }

    // Some cards pop an "add a note?" modal — send without one.
    const sendBtn = page.locator(SEND_SEL).first();
    if ((await sendBtn.count().catch(() => 0)) > 0) {
      await sendBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
    }

    // ONLY count a CONFIRMED invite: after a real send, this person's "Convidar … conectar" button
    // is gone (replaced by Pendente/Cancelar). If it's still there, a wall we can't satisfy blocked
    // it (verify-email / add-note / upsell) — dismiss it and DON'T count. This is the fix for
    // "displayed 20 but only sent 4": every non-confirmed click used to increment `sent`.
    await page.waitForTimeout(300);
    const stillOffering = await page.getByLabel(key, { exact: true }).count().catch(() => 1);
    if (stillOffering === 0) {
      sent += 1;
      stuck = 0;
      // SSE-style push: stream each confirmed invite so the UI counts up in real time instead of
      // waiting for the whole (up-to-200) call to return.
      writeLine({ event: "auto_connect_progress", sent, status: "ok" });
      if (delay_ms > 0 && sent < max_count) await page.waitForTimeout(delay_ms);
    } else {
      await dismissModal();
      await page.waitForTimeout(400);
      stuck += 1;
      // Keep going toward the weekly limit — don't quit on a few un-sendable cards. Only bail after a
      // long run of consecutive walls (LinkedIn silently gating every send ≈ an unshown limit).
      if (stuck >= 20) break;
    }
  }

  return { sent, status };
}

async function cmdGmailSend({ handle, to, subject, body, attachment_path }) {
  const { page } = session(handle);
  try {
    const composeUrl =
      "https://mail.google.com/mail/?view=cm&fs=1&tf=1" +
      `&to=${encodeURIComponent(to)}` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const landed = page.url();
    if (landed.includes("accounts.google.com") || landed.includes("ServiceLogin")) {
      return {
        sent: false,
        error:
          "Not logged into Gmail in the automation browser — log into Gmail once in this browser profile.",
      };
    }

    await page.waitForSelector('input[name="subjectbox"], div[aria-label="Corpo da mensagem"]', {
      timeout: 20_000,
    });

    if (attachment_path) {
      try {
        await page.setInputFiles('input[type="file"][name="Filedata"]', attachment_path);
      } catch {
      }
    }

    await page.waitForTimeout(attachment_path ? 4_000 : 1_500);

    await page
      .locator('[role="button"][aria-label^="Enviar" i], [role="button"][data-tooltip^="Enviar" i]')
      .first()
      .click({ timeout: 10_000 });

    await page.waitForTimeout(2_000);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

process.stderr.write("[worker] HireMeOps patchright worker ready\n");
