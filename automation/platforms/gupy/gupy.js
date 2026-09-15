// Gupy candidate resume ("My resume" / detached-curriculum) auto-fill + job-search scraper.
// Key: gupyPushProfile — entry point, ensures login then fills Experience/Skills/LinkedIn
// Key: ensureGupyLoggedIn / clickGupyGoogle — Google SSO popup flow when the session dropped
// Key: fillExperiences / fillSkills / fillLinkedin — per-section fillers, each ends in saveSection
// Key: selectCombo / commitComboOption — react-aria ComboBox driver (virtual-focus, ArrowDown+Enter)
// Key: gupySearchJobs — portal.gupy.io scraper, drives MUI pagination via scrapeGupyPage

import { parseGupyDate, gupyActivities, skillKey } from "./gupy-helpers.js";
import { perfEnabled, nowMs, logSpan } from "./perf.js";
import { captureDom } from "./capture.js";

const GUPY_LOGIN_RE = /\/candidates\/(sign-?in|login)/i;
const GUPY_RESUME_URL = "https://login.gupy.io/candidates/curriculum";

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function gupyPushProfile(page, profile = {}) {
  const { experiences = [], skills = [], linkedinUrl = "", url } = profile;

  await gotoGupyResume(page, url);
  if (await isGupySignin(page)) {
    const ok = await ensureGupyLoggedIn(page, url);
    if (!ok) {
      return {
        results: [
          {
            kind: "all",
            status: "error",
            reason: "Gupy login not completed — sign in with Google in the window, then retry.",
          },
        ],
      };
    }
  }

  const results = [];
  const run = async (section, fn) => {
    const t = perfEnabled() ? nowMs() : 0;
    try {
      const r = await fn();
      results.push(...(Array.isArray(r) ? r : [r]));
    } catch (e) {
      results.push({ kind: section, status: "error", reason: String(e?.message ?? e) });
    }
    if (perfEnabled()) logSpan("gupy_section", { section, ms: +(nowMs() - t).toFixed(1) });
  };

  const sections = [
    ["experience", experiences.length, () => fillExperiences(page, experiences)],
    ["skills", skills.length, () => fillSkills(page, skills)],
    ["personal", linkedinUrl, () => fillLinkedin(page, linkedinUrl)],
  ];
  for (const [section, wanted, fn] of sections) {
    if (!wanted) continue;
    await run(section, fn);
    if (await isGupySignin(page)) {
      results.push({
        kind: "all",
        status: "error",
        reason:
          "Gupy dropped the session when saving (bounced to sign-in) — the save didn't persist. " +
          "Log into Google ONCE by hand in this browser with 'stay signed in', so the post-save " +
          "reload re-authenticates silently, then retry the fill.",
      });
      break;
    }
  }

  return { results };
}

async function isGupySignin(page) {
  if (GUPY_LOGIN_RE.test(page.url())) return true;
  return page
    .locator('#googleSignInButton, [data-testid="googleSignInButton"], #button-signin')
    .first()
    .isVisible()
    .catch(() => false);
}

async function dismissGupyCookieBanner(page) {
  const accept = page
    .locator('#dm876A, [aria-label="Accept Cookies"], .cc-dismiss, .cc-close')
    .first();
  if (await accept.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await accept.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function clickGupyGoogle(page) {
  await dismissGupyCookieBanner(page);
  const google = page.locator('#googleSignInButton, [data-testid="googleSignInButton"]').first();
  const visible = await google
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return null;
  await google.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const popupPromise = page.waitForEvent("popup", { timeout: 8_000 }).catch(() => null);
  const clicked = await google
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) await google.click({ force: true, timeout: 5_000 }).catch(() => {});
  return popupPromise;
}

export async function gupyStartLogin(page) {
  await page.goto("https://login.gupy.io/candidates/signin", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await clickGupyGoogle(page);
  return {};
}

async function ensureGupyLoggedIn(page, url) {
  const popupP = await clickGupyGoogle(page);
  const popup = popupP ? await popupP : null;
  if (popup) {
    await popup.waitForEvent("close", { timeout: 180_000 }).catch(() => {});
  }
  const back = await page
    .waitForURL(
      (u) => {
        const s = u.toString();
        return /^https?:\/\/(?:[^/]+\.)?gupy\.io\/candidates\//i.test(s) && !/\/candidates\/(sign-?in|login)(?:[/?#]|$)/i.test(s);
      },
      { timeout: 180_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!back) return false;
  await page.goto(url || GUPY_RESUME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  return page
    .waitForSelector("#experienceInfo, .detached-curriculum", { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
}

const GUPY_SEARCH_BASE = "https://portal.gupy.io/job-search/term=";

function gupyFirstJobId(page) {
  return page.evaluate(() => {
    const a = document.querySelector("#job-listing-results li a[href*='/job/']");
    const m = a && a.href.match(/\/job\/([^/?]+)/);
    return m ? m[1] : null;
  });
}

function scrapeGupyPage(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("#job-listing-results li"));
    return cards.flatMap((li) => {
      const a = li.querySelector('a[href*="/job/"]');
      if (!a) return [];
      const applyUrl = a.href;
      const jobId = (applyUrl.match(/\/job\/([^/?]+)/) || [])[1] || null;
      const title = li.querySelector("h3")?.textContent?.trim() || null;
      const company = a.querySelector("p")?.textContent?.trim() || null;
      const location =
        li.querySelector('[data-testid="job-location"]')?.textContent?.trim() || null;
      const chips = Array.from(li.querySelectorAll('[data-testid="listing-details"] span'))
        .map((s) => s.textContent?.trim())
        .filter(Boolean);
      return [
        {
          job_id: jobId,
          title,
          company,
          location,
          apply_url: applyUrl,
          is_easy_apply: true,
          description: chips.join(" · "),
        },
      ];
    });
  });
}

export async function gupySearchJobs(page, { query = "", remoteOnly = false, maxPages = 3 } = {}) {
  const base = GUPY_SEARCH_BASE + encodeURIComponent(query) + (remoteOnly ? "&workplaceTypes[]=remote" : "");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));
  const result = await collectGupyPages(page, cap);
  return { jobs: result.jobs, has_next_page: result.hasNext };
}

async function collectGupyPages(page, cap) {
  const seen = new Set();
  const jobs = [];
  let hasNext = false;
  for (let pageNumber = 1; pageNumber <= cap; pageNumber += 1) {
    await page.waitForSelector("#job-listing-results li a[href*='/job/']", { timeout: 12_000 }).catch(() => {});
    const pageJobs = await scrapeGupyPage(page);
    const added = addGupyJobs(jobs, seen, pageJobs);
    const next = await gupyNextPage(page, pageNumber);
    hasNext = next.hasNext;
    if (pageNumber === cap || !hasNext || added === 0) break;
    await advanceGupyPage(page, next.button);
  }
  return { jobs, hasNext };
}

function addGupyJobs(jobs, seen, pageJobs) {
  let added = 0;
  for (const job of pageJobs) {
    if (job.job_id && seen.has(job.job_id)) continue;
    if (job.job_id) seen.add(job.job_id);
    jobs.push(job);
    added += 1;
  }
  return added;
}

async function gupyNextPage(page, pageNumber) {
  const numbered = page.locator(`button[aria-label="Page ${pageNumber + 1}"]`).first();
  const arrow = page.locator('button[aria-label="Next page"]').first();
  const numberedReady = (await numbered.count()) > 0 && await numbered.isEnabled().catch(() => false);
  const arrowReady = (await arrow.count()) > 0 && await arrow.isEnabled().catch(() => false);
  return { hasNext: numberedReady || arrowReady, button: numberedReady ? numbered : arrow };
}

async function advanceGupyPage(page, button) {
  const before = await gupyFirstJobId(page);
  await button.click().catch(() => {});
  await page.waitForFunction(
    (previous) => {
      const link = document.querySelector("#job-listing-results li a[href*='/job/']");
      const match = link && link.href.match(/\/job\/([^/?]+)/);
      return match && match[1] !== previous;
    },
    before,
    { timeout: 12_000 },
  ).catch(() => {});
}

async function gotoGupyResume(page, url) {
  const onResume = await page
    .locator(".detached-curriculum, #experienceInfo")
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
  if (!onResume) {
    await page.goto(url || GUPY_RESUME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  await page.waitForSelector("#experienceInfo, .detached-curriculum", { timeout: 10_000 }).catch(() => {});
}

async function ensureExpanded(page, sectionId) {
  const header = page.locator(`#${sectionId} [role="button"][aria-expanded]`).first();
  if (!(await header.count())) return false;
  const isOpen = async () => (await header.getAttribute("aria-expanded").catch(() => null)) === "true";
  if (!(await isOpen())) await header.click().catch(() => {});

  const content = page.locator(`#${sectionId} .curriculum-section__content`).first();
  const opened = await content.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  return opened && (await isOpen());
}

async function selectCombo(page, input, value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (!(await input.count())) return false;
  if (await input.isDisabled().catch(() => false)) return false;
  await input.click().catch(() => {});
  await input.fill("").catch(() => {});
  await input.pressSequentially(v, { delay: 40 }).catch(() => {});
  await page.waitForTimeout(300);
  return commitComboOption(page, input, v);
}

async function commitComboOption(page, input, v) {
  const listId = await comboListId(page, input);
  if (!listId) return false;

  const target = page.locator(`[id="${listId}"] [role="option"]`, {
    hasText: new RegExp(`^\\s*${esc(v)}\\s*$`, "i"),
  }).first();
  if (!(await target.isVisible({ timeout: 1_500 }).catch(() => false))) return false;
  const targetId = await target.getAttribute("id").catch(() => null);
  if (!targetId) return false;

  await focusComboOption(input, targetId);
  await input.press("Enter").catch(() => {});
  return true;
}

async function comboListId(page, input) {
  const current = await input.getAttribute("aria-controls").catch(() => null);
  if (current) return current;
  await page.waitForTimeout(250);
  return input.getAttribute("aria-controls").catch(() => null);
}

async function focusComboOption(input, targetId) {
  for (let i = 0; i < 40; i += 1) {
    if ((await input.getAttribute("aria-activedescendant").catch(() => null)) === targetId) return;
    await input.press("ArrowDown").catch(() => {});
  }
}

async function fillExperiences(page, experiences) {
  await ensureExpanded(page, "experienceInfo");
  await page.locator('[id^="professional-experience-"], .add-new-item [role="button"]').first()
    .waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
  const results = [];
  let filledAny = false;
  for (const experience of experiences) {
    const result = await fillExperience(page, experience);
    if (!result) continue;
    results.push(result);
    filledAny ||= result.status === "ok";
  }
  if (filledAny) await saveSection(page, "experienceInfo");
  return results;
}

async function fillExperience(page, experience) {
  const { role, company, label } = experienceDetails(experience);
  if (!role) return null;
  if (await experiencePresent(page, role, company)) {
    return { kind: "experience", status: "skipped", label, reason: "Already on Gupy resume" };
  }
  return createExperience(page, experience, { role, company, label });
}

function experienceDetails(experience) {
  const role = String(experience.role ?? experience.title ?? "").trim();
  const company = String(experience.company ?? experience.organization ?? "").trim();
  return { role, company, label: company ? `${role} @ ${company}` : role };
}

async function createExperience(page, experience, details) {
  const block = await addProfessionalBlock(page);
  if (!block) {
    return { kind: "experience", status: "skipped", label: details.label, reason: "No experience block to fill" };
  }
  await fillExperienceBlock(page, block, {
    role: details.role,
    company: details.company,
    dates: experience.dates,
    bullets: experience.bullets,
  });
  return { kind: "experience", status: "ok", label: details.label };
}

async function fillExperienceBlock(page, block, { role, company, dates, bullets }) {
  await block.locator('input[name="companyName"]').first().fill(company).catch(() => {});
  await block.locator('input[name="role"]').first().fill(role).catch(() => {});
  await fillExperienceDates(page, block, dates);
  const activities = gupyActivities(bullets);
  if (activities) await block.locator('textarea[name="activitiesPerformed"]').first().fill(activities).catch(() => {});
}

async function fillExperienceDates(page, block, dates) {
  const { startMonth, startYear, endMonth, endYear, current } = parseGupyDate(dates);
  const monthOr = (month, year) => month || (year ? "January" : "");
  const dateBlocks = block.locator(".monthYearSelect");
  const start = dateBlocks.nth(0);
  await selectCombo(page, start.locator('input[name="monthValue"]'), monthOr(startMonth, startYear));
  await selectCombo(page, start.locator('input[name="yearValue"]'), startYear);
  if (current) {
    const checkbox = block.locator('input[name="isCurrentJob"]').first();
    if (!(await checkbox.isChecked().catch(() => false))) {
      await block.locator(".current-job label").first().click({ force: true }).catch(() => {});
    }
    return;
  }
  const end = dateBlocks.nth(1);
  await selectCombo(page, end.locator('input[name="monthValue"]'), monthOr(endMonth, endYear));
  await selectCombo(page, end.locator('input[name="yearValue"]'), endYear);
}

async function experiencePresent(page, role, company) {
  const r = role.trim().toLowerCase();
  const c = (company || "").trim().toLowerCase();
  if (!r) return false;
  const rows = await page
    .locator('[id^="professional-experience-"]')
    .evaluateAll((blocks) =>
      blocks.map((b) => ({
        role: (b.querySelector('input[name="role"]')?.value || "").trim().toLowerCase(),
        company: (b.querySelector('input[name="companyName"]')?.value || "").trim().toLowerCase(),
      })),
    )
    .catch(() => []);
  const like = (a, b) => !!a && !!b && a.length > 3 && b.length > 3 && (a === b || a.includes(b) || b.includes(a));
  return rows.some((row) => (c ? like(row.role, r) && like(row.company, c) : like(row.role, r)));
}

async function addProfessionalBlock(page) {
  const blocks = page.locator('[id^="professional-experience-"]');
  const before = await blocks.count().catch(() => 0);
  const emptyBlock = await findEmptyProfessionalBlock(blocks, before);
  if (emptyBlock) return emptyBlock;

  return appendProfessionalBlock(page, blocks, before);
}

async function findEmptyProfessionalBlock(blocks, before) {
  if (before === 0) return null;
  const first = blocks.first();
  const firstRole = await first.locator('input[name="role"]').first().inputValue().catch(() => "");
  return firstRole.trim() ? null : first;
}

async function appendProfessionalBlock(page, blocks, before) {
  const add = page
    .locator('.add-new-item [role="button"]', { hasText: /Add another professional experience|Adicionar outra experi/i })
    .first();
  if (!(await add.count())) return null;
  await add.scrollIntoViewIfNeeded().catch(() => {});
  await add.click().catch(() => {});
  await page.waitForFunction(
    (n) => document.querySelectorAll('[id^="professional-experience-"]').length > n,
    before,
    { timeout: 5_000 },
  ).catch(() => {});
  const after = await blocks.count().catch(() => before);
  if (after <= before) return null;
  return blocks.nth(after - 1);
}

async function fillSkills(page, skills) {
  if (!(await ensureExpanded(page, "skills"))) {
    return { kind: "skills", status: "manual", reason: "Skills section wouldn't open" };
  }
  const existing = new Set(
    await page
      .locator('[data-testid="candidate-skill"] .sc-hmdomO, [data-testid="candidate-skill"]')
      .allTextContents()
      .then((xs) => xs.map(skillKey))
      .catch(() => []),
  );

  let added = 0;
  const pendingSkills = skills
    .map((raw) => String(raw ?? "").trim())
    .filter((skill) => skill && !existing.has(skillKey(skill)));

  for (const skill of pendingSkills) {
    if (existing.size + added >= 30) break;
    if (await addGupySkill(page, skill)) added += 1;
  }

  if (added) await saveSection(page, "skills");
  return { kind: "skills", status: added ? "ok" : "skipped", label: `${added} skill(s) added` };
}

async function addGupySkill(page, skill) {
  const box = page.locator("#skills-search-autocomplete");
  await box.click().catch(() => {});
  await box.fill("").catch(() => {});
  await box.pressSequentially(skill, { delay: 40 }).catch(() => {});
  await page.waitForTimeout(350);
  if (!await commitComboOption(page, box, skill)) return false;
  const addBtn = page.getByRole("button", { name: /^(Add|Adicionar)$/ }).first();
  if (!await waitForGupyAddButton(page, addBtn)) return false;
  await addBtn.click().catch(() => {});
  await page.waitForTimeout(250);
  return true;
}

async function waitForGupyAddButton(page, addBtn) {
  for (let i = 0; i < 8; i += 1) {
    if (await addBtn.isEnabled().catch(() => false)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function fillLinkedin(page, linkedinUrl) {
  await ensureExpanded(page, "personalInfo");
  const input = page.locator("#linkedinProfileUrl");
  if (!(await input.count())) {
    return { kind: "personal", status: "manual", reason: "LinkedIn field not found" };
  }
  await input.fill(String(linkedinUrl)).catch(() => {});
  await saveSection(page, "personalInfo");
  return { kind: "personal", status: "ok", label: "LinkedIn URL" };
}

async function saveSection(page, sectionId) {
  const save = page
    .locator(`#${sectionId} .curriculum-section__save button`)
    .filter({ hasText: /Save and continue|Save|Salvar/i })
    .last();
  if (!(await save.count())) return { saved: false, bounced: false };
  await save.scrollIntoViewIfNeeded().catch(() => {});

  await captureDom(page, `gupy_presave_${sectionId}`).catch(() => {});

  const collected = [];
  const onResp = (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.request().method()) && /^https?:\/\/(?:[^/]+\.)?gupy\.io(?:[/:?#]|$)/i.test(r.url())) collected.push(r);
  };
  page.on("response", onResp);
  await save.click().catch(() => {});
  await page.waitForTimeout(3_000);
  page.off("response", onResp);

  const responses = [];
  for (const r of collected) {
    responses.push({
      url: r.url(),
      method: r.request().method(),
      status: r.status(),
      body: await r.text().then((t) => t.slice(0, 1500)).catch(() => null),
    });
  }
  const failed = responses.filter((r) => r.status >= 400);
  const bounced = await isGupySignin(page);

  await captureDom(page, `gupy_postsave_${sectionId}`, {
    save: { bounced, failed, responses },
  }).catch(() => {});

  return { saved: !bounced && failed.length === 0, bounced, failed };
}
