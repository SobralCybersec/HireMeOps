import { chromium } from 'patchright';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cloudLaunchOptions, baseLaunchOptions } from './core/browser/browser-launch.js';
for (const launch of [cloudLaunchOptions, baseLaunchOptions]) {
  for (const enabled of ['0', '1']) {
    process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING = enabled;
    const browser = await chromium.launch(launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }));
    try {
      const flags = readdirSync('/proc').filter(id => /^\d+$/.test(id)).flatMap(id => {
        try {
          const args = readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0');
          if (!args.includes('--remote-debugging-pipe') || args.some(a => a.startsWith('--type='))) return [];
          return [{ pid: Number(id), backgroundNetworkingDisabled: args.includes('--disable-background-networking') }];
        } catch { return []; }
      });
      assert(flags.length > 0);
      assert(flags.every(p => p.backgroundNetworkingDisabled === (enabled === '0')));
      console.log(JSON.stringify({ launch: launch.name, enabled, version: browser.version(), processes: flags }));
      for (const viewport of [{width:800,height:600},{width:900,height:675},{width:1024,height:768}]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const actual = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
        assert.deepEqual(actual, viewport);
        console.log(JSON.stringify({ launch:launch.name, enabled, viewport:actual, verified:true }));
        await context.close();
      }
    } finally { await browser.close(); }
  }
}
