export const LOGIN_PROBES = {
  linkedin: {
    url: "https://www.linkedin.com/feed/",
    out: /\/login|\/authwall|\/checkpoint|\/uas\/login/,
  },
  catho: {
    url: "https://www.catho.com.br/area-candidato/",
    out: /\/login|\/signin|\/entrar|account\.catho/,
  },
  infojobs: {
    url: "https://www.infojobs.com.br/candidate/cv/insert2.aspx",
    out: /\/login|\/entrar|\/candidate\/login/,
  },
  indeed: { url: "https://myjobs.indeed.com/", out: /\/auth|\/account\/login|secure\.indeed\.com/ },
  gupy: {
    url: "https://login.gupy.io/candidates/curriculum",
    out: /\/candidates\/(sign-?in|login)/,
  },
};

export function selectLoginProbeSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0) return Object.keys(LOGIN_PROBES);
  return sites.filter((site) => LOGIN_PROBES[site]);
}

export function classifyLogin(url, out) {
  if (/checkpoint|challenge|captcha|mfa|verify|verification/i.test(url)) return "challenged";
  if (out.test(url)) return "login_required";
  return "valid";
}

export function classifyLinkedInAuth({
  url = "",
  authenticatedMarkers = 0,
  authenticatedNavDestinations = 0,
  loginMarkers = 0,
  challengeMarkers = 0,
} = {}) {
  const urlStatus = classifyLogin(String(url), LOGIN_PROBES.linkedin.out);
  if (urlStatus !== "valid") return urlStatus;
  if (Number(challengeMarkers) > 0) return "challenged";
  if (Number(loginMarkers) > 0) return "login_required";
  return Number(authenticatedMarkers) > 0 || Number(authenticatedNavDestinations) >= 3
    ? "valid"
    : "unknown";
}

export function classifyPlatformUrl(platform, url) {
  const probe = LOGIN_PROBES[platform];
  if (!probe || !url) return "unknown";
  return classifyLogin(String(url), probe.out);
}

export function sanitizeProbeUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[unavailable]";
  }
}

export function sanitizeProbeError(error) {
  return String(error?.message ?? error)
    .replace(/\s+/g, " ")
    .replace(
      /(authorization|cookie|set-cookie|token|password|secret|key)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 300);
}
