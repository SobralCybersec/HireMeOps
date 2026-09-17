import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chatGPTLaunchArgs,
  chatGPTLaunchOptions,
  gotoChatGPT,
  isOnHost,
  selectChatGPTPage,
} from './chatgpt-runtime.mjs'

function fakePage(url, closed = false) {
  return {
    url: () => url,
    isClosed: () => closed,
  }
}

test('recognizes ChatGPT and OpenAI hosts without matching lookalikes', () => {
  assert.equal(isOnHost('https://chatgpt.com/c/1', 'chatgpt.com'), true)
  assert.equal(isOnHost('https://auth.openai.com/login', 'openai.com'), true)
  assert.equal(isOnHost('https://not-chatgpt.com.example.test', 'chatgpt.com'), false)
  assert.equal(isOnHost('not a url', 'chatgpt.com'), false)
})

test('does not re-navigate a page already in an auth host', async () => {
  const page = {
    url: () => 'https://auth.openai.com/login',
    goto: () => assert.fail('goto must not run for an existing auth page'),
  }

  assert.equal(await gotoChatGPT(page), page)
})

test('starts navigation at commit when page is outside auth hosts', async () => {
  const calls = []
  const page = {
    url: () => 'about:blank',
    goto: async (...args) => calls.push(args),
  }

  await gotoChatGPT(page, { timeout: 45000 })

  assert.deepEqual(calls, [[
    'https://chatgpt.com/',
    { waitUntil: 'commit', timeout: 45000 },
  ]])
})

test('surfaces HTTP 403 without attempting another navigation', async () => {
  const page = {
    url: () => 'about:blank',
    goto: async () => ({ status: () => 403 }),
  }

  await assert.rejects(
    gotoChatGPT(page),
    /chatgpt_access_blocked_manual_action_required/,
  )
})

test('force only re-navigates when caller explicitly requests it', async () => {
  const calls = []
  const page = {
    url: () => 'https://chatgpt.com/c/1',
    goto: async (...args) => calls.push(args),
  }

  await gotoChatGPT(page, { force: true })

  assert.deepEqual(calls, [[
    'https://chatgpt.com/',
    { waitUntil: 'commit', timeout: 60000 },
  ]])
})

test('selects an existing ChatGPT page before another open page', () => {
  const chatgpt = fakePage('https://chatgpt.com/')
  const other = fakePage('https://example.test/')
  const context = { pages: () => [other, chatgpt] }

  assert.equal(selectChatGPTPage(context), chatgpt)
})

test('falls back to an open page and ignores closed pages', () => {
  const closed = fakePage('https://chatgpt.com/', true)
  const open = fakePage('about:blank')
  const context = { pages: () => [closed, open] }

  assert.equal(selectChatGPTPage(context), open)
})

test('uses reference launch args only for headless UA/window sizing', () => {
  const headless = chatGPTLaunchArgs({ headless: true, userAgent: 'Chrome/152' })
  const headed = chatGPTLaunchArgs({ headless: false, userAgent: 'Chrome/152' })

  assert.ok(headless.includes('--disable-background-networking'))
  assert.ok(headless.includes('--disable-features=DevToolsDebuggingRestrictions,CalculateNativeWinOcclusion'))
  assert.ok(headless.includes('--user-agent=Chrome/152'))
  assert.ok(headless.includes('--window-size=1920,1080'))
  assert.equal(headed.some((arg) => arg.startsWith('--user-agent=')), false)
  assert.equal(headed.includes('--window-size=1920,1080'), false)
})

test('clean launch has no stealth args, UA override, or init-script options', () => {
  assert.deepEqual(
    chatGPTLaunchOptions({ headless: false, clean: true, userAgent: 'Chrome/152' }),
    { headless: false, viewport: null },
  )

  const regular = chatGPTLaunchOptions({ headless: true, userAgent: 'Chrome/152' })
  assert.deepEqual(regular.ignoreDefaultArgs, ['--enable-automation'])
  assert.ok(regular.args.includes('--user-agent=Chrome/152'))
})
