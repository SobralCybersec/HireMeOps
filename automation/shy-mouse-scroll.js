import BaseShyMouse from './shy-mouse-core.js';

class ShyMouse extends BaseShyMouse {
  /**
   * Get scroll Y
   */
  async getCurrentScrollY() {
    try {
      return await this.page.evaluate(() => {
        try {
          return window.scrollY || window.pageYOffset || 0;
        } catch (e) {
          return 0;
        }
      });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Scroll to element with coherent fatigue
   */
  async scrollToElement(element, options = {}) {
    const viewport = await this.getViewport();

    if (await this.isElementInViewport(element, options.visibilityBuffer ?? 50)) {
      await this.maybeMicroScroll();
      return;
    }

    const box = await this.getElementBoundingBox(element);
    if (!box) throw new Error('Element has no bounding box');

    const scrollContainer = await this.getScrollContainer(element);
    const { currentScroll, targetScroll } = await this.resolveScrollTarget(
      element, box, viewport, scrollContainer, options
    );

    await this.preScrollMouseMovement(viewport, options);

    const delta = Math.abs(targetScroll - currentScroll);
    if (delta < 10) {
      await this.disposeScrollContainer(scrollContainer);
      return;
    }

    const sequence = this.createScrollSequence(delta, targetScroll, currentScroll, viewport, options);

    await this.executeScrollSequence({ ...sequence, scrollContainer, options });

    if (sequence.overshootAmount > 0) {
      await this.randomDelay(120, 350);
      await this.executeCorrectionScrollLogarithmic(
        targetScroll, sequence.direction, Math.max(3, Math.round(sequence.numSteps / 3)),
        scrollContainer, options
      );
    }

    await this.disposeScrollContainer(scrollContainer);

    await this.randomDelay(80, 180);
    this.updateActionCount();
  }

  async maybeMicroScroll() {
    if (Math.random() >= 0.25) return;
    await this.page.mouse.wheel(0, this.randomGaussian(0, 12));
    await this.randomDelay(50, 150);
  }

  async resolveScrollTarget(element, box, viewport, scrollContainer, options) {
    if (scrollContainer.info.isWindow) {
      return this.windowScrollTarget(box, viewport, scrollContainer, options);
    }

    const scrollInfo = await this.readNestedScrollInfo(element, options);
    if (scrollInfo.found) {
      return scrollInfo;
    }

    return this.windowScrollTarget(box, viewport, scrollContainer, options);
  }

  windowScrollTarget(box, viewport, scrollContainer, options) {
    const position = options.targetPosition ?? 'center';
    const offset = options.offset ?? 100;
    const targets = {
      top: box.y - offset,
      bottom: box.y + box.height - viewport.height + offset,
      center: box.y + box.height / 2 - viewport.height / 2
    };
    const targetScroll = targets[position] ?? targets.center;
    const maxScroll = scrollContainer.info.scrollHeight - viewport.height;

    return {
      currentScroll: viewport.scrollY,
      targetScroll: this.clamp(targetScroll, 0, maxScroll)
    };
  }

  async readNestedScrollInfo(element, options) {
    try {
      return await element.evaluate((el, opts) => {
        const parentNode = node => {
          if (node?.assignedSlot) return node.assignedSlot;
          const parent = node?.parentNode;
          if (parent instanceof ShadowRoot) return parent.host;
          return parent instanceof Element ? parent : null;
        };
        const targetFor = (elRect, parentRect, parent) => {
          const relativeTop = elRect.top - parentRect.top + parent.scrollTop;
          const offset = opts.offset || 50;
          const target = opts.targetPosition || 'center';
          if (target === 'top') return relativeTop - offset;
          if (target === 'bottom') return relativeTop + elRect.height - parent.clientHeight + offset;
          return relativeTop - parent.clientHeight / 2 + elRect.height / 2;
        };
        let parent = parentNode(el);
        for (let depth = 0; parent && parent !== document.documentElement && depth < 50; depth += 1) {
          const style = window.getComputedStyle(parent);
          const overflow = style.overflow + style.overflowY + style.overflowX;
          if (/(auto|scroll)/.test(overflow)) {
            const parentRect = parent.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const maxScroll = parent.scrollHeight - parent.clientHeight;
            return {
              found: true,
              currentScroll: parent.scrollTop,
              targetScroll: Math.max(0, Math.min(targetFor(elRect, parentRect, parent), maxScroll)),
              maxScroll
            };
          }
          parent = parentNode(parent);
        }
        return { found: false };
      }, { targetPosition: options.targetPosition, offset: options.offset });
    } catch (error) {
      return { found: false };
    }
  }

  createScrollSequence(delta, targetScroll, currentScroll, viewport, options) {
    const scrollID = Math.log2(delta / 100 + 1);
    const numSteps = this.applyFatigue(Math.max(5, Math.round(8 * scrollID)));
    const overshootProb = options.overshootProb ?? 0.18;
    const shouldOvershoot = delta > 250 && Math.random() < overshootProb && this.config.attentionSpan < 0.94;
    const overshootAmount = shouldOvershoot
      ? this.clamp(this.randomGaussian(0.15, 0.07) * viewport.height, 40, viewport.height * 0.35)
      : 0;

    return {
      targetScroll,
      direction: targetScroll > currentScroll ? 1 : -1,
      numSteps,
      overshootAmount
    };
  }

  async disposeScrollContainer(scrollContainer) {
    if (scrollContainer.containerHandle) {
      await scrollContainer.containerHandle.dispose().catch(() => {});
    }
  }

  /**
   * Pre-scroll mouse
   */
  async preScrollMouseMovement(viewport, options) {
    if (!this.lastPos) {
      this.initializePosition(viewport);
    }

    const hoverTarget = {
      x: viewport.width * (0.25 + Math.random() * 0.5),
      y: viewport.height * (0.15 + Math.random() * 0.7)
    };

    const distance = this.calculateDistance(this.lastPos, hoverTarget);

    if (distance > 60) {
      await this.moveToPosition(hoverTarget.x, hoverTarget.y, {
        ...options,
        numPoints: Math.max(6, Math.round(distance / 60))
      });
    }
  }

  /**
   * Execute scroll with COHERENT fatigue (smaller steps, slower)
   */
  async executeScrollSequence({ targetScroll, direction, numSteps, overshootAmount, scrollContainer, options }) {
    const baseJitterStdDev = options.scrollJitterStdDev ?? 18;
    const jitterStdDev = baseJitterStdDev * this.config.fatigueMultiplier; // Fatigue increases jitter

    for (let i = 1; i <= numSteps; i++) {
      const currentScroll = await this.getContainerScroll(scrollContainer);
      if (currentScroll === null) break;

      const remainingDelta = Math.abs(targetScroll - currentScroll);
      if (remainingDelta < 8) break;

      const stepDelta = this.scrollStepDelta(remainingDelta, i / numSteps, numSteps, i, overshootAmount, jitterStdDev);
      await this.applyScroll(scrollContainer, direction * stepDelta);

      // COHERENT FATIGUE: slower delays (multiply by fatigue)
      const baseDelay = (18 + Math.random() * 75) * this.config.fatigueMultiplier;
      const microPause = Math.random() < 0.12 ? Math.random() * 90 : 0;
      await this.randomDelay(baseDelay, baseDelay + microPause);

      if (Math.random() < 0.18) {
        await this.microMouseAdjustment();
      }
    }
  }

  async getContainerScroll(scrollContainer) {
    if (scrollContainer.info.isWindow) return this.getCurrentScrollY();
    if (!scrollContainer.containerHandle) return null;
    return scrollContainer.containerHandle.evaluate(el => {
      try {
        return el.scrollTop;
      } catch (error) {
        return 0;
      }
    });
  }

  scrollStepDelta(remainingDelta, progress, numSteps, step, overshootAmount, jitterStdDev) {
    const logDeceleration = 1 - Math.log10(1 + 9 * progress);
    const blendedProgress = this.easeInOutCubic(progress) * 0.6 + logDeceleration * 0.4;
    let stepDelta = (remainingDelta * (1 - blendedProgress) * 0.3) / this.config.fatigueMultiplier;
    stepDelta += this.randomGaussian(0, Math.min(jitterStdDev, remainingDelta * 0.12));
    stepDelta = this.clamp(stepDelta, 8, 180);
    if (overshootAmount > 0 && step > numSteps * 0.75) {
      stepDelta += overshootAmount * ((step - numSteps * 0.75) / (numSteps * 0.25)) * 0.4;
    }
    return stepDelta;
  }

  async applyScroll(scrollContainer, delta) {
    if (scrollContainer.info.isWindow) {
      await this.page.mouse.wheel(0, delta);
      return;
    }
    if (scrollContainer.containerHandle) {
      await scrollContainer.containerHandle.evaluate((el, amount) => {
        try {
          el.scrollTop += amount;
        } catch (error) {
          // Silent
        }
      }, delta);
    }
  }

  /**
   * Correction scroll
   */
  async executeCorrectionScrollLogarithmic(targetScroll, direction, correctionSteps, scrollContainer, options) {
    const baseJitterStdDev = (options.scrollJitterStdDev ?? 18) / 2;
    const jitterStdDev = baseJitterStdDev * this.config.fatigueMultiplier;

    for (let i = 1; i <= correctionSteps; i++) {
      let currentScroll;

      if (scrollContainer.info.isWindow) {
        currentScroll = await this.getCurrentScrollY();
      } else if (scrollContainer.containerHandle) {
        currentScroll = await scrollContainer.containerHandle.evaluate(el => {
          try {
            return el.scrollTop;
          } catch (e) {
            return 0;
          }
        });
      } else {
        break;
      }

      const correctionDelta = Math.abs(targetScroll - currentScroll);
      if (correctionDelta < 8) break;

      const progress = i / correctionSteps;
      const logFactor = 1 - Math.log10(1 + 9 * progress);

      // COHERENT FATIGUE
      let stepDelta = (correctionDelta * logFactor * 0.4) / this.config.fatigueMultiplier;

      stepDelta += this.randomGaussian(0, jitterStdDev);
      stepDelta = this.clamp(stepDelta, 8, 130);

      if (scrollContainer.info.isWindow) {
        await this.page.mouse.wheel(0, -direction * stepDelta);
      } else if (scrollContainer.containerHandle) {
        await scrollContainer.containerHandle.evaluate((el, delta) => {
          try {
            el.scrollTop += delta;
          } catch (e) {
            // Silent
          }
        }, -direction * stepDelta);
      }

      await this.randomDelay(12 * this.config.fatigueMultiplier, 65 * this.config.fatigueMultiplier);
    }
  }

}

export default ShyMouse;
export { ShyMouse };
