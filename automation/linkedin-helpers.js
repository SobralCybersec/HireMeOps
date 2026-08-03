// Pure (browser-free) helpers for the LinkedIn profile push.
// Key: PT_MONTH — PT month abbreviation → LinkedIn's month <select> value (1-12)
// Key: parseDates — "fev de 2026 - fev de 2028" / "2020-2025" → {startMonth,startYear,endMonth,endYear}

export const PT_MONTH = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

export function parseDates(dates) {
  if (!dates) return {};
  const parts = dates
    .split(/[–—\-]/)
    .map((s) => s.trim())
    .filter(Boolean);
  function parsePart(s) {
    const withMonth = s.match(/(\w{3})\s+de\s+(\d{4})/i);
    if (withMonth) {
      const m = PT_MONTH[withMonth[1].toLowerCase()];
      return { month: m ? String(m) : "", year: withMonth[2] };
    }
    const yearOnly = s.match(/(\d{4})/);
    if (yearOnly) return { month: "", year: yearOnly[1] };
    return {};
  }
  const start = parts[0] ? parsePart(parts[0]) : {};
  const end = parts[1] ? parsePart(parts[1]) : {};
  return {
    startMonth: start.month ?? "",
    startYear: start.year ?? "",
    endMonth: end.month ?? "",
    endYear: end.year ?? "",
  };
}
