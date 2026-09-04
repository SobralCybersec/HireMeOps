import { session, writeLine, isGmailLoginUrl } from "./worker-context.js";

export async function cmdAutoConnect(config) {
  const { handle, max_count = 200, delay_ms = 2000, max_refreshes = 25 } = config;
  const { browser } = session(handle);
  const pages = browser.pages().filter((page) => !page.isClosed());
  const page = pages.length ? pages[pages.length - 1] : await browser.newPage();
  const context = createNetworkContext({ page, max_count, delay_ms, max_refreshes });
  await gotoNetwork(context, 0);
  return runConnectionBatch(context);
}

function createNetworkContext({ page, max_count, delay_ms, max_refreshes }) {
  const urls = [
    "https://www.linkedin.com/mynetwork/invitation-manager/received/",
    "https://www.linkedin.com/mynetwork/grow/",
  ];
  const connectByAttr = page.locator([
    'button[componentkey^="ConnectButton"]',
    'button[aria-label*="Convidar" i][aria-label*="conectar" i]',
    'button[aria-label*="Invite" i][aria-label*="connect" i]',
  ].join(", "));
  const connectByText = page.getByRole("button", { name: /^\s*(Conectar|Connect)\s*$/ });
  return {
    page,
    urls,
    connectLoc: connectByAttr.or(connectByText),
    max_count,
    delay_ms,
    max_refreshes,
    sendSelector: [
      'button[aria-label*="Send without a note" i]',
      'button[aria-label*="Enviar sem nota" i]',
      'button[aria-label*="Send now" i]',
      'button[aria-label*="Enviar agora" i]',
    ].join(", "),
    limitStrings: [
      "weekly invitation limit",
      "limite semanal de convites",
      "more invitations next week",
      "mais convites na próxima semana",
      "more invitations on",
      "mais convites em",
    ],
    dismissSelector: [
      'button[aria-label*="Dismiss" i]',
      'button[aria-label*="Fechar" i]',
      'button[aria-label="Close" i]',
      ".artdeco-modal__dismiss",
    ].join(", "),
  };
}

async function gotoNetwork(context, index) {
  const { page, urls } = context;
  await page.goto(urls[index], { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

async function runConnectionBatch(context) {
  const state = { urlIndex: 0, sent: 0, refreshes: 0, status: "ok", stuck: 0, attempted: new Set() };
  while (state.sent < context.max_count) {
    const next = await findConnect(context, state.attempted);
    if (!next) {
      if (await advanceNetwork(context, state)) continue;
      break;
    }
    state.attempted.add(next.key);
    const result = await sendConnection(context, next);
    if (result === "limit") {
      state.status = "limit";
      writeLine({ event: "auto_connect_progress", sent: state.sent, status: "limit" });
      break;
    }
    if (result) {
      state.sent += 1;
      state.stuck = 0;
      writeLine({ event: "auto_connect_progress", sent: state.sent, status: "ok" });
      if (context.delay_ms > 0 && state.sent < context.max_count) {
        await context.page.waitForTimeout(context.delay_ms);
      }
      continue;
    }
    await dismissNetworkModal(context);
    state.stuck += 1;
    if (state.stuck >= 20) break;
  }
  return { sent: state.sent, status: state.status };
}

async function findConnect(context, attempted) {
  const { page, connectLoc } = context;
  for (let scroll = 0; scroll < 12; scroll += 1) {
    for (const button of await connectLoc.all().catch(() => [])) {
      const key = await button.getAttribute("aria-label").catch(() => null);
      if (key && !attempted.has(key)) return { btn: button, key };
    }
    const atBottom = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollBy(0, window.innerHeight);
      return window.scrollY === before;
    });
    await page.waitForTimeout(1_200);
    if (atBottom) return null;
  }
  return null;
}

async function advanceNetwork(context, state) {
  state.urlIndex += 1;
  if (state.urlIndex < context.urls.length) {
    await gotoNetwork(context, state.urlIndex);
    await context.page.waitForTimeout(1_000);
    return true;
  }
  if (state.refreshes >= context.max_refreshes) return false;
  state.refreshes += 1;
  state.urlIndex = 0;
  state.attempted.clear();
  await gotoNetwork(context, state.urlIndex);
  await context.page.waitForTimeout(1_500);
  return true;
}

async function sendConnection(context, next) {
  const { page } = context;
  await next.btn.scrollIntoViewIfNeeded().catch(() => {});
  await next.btn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1_000);
  if (await atWeeklyLimit(context)) return "limit";

  const sendButton = page.locator(context.sendSelector).first();
  if ((await sendButton.count().catch(() => 0)) > 0) {
    await sendButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(300);
  const stillOffering = await page.getByLabel(next.key, { exact: true }).count().catch(() => 1);
  return stillOffering === 0;
}

function atWeeklyLimit(context) {
  return context.page.evaluate((strings) => {
    const text = (document.body.textContent ?? "").toLowerCase();
    return strings.some((value) => text.includes(value.toLowerCase()));
  }, context.limitStrings);
}

function dismissNetworkModal(context) {
  return context.page.locator(context.dismissSelector).first().click({ force: true }).catch(() => {});
}

export async function cmdGmailSend({ handle, to, subject, body, attachment_path }) {
  const { page } = session(handle);
  try {
    const composeUrl =
      "https://mail.google.com/mail/?view=cm&fs=1&tf=1" +
      `&to=${encodeURIComponent(to)}` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const landed = page.url();
    if (isGmailLoginUrl(landed)) {
      return {
        sent: false,
        error:
          "Not logged into Gmail in the automation browser — log into Gmail once in this browser profile.",
      };
    }

    await page.waitForSelector('input[name="subjectbox"], div[aria-label="Corpo da mensagem"]', {
      timeout: 20_000,
    });

    if (attachment_path) {
      try {
        await page.setInputFiles('input[type="file"][name="Filedata"]', attachment_path);
      } catch {}
    }

    await page.waitForTimeout(attachment_path ? 4_000 : 1_500);

    await page
      .locator('[role="button"][aria-label^="Enviar" i], [role="button"][data-tooltip^="Enviar" i]')
      .first()
      .click({ timeout: 10_000 });

    await page.waitForTimeout(2_000);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

