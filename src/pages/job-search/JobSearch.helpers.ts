// Pure text/derivation helpers for the Vagas (JobSearch) page. Kept out of the
// component file so the page module only exports a component (fast-refresh) and
// so these stay unit-testable in isolation (see JobSearch.extractAssunto.test).

// Derive the selected work models from the calibration `remoteModes` preference.
// Was inlined per-platform and only ever emitted remote+hybrid — on-site jobs
// were never queried. Order is stable so per-model passes are deterministic.
export function workModelsFrom(remoteModes: string[]): string[] {
  const has = (...kws: string[]) =>
    remoteModes.some((m) => kws.some((k) => m.toLowerCase().includes(k)));
  const out: string[] = [];
  if (has("remote", "remoto", "home")) out.push("remote");
  if (has("hybrid", "hibrid", "híbr")) out.push("hybrid");
  if (has("onsite", "on-site", "presen", "local")) out.push("onsite");
  return out;
}

// Scans a job description for a recruiter-specified subject line.
// Matches Portuguese "Assunto: ..." or English "Subject: ..." (case-insensitive).
const ASSUNTO_RE = /(?:assunto|subject)\s*[:-]\s*(.+)/i;

export function extractAssunto(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = ASSUNTO_RE.exec(text);
  if (!m) return null;
  return m[1].trim().slice(0, 120);
}

// Detect a contact phone in post text. Matches Brazilian forms: "(11) 91234-5678",
// "(11)1234-5678", and the bare dashed "91234-5678" / "1234-5678". The dash is the
// anchor for the bare form so plain digit runs (dates, ids) don't false-match.
const PHONE_RE = /\(\d{2}\)\s?9?\d{4}-?\d{4}|\b9?\d{4}-\d{4}\b/;

export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = PHONE_RE.exec(text);
  return m ? m[0].trim() : null;
}
