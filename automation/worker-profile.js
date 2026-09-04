import { parseDates } from "./linkedin-helpers.js";
import { humanType } from "./human.js";
import { activePage, isHostname, session } from "./worker-context.js";

const HUMAN_TYPE_MAX = 120;

async function selectExistingResume(page, container, resumeCards) {
  const checked = await container.locator('[role="radio"][aria-checked="true"], input[type=radio]:checked').count().catch(() => 0);
  if (checked > 0) return;
  const first = resumeCards.first();
  await first.check({ timeout: 1_000 }).catch(async () => first.click().catch(() => {}));
  await page.waitForTimeout(400);
}

async function uploadResume(page, uploadBtn, cvPath) {
  const fileInput = page.locator("input[type=file]").first();
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

export async function handleResumeStep(page, cvPath) {
  const container = page.locator("#easyApplyUploadedResumeRef");
  const resumeCards = container.locator('[role="radio"], input[type=radio]');
  const hasResume = await resumeCards.first().waitFor({ state: "attached", timeout: 1_500 }).then(() => true).catch(() => false);
  if (hasResume) {
    await selectExistingResume(page, container, resumeCards);
    return true;
  }
  if (!cvPath) return true;
  const uploadBtn = page.locator(
    'button:has-text("Carregar currículo"), button:has-text("Upload resume"), button[aria-label*="currículo" i], button[aria-label*="resume" i]',
  ).first();
  if (!(await uploadBtn.isVisible({ timeout: 250 }).catch(() => false))) return false;
  return uploadResume(page, uploadBtn, cvPath);
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
function normalizeAnswer(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const NEGATIVE_ANSWER = new RegExp(
  "\\b(nao|not|nunca|nenhum|nenhuma|nope|negativo|jamais|discordo|false|falso)\\b|\\bn['’]?t\\b|^n(o)?$",
);
const POSITIVE_ANSWER = new RegExp(
  "\\b(sim|yes|yeah|yep|tenho|possuo|have|has|claro|certeza|afirmativo|positivo|true|verdadeiro|concordo|correto|correct|agree)\\b|^y$",
);

function isNegativeAnswer(value) { return NEGATIVE_ANSWER.test(value); }
function isPositiveAnswer(value) { return POSITIVE_ANSWER.test(value); }

function answerPolarity(raw) {
  const value = normalizeAnswer(raw);
  if (!value) return null;
  if (isNegativeAnswer(value)) return "no";
  if (isPositiveAnswer(value)) return "yes";
  return null;
}

function normalizeLabel(value) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findTextAnswer(label, answers) {
  return answers.find((answer) => {
    const want = normalizeLabel(answer.label);
    return want && (label.includes(want) || want.includes(label));
  });
}

async function fillTextAnswer(field, label, tag, answers, coverLetter, maxLen) {
  if (coverLetter && label.includes("cover letter")) {
    await setVal(field, tag, clampAnswer(coverLetter, maxLen));
    return true;
  }
  const match = findTextAnswer(label, answers);
  if (!match) return false;
  await setVal(field, tag, clampAnswer(match.value, maxLen));
  return true;
}

async function readTextField(field) {
  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  const label = await fieldLabel(field);
  const maxLen = tag === "select" ? null : await fieldMaxLen(field);
  const current = await field.evaluate((el) => String(el.value ?? "")).catch(() => "");
  return { tag, label, maxLen, current };
}

async function unansweredTextField(field, details) {
  if (!details.label || (details.current.trim() && (!details.maxLen || details.current.length <= details.maxLen))) return null;
  const options = details.tag === "select"
    ? await field.evaluate((el) => Array.from(el.options).map((option) => option.textContent.trim()).filter(Boolean)).catch(() => [])
    : undefined;
  return { label: details.label, kind: details.tag === "select" ? "select" : "text", options, maxLength: details.maxLen ?? undefined };
}

async function fillTextField(field, answers, coverLetter) {
  const details = await readTextField(field);
  if (await fillTextAnswer(field, details.label, details.tag, answers, coverLetter, details.maxLen)) return null;
  return unansweredTextField(field, details);
}

async function fillTextFields(page, answers, coverLetter) {
  const fields = await page.locator(
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select",
  ).all();
  const unanswered = [];
  for (const field of fields) {
    const question = await fillTextField(field, answers, coverLetter);
    if (question) unanswered.push(question);
  }
  return unanswered;
}

async function radioOptionText(element, useRole) {
  return useRole
    ? normalizeLabel(await element.evaluate((node) => node.querySelector("p")?.textContent ?? "").catch(() => ""))
    : fieldLabel(element);
}

async function clickRadioOption(element, group, useRole) {
  if (!useRole) {
    await element.check({ timeout: 1_500 }).catch(async () => {
      const id = await element.getAttribute("id");
      if (id) await group.locator(`label[for="${id}"]`).click().catch(() => {});
    });
    return;
  }
  const isChecked = async () => (await element.getAttribute("aria-checked").catch(() => null)) === "true";
  await element.click().catch(() => {});
  if (!(await isChecked())) await element.locator("p, input[type=radio], label").first().click().catch(() => {});
  if (!(await isChecked())) await element.evaluate((node) => node.click()).catch(() => {});
}

async function radioGroupLabel(group) {
  return normalizeLabel(await group.evaluate((node) => {
    const inner = node.querySelector("[data-test-form-builder-radio-button-form-component__title], legend, .fb-dash-form-element__label");
    if (inner?.textContent?.trim()) return inner.textContent;
    let previous = node.previousElementSibling;
    while (previous && !(previous.textContent ?? "").trim()) previous = previous.previousElementSibling;
    return previous?.textContent ?? "";
  }).catch(() => ""));
}

function matchingRadioAnswer(qLabel, answers) {
  return answers.find((answer) => {
    const want = normalizeLabel(answer.label);
    return want && (qLabel.includes(want) || want.includes(qLabel));
  });
}

function sameRadioChoice(a, b) {
  const yes = ["yes", "sim", "true", "1", "verdadeiro", "yeah", "y"];
  const no = ["no", "não", "nao", "false", "0", "falso", "n"];
  return (yes.includes(a) && yes.includes(b)) || (no.includes(a) && no.includes(b));
}

async function chooseRadioOption(group, optionEls, useRole, match) {
  const want = normalizeLabel(match.value);
  const wantPolarity = answerPolarity(match.value);
  for (const element of optionEls) {
    const text = await radioOptionText(element, useRole);
    const optionPolarity = answerPolarity(text);
    if (text && ((wantPolarity && optionPolarity === wantPolarity) || text.includes(want) || want.includes(text) || sameRadioChoice(text, want))) {
      await clickRadioOption(element, group, useRole);
      break;
    }
  }
}

async function fillRadioGroup(group, answers, unanswered) {
  const isResumeGroup = await group.evaluate((node) => !!node.querySelector(
    '#easyApplyUploadedResumeRef, [componentkey="easyApplyUploadedResumeRef"], input[type=file]',
  )).catch(() => false);
  if (isResumeGroup) return;
  const qLabel = await radioGroupLabel(group);
  if (!qLabel) return;
  const roleRadios = await group.locator('[role="radio"]').all();
  const useRole = roleRadios.length > 0;
  const optionEls = useRole ? roleRadios : await group.locator("input[type=radio]").all();
  const match = matchingRadioAnswer(qLabel, answers);
  if (!match) {
    const options = [];
    for (const element of optionEls) {
      const text = await radioOptionText(element, useRole);
      if (text) options.push(text);
    }
    unanswered.push({ label: qLabel, kind: "radio", options });
    return;
  }
  await chooseRadioOption(group, optionEls, useRole, match);
}

async function fillRadioGroups(page, answers, unanswered) {
  const groups = await page.locator(
    'fieldset[data-test-form-builder-radio-button-form-component="true"], fieldset[role="radiogroup"], fieldset:has(input[type=radio])',
  ).all();
  for (const group of groups) await fillRadioGroup(group, answers, unanswered);
}

async function fillTrueCheckboxes(page, answers) {
  const norm = normalizeLabel;

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
}

export async function fillStep(page, answers, coverLetter) {
  const unanswered = await fillTextFields(page, answers, coverLetter);
  await fillRadioGroups(page, answers, unanswered);
  await fillTrueCheckboxes(page, answers);
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
      if (!isHostname(page.url(), "linkedin.com")) throw e;
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
      if (!isHostname(page.url(), "linkedin.com")) throw e;
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

  if (!isHostname(page.url(), "linkedin.com")) {
    await page
      .goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch((e) => {
        if (!isHostname(page.url(), "linkedin.com")) throw e;
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

async function experiencePage(browser) {
  const pages = browser.pages().filter((page) => !page.isClosed());
  const page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();
  if (!isHostname(page.url(), "linkedin.com")) {
    await page.goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch((error) => {
      if (!isHostname(page.url(), "linkedin.com")) throw error;
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  return page;
}

async function experienceExists(page, title, organization) {
  if (!title) return false;
  return page.evaluate(({ title: candidate, organization: org }) => {
    const section = document.querySelector(
      '[componentkey*="ExperienceTopLevelSection"], section[aria-label*="Experiência" i], section[aria-label*="Experience" i]',
    );
    if (!section) return false;
    const text = (section.textContent ?? "").toLowerCase();
    return text.includes(candidate.toLowerCase()) && (!org || text.includes(org.toLowerCase()));
  }, { title, organization });
}

async function experienceTypeahead(page, locator, text) {
  if (!text) return;
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await locator.fill(text);
  const suggestion = page.locator('[role="option"]').first();
  const found = await suggestion.waitFor({ state: "visible", timeout: 6_000 }).then(() => true).catch(() => false);
  if (found) await suggestion.click();
  await page.waitForTimeout(500);
}

async function openExperienceForm(page, title, organization) {
  const match = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  const handle = match ? match[1] : "me";
  await page.evaluate((url) => { window.location.href = url; }, `https://www.linkedin.com/in/${handle}/edit/forms/position/new/`);
  await page.waitForURL((url) => url.href.includes("/edit/forms/position/new"), { timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const inputs = page.locator('input[data-testid="typeahead-input"]');
  await experienceTypeahead(page, inputs.nth(0), title);
  await experienceTypeahead(page, inputs.nth(1), organization);
}

async function setExperienceSelect(page, selector, value) {
  if (!value) return;
  const element = page.locator(selector).first();
  if ((await element.count()) > 0) await element.selectOption(value).catch(() => {});
}

async function setExperienceDates(page, entry) {
  const { startMonth, startYear, endMonth, endYear } = parseDates(entry.dates);
  const dates = entry.dates ?? "";
  const isCurrent = !endYear || dates.toLowerCase().includes("momento") || dates.toLowerCase().includes("present");
  if (!isCurrent) {
    const checkbox = page.locator('[role="checkbox"][aria-label*="Trabalho atualmente" i]').first();
    if ((await checkbox.getAttribute("aria-checked").catch(() => "false")) === "true") {
      await checkbox.click({ force: true });
      await page.waitForTimeout(500);
    }
  }
  await setExperienceSelect(page, 'div[aria-label*="Mês de Data de início"] select', startMonth);
  await setExperienceSelect(page, 'div[aria-label*="Ano de Data de início"] select', startYear);
  if (!isCurrent) {
    await setExperienceSelect(page, 'div[aria-label*="Mês de Data de término"] select', endMonth);
    await setExperienceSelect(page, 'div[aria-label*="Ano de Data de término"] select', endYear);
  }
  return isCurrent;
}

function experienceLocationType(location) {
  const lower = location.toLowerCase();
  if (lower.includes("remote") || lower.includes("remoto")) return "LocationType_REMOTE";
  if (lower.includes("hybrid") || lower.includes("híbrido")) return "LocationType_HYBRID";
  return "";
}

async function selectExperienceLocationType(page, type) {
  if (!type) return;
  for (const select of await page.locator("select").all()) {
    const match = await select.evaluate((element) => [...element.options].some((option) => option.value.startsWith("LocationType_"))).catch(() => false);
    if (match) {
      await select.selectOption(type).catch(() => {});
      break;
    }
  }
}

async function setExperienceLocation(page, location) {
  if (!location) return;
  const input = page.locator(
    'input[aria-label*="Localidade" i], input[aria-label*="Location" i], input[placeholder*="Localidade" i], input[placeholder*="Location" i]',
  ).first();
  if ((await input.count()) > 0) await experienceTypeahead(page, input, location.replace(/[·•].*$/, "").trim());
  await selectExperienceLocationType(page, experienceLocationType(location));
}

async function setExperienceDescription(page, bullets) {
  if (!bullets?.length) return;
  const editor = page.locator('[contenteditable="true"][role="textbox"][aria-label*="Descrição" i]').first();
  if ((await editor.count()) === 0) return;
  await editor.click({ clickCount: 3, force: true });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(bullets.map((bullet) => bullet.trim().startsWith("•") ? bullet.trim() : `• ${bullet.trim()}`).join("\n"));
}

async function saveExperience(page) {
  const save = page.getByRole("button", { name: /^(salvar|save)$/i }).first();
  await save.waitFor({ state: "visible", timeout: 8_000 });
  await save.click();
  await Promise.race([
    page.waitForURL((url) => !url.href.includes("/edit/forms/position/new"), { timeout: 15_000 }),
    save.waitFor({ state: "hidden", timeout: 15_000 }),
  ]).catch(() => {});
}

async function pushExperienceEntry(browser, entry) {
  const page = await experiencePage(browser);
  const title = (entry.title ?? "").trim();
  const organization = (entry.organization ?? "").trim();
  if (await experienceExists(page, title, organization)) {
    return { kind: "experience", status: "skipped", label: `${title} @ ${organization}` };
  }
  await openExperienceForm(page, title, organization);
  await setExperienceDates(page, entry);
  await setExperienceLocation(page, entry.location);
  await setExperienceDescription(page, entry.bullets);
  await saveExperience(page);
  return { kind: "experience", status: "ok", label: `${title} @ ${organization}` };
}

function sectionText(section) {
  return section.copyText ?? section.copy_text;
}

const PROFILE_PUSHERS = {
  headline: (browser, section) => pushHeadline(browser, sectionText(section)),
  about: (browser, section) => pushAbout(browser, sectionText(section)),
  skills: (browser, section) => pushSkills(browser, sectionText(section)),
  education: async (browser, section) => {
    const raw = section.metadata ?? sectionText(section) ?? "{}";
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    await pushEducationEntry(browser, entry);
    return { kind: "education", status: "ok", label: section.label };
  },
  experience: async (browser, section) => {
    const raw = section.metadata ?? sectionText(section);
    const entry = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const result = await pushExperienceEntry(browser, entry);
    return { ...result, label: result.label ?? section.label };
  },
};

async function pushProfileSection(browser, section) {
  const push = PROFILE_PUSHERS[section.kind];
  if (push) return push(browser, section);
  return {
    kind: section.kind,
    status: "manual",
    copyText: sectionText(section),
    editUrl: section.editUrl ?? section.edit_url,
    label: section.label,
  };
}

export async function cmdPushProfile({ handle, sections }) {
  const { browser } = session(handle);
  const results = [];
  for (const section of sections) {
    try {
      results.push(await pushProfileSection(browser, section));
    } catch (error) {
      results.push({ kind: section.kind, status: "error", reason: String(error.message || error) });
    }
  }
  return { results };
}
