export const sessions = new Map();
export const indeedPopups = new Map();

export function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function isHostname(url, hostname) {
  try {
    const actual = new URL(url).hostname.toLowerCase();
    return actual === hostname || actual.endsWith(`.${hostname}`);
  } catch {
    return false;
  }
}

export function isGmailLoginUrl(url) {
  try {
    const parsed = new URL(url);
    return isHostname(parsed.href, "accounts.google.com") || /(?:^|\/)ServiceLogin(?:\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function session(handle) {
  const sess = sessions.get(handle);
  if (!sess) throw new Error(`No session for handle: ${handle}`);
  return sess;
}

export async function activePage(handle) {
  const { browser } = session(handle);
  const pages = browser.pages().filter((p) => !p.isClosed());
  if (pages.length > 0) return pages[pages.length - 1];
  return browser.newPage();
}

export async function closeAll() {
  const handles = [...sessions.keys()];
  for (const h of handles) {
    const sess = sessions.get(h);
    sessions.delete(h);
    await sess?.browser.close().catch(() => {});
  }
}
