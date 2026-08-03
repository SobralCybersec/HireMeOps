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

  const result = await page.evaluate(async ({ cap, enrich }) => {
    const origin = "https://www.infojobs.com.br";

    const parseCards = (root) =>
      Array.from(root.querySelectorAll('div[id^="vacancy"][data-id]')).flatMap((card) => {
        const jobId = card.getAttribute("data-id");
        const href =
          card.getAttribute("data-href") ||
          card.querySelector('a[href*="/vaga-"]')?.getAttribute("href") ||
          "";
        if (!jobId || !href) return [];

        const title = (card.querySelector(".js_vacancyTitle")?.textContent || "").trim() || null;

        const compScope = card.querySelector(".d-flex.align-items-baseline");
        const company =
          (compScope?.querySelector(".text-body")?.textContent || "").replace(/\s+/g, " ").trim() ||
          null;

        const locEl = card.querySelector(".mb-8");
        const location = locEl
          ? locEl.textContent
              .replace(/\s+/g, " ")
              .replace(/,?\s*a\s*[\d.,]+\s*km de você\.?/i, "")
              .trim() || null
          : null;

        let salary = null;
        const moneyIcon = card.querySelector(".icon-money");
        if (moneyIcon) {
          const div = moneyIcon.closest("div");
          if (div) salary = div.textContent.replace(/\s+/g, " ").trim() || null;
        }

        const homeOffice = !!card.querySelector(".icon-user-home");

        const mediums = card.querySelectorAll(".text-medium");
        const teaser = mediums.length
          ? mediums[mediums.length - 1].textContent.replace(/\s+/g, " ").trim()
          : "";

        const bits = [];
        if (salary && !/combinar/i.test(salary)) bits.push(`Salário: ${salary}`);
        if (homeOffice) bits.push("Home office");
        const description = [bits.join(" · "), teaser].filter(Boolean).join("\n") || null;

        let applyUrl = null;
        try {
          applyUrl = new URL(href, origin).href;
        } catch {
          applyUrl = null;
        }

        return [
          {
            job_id: jobId,
            title,
            company,
            location,
            apply_url: applyUrl,
            is_easy_apply: true,
            description,
          },
        ];
      });

    const all = [];
    const seen = new Set();
    const push = (cards) => {
      for (const c of cards) {
        if (c.job_id && !seen.has(c.job_id)) {
          seen.add(c.job_id);
          all.push(c);
        }
      }
    };

    push(parseCards(document));

    const totalText =
      document.querySelector("#resumeVacancies .text-medium, #resumeVacancies span")?.textContent ||
      "";
    const total = parseInt(totalText.replace(/\D/g, ""), 10) || 0;
    const lastPage = total ? Math.min(cap, Math.ceil(total / 20)) : cap;

    const base = location.href.replace(/([?&])page=\d+/i, "$1").replace(/[?&]$/, "");
    let eof = all.length === 0;
    for (let p = 2; p <= lastPage && !eof; p++) {
      const sep = base.includes("?") ? "&" : "?";
      const listUrl = `${base}${sep}page=${p}`;
      const fragUrl = `${origin}/mf-publicarea/VacancyList/GetVacancyListFragment?url=${encodeURIComponent(listUrl)}`;
      try {
        const res = await fetch(fragUrl, {
          headers: { "X-Requested-With": "XMLHttpRequest" },
          credentials: "include",
        });
        if (!res.ok) break;
        const data = await res.json();
        const doc = new DOMParser().parseFromString(data.listFragmentHTML || "", "text/html");
        const cards = parseCards(doc);
        push(cards);
        eof = !!data.eof || cards.length === 0;
      } catch {
        break;
      }
    }

    if (enrich && all.length) {
      const CONCURRENCY = 6;
      for (let i = 0; i < all.length; i += CONCURRENCY) {
        const chunk = all.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (job) => {
            if (!job.apply_url) return;
            try {
              const r = await fetch(job.apply_url, { credentials: "include" });
              if (!r.ok) return;
              const html = await r.text();
              const d = new DOMParser().parseFromString(html, "text/html");
              const full = (
                d.querySelector(
                  ".js_vacancyDataPanels .white-space-pre-line, .white-space-pre-line",
                )?.textContent || ""
              )
                .replace(/[ \t]+\n/g, "\n")
                .trim();
              if (full && full.length > (job.description ? job.description.length : 0)) {
                const firstLine = (job.description || "").split("\n")[0];
                job.description = /Salário|Home office/.test(firstLine)
                  ? `${firstLine}\n${full}`
                  : full;
              }
            } catch {
            }
          }),
        );
      }
    }

    return { jobs: all, hasNext: !eof };
  }, { cap, enrich: enrichDescriptions });

  return { jobs: result.jobs, has_next_page: !!result.hasNext };
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

// Fill the killer form from an { "question label": "answer" } map (as returned by
// generate_form_answers). Radios match the answer to an option value (case-insensitive, with
// SIM/NÃO↔yes/no synonyms); textareas get typed. Returns the labels we couldn't answer so the
// caller can park for a human instead of submitting a half-filled form.
export async function answerInfojobsKillerQuestions(page, answers = {}) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const yes = new Set(["sim", "yes", "s", "y", "true", "verdadeiro"]);
  const no = new Set(["não", "nao", "no", "n", "false", "falso"]);
  const sameBool = (a, b) => (yes.has(a) && yes.has(b)) || (no.has(a) && no.has(b));

  const questions = await extractInfojobsKillerQuestions(page);
  const unanswered = [];

  for (const q of questions) {
    const raw = answers[q.label];
    if (raw == null || `${raw}`.trim() === "") {
      unanswered.push({ label: q.label });
      continue;
    }
    const want = norm(raw);

    if (q.kind === "radio") {
      const opt =
        q.options.find((o) => norm(o.value) === want) ||
        q.options.find((o) => sameBool(norm(o.value), want));
      if (!opt || !opt.id) {
        unanswered.push({ label: q.label });
        continue;
      }
      // Click the label (the native radio is visually hidden by the custom-control CSS).
      const clicked = await page
        .locator(`label[for="${opt.id}"]`)
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        const checked = await page.locator(`#${opt.id}`).check({ timeout: 4_000 }).then(() => true).catch(() => false);
        if (!checked) unanswered.push({ label: q.label });
      }
    } else {
      const box = page.locator(`textarea[name="${q.name}"]`).first();
      const ok = await box.count().then((n) => n > 0).catch(() => false);
      if (!ok) {
        unanswered.push({ label: q.label });
        continue;
      }
      await box.scrollIntoViewIfNeeded().catch(() => {});
      await box.fill(String(raw).slice(0, q.maxLength || 2000)).catch(async () => {
        await box.click().catch(() => {});
        await box.type(String(raw).slice(0, q.maxLength || 2000), { delay: 8 }).catch(() => {});
      });
    }
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

  const btn = page.locator("a.js_btApplyVacancy, .js_btApplyVacancy").first();
  if ((await btn.count()) === 0) return { offerId, status: "no_apply_button" };

  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click().catch(() => {});

  // The click either fires the success toast (no questions) or reveals the killer form.
  await Promise.race([
    page.waitForSelector(INFOJOBS_KILLER_SEL, { state: "visible", timeout: 12_000 }),
    page.waitForSelector(INFOJOBS_SUCCESS_SEL, { state: "visible", timeout: 12_000 }),
  ]).catch(() => {});

  const hasKiller = await page.locator(INFOJOBS_KILLER_SEL).first().isVisible().catch(() => false);
  if (hasKiller) {
    const questions = await extractInfojobsKillerQuestions(page);
    const answerable = toAnswerable(questions);

    if (!answers || Object.keys(answers).length === 0) {
      // Phase 1: hand the questions back for AI drafting; leave the form open in the visible window.
      return { offerId, status: "needs_answers", questions: answerable };
    }

    const { unanswered } = await answerInfojobsKillerQuestions(page, answers);
    if (unanswered.length) {
      return {
        offerId,
        status: "needs_answers",
        questions: answerable,
        unanswered: unanswered.map((u) => u.label),
      };
    }

    const accept = page.locator("#btnKillerQuestionsAccept").first();
    await accept.scrollIntoViewIfNeeded().catch(() => {});
    await accept.click().catch(() => {});
    const done = await page
      .locator(INFOJOBS_SUCCESS_SEL)
      .first()
      .waitFor({ state: "visible", timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    return { offerId, status: done ? "applied" : "submitted" };
  }

  const applied = await page
    .locator(INFOJOBS_SUCCESS_SEL)
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);

  return { offerId, status: applied ? "applied" : "submitted" };
}
