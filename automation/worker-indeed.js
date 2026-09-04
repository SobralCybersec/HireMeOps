import { session, indeedPopups, closeAll } from "./worker-context.js";
import { passCaptchaIfChallenged } from "./captcha.js";
import { classifyIndeedQuestion } from "./indeed-helpers.js";
import { humanClick, humanType, thinkTime } from "./human.js";

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


export async function cmdSearchIndeedJobs(config) {
  const {
    handle,
    keywords = "",
    location = "Brasil",
    page_index = 0,
    remote_only = false,
  } = config;
  const { page } = session(handle);
  const start = String(page_index * 15);
  const passes = remote_only
    ? [
        { q: keywords, l: location, limit: "15", start, sc: "0kf:attr(DSQF7);" },
        { q: keywords, l: "Remoto", radius: "25", limit: "15", start },
      ]
    : [{ q: keywords, l: location, limit: "15", start }];
  const byId = new Map();
  let hasNextPage = false;
  for (const paramObj of passes) {
    const { jobs, hasNext } = await scrapeIndeedPass(page, paramObj);
    for (const job of jobs) if (job.job_id && !byId.has(job.job_id)) byId.set(job.job_id, job);
    hasNextPage ||= hasNext;
  }
  return { jobs: [...byId.values()], has_next_page: hasNextPage };
}

async function scrapeIndeedPass(page, paramObj) {
  const url = `https://br.indeed.com/jobs?${new URLSearchParams(paramObj).toString()}`;
  await navigateIndeedSearch(page, url);
  await ensureIndeedChallenge(page);
  await page.waitForFunction(
    () => !!window.mosaic?.providerData?.["mosaic-provider-jobcards"] ||
      !!document.querySelector('a[data-jk], [data-testid="slider_item"], #mosaic-provider-jobcards'),
    { timeout: 15_000 },
  ).catch(() => {});

  const jobs = await readIndeedJobs(page);
  await assertIndeedResults(page, jobs);
  const hasNext = await page
    .locator('[data-testid="pagination-page-next"], [aria-label*="próxima" i], [aria-label*="next" i]')
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  return { jobs, hasNext };
}

async function navigateIndeedSearch(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (error) {
    throw new Error(
      `Indeed search navigation failed (the browser may have closed) — retry. [${String(error?.message ?? error)}]`,
    );
  }
}

async function ensureIndeedChallenge(page) {
  const challenge = await passCaptchaIfChallenged(page);
  if (challenge.challenged && !challenge.solved) {
    throw new Error(
      "Indeed is asking to verify you're human (Cloudflare). Solve the check in the Indeed window once, then retry — it'll stay cleared for a while.",
    );
  }
}

async function readIndeedJobs(page) {
  const globalResults = await page.evaluate(() => {
    const data = window.mosaic?.providerData?.["mosaic-provider-jobcards"];
    return data?.metaData?.mosaicProviderJobCardsModel?.results ?? data?.results ?? null;
  });
  const mosaicResults = globalResults?.length ? globalResults : await readMosaicScriptResults(page);
  if (Array.isArray(mosaicResults) && mosaicResults.length) {
    return mosaicResults.filter((job) => job?.jobkey).map(toIndeedJob);
  }
  return readIndeedDomCards(page);
}

async function readMosaicScriptResults(page) {
  const scripts = await page.evaluate(() =>
    [...document.scripts]
      .map((script) => script.textContent || "")
      .filter((text) => text.includes('providerData["mosaic-provider-jobcards"]=')),
  );
  for (const script of scripts) {
    const start = script.indexOf("{", script.indexOf('providerData["mosaic-provider-jobcards"]='));
    const json = start >= 0 ? extractJsonObject(script, start) : null;
    const results = json?.metaData?.mosaicProviderJobCardsModel?.results ?? json?.results;
    if (Array.isArray(results)) return results;
  }
  return null;
}

function extractJsonObject(text, start) {
  const end = findJsonEnd(text, start);
  if (end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return null;
  }
}

function findJsonEnd(text, start) {
  let state = { depth: 0, inString: false, escaped: false };
  for (let index = start; index < text.length; index += 1) {
    state = nextJsonState(state, text[index]);
    if (state.depth === 0) return index + 1;
  }
  return -1;
}

function nextJsonState(state, character) {
  if (state.escaped) return { ...state, escaped: false };
  if (character === "\\") return { ...state, escaped: true };
  if (character === '"') return { ...state, inString: !state.inString };
  if (state.inString) return state;
  const depth = state.depth + (character === "{" ? 1 : character === "}" ? -1 : 0);
  return { ...state, depth };
}

function toIndeedJob(job) {
  return {
    job_id: job.jobkey,
    title: (job.displayTitle ?? job.title ?? "").trim() || null,
    company: (job.company ?? job.truncatedCompany ?? "").trim() || null,
    location: (job.formattedLocation ?? job.jobLocationCity ?? "").trim() || null,
    apply_url: `https://br.indeed.com/viewjob?jk=${job.jobkey}`,
    is_easy_apply: job.indeedApplyEnabled === true || job.indeedApplyable === true,
  };
}

async function readIndeedDomCards(page) {
  return page.evaluate(() => {
    const card = (jk, title, company, location, easyApply) => ({
      job_id: jk,
      title: (title ?? "").trim() || null,
      company: (company ?? "").trim() || null,
      location: (location ?? "").trim() || null,
      apply_url: `https://br.indeed.com/viewjob?jk=${jk}`,
      is_easy_apply: easyApply === true,
    });
    return [...document.querySelectorAll('h3.jobTitle, [class*="jobTitle"]')].flatMap((heading) => {
      const link = heading.querySelector("a[data-jk]");
      if (!link) return [];
      const container = heading.closest('[data-testid="slider_item"], [class*="resultContent"], [class*="job_seen_beacon"]') ?? heading.parentElement?.parentElement?.parentElement;
      return [card(
        link.getAttribute("data-jk"),
        link.querySelector("span[id], span[title]")?.textContent ?? link.textContent,
        container?.querySelector('[data-testid="company-name"], [class*="companyName"]')?.textContent,
        container?.querySelector('[data-testid="text-location"], [class*="companyLocation"]')?.textContent,
        !!container?.querySelector('[data-testid="indeedApply"]'),
      )];
    });
  });
}

async function assertIndeedResults(page, jobs) {
  if (jobs.length > 0) return;
  const hasShell = await page.evaluate(() =>
    !!document.querySelector('#mosaic-provider-jobcards, a[data-jk], [data-testid="slider_item"]'),
  ).catch(() => false);
  if (!hasShell) {
    throw new Error(
      "Indeed returned no job data (likely a 'verify you're human' block). Open the Indeed window, solve any check, then retry.",
    );
  }
}

export async function cmdFillIndeedApply({ handle, url, answers = {} }) {
  const { browser, page } = session(handle);
  const form = await openIndeedApplication(browser, page, url);
  const result = await fillIndeedSteps(form, answers);
  indeedPopups.set(handle, form);
  return result;
}

async function openIndeedApplication(browser, page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await passCaptchaIfChallenged(page).catch(() => {});
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
  const form = (await popupPromise) ?? page;
  await form.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  await passCaptchaIfChallenged(form).catch(() => {});
  await assertIndeedFormMounted(form);
  return form;
}

async function assertIndeedFormMounted(form) {
  const mounted = await form
    .locator('button, input:not([type="hidden"]), textarea, select, [role="main"], form')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (mounted) return;
  const onSmartApply = /smartapply\.indeed\.com|indeedapply|\/form\/questions/i.test(form.url());
  throw new Error(
    onSmartApply
      ? "Indeed SmartApply opened but its form never rendered — likely a Cloudflare check or an expired single-use apply URL. Retry from the job page (headful) so a fresh apply link is minted."
      : "Indeed SmartApply did not open after clicking Apply — you may need to log in to Indeed (Login Indeed) or the job uses an external application.",
  );
}

async function fillIndeedSteps(form, answers) {
  let unanswered = [];
  let needsHuman = [];
  for (let step = 0; step < 20; step += 1) {
    await form.waitForTimeout(900);
    if (await isIndeedSubmitVisible(form)) return { parked: true, steps_taken: step, unanswered, needsHuman };
    const result = await fillIndeedStep(form, answers);
    if (result.unanswered.length) unanswered = result.unanswered;
    if (result.needsHuman.length) needsHuman = result.needsHuman;
    if (await clickIndeedContinue(form)) continue;
    if (await clickIndeedFallbackSubmit(form)) continue;
    break;
  }
  return { parked: true, steps_taken: 20, unanswered, needsHuman };
}

function isIndeedSubmitVisible(form) {
  return form.locator(INDEED_SUBMIT_SEL).isVisible({ timeout: 1_000 }).catch(() => false);
}

async function clickIndeedFallbackSubmit(form) {
  const button = form.locator('button[type="submit"]').first();
  if (!await button.isVisible({ timeout: 1_000 }).catch(() => false)) return false;
  await button.click();
  return true;
}

export async function cmdAnswerIndeedFreeText({ handle, answers = {} }) {
  const popup = indeedPopups.get(handle);
  if (!popup) throw new Error("no Indeed popup parked for this handle");

  let unanswered = [];
  let needsHuman = [];
  const MAX_STEPS = 10;
  for (let step = 0; step < MAX_STEPS; step++) {
    await popup.waitForTimeout(400);
    if (
      await popup
        .locator(INDEED_SUBMIT_SEL)
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
    ) {
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
      (await item
        .locator('[data-testid="safe-markup"]')
        .first()
        .textContent()
        .catch(() => "")) || ""
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
        const t = norm(
          await labels
            .nth(k)
            .textContent()
            .catch(() => ""),
        );
        if (t) out.push({ text: t, el: labels.nth(k) });
      }
      return out;
    };
    const provAns = provided[qLabel] || provided[qLabel.trim()];

    if ((await item.locator('input[type="radio"]').count()) > 0) {
      const opts = await readOpts("radio");
      const isYesNo =
        opts.length > 0 &&
        opts.length <= 3 &&
        opts.every((o) => YESRE.test(o.text) || NORE.test(o.text));

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
      await item
        .locator('[role="combobox"]')
        .first()
        .click()
        .catch(() => {});
      const search = item
        .locator('input[aria-controls^="Listbox"], input[placeholder*="esquis" i]')
        .first();
      if (await search.count()) {
        await search.fill("Brasil").catch(() => {});
        await popup.waitForTimeout(350);
      }
      const opt = item
        .locator('li[role="option"]', { hasText: /brasil \(br\)|^\s*brasil/i })
        .first();
      if (await opt.count()) await opt.click().catch(() => {});
      continue;
    }

    const textarea = item.locator("textarea").first();
    const input = item.locator('input[type="text"]').first();
    const field = (await textarea.count()) ? textarea : (await input.count()) ? input : null;
    if (!field) continue;

    if (await field.inputValue().catch(() => "")) continue;

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

export async function cmdConfirmIndeedSubmit({ handle }) {
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

export async function cmdRejectIndeedSubmit({ handle }) {
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

export async function cmdShutdown() {
  await closeAll();
  process.nextTick(() => process.exit(0));
  return {};
}

// Live Evidence Viewer: CDP-screencast the ACTIVE automation page (not a throwaway browser) and
// stream frames to Rust as unsolicited `screencast_frame` events (no `id`), which the Rust reader
// routes to the preview channel. Uses only the Page domain over a fresh CDP session — no
// Runtime.enable, so it doesn't reintroduce the patchright stealth leak.
