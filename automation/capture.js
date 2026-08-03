// Diagnostic capture: snapshot page DOM/network/console to disk for post-failure inspection.
// Key: attachDiagnostics — buffers console/page errors onto page.__diag
// Key: attachNetworkCapture — buffers JSON/fetch responses onto context.__net
// Key: captureDom — writes {ts}-{label}.html/.json/.png/.mhtml, prunes old bundles
// Key: captureResult — wraps a command result with a capture bundle

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export const CAPTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures");
const MAX_CONSOLE = 60;
const MAX_BUNDLES = 40;

async function pruneCaptures(keep = MAX_BUNDLES) {
  try {
    const files = await fs.readdir(CAPTURE_DIR);
    const bases = [...new Set(files.map((f) => f.replace(/\.(html|json|png|mhtml|pdf)$/i, "")))].sort();
    const stale = bases.slice(0, Math.max(0, bases.length - keep));
    await Promise.all(
      stale.flatMap((b) =>
        files.filter((f) => f.startsWith(`${b}.`)).map((f) => fs.rm(path.join(CAPTURE_DIR, f)).catch(() => {})),
      ),
    );
  } catch {
  }
}

export function attachDiagnostics(page) {
  if (!page || page.__diagAttached || typeof page.on !== "function") return page;
  page.__diagAttached = true;
  page.__diag = [];
  const push = (entry) => {
    page.__diag.push({ t: new Date().toISOString(), ...entry });
    if (page.__diag.length > 300) page.__diag.shift();
  };
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") push({ kind: "console", type, text: msg.text().slice(0, 2000) });
  });
  page.on("pageerror", (err) => push({ kind: "pageerror", text: String(err?.message ?? err).slice(0, 2000) }));
  page.on("requestfailed", (req) =>
    push({ kind: "requestfailed", text: `${req.method()} ${req.url()} — ${req.failure()?.errorText ?? ""}`.slice(0, 400) }),
  );
  return page;
}

const NET_MAX_BODY = 64 * 1024;
const NET_RING = 120;

export function attachNetworkCapture(context) {
  if (!context || context.__netAttached || typeof context.on !== "function") return context;
  context.__netAttached = true;
  context.__net = [];
  const push = (entry) => {
    context.__net.push({ t: new Date().toISOString(), ...entry });
    if (context.__net.length > NET_RING) context.__net.shift();
  };
  context.on("response", (response) => {
    let req, ct, type, status;
    try {
      req = response.request();
      ct = (response.headers()["content-type"] || "").toLowerCase();
      type = req.resourceType();
      status = response.status();
    } catch {
      return;
    }
    const looksJson = ct.includes("application/json") || ct.includes("+json");
    if (!looksJson && type !== "fetch" && type !== "xhr") return;
    if (status >= 300 && status < 400) return;
    if (status === 204 || status === 304) return;
    const meta = { url: response.url(), method: req.method(), status, type, ct };
    const len = Number(response.headers()["content-length"] || 0);
    if (len > NET_MAX_BODY) {
      push({ ...meta, body: `…[${len} bytes, skipped]` });
      return;
    }
    response
      .text()
      .then((text) => {
        const body = text.length > NET_MAX_BODY ? `${text.slice(0, NET_MAX_BODY)}…[truncated]` : text;
        push({ ...meta, body });
      })
      .catch(() => {});
  });
  return context;
}

function networkLog(page, keep = 40) {
  try {
    const ctx = typeof page.context === "function" ? page.context() : null;
    return ctx && Array.isArray(ctx.__net) ? ctx.__net.slice(-keep) : [];
  } catch {
    return [];
  }
}

async function ariaSnapshot(page) {
  try {
    const snap = await page.locator("body").ariaSnapshot({ mode: "ai" });
    return snap.length > NET_MAX_BODY ? `${snap.slice(0, NET_MAX_BODY)}…[truncated]` : snap;
  } catch {
    return null;
  }
}

const slug = (s) => String(s || "capture").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60);

async function visibleErrors(page) {
  return page
    .evaluate(() => {
      const sels = [
        ".mError:not(.hidden)",
        ".merror:not(.hidden)",
        "[id$='-error-message']",
        ".error-message__wrapper span",
        "[role='alert']",
        "[aria-invalid='true']",
        ".error:not(.hidden)",
        ".field-error",
      ];
      const seen = new Set();
      const out = [];
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!txt) continue;
          const st = window.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden") continue;
          const key = txt.slice(0, 120);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ sel, id: el.id || null, text: txt.slice(0, 300) });
          if (out.length >= 40) return out;
        }
      }
      return out;
    })
    .catch(() => []);
}

export async function captureDom(page, label = "capture", extra = {}) {
  try {
    await fs.mkdir(CAPTURE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${stamp}-${slug(label)}`;
    const htmlPath = path.join(CAPTURE_DIR, `${base}.html`);
    const jsonPath = path.join(CAPTURE_DIR, `${base}.json`);
    const pngPath = path.join(CAPTURE_DIR, `${base}.png`);
    const mhtmlPath = path.join(CAPTURE_DIR, `${base}.mhtml`);
    const pdfPath = path.join(CAPTURE_DIR, `${base}.pdf`);

    await reflectFormState(page);

    const html = await page.content().catch((e) => `<!-- page.content() failed: ${e?.message ?? e} -->`);
    await fs.writeFile(htmlPath, html, "utf8");

    const shot = await page
      .screenshot({ fullPage: true })
      .then((buf) => (fs.writeFile(pngPath, buf), pngPath))
      .catch(() => null);

    const mhtml = await captureMhtml(page, mhtmlPath);
    const pdf = await capturePdf(page, pdfPath);

    const meta = {
      label,
      at: new Date().toISOString(),
      url: page.url(),
      title: await page.title().catch(() => ""),
      validationErrors: await visibleErrors(page),
      network: networkLog(page),
      ariaSnapshot: await ariaSnapshot(page),
      console: (page.__diag || []).slice(-MAX_CONSOLE),
      ...extra,
    };
    await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf8");
    await pruneCaptures();
    return { html: htmlPath, json: jsonPath, png: shot, mhtml, pdf };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

async function captureMhtml(page, filePath) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
    await cdp.detach().catch(() => {});
    await fs.writeFile(filePath, data, "utf8");
    return filePath;
  } catch {
    return null;
  }
}

// Page-print to PDF over raw CDP (Page.printToPDF). Uses only the Page domain — no Runtime.enable —
// so it doesn't reintroduce the patchright stealth leak, and (per SeleniumBase CDP mode) works on a
// HEADED Chrome, which is the mode we always run in. Returns null on any failure (evidence is
// best-effort; a missing PDF must never fail the automation command).
async function capturePdf(page, filePath) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
    });
    await cdp.detach().catch(() => {});
    await fs.writeFile(filePath, Buffer.from(data, "base64"));
    return filePath;
  } catch {
    return null;
  }
}

async function reflectFormState(page) {
  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll("input, textarea, select")) {
        try {
          if (el.tagName === "SELECT") {
            for (const o of el.options) o.toggleAttribute("selected", o.selected);
          } else if (el.type === "checkbox" || el.type === "radio") {
            el.toggleAttribute("checked", el.checked);
          } else if (el.tagName === "TEXTAREA") {
            el.textContent = el.value;
          } else {
            el.setAttribute("value", el.value ?? "");
          }
        } catch {}
      }
    })
    .catch(() => {});
}

export async function captureResult(page, label, result) {
  const isArr = Array.isArray(result);
  const list = !isArr && Array.isArray(result?.results) ? result.results : [];
  const cap = await captureDom(page, label, {
    summary: list.length
      ? list.map((r) => ({ kind: r?.kind, status: r?.status, label: r?.label, reason: r?.reason }))
      : undefined,
    count: isArr ? result.length : undefined,
    hadErrors: list.some((r) => r && (r.status === "error" || r.status === "manual")) || result?.status === "error",
  });
  if (result && typeof result === "object" && !isArr) return { ...result, capture: cap };
  return result;
}
