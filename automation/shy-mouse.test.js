// Verifies ShyMouse coordinate motion stays in-bounds and clickAtPoint issues exactly one
// press, plus a smoke test that captcha.js loads and honors the auto-off gate.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ShyMouse, { getShyMouse } from "./shy-mouse.js";
import { passCaptchaOnPage, captchaSolvingEnabled } from "./captcha.js";

const VIEWPORT = {
  width: 1280,
  height: 800,
  scrollX: 0,
  scrollY: 0,
  devicePixelRatio: 1,
  documentWidth: 1280,
  documentHeight: 2000,
};

function fakePage() {
  const moves = [];
  const events = [];
  return {
    moves,
    events,
    on() {},
    // ShyMouse only evaluates the viewport probe in the clickAtPoint/move path.
    async evaluate(fn) {
      if (String(fn).includes("innerWidth")) return { ...VIEWPORT };
      return undefined;
    },
    async waitForTimeout(ms) {
      return new Promise((r) => setTimeout(r, Math.min(ms, 1)));
    },
    mouse: {
      async move(x, y) {
        moves.push({ x, y });
      },
      async down() {
        events.push("down");
      },
      async up() {
        events.push("up");
      },
      async wheel() {},
    },
  };
}

const inBounds = (moves) =>
  moves.every((p) => p.x >= 0 && p.x <= VIEWPORT.width - 1 && p.y >= 0 && p.y <= VIEWPORT.height - 1);

describe("ShyMouse.clickAtPoint", () => {
  it("issues exactly one down/up and keeps every move in-bounds", async () => {
    const page = fakePage();
    const shy = new ShyMouse(page, { fatigueEnabled: false });

    const pt = await shy.clickAtPoint(640, 400);

    expect(page.events.filter((e) => e === "down")).toHaveLength(1);
    expect(page.events.filter((e) => e === "up")).toHaveLength(1);
    expect(page.events.indexOf("down")).toBeLessThan(page.events.indexOf("up"));
    expect(page.moves.length).toBeGreaterThan(0);
    expect(inBounds(page.moves)).toBe(true);
    expect(pt.x).toBeGreaterThanOrEqual(0);
    expect(pt.x).toBeLessThanOrEqual(VIEWPORT.width - 1);
  });

  it("clamps out-of-range coordinates into the viewport", async () => {
    const page = fakePage();
    const shy = new ShyMouse(page, { fatigueEnabled: false });

    const pt = await shy.clickAtPoint(999999, -500);

    expect(pt.x).toBeLessThanOrEqual(VIEWPORT.width - 1);
    expect(pt.y).toBeGreaterThanOrEqual(0);
    expect(inBounds(page.moves)).toBe(true);
  });
});

describe("ShyMouse math primitives", () => {
  const shy = new ShyMouse(fakePage());

  it("randomGaussian is finite; clamp/bezier endpoints hold", () => {
    for (let i = 0; i < 2000; i++) expect(Number.isFinite(shy.randomGaussian(0, 1))).toBe(true);
    expect(shy.clamp(5, 0, 3)).toBe(3);
    expect(shy.clamp(-5, 0, 3)).toBe(0);
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 100, y: 50 };
    const start = shy.getBezierPoint(0, p0, p0, p3, p3);
    const end = shy.getBezierPoint(1, p0, p0, p3, p3);
    expect(start.x).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(100);
  });

  it("velocity profile has the requested length and never fully stops", () => {
    const prof = shy.generateVelocityProfile(30, 400);
    expect(prof).toHaveLength(30);
    expect(Math.min(...prof)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("getShyMouse", () => {
  it("returns one cached instance per page (coherent session fatigue)", () => {
    const page = fakePage();
    const a = getShyMouse(page);
    const b = getShyMouse(page);
    expect(a).toBe(b);
    expect(page.__shyMouse).toBe(a);
  });
});

describe("captcha.js gate", () => {
  const prev = process.env.HIREMEOPS_AUTO_CAPTCHA;
  beforeEach(() => {
    delete process.env.HIREMEOPS_AUTO_CAPTCHA;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.HIREMEOPS_AUTO_CAPTCHA;
    else process.env.HIREMEOPS_AUTO_CAPTCHA = prev;
  });

  it("loads (imports shy-mouse.js) and no-ops when auto-captcha is off", async () => {
    expect(captchaSolvingEnabled()).toBe(false);
    const res = await passCaptchaOnPage(fakePage());
    expect(res.solved).toBe(false);
    expect(res.reason).toMatch(/off/i);
  });
});
