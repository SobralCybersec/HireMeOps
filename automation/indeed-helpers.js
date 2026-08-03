// Pure, unit-testable helpers for the Indeed SmartApply question module.
// Key: classifyIndeedQuestion — buckets a screening question label; consent always wins over auth/experience

const CONSENT_RE =
  /ciente|consinto|consentimento|consent|lgpd|13\.?709|dados pessoais|antecedent|background\s*check|declaro|verdadeir|certif/i;
const AUTH_RE =
  /autoriz|legalmente.*trabalh|trabalhar no brasil|legally.*(work|authorized)|authorized to work|eleg[ií]vel para trabalh/i;
const EXPERIENCE_RE =
  /anos de experi[êe]ncia|years of experience|possui.*(cnh|registro|licen[çc]a|certifica)|valid (license|certificat)/i;

export function classifyIndeedQuestion(label) {
  const s = (label || "").trim();
  if (CONSENT_RE.test(s)) return "consent";
  if (AUTH_RE.test(s)) return "auth";
  if (EXPERIENCE_RE.test(s)) return "unverifiable";
  return "default";
}
