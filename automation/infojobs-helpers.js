// Pure, unit-testable helpers for the InfoJobs CV experience/education fill.
// Key: parseInfojobsDate — freeform CV date range -> separate numeric month/year fields
// Key: isFutureDate — InfoJobs rejects future dates; used to mark a role/course as ongoing
// Key: educationLevelValue / managerialLevelValue — heuristics for dropdowns absent from the variant
// Key: bestCourseMatch — Jaccard token match of a degree string against InfoJobs' course dropdown

const MONTHS_NUM = (() => {
  const en = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const pt = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const m = {};
  en.forEach((name, i) => {
    m[name] = i + 1;
    m[name.slice(0, 3)] = i + 1;
  });
  pt.forEach((name, i) => {
    m[name] = i + 1;
    m[name.slice(0, 3)] = i + 1;
  });
  return m;
})();

const CURRENT_RE = /present|atual|current|now|até o momento|presente|andamento|cursando/i;

export function parseInfojobsDate(dates) {
  const s = String(dates ?? "").trim();
  const out = { startMonth: "", startYear: "", endMonth: "", endYear: "", current: false };
  if (!s) return out;

  const current = CURRENT_RE.test(s);
  const [left, right] = s.split(/\s*(?:-|–|—|~|\bto\b|\baté\b|\ba\b)\s*/i);

  const pad = (n) => String(n).padStart(2, "0");
  const pick = (chunk) => {
    if (!chunk) return { month: "", year: "" };
    const year = (chunk.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
    let month = "";
    const iso = chunk.match(/\b(19|20)\d{2}[/-](\d{1,2})/);
    const my = chunk.match(/\b(\d{1,2})[/-](19|20)\d{2}/);
    if (iso) month = pad(iso[2]);
    else if (my) month = pad(my[1]);
    else {
      for (const tok of chunk.split(/[\s/.,]+/)) {
        const hit = MONTHS_NUM[tok.toLowerCase()];
        if (hit) {
          month = pad(hit);
          break;
        }
      }
    }
    return { month, year };
  };

  const a = pick(left);
  out.startMonth = a.month;
  out.startYear = a.year;
  if (right && !CURRENT_RE.test(right)) {
    const b = pick(right);
    out.endMonth = b.month;
    out.endYear = b.year;
  }
  out.current = current || (!!out.startYear && !out.endYear);
  return out;
}

export function isFutureDate(month, year, now = new Date()) {
  const y = parseInt(year, 10);
  if (!y) return false;
  const m = month ? parseInt(month, 10) : 1;
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return y > cy || (y === cy && m > cm);
}

export function educationLevelValue(degree) {
  const d = String(degree ?? "").toLowerCase();
  if (/doutor|phd|doctora/.test(d)) return "8";
  if (/mestr|master/.test(d)) return "7";
  if (/pós|pos-|especializa|mba|lato sensu/.test(d)) return "6";
  if (/técnic|tecnic|técnico/.test(d)) return "4";
  if (/médio|medio|ensino médio|2º grau|segundo grau/.test(d)) return "3";
  if (/fundamental|1º grau|primeiro grau/.test(d)) return "1";
  if (/curso|profissionaliz|extra/.test(d)) return "2";
  return "5";
}

export function managerialLevelValue(role) {
  const r = String(role ?? "").toLowerCase();
  if (/diretor|director|head|cto|ceo/.test(r)) return "13";
  if (/gerente|manager/.test(r)) return "12";
  if (/coorden|coordinator/.test(r)) return "11";
  if (/especialista|specialist|sênior|senior|sr\.?|lead|principal/.test(r)) return "10";
  if (/consultor|consultant/.test(r)) return "9";
  if (/estag|intern|trainee/.test(r)) return "1";
  return "6";
}

export function bestCourseMatch(degree, options) {
  const strip = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const STOP = new Set([
    "bacharelado", "licenciatura", "tecnologo", "em", "de", "da", "do", "das", "dos",
    "e", "curso", "superior", "graduacao", "pos", "mba", "especializacao", "mestrado",
    "doutorado", "ensino", "grau",
  ]);
  const stem = (w) => (w.length > 4 ? w.replace(/s$/, "") : w);
  const toks = (s) =>
    strip(s)
      .split(" ")
      .filter((w) => w && !STOP.has(w))
      .map(stem);

  const dTok = new Set(toks(degree));
  if (!dTok.size) return null;

  let best = null;
  for (const opt of options || []) {
    const oTok = toks(opt.label);
    if (!oTok.length) continue;
    const inter = oTok.filter((w) => dTok.has(w)).length;
    if (!inter) continue;
    const union = new Set([...dTok, ...oTok]).size;
    let score = inter / union;
    if (inter === dTok.size || inter === oTok.length) score += 0.3;
    if (!best || score > best.score) best = { value: opt.value, label: opt.label, score };
  }
  return best;
}
