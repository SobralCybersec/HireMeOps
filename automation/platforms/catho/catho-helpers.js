// Pure (browser-free) helpers for the Catho curriculo fill.
// Key: cathoParseMeta — parses a section's metadata (JSON string or object)
// Key: cathoMonthYear / cathoParseDates — freeform CV date text -> MM/YYYY range
// Key: cathoBulletList — bullets -> Catho's "principais atividades" textarea text
// Key: cathoDegreeValue — free-text degree -> Catho's #degree option value
export function cathoParseMeta(meta) {
  if (!meta) return {};
  try {
    return typeof meta === "string" ? JSON.parse(meta) : meta;
  } catch {
    return {};
  }
}

const MONTH3 = {
  jan: 1,
  fev: 2,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  set: 9,
  sep: 9,
  out: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

export function cathoMonthYear(part) {
  const s = String(part ?? "").trim();
  if (!s) return "";
  const num = s.match(/\b(0?[1-9]|1[0-2])\s*[/.]\s*((?:19|20)\d{2})\b/);
  if (num) return `${String(num[1]).padStart(2, "0")}/${num[2]}`;
  const wy = s.match(/([A-Za-zÀ-ÿ]{3,})\.?\s*(?:de\s+|of\s+)?((?:19|20)\d{2})/i);
  if (wy) {
    const key = wy[1]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .slice(0, 3);
    return `${String(MONTH3[key] ?? 1).padStart(2, "0")}/${wy[2]}`;
  }
  const y = s.match(/\b((?:19|20)\d{2})\b/);
  return y ? `01/${y[1]}` : "";
}

export function cathoParseDates(dates) {
  const parts = String(dates ?? "").split(/\s*[–—]\s*|\s+-\s+|\s+(?:a|até|to)\s+/i);
  const endRaw = parts[1] ?? "";
  const current = /atual|cursando|current|present|momento|hoje|em andamento/i.test(endRaw);
  return {
    start: cathoMonthYear(parts[0]),
    end: current ? "" : cathoMonthYear(endRaw),
    current,
  };
}

export function cathoBulletList(bullets) {
  return (Array.isArray(bullets) ? bullets : [])
    .map((b) => String(b ?? "").trim())
    .filter(Boolean)
    .map((b) => (b.startsWith("•") || /^tech stack/i.test(b) ? b : `• ${b}`))
    .join("\n\n");
}

export function cathoDegreeValue(degree) {
  const s = String(degree ?? "").toLowerCase();
  if (/mestrado/.test(s)) return "4";
  if (/doutorado/.test(s)) return "5";
  if (/\bmba\b/.test(s)) return "3";
  if (/pós-?doc|pos-?doc/.test(s)) return "6";
  if (/pós|pos-?grad|especializ/.test(s)) return "2";
  if (/técnic|tecnic/.test(s)) return "8";
  if (/médio|medio|ensino m/.test(s)) return "9";
  return "1";
}
