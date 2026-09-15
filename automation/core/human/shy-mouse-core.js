// Coordinate-level humanized mouse for the patchright worker (Fitts timing, Bézier paths,
// fatigue, jerk-smoothed physics, 60–144Hz polling simulation).
//
// WHY this exists alongside human.js: human.js clicks *locators* (element-relative, with
// actionability + overlay-escape logic) and is the right tool for form fields. ShyMouse drives
// raw viewport COORDINATES — which is what captcha solving needs, because a Cloudflare Turnstile
// checkbox lives in a cross-origin iframe you cannot reach into: you click its screen position,
// not its element. All motion goes through page.mouse.move/down/up → CDP Input domain, so the real
// OS pointer never moves (LO watches; see memory focus-safe-automation).
//
// Added for HireMeOps: clickAtPoint(x, y) — humanized move + realistic press at a computed point.

function createMotionState() {
  return {
      lastVelocity: { x: 0, y: 0 },
      lastAcceleration: { x: 0, y: 0 },
      lastJerk: { x: 0, y: 0 },
      temporalCorrelation: 0.5,
      entropyAccumulator: 0,
      perlinSeed: Math.random() * 10000,
      pollingPhase: Math.random(),
    };;
}

function optionOr(options, key, fallback) {
  return options[key] ?? fallback;
}

function createMouseConfig(options) {
  return {
      // Fatigue system (coherent: everything slows down)
      fatigueEnabled: optionOr(options, 'fatigueEnabled', true),
      fatigueThreshold: optionOr(options, 'fatigueThreshold', 20),
      actionCount: 0,
      maxFatigue: optionOr(options, 'maxFatigue', 100),
      fatigueMultiplier: 1.0, // Affects both speed and precision coherently

      attentionSpan: 0.88 + Math.random() * 0.10,
      minAttentionSpan: 0.80,

      // Human reaction time: 150-300ms (research-based)
      baseReactionTime: optionOr(options, 'baseReactionTime', 200),
      reactionTimeVariance: optionOr(options, 'reactionTimeVariance', 80),

      curveComplexity: optionOr(options, 'curveComplexity', 'high'),
      debug: optionOr(options, 'debug', false),

      // Human behavior patterns (2025+ enhanced)
      hesitationProbability: 0.08,
      microCorrectionFrequency: 0.15,
      targetDriftEnabled: true,

      // Mouse polling rate simulation (60-144Hz typical)
      minPollingInterval: 6.9, // 144Hz
      maxPollingInterval: 16.6, // 60Hz
      typicalPollingInterval: 10, // ~100Hz (most common)

      // Fitts's Law parameters (empirical research 2020-2025)
      fittsA: 0.230, // Intercept (reaction/processing time in seconds)
      fittsB: 0.166, // Slope (movement time coefficient)

      // Advanced entropy and fractal parameters
      fractalDepth: 3,
      entropyTarget: 0.65, // Target entropy for natural unpredictability
      jerkSmoothness: 0.85, // How smooth jerk transitions are (0-1)
    };;
}


async function elementHasAnimation(element) {
  return element.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return style.transition !== 'all 0s ease 0s' && style.transition !== 'none' || style.animation !== 'none';
  });
}

async function waitForAnimationFrameStability(element, timeout) {
  const stability = element.evaluate((el, timeoutMs) => new Promise((resolve) => {
    const start = Date.now();
    let lastChange = start;
    const observer = new MutationObserver(() => { lastChange = Date.now(); });
    try {
      observer.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
      const check = () => {
        const now = Date.now();
        if (now - start > timeoutMs) return observer.disconnect(), resolve(false);
        if (now - lastChange >= 150) return observer.disconnect(), resolve(true);
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    } catch {
      observer.disconnect();
      resolve(false);
    }
  }), timeout);
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), timeout));
  return Promise.race([stability, timeoutPromise]);
}

function sameBox(current, previous) {
  if (!previous) return false;
  return Math.abs(current.x - previous.x) < 1 && Math.abs(current.y - previous.y) < 1 && Math.abs(current.width - previous.width) < 1 && Math.abs(current.height - previous.height) < 1;
}
class ShyMouse {
  constructor(page, options = {}) {
    this.page = page;
    this.lastPos = null;
    this.lastMoveTime = Date.now();
    this.moveHistory = [];
    this.maxHistoryLength = 50;
    this.cachedViewport = null;
    this.viewportCacheTime = 0;
    this.viewportCacheDuration = 2000;

    // Advanced motion state tracking (2025+ research)
    this.motionState = createMotionState();
    this.config = createMouseConfig(options);

    this.setupNavigationListener();
    this.setupConsoleLogger();
  }

  /**
   * Setup navigation listener
   */
  setupNavigationListener() {
    try {
      this.page.on('framenavigated', () => {
        this.invalidateViewportCache();
        this.log('Frame navigated');
      });
    } catch (error) {
      this.log('Navigation listener failed:', error.message);
    }
  }

  /**
   * Setup console logger
   */
  setupConsoleLogger() {
    if (this.config.debug) {
      try {
        this.page.on('console', msg => {
          console.log('[Page]', msg.type(), msg.text());
        });
      } catch (error) {
        // Silent
      }
    }
  }

  /**
   * Log
   */
  log(...args) {
    if (this.config.debug) {
      console.log('[ShyMouse]', new Date().toISOString().substr(11, 12), ...args);
    }
  }

  /**
   * Get viewport with retry
   */
  async getViewport(retries = 2) {
    const now = Date.now();

    if (this.cachedViewport && (now - this.viewportCacheTime) < this.viewportCacheDuration) {
      return this.cachedViewport;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const viewportInfo = await this.page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            devicePixelRatio: window.devicePixelRatio,
            documentWidth: Math.max(root.scrollWidth, root.offsetWidth, root.clientWidth, body.scrollWidth, body.offsetWidth),
            documentHeight: Math.max(root.scrollHeight, root.offsetHeight, root.clientHeight, body.scrollHeight, body.offsetHeight),
          };
        });

        if (viewportInfo) {
          this.cachedViewport = viewportInfo;
          this.viewportCacheTime = now;
          return viewportInfo;
        }

        if (attempt < retries) {
          await this.randomDelay(50, 100);
        }
      } catch (error) {
        this.log(`getViewport attempt ${attempt + 1} failed:`, error.message);
        if (attempt < retries) {
          await this.randomDelay(100, 200);
        }
      }
    }

    this.log('Using fallback viewport');
    const fallback = {
      width: 1920,
      height: 1080,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      documentWidth: 1920,
      documentHeight: 1080,
    };

    this.cachedViewport = fallback;
    this.viewportCacheTime = now - (this.viewportCacheDuration - 500);

    return fallback;
  }

  /**
   * Invalidate cache
   */
  invalidateViewportCache() {
    this.cachedViewport = null;
    this.viewportCacheTime = 0;
  }

  /**
   * Get element frame
   */
  async getElementFrame(element) {
    try {
      const frame = await element.ownerFrame();
      return frame || this.page.mainFrame();
    } catch (error) {
      this.log('getElementFrame failed:', error.message);
      return this.page.mainFrame();
    }
  }

  /**
   * Get scroll container using evaluateHandle (no DOM injection)
   */
  async getScrollContainer(element) {
    try {
      const containerHandle = await element.evaluateHandle(el => {
        function parentNode(node) {
          if (!node) return null;
          if (node.assignedSlot) return node.assignedSlot;
          const parent = node.parentNode;
          if (!parent) return null;
          if (parent instanceof ShadowRoot) return parent.host;
          return parent instanceof Element ? parent : null;
        }
        let parent = parentNode(el);
        for (let depth = 0; parent && parent !== document.documentElement && depth < 50; depth++) {
          const style = window.getComputedStyle(parent);
          if (/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX)) return parent;
          parent = parentNode(parent);
        }
        return null;
      });
      const isContainer = await containerHandle.evaluate(node => node !== null);
      if (isContainer) {
        const info = await containerHandle.evaluate(container => {
          try {
            const rect = container.getBoundingClientRect();
            return {
              isWindow: false,
              scrollTop: container.scrollTop,
              scrollLeft: container.scrollLeft,
              scrollHeight: container.scrollHeight,
              scrollWidth: container.scrollWidth,
              clientHeight: container.clientHeight,
              clientWidth: container.clientWidth,
              rectTop: rect.top,
              rectLeft: rect.left,
              rectWidth: rect.width,
              rectHeight: rect.height,
            };
          } catch {
            return null;
          }
        });
        if (info) return { info, containerHandle };
      }
      await containerHandle.dispose();
      return this.windowScrollContainer();
    } catch (error) {
      this.log('getScrollContainer failed:', error.message);
      return this.windowScrollContainer();
    }
  }

  async windowScrollContainer() {
    const viewport = await this.getViewport();
    return {
      info: {
        isWindow: true,
        scrollTop: viewport.scrollY,
        scrollLeft: viewport.scrollX,
        scrollHeight: viewport.documentHeight,
        scrollWidth: viewport.documentWidth,
        clientHeight: viewport.height,
        clientWidth: viewport.width,
      },
      containerHandle: null,
    };
  }

  /**
   * Enhanced clickability check with multi-point sampling and ancestor checking
   */
  async isElementClickable(element) {
    try {
      const visible = await element.evaluate((el) => {
        const style = window.getComputedStyle(el);
        if (!el.isConnected) return false;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) < 0.1) return false;
        if (style.pointerEvents === 'none') return false;
        if (el.disabled) return false;
        return true;
      });
      if (!visible) return false;
      const inViewport = await element.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom < 0 || rect.right < 0) return false;
        if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
        return true;
      });
      if (!inViewport) return false;
      return element.evaluate((el) => {
        function parentNode(node) {
          if (!node) return null;
          if (node.assignedSlot) return node.assignedSlot;
          const parent = node.parentNode;
          if (!parent) return null;
          if (parent instanceof ShadowRoot) return parent.host;
          return parent instanceof Element ? parent : null;
        }
        function composedContains(ancestor, descendant) {
          let current = descendant;
          for (let depth = 0; current && depth < 100; depth++) {
            if (current === ancestor) return true;
            current = parentNode(current);
          }
          return false;
        }
        function elementAtPoint(x, y) {
          let target = document.elementFromPoint(x, y);
          for (let depth = 0; target?.shadowRoot && depth < 10; depth++) {
            const inner = target.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === target) break;
            target = inner;
          }
          return target;
        }
        function pointHitsElement(target, point) {
          const hit = elementAtPoint(point.x, point.y);
          return !!hit && (hit === target || composedContains(target, hit));
        }
        const rect = el.getBoundingClientRect();
        const points = [
          { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 },
          { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 }, { x: 0.3, y: 0.3 },
          { x: 0.7, y: 0.3 }, { x: 0.3, y: 0.7 }, { x: 0.7, y: 0.7 },
        ].map(({ x, y }) => ({ x: rect.left + rect.width * x, y: rect.top + rect.height * y }));
        let clickablePoints = 0;
        for (const point of points) if (pointHitsElement(el, point)) clickablePoints++;
        return clickablePoints >= points.length * 0.5;
      });
    } catch (error) {
      this.log('isElementClickable failed:', error.message);
      return false;
    }
  }

  /**
   * Check if in viewport
   */
  async isElementInViewport(element, buffer = 10) {
    try {
      const box = await this.getElementBoundingBox(element);
      if (!box) return false;

      const scrollContainer = await this.getScrollContainer(element);
      const viewport = await this.getViewport();

      if (scrollContainer.info.isWindow) {
        const viewTop = viewport.scrollY - buffer;
        const viewBottom = viewport.scrollY + viewport.height + buffer;
        const viewLeft = viewport.scrollX - buffer;
        const viewRight = viewport.scrollX + viewport.width + buffer;

        const hasVerticalOverlap = !(box.y + box.height < viewTop || box.y > viewBottom);
        const hasHorizontalOverlap = !(box.x + box.width < viewLeft || box.x > viewRight);

        return hasVerticalOverlap && hasHorizontalOverlap;
      } else {
        const inContainer = await element.evaluate((el, buff) => {
          try {
            // Helper: traverse shadow boundaries and slot assignments
            function getComposedParentNode(node) {
              if (!node) return null;
              if (node.assignedSlot) return node.assignedSlot;
              const parent = node.parentNode;
              if (!parent) return null;
              if (parent instanceof ShadowRoot) return parent.host;
              if (parent instanceof Element) return parent;
              return null;
            }

            let parent = getComposedParentNode(el);
            let depth = 0;

            while (parent && parent !== document.documentElement && depth < 50) {
              const style = window.getComputedStyle(parent);
              const overflow = style.overflow + style.overflowY + style.overflowX;

              if (/(auto|scroll)/.test(overflow)) {
                const parentRect = parent.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();

                const hasVerticalOverlap = !(elRect.bottom < parentRect.top - buff || elRect.top > parentRect.bottom + buff);
                const hasHorizontalOverlap = !(elRect.right < parentRect.left - buff || elRect.left > parentRect.right + buff);

                return hasVerticalOverlap && hasHorizontalOverlap;
              }

              parent = getComposedParentNode(parent);
              depth++;
            }

            return true;
          } catch (e) {
            return false;
          }
        }, buffer);

        // Dispose container handle if exists
        if (scrollContainer.containerHandle) {
          await scrollContainer.containerHandle.dispose().catch(() => {});
        }

        return inContainer;
      }
    } catch (error) {
      this.log('isElementInViewport failed:', error.message);
      return false;
    }
  }

  /**
   * Get bounding box
   */
  async getElementBoundingBox(element, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const box = await element.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          return box;
        }

        if (attempt < maxRetries - 1) {
          await this.randomDelay(50, 150);
        }
      } catch (error) {
        if (attempt === maxRetries - 1) {
          this.log(`Failed to get bounding box after ${maxRetries} attempts:`, error.message);
          return null;
        }
        await this.randomDelay(100, 200);
      }
    }
    return null;
  }

  /**
   * Wait for element stability with RAF + timeout (no hanging)
   */
  async waitForElementStability(element, timeout = 1500) {
    try {
      if (await elementHasAnimation(element)) await this.randomDelay(300, 500);
    } catch {
      // Continue.
    }
    const stable = await waitForAnimationFrameStability(element, timeout);
    if (!stable) this.log('Stability check timed out or element unstable');
    return this.waitForStableBox(element, timeout);
  }

  async waitForStableBox(element, timeout) {
    const startTime = Date.now();
    let lastBox = null;
    let stableCount = 0;
    while (Date.now() - startTime < timeout) {
      try {
        const box = await element.boundingBox();
        if (!box) {
          await this.randomDelay(50, 100);
          continue;
        }
        if (sameBox(box, lastBox)) {
          stableCount++;
          if (stableCount >= 3) return box;
        } else {
          stableCount = 0;
        }
        lastBox = box;
        await this.randomDelay(50, 100);
      } catch {
        await this.randomDelay(100, 200);
      }
    }
    return lastBox;
  }

}

export default ShyMouse;
export { ShyMouse };
