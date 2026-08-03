// Human-input emulation for the patchright worker (mouse paths, typing, scroll, pacing).
// Key: K — tunable knobs (mouse path, typing dynamics, scroll, think-time)
// Key: humanMove — moves the tracked cursor along a jittered Bézier path
// Key: humanClick — human approach path + dwell, then delegates to locator.click
// Key: humanType — per-character typing with Gaussian dwell/flight + typo/backspace
// Key: thinkTime — log-normal pause between fields/steps

import { fileURLToPath, pathToFileURL } from "node:url";

import { getShyMouse } from "./shy-mouse.js";

const K = {
  overshootDist: 500,
  overshootRadius: [80, 120],
  stepPx: 12,
  stepClamp: [5, 60],
  ctrlJitterFrac: [0.05, 0.2],
  pointJitterPx: 1.5,
  fitts: { a: 110, b: 140 },
  hoverDwell: [60, 200],
  dwell: { mean: 90, sd: 20, clamp: [45, 160] },
  flight: { mean: 165, sd: 55, clamp: [55, 380] },
  commaPause: [80, 230],
  sentencePause: [250, 650],
  typoRate: 0.02,
  scrollNotch: [80, 200],
  scrollGap: [40, 160],
  think: { mu: 0.45, sigma: 0.5, clamp: [250, 8000] },
  preClick: [90, 260],
};

const rand = () => Math.random();
const randRange = ([lo, hi]) => lo + rand() * (hi - lo);
const randInt = (range) => Math.round(randRange(range));

function gauss(mean, sd, clamp) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const val = mean + z * sd;
  if (!clamp) return val;
  return Math.min(clamp[1], Math.max(clamp[0], val));
}

function logNormal({ mu, sigma, clamp }) {
  const g = gauss(0, 1);
  const val = Math.exp(mu + sigma * g) * 1000;
  return Math.min(clamp[1], Math.max(clamp[0], val));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function cursor(page) {
  if (!page.__humanCursor) {
    page.__humanCursor = { x: 40 + rand() * 220, y: 60 + rand() * 180 };
  }
  return page.__humanCursor;
}

function pointInBox(box, pad = 0.15) {
  const bias = () => (rand() + rand() + rand()) / 3;
  return {
    x: box.x + box.width * (pad + bias() * (1 - 2 * pad)),
    y: box.y + box.height * (pad + bias() * (1 - 2 * pad)),
  };
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function buildPath(from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.min(
    K.stepClamp[1],
    Math.max(K.stepClamp[0], Math.round(dist / K.stepPx)),
  );
  const nx = dist === 0 ? 0 : -(to.y - from.y) / dist;
  const ny = dist === 0 ? 0 : (to.x - from.x) / dist;
  const off = () =>
    dist * randRange(K.ctrlJitterFrac) * (rand() < 0.5 ? -1 : 1);
  const c1 = {
    x: from.x + (to.x - from.x) / 3 + nx * off(),
    y: from.y + (to.y - from.y) / 3 + ny * off(),
  };
  const c2 = {
    x: from.x + (2 * (to.x - from.x)) / 3 + nx * off(),
    y: from.y + (2 * (to.y - from.y)) / 3 + ny * off(),
  };
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = bezier(from, c1, c2, to, t);
    if (i < steps) {
      p.x += (rand() * 2 - 1) * K.pointJitterPx;
      p.y += (rand() * 2 - 1) * K.pointJitterPx;
    }
    pts.push(p);
  }
  return { pts, dist };
}

async function walk(page, pts, dist) {
  const cur = cursor(page);
  const moveTime = K.fitts.a + K.fitts.b * Math.log2(dist / 40 + 1);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    await page.mouse.move(p.x, p.y, { steps: 1 });
    cur.x = p.x;
    cur.y = p.y;
    const frac = n <= 1 ? 0.5 : i / (n - 1);
    const bell = 0.4 + 1.2 * Math.sin(Math.PI * frac);
    await sleep((moveTime / n) * bell);
  }
}

async function humanMove(page, x, y) {
  const from = { ...cursor(page) };
  const to = { x, y };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist > K.overshootDist) {
    const over = randRange(K.overshootRadius);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const past = { x: to.x + Math.cos(ang) * over, y: to.y + Math.sin(ang) * over };
    const a = buildPath(from, past);
    await walk(page, a.pts, a.dist);
    const b = buildPath(cursor(page), to);
    await walk(page, b.pts, b.dist);
  } else {
    const a = buildPath(from, to);
    await walk(page, a.pts, a.dist);
  }
}

// Realistic cursor travel to (and hover over) a locator using ShyMouse's full motion model (Fitts
// timing, overshoot, fatigue, 60–144Hz polling sim). Falls back to the local Bézier walk if ShyMouse
// can't read geometry. The ACTIVATION (click) stays in humanClick so the LinkedIn SDUI overlay-escape
// is preserved — a raw coordinate click would land on a covering overlay (false success).
async function shyApproach(page, locator) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const box = await locator.boundingBox({ timeout: 2000 });
    if (!box || box.width < 1 || box.height < 1) return;
    const target = pointInBox(box);
    try {
      await getShyMouse(page).moveToPosition(target.x, target.y);
    } catch {
      await humanMove(page, target.x, target.y);
    }
    await sleep(randRange(K.hoverDwell));
  } catch {}
}

async function humanClick(page, locator, opts = {}) {
  await shyApproach(page, locator);
  // Normal click first (full actionability, incl. the pointer-interception
  // check). LinkedIn's SDUI apply modal sometimes floats a <section> overlay /
  // sticky footer that keeps intercepting pointer events, so the normal click
  // retries until it times out. Cap that attempt, then escape. NOTE a `force`
  // click is NOT the escape here: it clicks the coordinate, which a covering
  // overlay owns, so it silently lands on the wrong element (false success).
  // Instead fire the click straight on the target element — it bubbles to
  // React's delegated onClick regardless of what's painted on top.
  const clickOpts = { timeout: 8000, ...opts };
  try {
    return await locator.click(clickOpts);
  } catch {
    // Escape a covering overlay. A coordinate force-click lands on the overlay
    // (false success); a synthetic el.click() is isTrusted:false and LinkedIn's
    // SDUI ignores it. For a real button, FOCUS it + press Enter — a TRUSTED
    // activation that ignores pointer hit-testing and that SDUI honours. Only
    // non-button targets fall through to a direct el.click().
    const isButton = await locator
      .evaluate((el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button")
      .catch(() => false);
    if (isButton) {
      await locator.focus().catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      return;
    }
    // .catch: a click that triggers a full navigation detaches the frame — swallow the resulting
    // "Target closed" instead of letting it abort the run. The click still fired.
    return locator.evaluate((el) => el.click()).catch(() => {});
  }
}

const KEYMAP = { " ": "Space", "\n": "Enter", "\t": "Tab" };
const NEIGHBORS = {
  a: "s", s: "d", d: "f", e: "r", r: "t", t: "y", o: "i", i: "u", n: "m", l: "k",
};

// Typing pace. Default is FAST — ≈240 WPM keystrokes — because automation form fills want speed, and
// this matches the per-char pace of the site helpers. Human variance (Gaussian dwell, punctuation
// pauses, rare digit-free typos) is still applied, just heavily compressed. Knobs, first set wins:
//   HIREMEOPS_TYPE_INSTANT=1  → instant fill (no per-char delay) after a human travel+focus
//   HIREMEOPS_TYPE_SPEED=<x>  → raw multiplier over the ~47 WPM baseline
//   HIREMEOPS_TYPE_WPM=<n>    → target keystroke WPM (default 240)
// Per call: humanType(page, loc, text, { speed?, instant? }). BASELINE_WPM = measured keystroke pace
// at multiplier 1.0.
const BASELINE_WPM = 47;
const clampSpeed = (s) => Math.max(0.3, Math.min(12, s));
const TYPE_INSTANT = /^(1|true|yes|on)$/i.test(process.env.HIREMEOPS_TYPE_INSTANT || "");
const TYPE_SPEED = (() => {
  const explicit = parseFloat(process.env.HIREMEOPS_TYPE_SPEED || "");
  if (Number.isFinite(explicit) && explicit > 0) return clampSpeed(explicit);
  const wpm = parseFloat(process.env.HIREMEOPS_TYPE_WPM || "");
  const target = Number.isFinite(wpm) && wpm > 0 ? wpm : 240;
  return clampSpeed(target / BASELINE_WPM);
})();

async function pressChar(page, ch, speed = 1) {
  const key = KEYMAP[ch] ?? ch;
  const dwell = gauss(K.dwell.mean, K.dwell.sd, K.dwell.clamp) / speed;
  try {
    await page.keyboard.press(key, { delay: Math.round(dwell) });
  } catch {
    await page.keyboard.insertText(ch);
  }
}

async function humanType(page, locator, text, opts = {}) {
  await humanClick(page, locator);

  // Instant mode: travel + focus like a human, then drop the text in one shot. Fastest for fills.
  // fill() is instant and fires input/change; fall back to a near-zero-delay per-char type for the
  // stubborn controlled inputs where fill() doesn't stick.
  if (opts.instant ?? TYPE_INSTANT) {
    await page.keyboard.press("Control+a").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await locator
      .fill(String(text))
      .catch(() => locator.pressSequentially(String(text), { delay: 4 }).catch(() => {}));
    return;
  }

  const speed = clampSpeed(opts.speed ?? TYPE_SPEED);
  await sleep(randRange([80, 240]) / speed);
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await sleep(randRange([40, 120]) / speed);
  for (const ch of String(text)) {
    if (rand() < K.typoRate && NEIGHBORS[ch.toLowerCase()]) {
      const wrong = NEIGHBORS[ch.toLowerCase()];
      await pressChar(page, ch === ch.toUpperCase() ? wrong.toUpperCase() : wrong, speed);
      await sleep(gauss(K.flight.mean, K.flight.sd, K.flight.clamp) / speed);
      await page.keyboard.press("Backspace", { delay: 40 });
      await sleep(randRange([90, 240]) / speed);
    }
    await pressChar(page, ch, speed);
    let flight = gauss(K.flight.mean, K.flight.sd, K.flight.clamp);
    if (",;:".includes(ch)) flight += randRange(K.commaPause);
    else if (".?!".includes(ch)) flight += randRange(K.sentencePause);
    await sleep(flight / speed);
  }
}

async function humanScroll(page, totalY) {
  const dir = totalY < 0 ? -1 : 1;
  let done = 0;
  const total = Math.abs(totalY);
  while (done < total) {
    const step = Math.min(randInt(K.scrollNotch), total - done);
    await page.mouse.wheel(0, dir * step);
    done += step;
    await sleep(randRange(K.scrollGap));
  }
}

const thinkTime = () => sleep(logNormal(K.think));
const preClick = () => sleep(randRange(K.preClick));

export {
  humanClick,
  humanType,
  humanMove,
  humanScroll,
  thinkTime,
  preClick,
  sleep,
  buildPath,
  pointInBox,
  gauss,
  logNormal,
};

function _selfcheck() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`selfcheck failed: ${msg}`);
  };
  const box = { x: 100, y: 200, width: 300, height: 40 };
  for (let i = 0; i < 5000; i++) {
    const p = pointInBox(box);
    assert(p.x > box.x && p.x < box.x + box.width, "pointInBox x out of range");
    assert(p.y > box.y && p.y < box.y + box.height, "pointInBox y out of range");
  }
  const { pts } = buildPath({ x: 0, y: 0 }, { x: 600, y: 300 });
  assert(pts.length >= K.stepClamp[0] && pts.length <= K.stepClamp[1], "step count clamp");
  const last = pts[pts.length - 1];
  assert(Math.abs(last.x - 600) < 0.001 && Math.abs(last.y - 300) < 0.001, "path endpoint");
  assert(buildPath({ x: 5, y: 5 }, { x: 5, y: 5 }).pts.length >= K.stepClamp[0], "zero path");
  for (let i = 0; i < 5000; i++) {
    const g = gauss(90, 40, [45, 160]);
    assert(g >= 45 && g <= 160, "gauss clamp");
  }
  for (let i = 0; i < 5000; i++) {
    const l = logNormal(K.think);
    assert(l >= K.think.clamp[0] && l <= K.think.clamp[1], "logNormal clamp");
  }
  console.log("human.js selfcheck OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  _selfcheck();
}
