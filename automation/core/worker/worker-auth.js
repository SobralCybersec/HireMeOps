import { chromium } from "patchright";
import { sessions, indeedPopups } from "./worker-context.js";
import { reclaimProfileDir, resolveChromiumExec } from "./worker-lifecycle.js";

export async function cmdCheckLogin({ user_data_dir }) {
  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) return probeExistingLogin(existing.browser);

  await reclaimProfileDir(user_data_dir);
  return probeFreshLogin(user_data_dir);
}

const isLoggedInUrl = (url) => !/\/login|\/authwall|\/checkpoint|\/uas\/login/.test(url);

async function probeExistingLogin(browser) {
  let probe;
  try {
    probe = await browser.newPage();
    await probe.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return { logged_in: isLoggedInUrl(probe.url()) };
  } catch {
    return { logged_in: false };
  } finally {
    if (probe) await probe.close().catch(() => {});
  }
}

async function probeFreshLogin(userDataDir) {
  const resolvedExec = resolveChromiumExec();
  let browser;
  try {
    browser = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: resolvedExec ? undefined : "chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: resolvedExec,
    });
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return { logged_in: isLoggedInUrl(page.url()) };
  } catch {
    return { logged_in: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const LOGIN_URLS = {
  linkedin: "https://www.linkedin.com/login",
  catho: "https://www.catho.com.br/signin/",
  infojobs: "https://www.infojobs.com.br/candidate/cv/insert2.aspx",
  indeed: "https://secure.indeed.com/auth",
  gupy: "https://login.gupy.io/candidates/signin",
  gpt: "https://chatgpt.com/auth/login",
};

const LOGIN_PROBES = {
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

export async function cmdOpenLoginTabs({ handle, sites }) {
  const sess = sessions.get(handle);
  if (!sess) throw new Error(`open_login_tabs: unknown handle ${handle}`);
  const { browser, page } = sess;
  const wanted = (sites && sites.length ? sites : Object.keys(LOGIN_URLS)).filter(
    (s) => LOGIN_URLS[s],
  );
  const opened = [];
  for (let i = 0; i < wanted.length; i++) {
    const p = i === 0 ? page : await browser.newPage();
    attachDiagnostics(p);
    await p
      .goto(LOGIN_URLS[wanted[i]], { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => {});
    opened.push(wanted[i]);
  }
  return { opened };
}

export async function cmdCheckLogins({ user_data_dir, reuse_page = false, sites }) {
  const probeSites = selectLoginProbeSites(sites);
  const result = createLoginResult(probeSites);
  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) {
    const sharedPage = reuse_page ? existing.page : null;
    return checkBrowserLogins(existing.browser, sharedPage, result, probeSites);
  }
  await reclaimProfileDir(user_data_dir);
  const resolvedExec = resolveChromiumExec();
  let browser;
  try {
    browser = await chromium.launchPersistentContext(user_data_dir, {
      headless: true,
      channel: resolvedExec ? undefined : "chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: resolvedExec,
    });
    const sharedPage = reuse_page ? (browser.pages()[0] ?? (await browser.newPage())) : null;
    await checkBrowserLogins(browser, sharedPage, result, probeSites);
  } catch {
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return result;
}

function createLoginResult(sites) {
  return {
    status: Object.fromEntries(sites.map((site) => [site, false])),
    platform_status: {},
  };
}

async function checkBrowserLogins(browser, sharedPage, result, sites) {
  for (const site of sites) {
    await probeLogin(browser, site, sharedPage, result);
  }
  return result;
}

async function probeLogin(browser, site, sharedPage, result) {
  const { url, out } = LOGIN_PROBES[site];
  const tab = sharedPage ?? (await browser.newPage());
  try {
    await tab.goto(url, { waitUntil: "commit", timeout: 30_000 });
    const currentUrl = tab.url();
    result.platform_status[site] = classifyLogin(currentUrl, out);
    result.status[site] = result.platform_status[site] === "valid";
    await tab.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  } catch (error) {
    recordProbeFailure(result, site, error, tab);
  } finally {
    if (!sharedPage) await tab.close().catch(() => {});
  }
}

function recordProbeFailure(result, site, error, tab) {
  result.status[site] = false;
  result.platform_status[site] = "unknown";
  result.platform_errors ??= {};
  result.platform_errors[site] = {
    name: error?.name ?? "Error",
    message: sanitizeProbeError(error),
    url: sanitizeProbeUrl(tab.url()),
  };
}

function sanitizeProbeUrl(value) {
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
    .replace(/(authorization|cookie|set-cookie|token|password|secret|key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 300);
}

export async function cmdClose({ handle }) {
  const popup = indeedPopups.get(handle);
  if (popup) {
    indeedPopups.delete(handle);
    await popup.close().catch(() => {});
  }
  const sess = sessions.get(handle);
  if (sess) {
    sessions.delete(handle);
    await sess.browser.close().catch(() => {});
  }
  return {};
}
