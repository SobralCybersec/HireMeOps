import { chromium } from "patchright";
import { baseLaunchOptions } from "./browser-launch.js";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { descendantPids, logSpan } from "./perf.js";
import { sessions, indeedPopups, session } from "./worker-context.js";
import { handleResumeStep, fillStep } from "./worker-profile.js";
import { attachDiagnostics, attachNetworkCapture } from "./capture.js";
import { passCaptchaOnPage, captchaSolvingEnabled } from "./captcha.js";
import { humanClick, thinkTime } from "./human.js";

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
      } catch {}
    }
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {}
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


export function resolveChromiumExec() {
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

export async function reclaimProfileDir(userDataDir) {
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
    const proc = spawn("Xvfb", [display, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], {
      stdio: "ignore",
      detached: true,
    });
    proc.on("error", (e) =>
      reject(
        new Error(`Xvfb launch failed (install it: 'pacman -S xorg-server-xvfb'): ${e.message}`),
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

export async function cmdOpen({ user_data_dir = "", extensions = [], headless = true, hidden = false }) {
  const handle = randomUUID();

  await reclaimProfileDir(user_data_dir);
  const launch = await createLaunchConfig({ headless, hidden, extensions });

  const resolvedExec = resolveChromiumExec();

  const browser = await chromium.launchPersistentContext(user_data_dir, {
    ...baseLaunchOptions({ headless: launch.runHeadless, executablePath: resolvedExec, extraArgs: launch.extraArgs }),
    ...(launch.launchEnv ? { env: launch.launchEnv } : {}),
  });

  const page = browser.pages()[0] ?? (await browser.newPage());

  await reportHiddenRenderer(page, launch.launchEnv, hidden);

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

async function createLaunchConfig({ headless, hidden, extensions }) {
  const extraArgs = hidden
    ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--enable-unsafe-webgl", "--ignore-gpu-blocklist", "--enable-gpu"]
    : [];
  const launchEnv = hidden ? await hiddenLaunchEnv(extraArgs) : undefined;
  addExtensionArgs(extraArgs, extensions);
  return { runHeadless: hidden ? false : headless, extraArgs, launchEnv };
}

async function hiddenLaunchEnv(extraArgs) {
  try {
    return { ...process.env, DISPLAY: await ensureHiddenDisplay() };
  } catch (error) {
    process.stderr.write(`worker: ${error.message} — opening a VISIBLE window instead\n`);
    return undefined;
  }
}

function addExtensionArgs(extraArgs, extensions) {
  const validExtensions = extensions.filter((extensionPath) => {
    const valid = existsSync(path.join(extensionPath, "manifest.json"));
    if (!valid) process.stderr.write(`worker: skipping invalid extension path (no manifest.json): ${extensionPath}\n`);
    return valid;
  });
  if (validExtensions.length === 0) return;
  const extPaths = validExtensions.join(",");
  extraArgs.push(`--disable-extensions-except=${extPaths}`, `--load-extension=${extPaths}`);
}

async function reportHiddenRenderer(page, launchEnv, hidden) {
  if (!hidden || !launchEnv) return;
  try {
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    const software = /swiftshader|llvmpipe|software/i.test(renderer);
    process.stderr.write(`worker: hidden GPU renderer = ${renderer}${software ? " [SOFTWARE — Akamai may block; GPU didn't attach under Xvfb]\n" : " [hardware ok]\n"}`);
  } catch {}
}

export async function cmdNavigate({ handle, url }) {
  const { page } = session(handle);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return {};
}

export async function cmdProbe({ handle }) {
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

export async function cmdSolveCaptcha({ handle }) {
  const { page } = session(handle);
  return passCaptchaOnPage(page);
}

export async function cmdFillEasyApply({ handle, answers = [], cover_letter, cv_path }) {
  const { page } = session(handle);
  await openEasyApply(page);

  const unansweredByLabel = new Map();
  const MAX_STEPS = 15;
  let resumeDone = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!resumeDone) resumeDone = await handleResumeStep(page, cv_path);
    const stepResult = await fillEasyApplyStep(page, answers, cover_letter);
    for (const question of stepResult.unanswered) {
      if (question.label && !unansweredByLabel.has(question.label)) unansweredByLabel.set(question.label, question);
    }
    if (!stepResult.hasNext) break;

    await thinkTime();
    await humanClick(page, stepResult.nextBtn);
    await page.waitForTimeout(600);
    if (await hasEasyApplyError(page)) break;
  }

  return { unanswered: [...unansweredByLabel.values()] };
}

async function openEasyApply(page) {
  try {
    const btn = page.locator(LI_EASY_APPLY_SEL).filter({ visible: true }).first();
    if (!await btn.isVisible({ timeout: 3_000 }).catch(() => false)) return;
    await humanClick(page, btn);
    await page.waitForSelector(
      '.jobs-easy-apply-content, [data-test-modal-id="easy-apply-modal"]',
      { timeout: 10_000 },
    );
  } catch {}
}

async function fillEasyApplyStep(page, answers, coverLetter) {
  const unanswered = (await fillStep(page, answers, coverLetter)) || [];
  const modal = page.locator(LI_MODAL_SEL).last();
  const root = (await modal.count().catch(() => 0)) > 0 ? modal : page;
  const nextBtn = root.locator(LI_NEXT_SEL).first();
  return {
    unanswered,
    nextBtn,
    hasNext: await nextBtn.isVisible({ timeout: 1_500 }).catch(() => false)
  };
}

function hasEasyApplyError(page) {
  return page
    .locator([
      ".artdeco-inline-feedback--error",
      "[data-test-form-element-error-messages]",
      ".fb-dash-form-element__error-field",
      ".fb-dash-form-element__error-text",
    ].join(","))
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

export async function cmdAnswerEasyApply({ handle, questions = {} }) {
  const { page } = session(handle);
  const answers = Object.entries(questions).map(([label, value]) => ({
    label,
    value: String(value),
  }));
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

export async function cmdConfirmSubmit({ handle }) {
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

export async function cmdRejectSubmit({ handle }) {
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
  } catch {}
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
  } catch {}
  return {};
}

export async function cmdScreenshot({ handle, path: filePath, phone = true }) {
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

export async function cmdDomSnapshot({ handle }) {
  const { page } = session(handle);
  const dom = await page.content();
  return { dom };
}

export async function cmdExtractHr({ handle }) {
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
