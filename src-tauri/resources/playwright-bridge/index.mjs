import { createHash, randomUUID } from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Fix IPv6/IPv4 resolution issue in Node 17+ (localhost resolves to ::1 instead of 127.0.0.1)
// See: https://github.com/microsoft/playwright/issues/20784
dns.setDefaultResultOrder('ipv4first')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
async function importPlaywright() {
  const candidateUrls = [
    // patchright — the stealth fork we vendor (identical Playwright API,
    // self-contained core + Chromium installer). The bridge's own node_modules
    // is NOT shipped; the bundle stages patchright at ../node_modules (see
    // tauri.conf.json resources + prepare-tauri-playwright-resources.mjs).
    new URL('./node_modules/patchright/index.mjs', import.meta.url),
    new URL('../node_modules/patchright/index.mjs', import.meta.url),
    new URL('../../node_modules/patchright/index.mjs', import.meta.url),
    new URL('../../../node_modules/patchright/index.mjs', import.meta.url),
  ]

  for (const candidate of candidateUrls) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return import(candidate)
    }
  }

  const pnpmRoots = [
    path.resolve(__dirname, 'node_modules', '.pnpm'),
    path.resolve(__dirname, '..', 'node_modules', '.pnpm'),
    path.resolve(__dirname, '..', '..', 'node_modules', '.pnpm'),
    path.resolve(__dirname, '..', '..', '..', 'node_modules', '.pnpm'),
  ]

  for (const root of pnpmRoots) {
    if (!fs.existsSync(root)) {
      continue
    }

    const patchrightDir = fs
      .readdirSync(root, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith('patchright@'))

    if (!patchrightDir) {
      continue
    }

    const candidate = path.join(root, patchrightDir.name, 'node_modules', 'patchright', 'index.mjs')
    if (fs.existsSync(candidate)) {
      return import(pathToFileURL(candidate).href)
    }
  }

  return import('patchright')
}

const playwright = await importPlaywright()
const { chromium, firefox, webkit } = playwright

function isHostname(url, hostname) {
  try {
    const actual = new URL(url).hostname.toLowerCase()
    return actual === hostname || actual.endsWith(`.${hostname}`)
  } catch {
    return false
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// Defense-in-depth: account_id is joined to a filesystem profile path.
// Reject anything outside [A-Za-z0-9_-]{1,64} before path.resolve sees it.
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/
function assertSafeAccountId(accountId) {
  if (accountId != null && accountId !== '' && !SAFE_ACCOUNT_ID.test(accountId)) {
    throw new Error(`unsafe account_id rejected: ${accountId}`)
  }
}

function resolveEngine(browser) {
  switch (browser) {
    case 'firefox':
      return { engine: firefox }
    case 'webkit':
      return { engine: webkit }
    case 'chrome':
      return { engine: chromium, channel: 'chrome' }
    case 'edge':
    case 'msedge':
      return { engine: chromium, channel: 'msedge' }
    case 'chromium':
    default:
      return { engine: chromium }
  }
}

// Resolve a system Chromium binary. Env override first, then well-known paths.
// Using the full system Chromium lets headless run via `--headless` and avoids
// Playwright's separate `chromium_headless_shell` download, which is frequently
// not installed (e.g. after `playwright install chromium` only).
function resolveChromiumExecutable() {
  const FALLBACK_PATHS = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/brave-browser',
  ]
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    FALLBACK_PATHS.find((p) => fs.existsSync(p)) ||
    undefined
  )
}

// ---------------------------------------------------------------------------
// Stealth helpers — shared across all provider init functions
// ---------------------------------------------------------------------------

function stealthArgs() {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=DevToolsDebuggingRestrictions',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-dev-shm-usage',
  ]
}

async function applyStealthScripts(context) {
  await context.addInitScript(() => {
    // Core tell: webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })

    // Headless Chromium reports 0 plugins; real Chrome ships with 5.
    Object.defineProperty(navigator, 'plugins', {
      get: () => Object.assign([1, 2, 3, 4, 5], {
        item: () => null,
        namedItem: () => null,
        refresh: () => {},
      }),
    })

    // Headless can return an empty language list
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })

    // Realistic CPU count
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })

    // window.chrome is absent in headless — detectors check for it
    if (!window.chrome) window.chrome = {}
    if (!window.chrome.runtime) window.chrome.runtime = {}

    // Remove Playwright's residual CDP automation markers
    ;[
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    ].forEach(p => { try { delete window[p] } catch {} })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getParseTime() {
  const d = new Date()
  const parts = d.toString().match(/^(.*?) GMT/)
  return parts ? parts[1].trim() + ' GMT-0500 (Eastern Standard Time)' : d.toString()
}

function getPowConfig(userAgent, dpl) {
  const cores = [8, 16, 24, 32]
  const screens = [3000, 4000, 3120, 4160]
  const navigatorKeys = [
    'webdriver−false',
    'hardwareConcurrency−8',
    'cookieEnabled−true',
    'pdfViewerEnabled−true',
    'vendor−Google Inc.',
    'product−Gecko',
  ]
  const documentKeys = ['location', '_reactListeningo743lnnpvdg']
  const windowKeys = ['window', 'document', 'location', 'navigator', 'chrome', 'performance']
  const perfNow = typeof performance !== 'undefined' ? performance.now() * 1000 : Date.now()

  return [
    screens[Math.floor(Math.random() * screens.length)],
    getParseTime(),
    4294705152,
    0,
    userAgent,
    dpl ? `https://cdn.oaistatic.com/_next/static/${dpl}/_ssgManifest.js` : '',
    dpl || '',
    'en-US',
    'en-US,en',
    0,
    navigatorKeys[Math.floor(Math.random() * navigatorKeys.length)],
    documentKeys[Math.floor(Math.random() * documentKeys.length)],
    windowKeys[Math.floor(Math.random() * windowKeys.length)],
    perfNow,
    randomUUID(),
    '',
    cores[Math.floor(Math.random() * cores.length)],
    Date.now() - perfNow,
  ]
}

function generatePowAnswer(seed, diff, config) {
  const targetDiff = Buffer.from(diff, 'hex')
  const diffLen = targetDiff.length
  const seedBuf = Buffer.from(seed)

  for (let i = 0; i < 500000; i += 1) {
    config[3] = i
    config[9] = i >> 1
    const jsonData = JSON.stringify(config)
    const base = Buffer.from(jsonData).toString('base64')
    const hash = createHash('sha3-512').update(Buffer.concat([seedBuf, Buffer.from(base)])).digest()
    if (Buffer.compare(hash.subarray(0, diffLen), targetDiff) <= 0) {
      return { answer: base, solved: true }
    }
  }
  const fallbackBase = Buffer.from(`"${seed}"`).toString('base64')
  return { answer: 'wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D' + fallbackBase, solved: false }
}

function getRequirementsToken(config) {
  const clonedConfig = [...config]
  const { answer } = generatePowAnswer(String(Math.random()), '0fffff', clonedConfig)
  return 'gAAAAAC' + answer
}

function getProofToken(seed, difficulty, config) {
  const clonedConfig = [...config]
  const { answer, solved } = generatePowAnswer(seed, difficulty, clonedConfig)
  return { token: 'gAAAAAB' + answer, solved }
}

async function extractDpl(page) {
  return page.evaluate(() => {
    const dataBuild = document.documentElement.getAttribute('data-build')
    if (dataBuild) return dataBuild
    for (const script of document.querySelectorAll('script[src]')) {
      const match = (script.getAttribute('src') || '').match(/\/_next\/static\/([^/]+)\//)
      if (match) return match[1]
    }
    return ''
  }).catch(() => '')
}

async function fetchFreshSentinelTokens(page, baseHeaders) {
  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '')
  const dpl = await extractDpl(page)
  const config = getPowConfig(userAgent, dpl)
  const pToken = getRequirementsToken([...config])

  const sentinelHeaders = {}
  try {
    const resp = await page.context().request.post(
      'https://chatgpt.com/backend-api/sentinel/chat-requirements',
      {
        headers: {
          ...baseHeaders,
          'content-type': 'application/json',
        },
        data: { p: pToken },
        timeout: 10000,
      },
    )
    if (!resp.ok()) return sentinelHeaders
    const requirements = await resp.json()

    if (requirements.token) {
      sentinelHeaders['openai-sentinel-chat-requirements-token'] = requirements.token
    }

    const proofofwork = requirements.proofofwork || {}
    if (proofofwork.required && proofofwork.seed && proofofwork.difficulty) {
      const { token: proofToken } = getProofToken(proofofwork.seed, proofofwork.difficulty, [...config])
      sentinelHeaders['openai-sentinel-proof-token'] = proofToken
    }

    if (requirements.turnstile?.token) {
      sentinelHeaders['openai-sentinel-turnstile-token'] = requirements.turnstile.token
    }
  } catch {}

  return sentinelHeaders
}

// How long a `manual_login` call blocks on the *open* login window waiting for
// the user to finish authenticating (i.e. until the site's logged-in composer
// selector appears). This keeps the visible page in the foreground and only
// resolves once login is actually complete, so the caller can immediately scan
// and persist models from the same live page instead of racing a not-yet
// logged-in tab. Generous by default (5 min) and overridable for tests.
const LOGIN_WAIT_MS = Number(process.env.HIREMEOPS_BROWSER_LOGIN_TIMEOUT_MS) || 300000

// How long the Node-layer POST to ChatGPT's conversation endpoint may stream
// before Playwright aborts it. Reasoning models stream for minutes on a heavy
// prompt (a full CV rewrite), so the old 120s cap aborted requests whose answer
// had in fact fully generated ("apiRequestContext.post: Timeout 120000ms
// exceeded"). Kept just under the Rust bridge's DEFAULT_BRIDGE_TIMEOUT_MS so this
// inner limit surfaces a clean error before the outer RPC gives up.
const CHAT_REQUEST_TIMEOUT_MS = Number(process.env.HIREMEOPS_CHAT_REQUEST_TIMEOUT_MS) || 600000

// Composer interception is only needed to learn request headers/payload shape.
// Cookie-authenticated sessions may omit Authorization, so allow enough time
// for the composer to become interactive without requiring that header.
const CHAT_TEMPLATE_TIMEOUT_MS = Number(process.env.HIREMEOPS_CHAT_TEMPLATE_TIMEOUT_MS) || 120000

function send(id, result = null, error = null) {
  process.stdout.write(`${JSON.stringify({ id, result, error })}\n`)
}

const state = {
  chatgpt: {
    context: null,
    page: null,
    headless: null,
    authenticated: false,
    cachedHeaders: null,
    lastHeadersTime: 0,
  },
}

function ensureSessionText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

async function hasChatGPTSession() {
  const context = state.chatgpt.context
  if (!context) return false
  const cookies = await context.cookies('https://chatgpt.com').catch(() => [])
  return cookies.some((cookie) => /session-token/i.test(cookie.name) && cookie.value)
}

// Default in-session model id per browser site. Used as the fallback id when the
// live page exposes no enumerable model list, and as the default `model` a chat
// request is tagged with when the caller doesn't pin one. Centralised here so a
// provider's list/chat paths always agree on one id per site.
const SITE_DEFAULT_MODEL = {
  chatgpt: 'chatgpt-web-session',
}

function modelPattern(provider) {
  switch (provider) {
    case 'chatgpt':
      return /^(?:gpt|o[0-9]|chatgpt)[a-z0-9_.:-]*$/i
    default:
      return /^[a-z0-9][a-z0-9_.:-]{1,80}$/i
  }
}

function addModelCandidate(target, provider, value) {
  if (typeof value !== 'string') return
  const clean = value.trim().replace(/^model:/i, '').replace(/^models\//i, '')
  if (!clean || clean.length > 96 || /\s/.test(clean)) return
  if (modelPattern(provider).test(clean)) target.add(clean)
}

function collectModelIds(value, provider, target, depth = 0) {
  if (depth > 8 || value == null) return

  if (typeof value === 'string') {
    addModelCandidate(target, provider, value)
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 500000) {
      try {
        collectModelIds(JSON.parse(trimmed), provider, target, depth + 1)
      } catch {}
    }

    const modelKeyRe = /["'](?:model|model_slug|slug|id|name)["']\s*:\s*["']([a-zA-Z0-9][\w.:-]{1,95})["']/g
    for (const match of trimmed.matchAll(modelKeyRe)) addModelCandidate(target, provider, match[1])

    const directPatterns = {
      chatgpt: /\b(?:gpt|o[0-9]|chatgpt)[a-zA-Z0-9_.:-]{1,80}\b/g,
    }
    for (const match of trimmed.matchAll(directPatterns[provider] || /\b[a-z][a-z0-9_.:-]{1,80}\b/g)) {
      addModelCandidate(target, provider, match[0])
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectModelIds(item, provider, target, depth + 1)
    return
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:model|model_slug|slug|id|name)$/i.test(key)) {
        addModelCandidate(target, provider, child)
      }
      collectModelIds(child, provider, target, depth + 1)
    }
  }
}

function modelListResponse(ids, provider, fallbackModel) {
  const data = [...ids].length ? [...ids] : [fallbackModel]
  return {
    data: data.map(id => ({ id, provider })),
  }
}

function addKnownChatGPTModels(target) {
  for (const id of [
    'gpt-5-6-thinking',
    'gpt-5-5-thinking',
    'gpt-5-4-thinking',
    'gpt-5-3-thinking',
    'gpt-5-6',
    'gpt-5-5',
    'gpt-5-4',
    'gpt-5-3',
    'gpt-5.5',
    'gpt-5.5-thinking',
    'gpt-5',
    'gpt-4.1',
    'o3',
    'o4-mini',
    'chatgpt-web-session',
  ]) {
    addModelCandidate(target, 'chatgpt', id)
  }
}

async function scanPageModelHints(page, provider, endpointPaths = []) {
  const bodies = []

  // Fetch API endpoints at the Node.js layer — page.context().request shares
  // the browser session's cookies but is immune to SPA navigation context
  // destruction that kills a long-running page.evaluate mid-flight.
  for (const endpoint of endpointPaths) {
    try {
      const resp = await page.context().request.get(endpoint, { timeout: 8000 })
      if (resp.ok()) {
        const text = await resp.text()
        if (text && text.trim()) bodies.push(text.slice(0, 500000))
      }
    } catch {}
  }

  // Wait for any active navigation to settle before touching the JS context.
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})

  // In-page reads (NEXT_DATA, scripts, storage, perf entries) — fast/synchronous
  // so context destruction is unlikely, but we still catch it gracefully.
  const pageBodies = await page.evaluate(() => {
    const out = []
    const add = value => {
      if (typeof value === 'string' && value.trim()) out.push(value.slice(0, 500000))
    }

    try {
      add(JSON.stringify(window.__NEXT_DATA__ || window.__NUXT__ || {}))
    } catch {}

    for (const script of Array.from(document.scripts).slice(0, 80)) {
      const text = script.textContent || ''
      if (/model|gpt/i.test(text)) add(text)
    }

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) || ''
          const value = storage.getItem(key) || ''
          if (/model|gpt/i.test(`${key} ${value}`)) {
            add(`${key} ${value}`)
          }
        }
      } catch {}
    }

    for (const resource of performance.getEntriesByType('resource').map(entry => entry.name)) {
      if (/batchexecute|model|init|template|status/i.test(resource)) add(resource)
    }

    return out
  }).catch(() => []) // navigation fired mid-eval → return empty, retry loop handles it

  bodies.push(...pageBodies)

  const ids = new Set()
  for (const body of bodies) collectModelIds(body, provider, ids)
  return ids
}

async function waitForInteractiveSelector(page, selectors, timeout = 30000) {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout })
      return selector
    } catch {}
  }

  throw new Error(`Timeout waiting for interactive selector: ${selectors.join(', ')}`)
}

async function scanPageModelHintsWithRetries(page, provider, endpointPaths = [], attempts = 3) {
  let ids = new Set()
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    ids = await scanPageModelHints(page, provider, endpointPaths)
    if (ids.size > 0) {
      return ids
    }
    await sleep(1200)
  }
  return ids
}

// When sharing the automation's cookie jar (HIREMEOPS_CHATGPT_PROFILE_DIR set),
// release the ChatGPT context after each use so the automation worker can open
// the same profile dir — Chromium's SingletonLock forbids two browsers on one dir
// at once. `ensureLiveSession` re-opens it on the next chat; the persistent jar
// keeps the login. No-op when using the standalone ./chatgpt_profile jar.
async function releaseChatgptIfShared() {
  if (!process.env.HIREMEOPS_CHATGPT_PROFILE_DIR) return
  try {
    await closeContext(state.chatgpt.context)
  } catch {}
  state.chatgpt.context = null
  state.chatgpt.page = null
}

async function closeContext(context) {
  if (!context) return
  const browser = typeof context.browser === 'function' ? context.browser() : null
  await context.close().catch(() => {})
  if (browser) {
    await browser.close().catch(() => {})
  }
}

// Per-site headless initializers, keyed by the `provider` token used on the
// wire. Consumed by ensureLiveSession() to relaunch a dead context from the
// params stored at the last init. Populated with the hoisted init declarations.
const SITE_INITIALIZERS = {
  chatgpt: initChatGPT,
}

/**
 * A cached per-site session is only reusable if its page is still open. The
 * persistent context or its page can die between requests (browser crash, the
 * headless page being closed, a login window the user closed, or the profile
 * being relaunched). Reusing a dead handle makes the next `page.goto` throw
 * "Target page, context or browser has been closed", so callers must fall
 * through to a fresh init when this returns false.
 */
function isSessionAlive(s) {
  try {
    if (!s || !s.page || s.page.isClosed()) return false
    // A persistent context whose browser process has disconnected (crash, the
    // window closed by the user, the profile relaunched) can leave a page whose
    // isClosed() has not yet flipped. Verify the underlying browser is still
    // connected so we don't hand back a stale handle whose next `page.goto`
    // throws "Target page, context or browser has been closed".
    const ctx = s.context
    if (!ctx) return false
    const browser = typeof ctx.browser === 'function' ? ctx.browser() : null
    if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Re-establish a dead persistent context before an operation that assumes a
 * live page. The Rust `ensure_init` latch only sends `init` once per bridge
 * process, so once the cached context dies nothing upstream relaunches it and
 * every subsequent `page.goto` throws "Target page, context or browser has been
 * closed". Self-heal here headlessly from the params captured at the last init.
 * A still-alive headed login window is left untouched (isSessionAlive true).
 */
async function ensureLiveSession(site) {
  const s = state[site]
  if (isSessionAlive(s)) return
  const init = SITE_INITIALIZERS[site]
  if (!init || !s || !s.runtimeDir) {
    throw new Error(`${site} Playwright not initialized`)
  }
  // Let the initializer tear down the stale context and relaunch. Reusing the
  // params from the last successful init keeps the same profile/browser choice.
  await init({ runtime_dir: s.runtimeDir, headless: true, browser: s.browserChoice })
}

async function initChatGPT({ runtime_dir, headless, browser }) {
  ensureDir(runtime_dir)
  process.chdir(runtime_dir)
  // Reuse a live context for any headless call (a visible, logged-in context serves
  // headless requests fine); only relaunch to open a *visible* login window
  // (headless===false) when the current context isn't already headed. This stops a
  // chat/list_models probe (headless:true) from tearing down a mid-login headed window.
  if (state.chatgpt.context && isSessionAlive(state.chatgpt) && (headless || state.chatgpt.headless === false)) return
  if (state.chatgpt.context) {
    await closeContext(state.chatgpt.context)
    state.chatgpt.context = null
    state.chatgpt.page = null
    state.chatgpt.cachedHeaders = null
    state.chatgpt.lastHeadersTime = 0
  }
  // Share the automation's per-profile cookie jar when the app points us at it
  // (HIREMEOPS_CHATGPT_PROFILE_DIR = the active profile's automation browser dir),
  // so a single ChatGPT login — via Settings OR the Command Center's Universal
  // Login — authenticates both the AI bridge and the job automations. Falls back
  // to the standalone ./chatgpt_profile when the app doesn't set it.
  const chatgptProfileDir = process.env.HIREMEOPS_CHATGPT_PROFILE_DIR || path.resolve('chatgpt_profile')
  ensureDir(chatgptProfileDir)
  const { engine, channel } = resolveEngine(browser)
  // Prefer a real system Chromium so headless doesn't need the bundled
  // `chromium_headless_shell`. executablePath and channel are mutually
  // exclusive, so drop the channel whenever we resolve an explicit binary.
  const executablePath = engine === chromium ? resolveChromiumExecutable() : undefined
  // Headless Chromium announces "HeadlessChrome/<major>" in BOTH navigator.userAgent
  // AND the Sec-CH-UA client hints — a hard Cloudflare 403 at auth.openai.com
  // (verified: HeadlessChrome UA → 403 "Just a moment"; identical request with the
  // token stripped → the API's own 400/200). Override the UA at the BROWSER level
  // (the --user-agent flag, not the context `userAgent` option, so Sec-CH-UA stays
  // coherent) to strip only "Headless", on a Linux UA that matches this binary's
  // platform and major. Headed launches keep the genuine UA (a visible window is
  // never "HeadlessChrome"). Mirrors automation/browser-launch.js HEADLESS_UA.
  // ponytail: bump the major when the system Chromium jumps a major.
  const uaArgs = headless
    ? ['--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36']
    : []
  state.chatgpt.context = await engine.launchPersistentContext(chatgptProfileDir, {
    headless,
    channel: executablePath ? undefined : channel,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [...stealthArgs(), ...uaArgs],
    executablePath,
  })
  await applyStealthScripts(state.chatgpt.context)
  state.chatgpt.page = await state.chatgpt.context.newPage()
  state.chatgpt.headless = headless
  state.chatgpt.runtimeDir = runtime_dir
  state.chatgpt.browserChoice = browser
  state.chatgpt.authenticated = await hasChatGPTSession()
}

async function captureChatGPTTemplate(forceNew = false) {
  await ensureLiveSession('chatgpt')
  const page = state.chatgpt.page
  if (!page) throw new Error('ChatGPT Playwright not initialized')

  if (!forceNew && state.chatgpt.cachedHeaders && Date.now() - state.chatgpt.lastHeadersTime < 5 * 60 * 1000) {
    return state.chatgpt.cachedHeaders
  }

  if (!isHostname(page.url(), 'chatgpt.com') || forceNew) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
  }

  const inputSelector = 'textarea:visible, #prompt-textarea:visible, div[contenteditable="true"]:visible'
  await page.waitForSelector(inputSelector, { timeout: 30000 }).catch(() => {
    throw new Error('Timeout waiting for ChatGPT input. Are you logged in?')
  })

  return new Promise((resolve, reject) => {
    const routePattern = '**/backend-api/f/conversation*'
    let settled = false
    let timeout
    let routeHandler

    const cleanup = () => {
      clearTimeout(timeout)
      return page.unroute(routePattern, routeHandler).catch(() => {})
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      void cleanup().finally(() => {
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    }

    timeout = setTimeout(() => {
      fail(new Error('Timeout waiting for ChatGPT request template'))
    }, CHAT_TEMPLATE_TIMEOUT_MS)

    routeHandler = async (route, request) => {
      if (settled) {
        await route.continue().catch(() => {})
        return
      }

      const postData = request.postData() || ''
      let payload
      try {
        payload = JSON.parse(postData)
      } catch {
        await route.continue().catch(fail)
        return
      }

      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages) || payload.messages.length === 0) {
        await route.continue().catch(fail)
        return
      }

      const reqHeaders = request.headers()
      const payloadModel = typeof payload.model === 'string' ? payload.model : 'chatgpt-web-session'

      const headers = {
        authorization: reqHeaders.authorization || '',
        accept: reqHeaders.accept || 'text/event-stream',
        'accept-language': reqHeaders['accept-language'] || 'en-US,en;q=0.9',
        'content-type': reqHeaders['content-type'] || 'application/json',
        origin: reqHeaders.origin || 'https://chatgpt.com',
        referer: reqHeaders.referer || 'https://chatgpt.com/',
        'user-agent': reqHeaders['user-agent'] || '',
        'oai-client-build-number': reqHeaders['oai-client-build-number'] || '',
        'oai-client-version': reqHeaders['oai-client-version'] || '',
        'oai-device-id': reqHeaders['oai-device-id'] || '',
        'oai-language': reqHeaders['oai-language'] || 'en-US',
        'oai-session-id': reqHeaders['oai-session-id'] || '',
        'openai-sentinel-chat-requirements-token': reqHeaders['openai-sentinel-chat-requirements-token'] || '',
        'openai-sentinel-proof-token': reqHeaders['openai-sentinel-proof-token'] || '',
        'openai-sentinel-turnstile-token': reqHeaders['openai-sentinel-turnstile-token'] || '',
        'x-conduit-token': reqHeaders['x-conduit-token'] || '',
        'x-oai-turn-trace-id': reqHeaders['x-oai-turn-trace-id'] || '',
        'x-openai-target-path': reqHeaders['x-openai-target-path'] || '/backend-api/f/conversation',
        'x-openai-target-route': reqHeaders['x-openai-target-route'] || '/backend-api/f/conversation',
      }

      state.chatgpt.cachedHeaders = {
        headers,
        payload: postData,
        model: payloadModel,
        url: request.url(),
      }
      state.chatgpt.lastHeadersTime = Date.now()

      settled = true
      clearTimeout(timeout)
      await route.abort('aborted').catch(() => {})
      await page.unroute(routePattern, routeHandler).catch(() => {})
      resolve(state.chatgpt.cachedHeaders)
    }

    page.route(routePattern, routeHandler).then(async () => {
      await page.focus(inputSelector)
      await page.fill(inputSelector, '')
      await page.type(inputSelector, 'a', { delay: 50 })
      await sleep(1500)
      await page.keyboard.press('Enter')
    }).catch(fail)
  })
}

async function getChatGPTBasicHeaders() {
  const page = state.chatgpt.page
  if (!page) throw new Error('ChatGPT Playwright not initialized')

  const cookies = await page.context().cookies()
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  const userAgent = await page.evaluate(() => navigator.userAgent)
  const template = state.chatgpt.cachedHeaders

  return {
    headers: {
      cookie,
      authorization: template?.headers?.authorization || '',
      'user-agent': userAgent,
      origin: 'https://chatgpt.com',
      referer: 'https://chatgpt.com/',
    },
  }
}

async function getChatGPTRequestTemplate() {
  const cached = state.chatgpt.cachedHeaders
  if (cached && Date.now() - state.chatgpt.lastHeadersTime < 5 * 60 * 1000) {
    return cached
  }

  const basic = await getChatGPTBasicHeaders()
  return {
    ...basic,
    payload: '',
    model: SITE_DEFAULT_MODEL.chatgpt,
    url: 'https://chatgpt.com/backend-api/f/conversation',
  }
}

function buildChatGPTPayload(prompt, model, webSearch) {
  return {
    action: 'next',
    messages: [
      {
        id: randomUUID(),
        author: { role: 'user' },
        create_time: Date.now() / 1000,
        content: {
          content_type: 'text',
          parts: [prompt],
        },
        metadata: {
          developer_mode_connector_ids: [],
          selected_sources: webSearch ? ['web'] : [],
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: {
            custom_symbol_offsets: [],
          },
        },
      },
    ],
    parent_message_id: 'client-created-root',
    model,
    client_prepare_state: 'success',
    timezone_offset_min: -new Date().getTimezoneOffset(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    conversation_mode: { kind: 'primary_assistant' },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_contextual_info: {
      app_name: 'chatgpt.com',
    },
    paragen_cot_summary_display_override: 'allow',
    force_parallel_switch: 'auto',
    thinking_effort: model.includes('thinking') ? 'extended' : 'auto',
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function replaceChatGPTMessageContent(content, prompt) {
  if (!content || typeof content !== 'object') {
    return {
      content_type: 'text',
      parts: [prompt],
    }
  }

  if (Array.isArray(content.parts)) {
    return {
      ...content,
      parts: [prompt],
    }
  }

  return {
    ...content,
    text: prompt,
  }
}

function buildChatGPTPayloadFromTemplate(template, prompt, model, webSearch) {
  let payload = null
  try {
    payload = template?.payload ? JSON.parse(template.payload) : null
  } catch {}

  if (!payload || typeof payload !== 'object') {
    return buildChatGPTPayload(prompt, model, webSearch)
  }

  const nextPayload = cloneJson(payload)
  const messages = Array.isArray(nextPayload.messages) ? nextPayload.messages : []
  const templateMessage = messages.find((message) => message?.author?.role === 'user') || messages[0] || {}
  const templateMetadata =
    templateMessage?.metadata && typeof templateMessage.metadata === 'object'
      ? templateMessage.metadata
      : {}

  nextPayload.model = model
  delete nextPayload.conversation_id
  delete nextPayload.conversationId
  delete nextPayload.current_node
  delete nextPayload.currentNode
  delete nextPayload.parent_id
  delete nextPayload.parentId
  delete nextPayload.response_id
  delete nextPayload.responseId
  delete nextPayload.suggestions
  delete nextPayload.history_and_training_disabled
  nextPayload.messages = [
    {
      ...templateMessage,
      id: randomUUID(),
      create_time: Date.now() / 1000,
      author: { ...(templateMessage.author || {}), role: 'user' },
      content: replaceChatGPTMessageContent(templateMessage.content, prompt),
      metadata: {
        ...templateMetadata,
        selected_sources: webSearch ? ['web'] : [],
      },
    },
  ]

  nextPayload.parent_message_id = 'client-created-root'
  if (!nextPayload.action || typeof nextPayload.action !== 'string') {
    nextPayload.action = 'next'
  }

  return nextPayload
}

function extractChatGPTAssistantText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const mapping = payload.mapping && typeof payload.mapping === 'object' ? Object.values(payload.mapping) : []
  const messages = mapping
    .map((entry) => entry?.message)
    .filter((message) => message?.author?.role === 'assistant')
    .sort((left, right) => (left?.create_time || 0) - (right?.create_time || 0))

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content
    if (!content) continue
    const parts = Array.isArray(content.parts) ? content.parts : []
    const text = parts
      .filter((part) => typeof part === 'string')
      .join('\n')
      .trim()
    if (text) return text
  }

  return ''
}

async function listChatGPTModels() {
  await ensureLiveSession('chatgpt')
  const page = state.chatgpt.page
  if (!page) throw new Error('ChatGPT Playwright not initialized')
  if (!isHostname(page.url(), 'chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
  }

  await waitForInteractiveSelector(page, [
    'textarea:visible',
    '#prompt-textarea:visible',
    'div[contenteditable="true"]:visible',
  ])

  const ids = await scanPageModelHintsWithRetries(page, 'chatgpt', [
    '/backend-api/models',
    '/backend-api/f/models',
    '/backend-api/model_slug_availability',
  ])
  addKnownChatGPTModels(ids)
  if (state.chatgpt.cachedHeaders?.model) addModelCandidate(ids, 'chatgpt', state.chatgpt.cachedHeaders.model)
  return modelListResponse(ids, 'chatgpt', SITE_DEFAULT_MODEL.chatgpt)
}

async function chatChatGPT({ model, prompt, web_search = false }) {
  await ensureLiveSession('chatgpt')
  const page = state.chatgpt.page
  if (!page) throw new Error('ChatGPT Playwright not initialized')

  const template = await captureChatGPTTemplate(true)
  const requestHeaders = { ...template.headers }
  delete requestHeaders.cookie

  // The "a" test message in captureChatGPTTemplate can trigger a SPA navigation
  // (/ → /c/{id}). Wait for it to settle before making any requests — otherwise
  // page.evaluate below would die with "Execution context was destroyed".
  await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {})

  // Fetch fresh sentinel tokens — stale/reused tokens trigger 403 "unusual activity"
  const cookieHeader = (await page.context().cookies('https://chatgpt.com'))
    .map(c => `${c.name}=${c.value}`).join('; ')
  const sentinelBaseHeaders = {
    cookie: cookieHeader,
    authorization: requestHeaders.authorization || '',
    'user-agent': requestHeaders['user-agent'] || '',
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/',
    'oai-language': requestHeaders['oai-language'] || 'en-US',
    'oai-device-id': requestHeaders['oai-device-id'] || '',
  }
  const freshSentinel = await fetchFreshSentinelTokens(page, sentinelBaseHeaders)
  Object.assign(requestHeaders, freshSentinel)

  const sendConversation = async (promptText) => {
    const payload = buildChatGPTPayloadFromTemplate(
      template,
      promptText,
      ensureSessionText(model, template.model || SITE_DEFAULT_MODEL.chatgpt),
      web_search,
    )

    // page.context().request runs at the Node.js layer — immune to SPA navigation
    // context destruction, while still sharing the browser session's cookies.
    const apiResp = await page.context().request.post(
      'https://chatgpt.com/backend-api/f/conversation',
      {
        headers: requestHeaders,
        data: JSON.stringify(payload),
        timeout: CHAT_REQUEST_TIMEOUT_MS,
      },
    )
    const bodyText = await apiResp.text()
    const status = apiResp.status()

    // Extract conversationId from the SSE stream that came back
    let conversationId = ''
    for (const rawLine of bodyText.split('\n')) {
      const trimmed = rawLine.trim()
      if (!trimmed.startsWith('data:')) continue
      const chunk = trimmed.slice(5).trim()
      if (!chunk || chunk === '[DONE]') continue
      try {
        const parsed = JSON.parse(chunk)
        conversationId =
          parsed.conversation_id ||
          parsed.token?.conversation_id ||
          parsed.options?.[0]?.conversation_id ||
          conversationId
      } catch {}
    }

    return {
      payload,
      requestResult: { ok: apiResp.ok(), status, conversationId, body: bodyText },
    }
  }

  const sent = await sendConversation(prompt)

  const conversationId = sent.requestResult.conversationId || sent.payload.conversation_id || ''
  if (!sent.requestResult.ok || !conversationId) {
    const detail = sent.requestResult.body?.trim()
    throw new Error(
      detail
        ? `ChatGPT upstream request failed with status ${sent.requestResult.status}: ${detail.slice(0, 400)}`
        : `ChatGPT upstream request failed with status ${sent.requestResult.status}`,
    )
  }

  // Poll for the complete conversation — also at Node.js layer, no page.evaluate
  let conversationJson = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pollResp = await page.context().request.get(
      `https://chatgpt.com/backend-api/conversation/${conversationId}`,
      { headers: requestHeaders, timeout: 10_000 },
    ).catch(() => null)

    if (pollResp?.ok()) {
      const text = await pollResp.text()
      if (text && text !== 'null') {
        conversationJson = text
        break
      }
    }
    await sleep(1000)
  }

  const text = extractChatGPTAssistantText(conversationJson ? JSON.parse(conversationJson) : null)
  if (!text) {
    throw new Error('ChatGPT response was empty. Confirm session is active, then retry.')
  }

  return {
    text,
    model: sent.payload.model,
    conversation_id: conversationId,
    warning: [
      web_search
        ? 'ChatGPT web search toggle not mapped yet. Current web-session defaults were used.'
        : null,
    ]
      .filter(Boolean)
      .join(' | ') || null,
  }
}

async function openChatGPTLogin({ runtime_dir, browser }) {
  await initChatGPT({ runtime_dir, headless: false, browser })
  const page = state.chatgpt.page
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
  // Block until the user has ACTUALLY authenticated. DOM heuristics are useless
  // here: ChatGPT's logged-OUT landing renders the same composer/textarea, and a
  // stray hidden textarea evaluates true before the login buttons even paint — so
  // the window "completed" login instantly and closed before the user could sign
  // in (nothing persisted). The ONE unambiguous, layout/locale-independent signal
  // is the auth SESSION COOKIE — it only exists after a real login. Poll for it.
  const deadline = Date.now() + LOGIN_WAIT_MS
  let loggedIn = false
  while (Date.now() < deadline) {
    if (await hasChatGPTSession()) {
      loggedIn = true
      state.chatgpt.authenticated = true
      break
    }
    await sleep(1500)
  }
  if (!loggedIn) {
    throw new Error('ChatGPT login timed out — no session cookie after waiting. Sign in and retry.')
  }
  // Scan + return models straight from the same live, logged-in page so the
  // caller persists them without a second (racy) round-trip.
  return listChatGPTModels()
}

async function logoutChatGPT() {
  const session = state.chatgpt
  if (!session.runtimeDir) {
    session.authenticated = false
    return { ok: true, logged_in: false }
  }

  try {
    await ensureLiveSession('chatgpt')
    const context = session.context
    if (!context) throw new Error('ChatGPT Playwright session is unavailable')

    const cookies = await context.cookies()
    for (const cookie of cookies) {
      if (cookie.domain !== 'chatgpt.com' && !cookie.domain.endsWith('.chatgpt.com')) continue
      await context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path })
    }

    if (session.page && !session.page.isClosed()) {
      await session.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    }

    session.authenticated = await hasChatGPTSession()
    if (session.authenticated) {
      throw new Error('ChatGPT logout failed — session cookie is still present')
    }
    return { ok: true, logged_in: false }
  } finally {
    await releaseChatgptIfShared()
  }
}

async function chatGPTStatus() {
  try {
    if (!state.chatgpt.context && state.chatgpt.runtimeDir) {
      await ensureLiveSession('chatgpt')
    }
    state.chatgpt.authenticated = await hasChatGPTSession()
    return { logged_in: state.chatgpt.authenticated }
  } finally {
    await releaseChatgptIfShared()
  }
}

async function closeAll() {
  for (const key of ['chatgpt']) {
    if (state[key].context) {
      await closeContext(state[key].context)
      state[key].context = null
      state[key].page = null
      state[key].headless = null
      state[key].authenticated = false
      state[key].cachedHeaders = null
      state[key].lastHeadersTime = 0
    }
  }
}

async function shutdownAndExit(code = 0) {
  await closeAll().catch((error) => {
    process.stderr.write(`shutdown cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
  })
  process.exit(code)
}

async function handle(method, provider, params) {
  switch (`${provider}:${method}`) {
    case 'chatgpt:init':
      return initChatGPT(params)
    case 'chatgpt:capture_headers':
      return captureChatGPTTemplate(!!params.force_new)
    case 'chatgpt:basic_headers':
      return getChatGPTBasicHeaders()
    case 'chatgpt:manual_login': {
      const r = await openChatGPTLogin(params)
      await releaseChatgptIfShared()
      return r
    }
    case 'chatgpt:logout':
      return logoutChatGPT()
    case 'chatgpt:status':
      return chatGPTStatus()
    case 'chatgpt:list_models':
      return listChatGPTModels()
    case 'chatgpt:chat': {
      const r = await chatChatGPT(params)
      await releaseChatgptIfShared()
      return r
    }
    case 'chatgpt:shutdown':
      await closeAll()
      setImmediate(() => process.exit(0))
      return { ok: true }
    default:
      throw new Error(`Unsupported helper call: ${provider}:${method}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buffer += chunk
  let newlineIndex = buffer.indexOf('\n')
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim()
    buffer = buffer.slice(newlineIndex + 1)
    if (line) {
      let requestId = null
      try {
        const request = JSON.parse(line)
        requestId = request?.id ?? null
        const result = await handle(request.method, request.provider, request.params || {})
        send(request.id, result, null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (requestId != null) {
          send(requestId, null, message)
        } else {
          process.stderr.write(`bridge request parse failed: ${message}\n`)
        }
      }
    }
    newlineIndex = buffer.indexOf('\n')
  }
})

process.stdin.on('end', () => {
  void shutdownAndExit(0)
})

process.on('SIGTERM', () => {
  void shutdownAndExit(0)
})

process.on('SIGINT', () => {
  void shutdownAndExit(0)
})
