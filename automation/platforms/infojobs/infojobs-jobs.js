// InfoJobs Brazil job search; scrapes empregos.aspx results into JobCards, applies via CANDIDATAR-ME.
// Key: buildInfojobsSearchUrl / infojobsWorkMode / infojobsAntiguedad — pure URL/facet helpers
// Key: infojobsSearchJobs — page 1 DOM scrape + deeper pages via GetVacancyListFragment XHR, optional enrich
// Key: infojobsApply — per-offer explicit apply click, never batch-auto

export function infojobsWorkMode(workModels = []) {
  const m = (Array.isArray(workModels) ? workModels : []).map((s) =>
    String(s).toLowerCase().replace(/[^a-z]/g, ""),
  );
  if (m.some((s) => s.includes("remote") || s.includes("home"))) return 2;
  if (m.some((s) => s.includes("hybrid") || s.includes("hibrid"))) return 3;
  if (m.some((s) => s.includes("onsite") || s.includes("presen"))) return 1;
  return null;
}

export function infojobsAntiguedad(lastDays) {
  if (lastDays == null || `${lastDays}` === "") return null;
  const d = Number(lastDays);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d <= 1) return 1;
  if (d <= 3) return 2;
  if (d <= 7) return 3;
  if (d <= 15) return 4;
  return 5;
}

export function buildInfojobsSearchUrl({ query = "", location = "", workModels = [], lastDays } = {}) {
  const parts = [];
  if (query) parts.push(`palabra=${encodeURIComponent(query)}`);
  if (location != null && `${location}` !== "") parts.push(`poblacion=${encodeURIComponent(location)}`);
  const idw = infojobsWorkMode(workModels);
  if (idw != null) parts.push(`idw=${idw}`);
  const anti = infojobsAntiguedad(lastDays);
  if (anti != null) parts.push(`Antiguedad=${anti}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `https://www.infojobs.com.br/empregos.aspx${qs}`;
}

async function extractInfojobsCards(page, html = null) {
  return page.evaluate((markup) => {
    const origin = "https://www.infojobs.com.br";
    const root = markup ? new DOMParser().parseFromString(markup, "text/html") : document;
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const safeUrl = (href) => {
      try {
        return new URL(href, origin).href;
      } catch {
        return null;
      }
    };
    const readLocation = (card) => {
      const text = card.querySelector(".mb-8")?.textContent;
      return text ? clean(text).replace(/,?\s*a\s*[\d.,]+\s*km de você\.?/i, "").trim() || null : null;
    };
    const readDescription = (card, salary) => {
      const mediums = card.querySelectorAll(".text-medium");
      const teaser = mediums.length ? clean(mediums[mediums.length - 1].textContent) : "";
      const bits = [];
      if (salary && !/combinar/i.test(salary)) bits.push(`Salário: ${salary}`);
      if (card.querySelector(".icon-user-home")) bits.push("Home office");
      return [bits.join(" · "), teaser].filter(Boolean).join("\n") || null;
    };
    const buildCard = ({ card, jobId, applyUrl }) => {
      const compScope = card.querySelector(".d-flex.align-items-baseline");
      const company = clean(compScope?.querySelector(".text-body")?.textContent) || null;
      const salary = clean(card.querySelector(".icon-money")?.closest("div")?.textContent) || null;
      return {
        job_id: jobId,
        title: clean(card.querySelector(".js_vacancyTitle")?.textContent) || null,
        company,
        location: readLocation(card),
        apply_url: applyUrl,
        is_easy_apply: true,
        description: readDescription(card, salary),
      };
    };
    const readCard = (card) => {
      const jobId = card.getAttribute("data-id");
      const href =
        card.getAttribute("data-href") || card.querySelector('a[href*="/vaga-"]')?.getAttribute("href");
      if (!jobId || !href) return [];
      const applyUrl = safeUrl(href);
      if (!applyUrl) return [];
      return [buildCard({ card, jobId, applyUrl })];
    };
    return Array.from(root.querySelectorAll('div[id^="vacancy"][data-id]')).flatMap(readCard);
  }, html);
}

async function fetchInfojobsFragment(page, url) {
  return page.evaluate(async (fragUrl) => {
    try {
      const response = await fetch(fragUrl, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "include",
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { html: data.listFragmentHTML || "", eof: !!data.eof };
    } catch {
      return null;
    }
  }, url);
}

async function enrichInfojobsJob(page, job) {
  if (!job.apply_url) return;
  const full = await page
    .evaluate(async (url) => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) return "";
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        return (doc.querySelector(".js_vacancyDataPanels .white-space-pre-line, .white-space-pre-line")?.textContent || "")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
      } catch {
        return "";
      }
    }, job.apply_url)
    .catch(() => "");
  if (full.length <= (job.description || "").length) return;
  const firstLine = (job.description || "").split("\n")[0];
  job.description = /Salário|Home office/.test(firstLine) ? `${firstLine}\n${full}` : full;
}

async function enrichInfojobsJobs(page, jobs) {
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map((job) => enrichInfojobsJob(page, job)));
  }
}

function addInfojobsJobs(jobs, seen, cards) {
  for (const card of cards) {
    if (seen.has(card.job_id)) continue;
    seen.add(card.job_id);
    jobs.push(card);
  }
}

async function collectInfojobsPages(page, { base, lastPage, jobs, seen }) {
  let eof = jobs.length === 0;
  for (let p = 2; p <= lastPage && !eof; p++) {
    const sep = base.includes("?") ? "&" : "?";
    const listUrl = `${base}${sep}page=${p}`;
    const fragment = await fetchInfojobsFragment(
      page,
      `https://www.infojobs.com.br/mf-publicarea/VacancyList/GetVacancyListFragment?url=${encodeURIComponent(listUrl)}`,
    );
    if (!fragment) break;
    const cards = await extractInfojobsCards(page, fragment.html);
    addInfojobsJobs(jobs, seen, cards);
    eof = fragment.eof || cards.length === 0;
  }
  return eof;
}

export async function infojobsSearchJobs(page, opts = {}) {
  const { maxPages = 3, enrichDescriptions = true, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(20, Number(maxPages) || 1));

  await page.goto(buildInfojobsSearchUrl(urlOpts), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page
    .waitForSelector('div[id^="vacancy"][data-id], .js_rowCard', { timeout: 15_000 })
    .catch(() => {});

  const jobs = await extractInfojobsCards(page);
  const seen = new Set(jobs.map((job) => job.job_id));
  const totalText = await page.locator("#resumeVacancies .text-medium, #resumeVacancies span").first().textContent().catch(() => "");
  const total = parseInt(String(totalText || "").replace(/\D/g, ""), 10) || 0;
  const lastPage = total ? Math.min(cap, Math.ceil(total / 20)) : cap;
  const base = page.url().replace(/([?&])page=\d+/i, "$1").replace(/[?&]$/, "");
  const eof = await collectInfojobsPages(page, { base, lastPage, jobs, seen });
  if (enrichDescriptions && jobs.length) await enrichInfojobsJobs(page, jobs);

  return { jobs, has_next_page: !eof };
}

const INFOJOBS_LOGIN_RE = /\/(login|entrar|acesso|account\/login|candidate\/login)/i;

const INFOJOBS_KILLER_SEL = "#KillerQuestionsForm, #divKillerQuestionsForm";
const INFOJOBS_SUCCESS_SEL = "#Toast.toast-success, .toast-success.show, [class*='match-']";

// InfoJobs gates many applications behind a "killer questions" form (SIM/NÃO radios +
// open-answer textareas) that appears in the detail panel AFTER clicking CANDIDATAR-ME.
// We reuse the same AI text-answering the LinkedIn Easy Apply flow uses: the worker EXTRACTS
// the questions, Rust's generate_form_answers drafts them from the CV, then we fill + submit.
// Each label div (`.t4.font-weight-bold`) is followed by a `.mb-32` block holding either the
// radios or the textarea for that question.
export function extractInfojobsKillerQuestions(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const lab of Array.from(root.querySelectorAll(".t4.font-weight-bold"))) {
      const label = clean(lab.textContent);
      if (!label) continue;
      const body = lab.nextElementSibling;
      if (!body) continue;
      const radios = Array.from(body.querySelectorAll('input[type="radio"]'));
      const textarea = body.querySelector("textarea");
      if (radios.length) {
        out.push({
          label,
          kind: "radio",
          options: radios.map((r) => ({ value: clean(r.value), id: r.id })),
        });
      } else if (textarea) {
        out.push({
          label,
          kind: "text",
          name: textarea.getAttribute("name") || "",
          maxLength: Number(textarea.getAttribute("maxlength")) || 2000,
        });
      }
    }
    return out;
  }, INFOJOBS_KILLER_SEL);
}

// Shape the extracted questions for Rust's generate_form_answers (it reads `label`, `options`
// as plain strings, and `maxLength`). Radios expose their option texts so the AI (or the
// yes/no fast-path) picks one VERBATIM; textareas expose their length cap.
function toAnswerable(questions) {
  return questions.map((q) =>
    q.kind === "radio"
      ? { label: q.label, options: q.options.map((o) => o.value) }
      : { label: q.label, maxLength: q.maxLength },
  );
}

const INFOJOBS_YES = new Set(["sim", "yes", "s", "y", "true", "verdadeiro"]);
const INFOJOBS_NO = new Set(["não", "nao", "no", "n", "false", "falso"]);

const normalizeInfojobsAnswer = (value) => String(value ?? "").trim().toLowerCase();

function sameInfojobsBoolean(left, right) {
  return (
    (INFOJOBS_YES.has(left) && INFOJOBS_YES.has(right)) ||
    (INFOJOBS_NO.has(left) && INFOJOBS_NO.has(right))
  );
}

function findInfojobsOption(question, answer) {
  return (
    question.options.find((option) => normalizeInfojobsAnswer(option.value) === answer) ||
    question.options.find((option) => sameInfojobsBoolean(normalizeInfojobsAnswer(option.value), answer))
  );
}

async function fillInfojobsRadio(page, question, answer) {
  const option = findInfojobsOption(question, answer);
  if (!option?.id) return false;
  const clicked = await page
    .locator(`label[for="${option.id}"]`)
    .first()
    .click({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (clicked) return true;
  return page
    .locator(`#${option.id}`)
    .check({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
}

async function fillInfojobsText(page, question, raw) {
  const box = page.locator(`textarea[name="${question.name}"]`).first();
  const present = await box.count().then((count) => count > 0).catch(() => false);
  if (!present) return false;
  const value = String(raw).slice(0, question.maxLength || 2000);
  await box.scrollIntoViewIfNeeded().catch(() => {});
  await box.fill(value).catch(async () => {
    await box.click().catch(() => {});
    await box.type(value, { delay: 8 }).catch(() => {});
  });
  return true;
}

async function fillInfojobsQuestion(page, question, raw) {
  const answer = normalizeInfojobsAnswer(raw);
  return question.kind === "radio"
    ? fillInfojobsRadio(page, question, answer)
    : fillInfojobsText(page, question, raw);
}

async function waitInfojobsSuccess(page) {
  return page
    .locator(INFOJOBS_SUCCESS_SEL)
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
}

async function processInfojobsKillerForm(page, offerId, answers) {
  const questions = await extractInfojobsKillerQuestions(page);
  const answerable = toAnswerable(questions);
  if (!answers || Object.keys(answers).length === 0) {
    return { offerId, status: "needs_answers", questions: answerable };
  }
  const { unanswered } = await answerInfojobsKillerQuestions(page, answers);
  if (unanswered.length) {
    return {
      offerId,
      status: "needs_answers",
      questions: answerable,
      unanswered: unanswered.map((question) => question.label),
    };
  }
  const accept = page.locator("#btnKillerQuestionsAccept").first();
  await accept.scrollIntoViewIfNeeded().catch(() => {});
  await accept.click().catch(() => {});
  return { offerId, status: (await waitInfojobsSuccess(page)) ? "applied" : "submitted" };
}

async function clickInfojobsApply(page) {
  const button = page.locator("a.js_btApplyVacancy, .js_btApplyVacancy").first();
  if ((await button.count()) === 0) return false;
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click().catch(() => {});
  await Promise.race([
    page.waitForSelector(INFOJOBS_KILLER_SEL, { state: "visible", timeout: 12_000 }),
    page.waitForSelector(INFOJOBS_SUCCESS_SEL, { state: "visible", timeout: 12_000 }),
  ]).catch(() => {});
  return true;
}

// Fill the killer form from an { "question label": "answer" } map (as returned by
// generate_form_answers). Radios match the answer to an option value (case-insensitive, with
// SIM/NÃO↔yes/no synonyms); textareas get typed. Returns the labels we couldn't answer so the
// caller can park for a human instead of submitting a half-filled form.
export async function answerInfojobsKillerQuestions(page, answers = {}) {
  const questions = await extractInfojobsKillerQuestions(page);
  const unanswered = [];

  for (const q of questions) {
    const raw = answers[q.label];
    if (raw == null || `${raw}`.trim() === "") {
      unanswered.push({ label: q.label });
      continue;
    }
    if (!(await fillInfojobsQuestion(page, q, raw))) unanswered.push({ label: q.label });
  }

  return { unanswered };
}

// Two-phase apply that mirrors LinkedIn's "never submit blind":
//   phase 1 (no answers) → if a killer form blocks, return its questions so Rust can AI-draft them
//   phase 2 (answers)    → fill every question; submit only when NONE are left blank, else park
// Vacancies without killer questions apply in one CANDIDATAR-ME click, as before.
export async function infojobsApply(page, { offerId, applyUrl, answers } = {}) {
  if (!applyUrl) return { offerId, status: "not_found", reason: "no apply_url" };

  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".js_btApplyVacancy", { timeout: 15_000 }).catch(() => {});

  if (INFOJOBS_LOGIN_RE.test(page.url())) {
    return { offerId, status: "needs_login", reason: "sign in to InfoJobs, then retry" };
  }

  const alreadyApplied = await page
    .locator("text=/candidatura (realizada|enviada|efetuada)/i")
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyApplied) return { offerId, status: "already_applied" };

  if (!(await clickInfojobsApply(page))) return { offerId, status: "no_apply_button" };

  const hasKiller = await page.locator(INFOJOBS_KILLER_SEL).first().isVisible().catch(() => false);
  if (hasKiller) return processInfojobsKillerForm(page, offerId, answers);
  return { offerId, status: (await waitInfojobsSuccess(page)) ? "applied" : "submitted" };
}
