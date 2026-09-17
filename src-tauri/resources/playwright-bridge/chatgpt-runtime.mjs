export const CHATGPT_URL = 'https://chatgpt.com/'

const CHATGPT_HOSTS = ['chatgpt.com', 'openai.com']

export function isOnHost(rawUrl, ...hosts) {
  let hostname
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return false
  }

  return hosts.some((host) => {
    const target = host.toLowerCase()
    return hostname === target || hostname.endsWith(`.${target}`)
  })
}

export async function gotoChatGPT(page, { force = false, timeout = 60000 } = {}) {
  if (!force && isOnHost(page.url(), ...CHATGPT_HOSTS)) return page

  const response = await page.goto(CHATGPT_URL, {
    waitUntil: 'commit',
    timeout,
  })
  if (response?.status?.() === 403) {
    throw new Error('chatgpt_access_blocked_manual_action_required')
  }
  return page
}

export function selectChatGPTPage(context) {
  const pages = context.pages().filter((page) => {
    return typeof page.isClosed !== 'function' || !page.isClosed()
  })

  return pages.find((page) => isOnHost(page.url(), ...CHATGPT_HOSTS)) || pages[0] || null
}

export function chatGPTLaunchArgs({ headless = true, userAgent = '' } = {}) {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=DevToolsDebuggingRestrictions,CalculateNativeWinOcclusion',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-dev-shm-usage',
    '--class=HireMeOpsBot',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--mute-audio',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
  ]

  if (headless && userAgent) {
    args.push(`--user-agent=${userAgent}`, '--window-size=1920,1080')
  }

  return args
}

export function chatGPTLaunchOptions({ headless = true, clean = false, userAgent = '' } = {}) {
  return {
    headless,
    viewport: null,
    ...(clean
      ? {}
      : {
          args: chatGPTLaunchArgs({ headless, userAgent }),
          ignoreDefaultArgs: ['--enable-automation'],
        }),
  }
}
