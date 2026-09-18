import { execFileSync } from "node:child_process";

// Single source of truth for the stealth launch config shared by the real
// worker (`worker.js` cmdOpen) and the headless diagnostic harness
// (`headless-test.mjs`). Keeping them identical is the whole point: the harness
// is only honest about "does it work headless" if it launches the browser the
// exact same way the app does. A bare launch (no args, `--enable-automation`
// left on, `HeadlessChrome` UA) gets 403'd by WAF-fronted boards like Catho.

/** Base stealth flags applied to every automation Chromium launch. */
export const BASE_STEALTH_ARGS = [
  "--no-sandbox",
  "--disable-features=DevToolsDebuggingRestrictions,CalculateNativeWinOcclusion",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
  "--disable-dev-shm-usage",
  "--class=HireMeOpsBot",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--mute-audio",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-default-apps",
  "--disable-client-side-phishing-detection",
];

// Headless Chromium advertises `HeadlessChrome/<v>` in its User-Agent, which
// WAF-fronted boards (Catho → 403) block on sight. We override it at the browser
// level (the `--user-agent` flag, NOT Playwright's context `userAgent` — that one
// desyncs from Client Hints and got Indeed blocking us) with the SAME major as the
// installed Chromium so the UA and Sec-CH-UA stay coherent; only the "Headless"
// token is removed. Coherence wins — a real-looking UA that matches the binary.
// ponytail: bump the major when the vendored Chromium jumps a major; stale-by-one
// is a non-signal next to literally announcing "HeadlessChrome".
const HEADLESS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const CLOUD_CHROMIUM_MAJOR_FALLBACK = "152";

function cloudChromiumMajor(executablePath) {
  const override = process.env.HIREMEOPS_CLOUD_CHROMIUM_MAJOR?.trim();
  if (override && /^\d+$/.test(override)) return override;
  if (!executablePath) return CLOUD_CHROMIUM_MAJOR_FALLBACK;
  try {
    const version = execFileSync(executablePath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    return version.match(/(?:Chromium|Chrome)[ /](\d+)/i)?.[1] ?? CLOUD_CHROMIUM_MAJOR_FALLBACK;
  } catch {
    return CLOUD_CHROMIUM_MAJOR_FALLBACK;
  }
}

function cloudHeadlessUserAgent(executablePath) {
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cloudChromiumMajor(executablePath)}.0.0.0 Safari/537.36`;
}

function cloudRendererArgs() {
  return /^(1|true|yes)$/i.test(process.env.HIREMEOPS_CLOUD_DISABLE_RENDERER_PROCESS_LIMIT ?? "")
    ? []
    : ["--renderer-process-limit=1"];
}

export function cloudLaunchOptions({ executablePath, extraArgs = [] } = {}) {
  const cloudHeadlessUA = cloudHeadlessUserAgent(executablePath);
  return {
    headless: true,
    args: [
      ...BASE_STEALTH_ARGS,
      `--user-agent=${cloudHeadlessUA}`,
      "--window-size=1024,768",
      ...cloudRendererArgs(),
      ...extraArgs,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    channel: executablePath ? undefined : "chrome",
    executablePath,
  };
}

/**
 * Base options for `chromium.launchPersistentContext`. Callers spread this and
 * add their own extras (extensions, hidden-display GPU flags, env).
 * `ignoreDefaultArgs: ["--enable-automation"]` is the load-bearing stealth bit —
 * without it Chromium advertises itself as automated and WAFs block on sight.
 * Headless launches also get a de-Headlessed UA (see `HEADLESS_UA`); headed
 * launches keep the real UA (a visible window is never "HeadlessChrome").
 */
export function baseLaunchOptions({ headless = true, executablePath, extraArgs = [] } = {}) {
  // Headless-only coherence: strip the "Headless" UA token and give the window a
  // real desktop size (default headless is 800×600 — a known bot tell, and too
  // small for lazy-loaded board layouts). GPU/WebGL renderer is deliberately NOT
  // forced here: on a headless box it needs specific hardware/Vulkan and did not
  // move the needle on the IP-reputation-gated sites (Indeed/Upwork) in testing —
  // that path lives in the headed + Xvfb "hidden" mode where a real GPU exists.
  const headlessUA = process.env.HIREMEOPS_CLOUD
    ? cloudHeadlessUserAgent(executablePath)
    : HEADLESS_UA;
  const uaArgs = headless ? [`--user-agent=${headlessUA}`, "--window-size=1920,1080"] : [];
  // Cloud uses one page/profile per job; cap renderer fan-out and use a smaller
  // desktop viewport only there. Local headed/headless behavior stays unchanged.
  const cloudArgs = process.env.HIREMEOPS_CLOUD
    ? [...cloudRendererArgs(), "--window-size=1024,768"]
    : [];
  return {
    headless,
    viewport: null,
    args: [...BASE_STEALTH_ARGS, ...uaArgs, ...cloudArgs, ...extraArgs],
    ignoreDefaultArgs: ["--enable-automation"],
    channel: executablePath ? undefined : "chrome",
    executablePath,
  };
}
