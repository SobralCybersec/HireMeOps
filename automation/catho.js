// Catho curriculo (/curriculo/) auto-fill: navigates each resume section, fills it, saves.
// Key: cathoPushProfile — entry point, iterates sections and dispatches to cathoFillSection
// Key: cathoFillSection — switch over section kind (additional_info/summary/objetivo/experience/education)
// Key: cathoAddExperience / cathoAddEducation — repeater "adicionar" forms, dedup via cathoAlreadyPresent
// Key: cathoFillDate — MM/YYYY text-field fallback chain (literal, masked digits, programmatic)
// Key: cathoTypeahead — autosuggest fill, takes a suggestion match or leaves the typed text

import {
  cathoParseMeta,
  cathoParseDates,
  cathoDegreeValue,
  cathoBulletList,
} from "./catho-helpers.js";
import { perfEnabled, nowMs, logSpan } from "./perf.js";

const CATHO_CURRICULO = "https://www.catho.com.br/curriculo/";
const CATHO_LOGIN_RE = /\/(login|acesso|entrar|autenticacao)|account\.catho|auth\.catho/i;

export async function cathoPushProfile(page, sections = []) {
  await gotoCathoCurriculo(page);

  if (CATHO_LOGIN_RE.test(page.url())) {
    return {
      results: sections.map((s) => ({
        kind: s.kind,
        status: "error",
        label: s.label,
        reason: "Not logged into Catho — sign in in the browser window, then retry.",
      })),
    };
  }

  const results = [];
  for (const sec of sections) {
    const t = perfEnabled() ? nowMs() : 0;
    let r;
    try {
      r = await cathoFillSection(page, sec);
    } catch (e) {
      r = { kind: sec.kind, status: "error", label: sec.label, reason: String(e.message || e) };
    }
    results.push(r);
    if (perfEnabled()) {
      logSpan("catho_section", { kind: sec.kind, status: r.status, ms: +(nowMs() - t).toFixed(1) });
    }
    await gotoCathoCurriculo(page).catch(() => {});
  }
  if (perfEnabled()) await cathoLogRendererMetrics(page);
  return { results };
}

async function gotoCathoCurriculo(page) {
  await page.goto(CATHO_CURRICULO, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector("#personal-data", { timeout: 8_000 }).catch(() => {});
}

async function cathoLogRendererMetrics(page) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    const { metrics } = await client.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    logSpan("renderer", {
      jsHeapMb: +((m.JSHeapUsedSize || 0) / 1_048_576).toFixed(1),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      frames: m.Frames,
    });
    await client.detach().catch(() => {});
  } catch (e) {
    logSpan("renderer", { error: String(e?.message ?? e) });
  }
}

async function cathoFillSection(page, sec) {
  const text = sec.text ?? sec.value ?? "";
  const entry = cathoParseMeta(sec.metadata);
  switch (sec.kind) {
    case "additional_info":
      return cathoFillTextarea(page, {
        sectionId: "additional-info",
        openTitle: "editar informações",
        textareaId: "additionalInfo",
        text,
        kind: sec.kind,
        label: sec.label,
      });
    case "summary":
      return cathoFillTextarea(page, {
        sectionId: "summary",
        openTitle: "editar resumo",
        textareaId: null,
        text,
        kind: sec.kind,
        label: sec.label,
      });
    case "objetivo":
      return cathoFillObjetivo(page, sec, text);
    case "experience":
      return cathoAddExperience(page, sec, entry);
    case "education":
      return cathoAddEducation(page, sec, entry);
    default:
      return {
        kind: sec.kind,
        status: "manual",
        label: sec.label,
        reason: "No Catho automation for this section yet.",
      };
  }
}

async function cathoFillTextarea(page, { sectionId, openTitle, textareaId, text, kind, label }) {
  const openBtn = page.locator(`#${sectionId} button[title="${openTitle}"]`).first();
  await openBtn.waitFor({ state: "visible", timeout: 12_000 });
  await openBtn.click();

  const textarea = textareaId
    ? page.locator(`#${textareaId}`).first()
    : page.locator("form textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 12_000 });
  await textarea.fill(text);

  await cathoSave(page);
  return { kind, status: "ok", label };
}

async function cathoSave(page) {
  const saveBtn = page.getByRole("button", { name: /^\s*salvar/i }).first();
  await saveBtn.waitFor({ state: "visible", timeout: 8_000 });
  await saveBtn.click();
  await page
    .waitForURL((u) => /\/curriculo\/?($|\?)/.test(u.href), { timeout: 12_000 })
    .catch(() => {});
}

async function cathoFillObjetivo(page, sec, text) {
  const openBtn = page.locator('#preferences button[title="editar objetivo"]').first();
  await openBtn.waitFor({ state: "visible", timeout: 12_000 });
  await openBtn.click();

  await page.locator("#goal").first().waitFor({ state: "visible", timeout: 12_000 });
  await cathoTypeahead(page, "#goal", text);

  await cathoSave(page);
  return { kind: "objetivo", status: "ok", label: sec.label };
}

async function cathoTypeahead(page, selector, value) {
  const v = String(value ?? "").trim();
  if (!v) return;
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 10_000 });
  await el.click();
  await el.fill(v);
  const sugg = page
    .locator('.react-autosuggest__suggestions-container [role="option"], .react-autosuggest__suggestion')
    .first();
  const found = await sugg
    .waitFor({ state: "visible", timeout: 3_500 })
    .then(() => true)
    .catch(() => false);
  if (found) await sugg.click().catch(() => {});
}

async function cathoFillDate(page, selector, value) {
  if (!value) return;
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return;

  const type = (await el.getAttribute("type").catch(() => "")) || "";
  if (type === "month") {
    const m = value.match(/(\d{1,2})\/(\d{4})/);
    if (m) await el.fill(`${m[2]}-${m[1].padStart(2, "0")}`).catch(() => {});
    return;
  }

  const isValid = (v) => /^\d{2}\/\d{4}$/.test(v);
  const read = async () => (await el.inputValue().catch(() => "")) || "";

  await el.click().catch(() => {});
  await el.fill("").catch(() => {});
  await el.pressSequentially(value, { delay: 50 }).catch(() => {});
  if (isValid(await read())) return;

  await el.fill("").catch(() => {});
  await el.pressSequentially(value.replace(/\D/g, ""), { delay: 50 }).catch(() => {});
  if (isValid(await read())) return;

  await el.fill(value).catch(() => {});
}

async function cathoAlreadyPresent(page, sectionId, needle) {
  const n = String(needle ?? "").trim();
  if (!n) return false;
  return page
    .evaluate(
      ({ id, t }) => {
        const s = document.getElementById(id);
        return s ? (s.textContent ?? "").toLowerCase().includes(t.toLowerCase()) : false;
      },
      { id: sectionId, t: n },
    )
    .catch(() => false);
}

async function cathoAddExperience(page, sec, entry) {
  const title = String(entry.title ?? "").trim();
  const org = String(entry.organization ?? "").trim();
  const label = sec.label || `${title} @ ${org}`;

  if (await cathoAlreadyPresent(page, "professional-experience", title)) {
    return { kind: "experience", status: "skipped", label, reason: "Already on Catho resume" };
  }

  const addBtn = page
    .locator('#professional-experience button[title="adicionar experiência"]')
    .first();
  await addBtn.waitFor({ state: "visible", timeout: 12_000 });
  await addBtn.click();

  await page.locator("#role").first().waitFor({ state: "visible", timeout: 12_000 });
  await cathoTypeahead(page, "#role", title);
  await cathoTypeahead(page, "#company", org);

  const { start, end, current } = cathoParseDates(entry.dates);
  const ongoing = current || !end;
  if (ongoing) await page.locator('label[for="currentJob"]').first().click().catch(() => {});
  await cathoFillDate(page, "#dateInit", start);
  if (!ongoing) await cathoFillDate(page, "#dateEnd", end);

  const desc = cathoBulletList(entry.bullets);
  if (desc) await page.locator("#description").first().fill(desc.slice(0, 3000)).catch(() => {});

  await cathoSave(page);
  return { kind: "experience", status: "ok", label };
}

async function cathoAddEducation(page, sec, entry) {
  const degree = String(entry.degree ?? "").trim();
  const inst = String(entry.institution ?? "").trim();
  const label = sec.label || degree;

  if (await cathoAlreadyPresent(page, "education", degree)) {
    return { kind: "education", status: "skipped", label, reason: "Already on Catho resume" };
  }

  const addBtn = page.locator('#education button[title="adicionar formação"]').first();
  await addBtn.waitFor({ state: "visible", timeout: 12_000 });
  await addBtn.click();

  await page.locator("#degree").first().waitFor({ state: "visible", timeout: 12_000 });
  await page.locator("#degree").first().selectOption(cathoDegreeValue(degree)).catch(() => {});
  await cathoTypeahead(page, "#course", degree);
  await page.locator("#institution").first().fill(inst).catch(() => {});

  const { start, end, current } = cathoParseDates(entry.dates);
  const ongoing = current || !end;
  if (ongoing) await page.locator('label[for="currentYear"]').first().click().catch(() => {});
  await cathoFillDate(page, "#courseStart", start);
  if (!ongoing) await cathoFillDate(page, "#courseEnd", end);

  await cathoSave(page);
  return { kind: "education", status: "ok", label };
}
