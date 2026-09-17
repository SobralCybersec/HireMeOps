import { describe, expect, it } from "vitest";
import { BASE_STEALTH_ARGS, baseLaunchOptions, cloudLaunchOptions } from "./browser-launch.js";

describe("cloud browser launch", () => {
  it("uses browser-level Mozilla UA aligned with cloud Chromium", () => {
    const options = cloudLaunchOptions({
      executablePath: "/usr/bin/chromium-headless-shell",
    });
    const userAgent = options.args.find((arg) => arg.startsWith("--user-agent="));

    expect(options.args.slice(0, BASE_STEALTH_ARGS.length)).toEqual(BASE_STEALTH_ARGS);
    expect(userAgent).toBe(
      "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    expect(userAgent).not.toMatch(/HeadlessChrome/i);
    expect(options).not.toHaveProperty("userAgent");
    expect(options.ignoreDefaultArgs).toEqual(["--enable-automation"]);
  });

  it("keeps shared headless launch aligned with cloud Chromium", () => {
    const previous = process.env.HIREMEOPS_CLOUD;
    process.env.HIREMEOPS_CLOUD = "1";
    try {
      const options = baseLaunchOptions({ headless: true, executablePath: "/usr/bin/chromium" });
      expect(options.args).toContain(
        "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      );
    } finally {
      if (previous === undefined) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previous;
    }
  });
});
