import { existsSync } from "node:fs";
import { chromium } from "patchright";
import { cloudLaunchOptions } from "../core/browser/browser-launch.js";

const DEFAULT_EXECUTABLES = ["/usr/bin/chromium-headless-shell", "/usr/bin/chromium"];

function executablePath() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  return DEFAULT_EXECUTABLES.find((candidate) => existsSync(candidate));
}

function blocksHeavyResources() {
  return !/^(0|false|no)$/i.test(process.env.HIREMEOPS_CLOUD_BLOCK_HEAVY_RESOURCES ?? "1");
}

async function installResourcePolicy(context) {
  if (!blocksHeavyResources()) return;
  await context.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

export async function openCloudBrowser(
  storageState,
  { viewport = { width: 800, height: 600 } } = {},
) {
  let browser;
  try {
    browser = await chromium.launch(cloudLaunchOptions({ executablePath: executablePath() }));
    const context = await browser.newContext({
      storageState,
      viewport,
      acceptDownloads: false,
    });
    await installResourcePolicy(context);
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    await browser?.close().catch(() => {});
    throw error;
  }
}

export async function closeCloudBrowser(runtime) {
  await runtime?.context?.close().catch(() => {});
  await runtime?.browser?.close().catch(() => {});
}

export function cloudBrowserOptions() {
  return {
    executablePath: executablePath() ?? null,
    blockHeavyResources: blocksHeavyResources(),
  };
}
