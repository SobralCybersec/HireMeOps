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

export async function cmdCheckLogins({ user_data_dir }) {
  const status = { linkedin: false, catho: false, infojobs: false, indeed: false, gupy: false };
  const probeOne = async (browser, site) => {
    const { url, out } = LOGIN_PROBES[site];
    let tab;
    try {
      tab = await browser.newPage();
      await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      status[site] = !out.test(tab.url());
    } catch {
      status[site] = false;
    } finally {
      if (tab) await tab.close().catch(() => {});
    }
  };

  const existing = [...sessions.values()].find((s) => s.user_data_dir === user_data_dir);
  if (existing) {
    for (const site of Object.keys(LOGIN_PROBES)) await probeOne(existing.browser, site);
    return { status };
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
    for (const site of Object.keys(LOGIN_PROBES)) await probeOne(browser, site);
  } catch {
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { status };
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
