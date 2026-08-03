// Pure, unit-testable helpers for the Gupy curriculum auto-fill.
// Key: MONTH_LOOKUP — EN/PT month name+abbreviation → Gupy's exact combobox label
// Key: parseGupyDate — freeform CV date range → {startMonth,startYear,endMonth,endYear,current}
// Key: gupyActivities — bullets → dash-prefixed textarea text
// Key: skillKey — normalized key for dup-detection against existing chips

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_LOOKUP = (() => {
  const m = {};
  MONTHS.forEach((name, i) => {
    m[name.toLowerCase()] = name;
    m[name.slice(0, 3).toLowerCase()] = name;
  });
  const pt = [
    ["janeiro", "jan"],
    ["fevereiro", "fev"],
    ["março", "mar"],
    ["abril", "abr"],
    ["maio", "mai"],
    ["junho", "jun"],
    ["julho", "jul"],
    ["agosto", "ago"],
    ["setembro", "set"],
    ["outubro", "out"],
    ["novembro", "nov"],
    ["dezembro", "dez"],
  ];
  pt.forEach(([full, abbr], i) => {
    m[full] = MONTHS[i];
    m[abbr] = MONTHS[i];
  });
  return m;
})();

const CURRENT_RE = /present|atual|current|now|o momento|até o momento|presente/i;

export function parseGupyDate(dates) {
  const s = String(dates ?? "").trim();
  const out = { startMonth: "", startYear: "", endMonth: "", endYear: "", current: false };
  if (!s) return out;

  const current = CURRENT_RE.test(s);
  const [left, right] = s.split(/\s*(?:-|–|—|\bto\b|\baté\b|\ba\b)\s*/i);

  const pick = (chunk) => {
    if (!chunk) return { month: "", year: "" };
    const year = (chunk.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
    let month = "";
    for (const tok of chunk.split(/[\s/.,]+/)) {
      const hit = MONTH_LOOKUP[tok.toLowerCase()];
      if (hit) {
        month = hit;
        break;
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

export function gupyActivities(bullets) {
  const list = Array.isArray(bullets) ? bullets : bullets ? [String(bullets)] : [];
  return list
    .map((b) => String(b).trim())
    .filter(Boolean)
    .map((b) => (b.startsWith("-") || b.startsWith("•") ? b : `- ${b}`))
    .join("\n\n");
}

export function skillKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
