import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_STEALTH_ARGS, baseLaunchOptions, cloudLaunchOptions } from "./browser-launch.js";

describe("cloud background networking defaults", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([cloudLaunchOptions, baseLaunchOptions])(
    "removes the networking flag from both custom and browser default args",
    (launchOptions) => {
      vi.stubEnv("HIREMEOPS_CLOUD", "1");
      vi.stubEnv("HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING", "0");
      const baseline = launchOptions({ executablePath: "/usr/bin/chromium" });
      vi.stubEnv("HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING", "1");
      expect(launchOptions({ executablePath: "/usr/bin/chromium" })).toEqual({
        ...baseline,
        args: baseline.args.filter((arg) => arg !== "--disable-background-networking"),
        ignoreDefaultArgs: [...baseline.ignoreDefaultArgs, "--disable-background-networking"],
      });
    },
  );

  it("does not apply the cloud networking experiment to local launch", () => {
    vi.stubEnv("HIREMEOPS_CLOUD", "");
    vi.stubEnv("HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING", "0");
    const baseline = baseLaunchOptions();
    vi.stubEnv("HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING", "1");
    expect(baseLaunchOptions()).toEqual(baseline);
  });
});

describe("cloud browser launch", () => {
  it("uses browser-level Mozilla UA aligned with cloud Chromium", () => {
    const options = cloudLaunchOptions({
      executablePath: "/usr/bin/chromium-headless-shell",
    });
    const userAgent = options.args.find((arg) => arg.startsWith("--user-agent="));

    expect(options.args.slice(0, BASE_STEALTH_ARGS.length)).toEqual(BASE_STEALTH_ARGS);
    expect(userAgent).toMatch(
      /^--user-agent=Mozilla\/5\.0 \(X11; Linux x86_64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/,
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

  it("supports an explicit renderer-limit A/B override", () => {
    const previous = process.env.HIREMEOPS_CLOUD_DISABLE_RENDERER_PROCESS_LIMIT;
    process.env.HIREMEOPS_CLOUD_DISABLE_RENDERER_PROCESS_LIMIT = "1";
    try {
      const options = cloudLaunchOptions({ executablePath: "/usr/bin/chromium" });
      expect(options.args).not.toContain("--renderer-process-limit=1");
    } finally {
      if (previous === undefined) delete process.env.HIREMEOPS_CLOUD_DISABLE_RENDERER_PROCESS_LIMIT;
      else process.env.HIREMEOPS_CLOUD_DISABLE_RENDERER_PROCESS_LIMIT = previous;
    }
  });

  it("removes only background networking when explicitly enabled", () => {
    const previous = process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING;
    process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING = "1";
    try {
      const options = cloudLaunchOptions({ executablePath: "/usr/bin/chromium" });
      expect(options.args).not.toContain("--disable-background-networking");
      expect(options.args).toContain("--disable-background-timer-throttling");
      expect(options.args).toContain("--disable-dev-shm-usage");
      expect(options.args).toContain("--renderer-process-limit=1");
    } finally {
      if (previous === undefined) delete process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING;
      else process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING = previous;
    }
  });

  it("keeps background networking disabled by default in shared cloud launch", () => {
    const previousCloud = process.env.HIREMEOPS_CLOUD;
    const previousNetworking = process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING;
    process.env.HIREMEOPS_CLOUD = "1";
    delete process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING;
    try {
      const options = baseLaunchOptions({ headless: true, executablePath: "/usr/bin/chromium" });
      expect(options.args).toContain("--disable-background-networking");
    } finally {
      if (previousCloud === undefined) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previousCloud;
      if (previousNetworking === undefined)
        delete process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING;
      else process.env.HIREMEOPS_CLOUD_ENABLE_BACKGROUND_NETWORKING = previousNetworking;
    }
  });
});
