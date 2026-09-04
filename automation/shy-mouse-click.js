import BaseShyMouse from './shy-mouse-scroll.js';

class ShyMouse extends BaseShyMouse {
  /**
   * Enhanced click
   */
  async click(element, options = {}) {
    let box = await this.prepareClickTarget(element, options);
    await this.waitUntilClickable(element, options.waitTimeout ?? 5000);
    if (!await this.isElementClickable(element)) throw new Error('Element is not clickable');

    const stableBox = await this.waitForElementStability(element, options.stabilityTimeout ?? 1500);
    if (!stableBox) throw new Error('Element position is unstable');

    const viewport = await this.getViewport();
    box = await this.getElementBoundingBox(element);
    if (!box) throw new Error('Element bounding box unavailable after stability check');

    const clickTarget = await this.moveToClickTarget(element, box, viewport, options);
    const preClickState = await this.pressElement(element);
    await this.validateClick(element, preClickState, options);
    await this.postClickBehavior(clickTarget, viewport, options);

    this.lastPos = clickTarget;
    this.updateActionCount();
  }

  async prepareClickTarget(element, options) {
    const box = await this.getElementBoundingBox(element);
    if (!box) throw new Error('Element bounding box unavailable');
    if (await this.isElementInViewport(element, options.visibilityBuffer ?? 50)) return box;

    try {
      await this.scrollToElement(element, options);
    } catch (error) {
      this.log('Scroll failed:', error.message);
    }
    await this.randomDelay(120, 250);
    const scrolledBox = await this.getElementBoundingBox(element);
    if (!scrolledBox) throw new Error('Element bounding box unavailable after scroll');
    return scrolledBox;
  }

  async waitUntilClickable(element, maxWaitTime) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      if (await this.isElementClickable(element)) return;
      await this.randomDelay(80, 180);
    }
  }

  async moveToClickTarget(element, box, viewport, options) {
    await this.humanReactionDelay();
    const clickTarget = this.calculateClickTarget(box, options);
    clickTarget.x = this.clamp(clickTarget.x, 0, viewport.width - 1);
    clickTarget.y = this.clamp(clickTarget.y, 0, viewport.height - 1);
    const approachTarget = this.calculateNaturalApproachTarget(clickTarget, box, viewport);

    await this.moveToPosition(approachTarget.x, approachTarget.y, { ...options, isApproach: true });
    await this.randomDelay(120, 450);
    await this.moveToPosition(clickTarget.x, clickTarget.y, {
      ...options,
      numPoints: Math.max(3, Math.round(2 + Math.random() * 4))
    });
    if (!await this.isElementClickable(element)) throw new Error('Element became unclickable');
    return clickTarget;
  }

  async pressElement(element) {
    const preClickState = await this.readClickState(element);
    const clickDuration = Math.max(40, Math.round(this.randomGaussian(75, 20)));
    try {
      await this.page.mouse.down();
      await this.randomDelay(clickDuration, clickDuration + 15);
      await this.page.mouse.up();
    } catch (error) {
      throw new Error(`Click failed: ${error.message}`);
    }
    return preClickState;
  }

  async readClickState(element) {
    return element.evaluate(el => {
      try {
        return {
          className: el.className,
          disabled: el.disabled,
          ariaPressed: el.getAttribute('aria-pressed'),
          ariaExpanded: el.getAttribute('aria-expanded'),
        };
      } catch (error) {
        return null;
      }
    });
  }

  async validateClick(element, preClickState, options) {
    if (options.validateClick === false || !preClickState) return;
    const navigationPromise = this.page.waitForNavigation({ timeout: 10 }).catch(() => null);
    const isElementAccessible = await Promise.race([
      navigationPromise,
      element.evaluate(el => el.isConnected).catch(() => false)
    ]);
    if (isElementAccessible === null || !isElementAccessible) {
      this.log('Skipping validation: element removed or navigation occurred (click likely succeeded)');
      return;
    }

    await this.randomDelay(50, 150);
    let postClickState = null;
    try {
      postClickState = await this.readClickState(element);
    } catch (error) {
      this.log('Post-click validation failed: element possibly removed or unavailable', error.message);
    }
    this.reportClickState(preClickState, postClickState);
  }

  reportClickState(preClickState, postClickState) {
    if (!postClickState) {
      this.log('Validation skipped: post-click state unavailable (click may have succeeded if element was removed)');
      return;
    }
    const stateChanged = ['className', 'disabled', 'ariaPressed', 'ariaExpanded']
      .some(key => preClickState[key] !== postClickState[key]);
    this.log(stateChanged ? 'Click validated: state changed' : 'Warning: No visible state change after click');
  }

  /**
   * Humanized click at a raw viewport COORDINATE (added for HireMeOps captcha solving).
   * The Cloudflare Turnstile / reCAPTCHA checkbox lives in a cross-origin iframe you can't
   * reach into, so we click its screen position: humanized approach + realistic press.
   * Returns the point actually clicked.
   */
  async clickAtPoint(x, y, options = {}) {
    const viewport = await this.getViewport();
    if (!this.lastPos) {
      this.initializePosition(viewport);
    }

    const targetX = this.clamp(x, 0, viewport.width - 1);
    const targetY = this.clamp(y, 0, viewport.height - 1);

    // Approach from the current trajectory, then settle on the target.
    const approach = this.calculateNaturalApproachTarget({ x: targetX, y: targetY }, null, viewport);
    await this.moveToPosition(approach.x, approach.y, { ...options, isApproach: true });
    await this.randomDelay(120, 420);

    await this.moveToPosition(targetX, targetY, {
      ...options,
      numPoints: Math.max(3, Math.round(2 + Math.random() * 4)),
    });

    await this.humanReactionDelay();

    const clickDuration = Math.max(40, Math.round(this.randomGaussian(75, 20)));
    try {
      await this.page.mouse.down();
      await this.randomDelay(clickDuration, clickDuration + 15);
      await this.page.mouse.up();
    } catch (error) {
      throw new Error(`clickAtPoint failed: ${error.message}`);
    }

    await this.postClickBehavior({ x: targetX, y: targetY }, viewport, options);

    this.lastPos = { x: targetX, y: targetY };
    this.updateActionCount();
    return { x: targetX, y: targetY };
  }

  /**
   * Humanized drag from one viewport coordinate to another (added for HireMeOps: DataDome-style
   * slider captchas). Press at start, drag along a human path with a small overshoot past the
   * target, then settle and release — mirrors SeleniumBase's slider-drop overshoot. All via CDP.
   */
  async dragTo(x1, y1, x2, y2, options = {}) {
    const viewport = await this.getViewport();
    const sx = this.clamp(x1, 0, viewport.width - 1);
    const sy = this.clamp(y1, 0, viewport.height - 1);
    const ex = this.clamp(x2, 0, viewport.width - 1);
    const ey = this.clamp(y2, 0, viewport.height - 1);

    await this.moveToPosition(sx, sy, options);
    await this.humanReactionDelay();
    await this.page.mouse.down();
    await this.randomDelay(70, 150);

    // Overshoot the drop point a touch, then correct back — maximizes slider-match compatibility.
    const overshoot = this.clamp(ex + 12, 0, viewport.width - 1);
    await this.moveToPosition(overshoot, ey, { ...options, overshootProb: 0 });
    await this.randomDelay(40, 110);
    await this.moveToPosition(ex, ey, {
      ...options,
      overshootProb: 0,
      numPoints: Math.max(4, Math.round(3 + Math.random() * 4)),
    });
    await this.randomDelay(60, 160);

    await this.page.mouse.up();
    this.lastPos = { x: ex, y: ey };
    this.updateActionCount();
    return { x: ex, y: ey };
  }

  /**
   * Calculate click target
   */
  calculateClickTarget(box, options) {
    const clickPaddingFactor = options.clickPadding ?? 0.68;

    // Fatigue affects precision
    const fatigueOffset = (this.config.fatigueMultiplier - 1) * 0.15;

    const biasX = -0.1 + fatigueOffset;
    const biasY = -0.05 + fatigueOffset;

    const offsetX = (this.randomGaussian(biasX, 0.25 * this.config.fatigueMultiplier) * box.width) * clickPaddingFactor;
    const offsetY = (this.randomGaussian(biasY, 0.25 * this.config.fatigueMultiplier) * box.height) * clickPaddingFactor;

    let targetX = box.x + box.width / 2 + offsetX;
    let targetY = box.y + box.height / 2 + offsetY;

    const marginX = Math.min(8, box.width * 0.1);
    const marginY = Math.min(8, box.height * 0.1);

    targetX = this.clamp(targetX, box.x + marginX, box.x + box.width - marginX);
    targetY = this.clamp(targetY, box.y + marginY, box.y + box.height - marginY);

    return { x: targetX, y: targetY };
  }

  /**
   * NATURAL APPROACH: based on actual trajectory
   */
  calculateNaturalApproachTarget(clickTarget, box, viewport) {
    if (!this.lastPos) {
      // Fallback to random approach
      const distance = 25 + Math.random() * 35;
      const angle = Math.random() * Math.PI * 2;

      let x = clickTarget.x + Math.cos(angle) * distance;
      let y = clickTarget.y + Math.sin(angle) * distance;

      x = this.clamp(x, 0, viewport.width - 1);
      y = this.clamp(y, 0, viewport.height - 1);

      return { x, y };
    }

    // Calculate approach based on current trajectory
    const dx = clickTarget.x - this.lastPos.x;
    const dy = clickTarget.y - this.lastPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

    // Direction from lastPos to target
    const dirX = dx / distance;
    const dirY = dy / distance;

    // Approach distance: 25-60px from target along trajectory
    const approachDistance = 25 + Math.random() * 35;

    // Natural jitter perpendicular to trajectory (±15 degrees typical)
    const perpendicularAngle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * (Math.PI / 6);
    const jitterMagnitude = (Math.random() - 0.5) * 20 * this.config.fatigueMultiplier;

    let x = clickTarget.x - dirX * approachDistance + Math.cos(perpendicularAngle) * jitterMagnitude;
    let y = clickTarget.y - dirY * approachDistance + Math.sin(perpendicularAngle) * jitterMagnitude;

    x = this.clamp(x, 0, viewport.width - 1);
    y = this.clamp(y, 0, viewport.height - 1);

    return { x, y };
  }

  /**
   * Post-click
   */
  async postClickBehavior(clickTarget, viewport, options) {
    const behavior = Math.random();

    if (behavior < 0.35) {
      await this.randomDelay(120, 550);
    } else if (behavior < 0.65) {
      const jitterX = clickTarget.x + this.randomGaussian(0, 6 * this.config.fatigueMultiplier);
      const jitterY = clickTarget.y + this.randomGaussian(0, 6 * this.config.fatigueMultiplier);

      await this.moveToPosition(
        this.clamp(jitterX, 0, viewport.width - 1),
        this.clamp(jitterY, 0, viewport.height - 1),
        { ...options, numPoints: 2 }
      );

      await this.randomDelay(60, 220);
    } else {
      const awayDistance = 35 + Math.random() * 80;
      const awayAngle = Math.random() * Math.PI * 2;
      const awayX = clickTarget.x + Math.cos(awayAngle) * awayDistance;
      const awayY = clickTarget.y + Math.sin(awayAngle) * awayDistance;

      await this.moveToPosition(
        this.clamp(awayX, 0, viewport.width - 1),
        this.clamp(awayY, 0, viewport.height - 1),
        options
      );
    }
  }

}

export default ShyMouse;
export { ShyMouse };
