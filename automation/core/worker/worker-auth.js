import { chromium } from "patchright";
import { isHostname, sessions, indeedPopups } from "./worker-context.js";
import { reclaimProfileDir, resolveChromiumExec } from "./worker-lifecycle.js";
import { attachDiagnostics } from "../capture/capture.js";
import { CAPTURE_ENABLED } from "../capture/capture-config.js";
import {
  LOGIN_PROBES,
  classifyLinkedInAuth,
  classifyLogin,
  sanitizeProbeError,
  sanitizeProbeUrl,
  selectLoginProbeSites,
} from "../auth/auth-classification.js";
import { inspectLinkedInAuthDocument } from "../../platforms/linkedin/linkedin-search-dom.js";

export {
  classifyLinkedInAuth,
  classifyLogin,
  classifyPlatformUrl,
  sanitizeProbeError,
  selectLoginProbeSites,
} from "../auth/auth-classification.js";

export async function cmdCheckLogin({ user_data_dir }) {
  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) return probeExistingLogin(existing.browser);

  await reclaimProfileDir(user_data_dir);
  return probeFreshLogin(user_data_dir);
}

async function probeExistingLogin(browser) {
  const page = await browser.newPage();
  try {
    return { logged_in: (await probeLinkedInPage(page)) === "valid" };
  } catch {
    return { logged_in: false };
  } finally {
    await page.close().catch(() => {});
  }
}

async function probeLinkedInPage(page) {
  await page.goto(LOGIN_PROBES.linkedin.url, { waitUntil: "commit", timeout: 30_000 });
  return (await waitForLinkedInAuthState(page)).status;
}

export async function waitForLinkedInAuthState(
  page,
  { timeout = 15_000, pollInterval = 250 } = {},
) {
  const deadline = Date.now() + Math.max(0, timeout);
  let markers = await readLinkedInAuthMarkers(page);
  let status = classifyLinkedInAuth({ url: page.url(), ...markers });
  while (status === "unknown" && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(pollInterval, deadline - Date.now()));
    markers = await readLinkedInAuthMarkers(page);
    status = classifyLinkedInAuth({ url: page.url(), ...markers });
  }
  return { status, markers };
}

async function readLinkedInAuthMarkers(page) {
  try {
    return (await page.evaluate?.(inspectLinkedInAuthDocument)) ?? {};
  } catch {
    return {};
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
    const probePage = await browser.newPage();
    try {
      return { logged_in: (await probeLinkedInPage(probePage)) === "valid" };
    } finally {
      await probePage.close().catch(() => {});
    }
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

export async function cmdOpenLoginTabs({ handle, sites }) {
  const sess = sessions.get(handle);
  if (!sess) throw new Error(`open_login_tabs: unknown handle ${handle}`);
  const { browser, page } = sess;
  const wanted = (sites && sites.length ? sites : Object.keys(LOGIN_URLS)).filter(
    (s) => LOGIN_URLS[s],
  );
  const opened = [];
  for (let i = 0; i < wanted.length; i++) {
    const existingPage = findExistingLoginPage(browser, LOGIN_URLS[wanted[i]]);
    const p = existingPage ?? (i === 0 ? page : await browser.newPage());
    if (!existingPage && CAPTURE_ENABLED) attachDiagnostics(p);
    await navigateLoginProbe(p, LOGIN_URLS[wanted[i]], 45_000).catch(() => {});
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
  if (site === "linkedin") {
    const probePage = await browser.newPage();
    try {
      result.platform_status[site] = await probeLinkedInPage(probePage);
      result.status[site] = result.platform_status[site] === "valid";
    } catch (error) {
      recordProbeFailure(result, site, error, probePage);
    } finally {
      await probePage.close().catch(() => {});
    }
    return;
  }
  const existingPage = findExistingLoginPage(browser, url);
  const tab = existingPage ?? sharedPage ?? (await browser.newPage());
  const ownsPage = !existingPage && !sharedPage;
  try {
    await navigateLoginProbe(tab, url);
    result.platform_status[site] = await classifyProbePage(site, tab, out);
    result.status[site] = result.platform_status[site] === "valid";
  } catch (error) {
    recordProbeFailure(result, site, error, tab);
  } finally {
    if (ownsPage) await tab.close().catch(() => {});
  }
}

async function classifyProbePage(site, page, out = LOGIN_PROBES[site]?.out) {
  const url = page.url();
  if (site !== "linkedin") return classifyLogin(url, out);
  const markers = await readLinkedInAuthMarkers(page);
  return classifyLinkedInAuth({ url, ...markers });
}

function findExistingLoginPage(browser, probeUrl) {
  const host = new URL(probeUrl).hostname;
  return browser.pages().find((page) => {
    if (page.isClosed()) return false;
    try {
      return isHostname(page.url(), host);
    } catch {
      return false;
    }
  });
}

async function navigateLoginProbe(page, url, timeout = 30_000) {
  if (isHostname(page.url(), new URL(url).hostname)) return;
  await page.goto(url, { waitUntil: "commit", timeout });
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
