// InfoJobs CV ("Meu Currículo" / insert2.aspx) auto-fill: one ASP.NET WebForms page, one SALVAR CV.
// Key: infojobsPushProfile — entry point, fills name/Resumo/phone/LinkedIn/skills + repeaters
// Key: fillEducation / fillExperiences — Formação/Experiências repeater modals, dedup by text match
// Key: selCascade — drives cascading selects (Área→Especialidade, País→Estado), polls for repopulation
// Key: saveCv — clicks a.js_btSend, waits for the POST, reports save status by HTTP code

import { perfEnabled, nowMs, logSpan } from "./perf.js";
import { captureDom } from "./capture.js";
import {
  parseInfojobsDate,
  isFutureDate,
  educationLevelValue,
  managerialLevelValue,
  bestCourseMatch,
} from "./infojobs-helpers.js";

const INFOJOBS_CV_URL = "https://www.infojobs.com.br/candidate/cv/insert2.aspx";
const P = "#ctl00_phMasterPage_cPersonalData_";
const S = "#ctl00_phMasterPage_cStudies_";
const X = "#ctl00_phMasterPage_cExperiences_";

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function infojobsPushProfile(page, profile = {}) {
  const {
    firstName = "",
    surname = "",
    abstract = "",
    phoneDdd = "",
    phoneNumber = "",
    linkedinUrl = "",
    skills = [],
    experiences = [],
    education = [],
    url,
  } = profile;

  const t = perfEnabled() ? nowMs() : 0;
  const alreadyOnForm = await page
    .locator("#IdPersonalData")
    .first()
    .isVisible()
    .catch(() => false);
  if (!alreadyOnForm) {
    await page
      .goto(url || INFOJOBS_CV_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});
  }
  const loaded = await page
    .waitForSelector("#IdPersonalData", { state: "visible", timeout: 180_000 })
    .then(() => true)
    .catch(() => false);
  if (!loaded) {
    return {
      results: [
        {
          kind: "all",
          status: "error",
          reason: "InfoJobs CV form never loaded — sign in to InfoJobs in the window, then retry.",
        },
      ],
    };
  }

  const results = [];
  const setVal = async (sel, val, kind, label) => {
    if (!val) return;
    const el = page.locator(sel).first();
    if (!(await el.count())) {
      results.push({ kind, status: "manual", label, reason: "field not found" });
      return;
    }
    await el.fill(String(val)).catch(() => {});
    results.push({ kind, status: "ok", label });
  };

  await setVal(`${P}txtName`, firstName, "name", "Nome");
  await setVal(`${P}txtSurname`, surname, "name", "Sobrenome");
  await setVal(`${P}txtAbstract`, abstract, "abstract", "Resumo");
  await setVal(`${P}txtPhone1Code`, phoneDdd, "phone", "DDD");
  await setVal(`${P}txtPhone1`, phoneNumber, "phone", "Telefone");
  await setVal(
    "#ctl00_phMasterPage_cSocialMedia_rptGrid_ctl00_txtSocialMedia",
    linkedinUrl,
    "linkedin",
    "LinkedIn",
  );

  if (skills.length) results.push(await fillSkills(page, skills));
  if (education.length) results.push(...(await fillEducation(page, education)));
  if (experiences.length) results.push(...(await fillExperiences(page, experiences)));

  results.push(await saveCv(page));
  if (perfEnabled()) logSpan("infojobs_push", { ms: +(nowMs() - t).toFixed(1) });
  return { results };
}

async function fillSkills(page, skills) {
  const existing = new Set(
    (await page.locator(".addSkill li").allTextContents().catch(() => [])).map((s) =>
      s.replace(/x\s*$/i, "").trim().toLowerCase(),
    ),
  );
  const box = page.locator(`#ctl00_phMasterPage_cSkills_txtName`);
  const addBtn = page.locator("#btnIncludeSkill, .js_btnIncludeSkill").first();
  let added = 0;

  for (const raw of skills) {
    const skill = String(raw ?? "").trim();
    if (!skill || existing.has(skill.toLowerCase())) continue;
    await box.click().catch(() => {});
    await box.fill(skill).catch(() => {});
    await page.waitForTimeout(300);
    const opt = page
      .locator('#divSkills li, .ui-autocomplete li', { hasText: new RegExp(`^\\s*${esc(skill)}\\s*$`, "i") })
      .first();
    if (await opt.isVisible({ timeout: 1_000 }).catch(() => false)) await opt.click().catch(() => {});
    if (await addBtn.isEnabled().catch(() => false)) {
      await addBtn.click().catch(() => {});
      added++;
      await page.waitForTimeout(200);
    }
  }
  return { kind: "skills", status: added ? "ok" : "skipped", label: `${added} skill(s) added` };
}

async function selOpt(page, sel, value) {
  if (!value) return;
  const el = page.locator(sel).first();
  if (await el.count()) await el.selectOption(value).catch(() => {});
}

async function selCascade(page, parentSel, parentValue, childSel, childValue) {
  const parent = page.locator(parentSel).first();
  if (!(await parent.count())) return false;
  const child = page.locator(childSel).first();
  const sig = () => child.locator("option").allTextContents().then((x) => x.join("|")).catch(() => "");

  const prev = await parent.inputValue().catch(() => "");
  if (String(parentValue) !== String(prev)) {
    const before = await sig();
    await parent.selectOption(parentValue).catch(() => {});
    await parent.dispatchEvent("change").catch(() => {});
    for (let i = 0; i < 40; i++) {
      const now = await sig();
      if (now && now !== before) break;
      await page.waitForTimeout(150);
    }
  }

  const held = async () => {
    const now = await child.inputValue().catch(() => "");
    return childValue ? now === String(childValue) : !!now;
  };
  if (!(await held())) {
    for (let i = 0; i < 6; i++) {
      if (childValue) await child.selectOption(String(childValue)).catch(() => {});
      else await child.selectOption({ index: 1 }).catch(() => {});
      await child.dispatchEvent("change").catch(() => {});
      await page.waitForTimeout(300);
      if (await held()) break;
    }
  }
  return true;
}

async function clickHard(page, sel) {
  const el = page.locator(sel).first();
  if (!(await el.count())) return;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const ok = await el
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await el.click({ force: true, timeout: 5_000 }).catch(() => {});
    await el.evaluate((e) => e.click()).catch(() => {});
  }
}
async function fillIf(page, sel, value) {
  if (!value) return;
  const el = page.locator(sel).first();
  if (await el.count()) await el.fill(String(value)).catch(() => {});
}
function monthOrDefault(month, year) {
  return month || (year ? "01" : "");
}
async function typeDate(page, sel, value) {
  if (!value) return;
  const el = page.locator(sel).first();
  if (!(await el.count())) return;
  await el.click().catch(() => {});
  await el.fill("").catch(() => {});
  await el.pressSequentially(String(value), { delay: 60 }).catch(() => {});
  await el.blur().catch(() => {});
}

async function fillEducation(page, education) {
  const results = [];
  const existing = (
    await page.locator(`${S}divStudie .item`).allTextContents().catch(() => [])
  ).map((t) => t.toLowerCase());

  for (const edu of education) {
    const degree = String(edu.degree ?? "").trim();
    const inst = String(edu.institution ?? "").trim();
    const label = inst ? `${degree} — ${inst}` : degree;
    if (!degree) continue;
    if (existing.some((t) => t.includes(degree.toLowerCase()))) {
      results.push({ kind: "education", status: "skipped", label, reason: "already on CV" });
      continue;
    }
    try {
      await page.locator('a[href="javascript:GestorStudies.NewItem();"]').first().click();
      await page.locator(`${S}txtInstitution`).waitFor({ state: "visible", timeout: 10_000 });
      await fillIf(page, `${S}txtInstitution`, inst);
      await selOpt(page, `${S}drpCountry`, "12");
      await selOpt(page, `${S}drpState`, "182");
      await selOpt(page, `${S}drpStudie1`, educationLevelValue(degree));
      await page.waitForTimeout(800);

      await page
        .locator(`${S}drpStudie2 option`)
        .nth(1)
        .waitFor({ state: "attached", timeout: 5_000 })
        .catch(() => {});
      const courseOptions = await page
        .locator(`${S}drpStudie2 option`)
        .evaluateAll((els) =>
          els.map((o) => ({ value: o.value, label: (o.textContent || "").trim() })).filter((o) => o.value),
        )
        .catch(() => []);
      const match = bestCourseMatch(degree, courseOptions);
      if (match && match.score >= 0.4) {
        await selOpt(page, `${S}drpStudie2`, match.value);
      } else {
        await page
          .evaluate(() => {
            const li = document.getElementById("liCourseNotFound");
            if (li) li.style.display = "block";
          })
          .catch(() => {});
        await page.locator("#lnkCourseNotFound").click({ force: true }).catch(() => {});
        await fillIf(page, `${S}txtCurse`, degree);
      }

      const d = parseInfojobsDate(edu.dates);
      const inProgress = d.current || isFutureDate(d.endMonth, d.endYear);
      await typeDate(page, `${S}txtBeginMonth`, monthOrDefault(d.startMonth, d.startYear));
      await typeDate(page, `${S}txtBeginYear`, d.startYear);
      await selOpt(page, `${S}drpStatus`, inProgress ? "0" : "1");
      if (d.endYear) {
        await typeDate(page, `${S}txtEndMonth`, monthOrDefault(d.endMonth, d.endYear));
        await typeDate(page, `${S}txtEndYear`, d.endYear);
      }

      await clickHard(page, `${S}btnIncluir`);
      await page.waitForTimeout(1_200);
      results.push({ kind: "education", status: "ok", label });
    } catch (e) {
      results.push({ kind: "education", status: "error", label, reason: String(e?.message ?? e) });
    }
  }
  return results;
}

async function fillExperiences(page, experiences) {
  const results = [];
  const existing = (
    await page.locator(`${X}divExperience .item`).allTextContents().catch(() => [])
  ).map((t) => t.toLowerCase());

  for (const exp of experiences) {
    const role = String(exp.role ?? "").trim();
    const company = String(exp.company ?? "").trim();
    const label = company ? `${role} @ ${company}` : role;
    if (!role) continue;
    if (existing.some((t) => t.includes(role.toLowerCase()))) {
      results.push({ kind: "experience", status: "skipped", label, reason: "already on CV" });
      continue;
    }
    try {
      await page
        .locator('#js_clickNewExperience, a[href="javascript:GestorExperience.NewItem();"]')
        .first()
        .click();
      await page.locator(`${X}txtTitle`).waitFor({ state: "visible", timeout: 10_000 });
      await fillIf(page, `${X}txtTitle`, role);
      await selOpt(page, `${X}drpManagerialLevel`, managerialLevelValue(role));
      await selCascade(page, `${X}drpCategory1`, "74", `${X}drpCategory2`, "371");
      await fillIf(page, `${X}txtName`, company);

      const d = parseInfojobsDate(exp.dates);
      const ongoing = d.current || isFutureDate(d.endMonth, d.endYear);
      await typeDate(page, `${X}txtBeginMonth`, monthOrDefault(d.startMonth, d.startYear));
      await typeDate(page, `${X}txtBeginYear`, d.startYear);
      if (ongoing) {
        await page.locator("#chkActuallyWorking").check().catch(() => {});
      } else {
        await typeDate(page, `${X}txtEndMonth`, monthOrDefault(d.endMonth, d.endYear));
        await typeDate(page, `${X}txtEndYear`, d.endYear);
      }

      const activities = (Array.isArray(exp.bullets) ? exp.bullets : [])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .map((b) => (b.startsWith("-") ? b : `- ${b}`))
        .join("\n");
      if (activities) await fillIf(page, `${X}txtDescription`, activities);

      await selCascade(page, `${X}drpCountry`, "12", `${X}drpState`, "182");

      const before = await page.locator(`${X}divExperience .item`).count().catch(() => 0);
      await clickHard(page, `${X}btnIncluir`);
      await page.waitForTimeout(1_200);
      const after = await page.locator(`${X}divExperience .item`).count().catch(() => 0);

      if (after > before) {
        results.push({ kind: "experience", status: "ok", label });
      } else {
        const reason = await formError(page);
        await captureDom(page, "infojobs_exp_addfail", { label, reason }).catch(() => {});
        results.push({
          kind: "experience",
          status: "error",
          label,
          reason: reason || "SALVAR EXPERIÊNCIA validation failed (item not added)",
        });
      }
    } catch (e) {
      results.push({ kind: "experience", status: "error", label, reason: String(e?.message ?? e) });
    }
  }
  return results;
}

async function formError(page) {
  return page
    .evaluate(() => {
      for (const el of document.querySelectorAll(
        ".mError:not(.hidden), .errIncomplet:not(.hidden)",
      )) {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") continue;
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt) return (el.id ? el.id + ": " : "") + txt.slice(0, 160);
      }
      return "";
    })
    .catch(() => "");
}

async function saveCv(page) {
  await page
    .evaluate(() => {
      try {
        window.GestorExperience?.ClearForm?.();
      } catch {}
      try {
        window.GestorStudies?.ClearForm?.();
      } catch {}
      document
        .querySelectorAll(".mError:not(.hidden)")
        .forEach((el) => el.classList.add("hidden"));
    })
    .catch(() => {});
  await page.waitForTimeout(400);

  const save = page.locator("a.js_btSend").first();
  if (!(await save.count())) return { kind: "save", status: "error", label: "SALVAR CV", reason: "save button not found" };

  await save.scrollIntoViewIfNeeded().catch(() => {});
  const savePost = page
    .waitForResponse(
      (r) => r.request().method() === "POST" && /^https?:\/\/(?:[^/]+\.)?infojobs\.com\.br\/candidate\/cv(?:[/?#]|$)/i.test(r.url()),
      { timeout: 20_000 },
    )
    .catch(() => null);
  await save.click().catch(() => {});
  const resp = await savePost;

  await waitDomIdle(page, 500, 8_000);

  if (!resp) {
    return { kind: "save", status: "error", label: "SALVAR CV", reason: "no save POST fired (validation blocked or button not clicked)" };
  }
  const ok = resp.status() < 400;
  return {
    kind: "save",
    status: ok ? "ok" : "error",
    label: "SALVAR CV",
    reason: ok ? `saved (HTTP ${resp.status()})` : `save POST returned HTTP ${resp.status()}`,
  };
}

async function waitDomIdle(page, quietMs = 500, maxMs = 8_000) {
  await page
    .evaluate(
      ({ quietMs, maxMs }) =>
        new Promise((resolve) => {
          let timer = setTimeout(done, quietMs);
          const deadline = setTimeout(done, maxMs);
          const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, quietMs);
          });
          obs.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          function done() {
            clearTimeout(timer);
            clearTimeout(deadline);
            obs.disconnect();
            resolve();
          }
        }),
      { quietMs, maxMs },
    )
    .catch(() => {});
}
