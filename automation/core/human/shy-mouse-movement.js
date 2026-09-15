import BaseShyMouse from './shy-mouse-click.js';

class ShyMouse extends BaseShyMouse {
  /**
   * Random move
   */
  async move(options = {}) {
    const viewport = await this.getViewport();

    if (!this.lastPos) {
      this.initializePosition(viewport);
    }

    const padding = 60;
    const targetX = padding + Math.random() * (viewport.width - 2 * padding);
    const targetY = padding + Math.random() * (viewport.height - 2 * padding);

    await this.moveToPosition(targetX, targetY, options);
    this.updateActionCount();
  }

  /**
   * CRITICAL: Ultra-realistic movement with 60-144Hz polling simulation (2025+ enhanced)
   */
  async moveToPosition(targetX, targetY, options = {}) {
    const viewport = await this.getViewport();

    if (!this.lastPos) {
      this.initializePosition(viewport);
    }

    targetX = this.clamp(targetX, 0, viewport.width - 1);
    targetY = this.clamp(targetY, 0, viewport.height - 1);

    const motionPath = this.calculateHumanBezierPoints({
      startX: this.lastPos.x,
      startY: this.lastPos.y,
      targetX,
      targetY,
      box: null,
      viewport,
      options
    });
    const motion = {
      lastPoint: this.lastPos,
      lastVelocity: this.motionState.lastVelocity,
      lastAcceleration: this.motionState.lastAcceleration
    };

    for (let i = 0; i < motionPath.points.length; i += 1) {
      const result = await this.movePoint({
        point: motionPath.points[i],
        index: i,
        points: motionPath.points,
        targetDrift: motionPath.targetDrift,
        velocityProfile: motionPath.velocityProfile,
        viewport,
        motion
      });
      if (!result) continue;
      Object.assign(motion, result);
    }

    this.finishMotion(motion);

    this.lastPos = { x: targetX, y: targetY };
    this.lastMoveTime = Date.now();
    this.addToHistory({ x: targetX, y: targetY, time: Date.now() });
  }

  async movePoint(context) {
    const { point: initialPoint, index, points, targetDrift, velocityProfile, viewport, motion } = context;
    let point = initialPoint;
    point = this.applyTargetDrift(point, index, points.length, targetDrift);
    const derivatives = this.calculateMotionDerivatives(point, motion);
    point = this.applyJerkNoise(point, derivatives.jerk);
    point.x = this.clamp(point.x, 0, viewport.width - 1);
    point.y = this.clamp(point.y, 0, viewport.height - 1);

    try {
      await this.page.mouse.move(point.x, point.y);
    } catch (error) {
      this.log('Mouse move failed:', error.message);
      return null;
    }

    await this.waitForMotionFrame(index, points, velocityProfile);
    this.motionState.lastJerk = derivatives.jerk;
    return { lastPoint: point, ...derivatives };
  }

  applyTargetDrift(point, index, pointCount, targetDrift) {
    if (!targetDrift || index <= pointCount * 0.5) return point;
    const driftFactor = (index - pointCount * 0.5) / (pointCount * 0.5);
    const fractalNoise = this.perlinNoise(index * 0.1, Date.now() * 0.001, this.motionState.perlinSeed);
    point.x += targetDrift.x * driftFactor + fractalNoise * 0.5;
    point.y += targetDrift.y * driftFactor + fractalNoise * 0.5;
    return point;
  }

  calculateMotionDerivatives(point, motion) {
    const velocity = {
      x: point.x - motion.lastPoint.x,
      y: point.y - motion.lastPoint.y
    };
    const acceleration = {
      x: velocity.x - motion.lastVelocity.x,
      y: velocity.y - motion.lastVelocity.y
    };
    const rawJerk = {
      x: acceleration.x - motion.lastAcceleration.x,
      y: acceleration.y - motion.lastAcceleration.y
    };
    const jerk = this.calculateSmoothJerk(this.motionState.lastJerk, rawJerk);
    return { velocity, acceleration, jerk };
  }

  applyJerkNoise(point, jerk) {
    const jerkMagnitude = Math.sqrt(jerk.x * jerk.x + jerk.y * jerk.y);
    if (jerkMagnitude <= 0.5) return point;
    const jerkNoise = this.randomGaussian(0, jerkMagnitude * 0.15);
    point.x += jerkNoise;
    point.y += jerkNoise;
    return point;
  }

  async waitForMotionFrame(index, points, velocityProfile) {
    const phase = index / points.length;
    const velocityFactor = velocityProfile ? velocityProfile[index] : 1;
    const pollingDelay = this.calculateRealisticPollingDelay(phase, velocityFactor) * this.config.fatigueMultiplier;
    await this.randomDelay(pollingDelay, pollingDelay + 2);

    const currentEntropy = this.calculateEntropy(points.slice(Math.max(0, index - 5), index + 1));
    const hesitationProb = this.config.hesitationProbability * (1 + (this.config.entropyTarget - currentEntropy));
    if (Math.random() < hesitationProb && phase > 0.2 && phase < 0.8) {
      const hesitationDuration = this.randomGaussian(80, 40) * this.config.fatigueMultiplier;
      await this.randomDelay(Math.max(30, hesitationDuration), hesitationDuration + 50);
      this.log('Hesitation at', phase.toFixed(2), 'entropy:', currentEntropy.toFixed(3));
    }
  }

  finishMotion(motion) {
    this.motionState.lastVelocity = motion.lastVelocity;
    this.motionState.lastAcceleration = motion.lastAcceleration;
    this.motionState.temporalCorrelation = Math.min(0.9, this.motionState.temporalCorrelation + 0.05);
  }

  /**
   * Calculate realistic polling delay with temporal correlation (2025+ enhanced)
   */
  calculateRealisticPollingDelay(phase, velocityFactor = 1) {
    // Temporal correlation: events are correlated with previous polling intervals
    const correlation = this.motionState.temporalCorrelation;
    const pollingPhase = this.motionState.pollingPhase;

    let baseDelay;

    // Correlated randomness (not pure random)
    const correlatedRandom = Math.random() * (1 - correlation) + pollingPhase * correlation;
    this.motionState.pollingPhase = correlatedRandom; // Update for next call

    if (correlatedRandom < 0.65) {
      // 65% typical rate: ~100Hz (9-11ms)
      baseDelay = this.config.typicalPollingInterval + this.randomGaussian(0, 1.5);
    } else if (correlatedRandom < 0.82) {
      // 17% faster: ~120-144Hz (6.9-8.5ms)
      baseDelay = this.config.minPollingInterval + Math.random() * 1.6;
    } else {
      // 18% slower: ~60-85Hz (11.8-16.6ms)
      baseDelay = 11.8 + Math.random() * 4.8;
    }

    // Phase modulation: velocity-dependent timing (Fitts's Law influence)
    if (phase > 0.3 && phase < 0.7) {
      // Cruise phase: faster polling during fast movement
      baseDelay *= 0.88 * velocityFactor;
    } else if (phase > 0.85) {
      // Precision phase: slower, more deliberate
      baseDelay *= 1.25;
    } else if (phase < 0.15) {
      // Acceleration phase: variable timing
      baseDelay *= 0.95 + Math.random() * 0.15;
    }

    // Entropy-based micro-variation (fractal-like)
    const entropyNoise = this.perlinNoise(
      Date.now() * 0.01,
      this.motionState.entropyAccumulator,
      this.motionState.perlinSeed
    );
    baseDelay += entropyNoise * 1.2;
    this.motionState.entropyAccumulator += 0.1;

    // Physiological limits: can't be perfectly regular
    baseDelay += Math.sin(Date.now() * 0.01) * 0.5;

    return this.clamp(baseDelay, this.config.minPollingInterval, this.config.maxPollingInterval);
  }

  /**
   * Calculate ultra-realistic Bezier points with Fitts's Law timing (2025+ enhanced)
   */
  calculateHumanBezierPoints(context) {
    const { startX, startY, targetX, targetY, box, viewport, options } = context;
    const distance = this.calculateDistance({ x: startX, y: startY }, { x: targetX, y: targetY });
    const targetWidth = box ? Math.min(box.width, box.height) : (options.defaultTargetWidth ?? 100);
    const difficulty = Math.log2(distance / targetWidth + 1);
    const predictedMovement = (this.config.fittsA + this.config.fittsB * difficulty) * 1000;
    const adjustedMovement = predictedMovement * this.config.fatigueMultiplier * (0.95 + Math.random() * 0.1);
    const numPoints = options.numPoints ?? this.calculatePointCount(adjustedMovement);
    const controls = this.calculateRealisticControlPoints(
      startX, startY, targetX, targetY, distance, options
    );
    const targetDrift = this.calculateTargetDrift(distance, options);
    const velocityProfile = this.generateVelocityProfile(numPoints, distance);
    const points = this.generateHumanBezierPoints({
      numPoints,
      distance,
      viewport,
      controls,
      velocityProfile,
      jitterStdDev: (options.jitterStdDev ?? 1.5) * this.config.fatigueMultiplier
    });
    const result = this.handleRealisticOvershoot(
      startX, startY, targetX, targetY, box, viewport, points, options, distance, targetWidth
    );
    return { ...result, targetDrift, velocityProfile };
  }

  calculatePointCount(adjustedMovementTime) {
    const complexity = { low: 0.7, high: 1.3 }[this.config.curveComplexity] ?? 1;
    const baseCount = Math.round(adjustedMovementTime / this.config.typicalPollingInterval);
    return this.applyFatigue(Math.max(15, Math.round(baseCount * complexity)));
  }

  calculateTargetDrift(distance, options) {
    if (!this.config.targetDriftEnabled || options.isApproach || distance <= 100) return null;
    const driftMagnitude = this.randomGaussian(0, 3 * this.config.fatigueMultiplier);
    return { x: driftMagnitude, y: driftMagnitude };
  }

  generateHumanBezierPoints({ numPoints, distance, viewport, controls, velocityProfile, jitterStdDev }) {
    const points = [];
    for (let index = 1; index <= numPoints; index += 1) {
      const linearT = index / numPoints;
      const easedT = this.multiLayerEasing(linearT, distance);
      let point = this.getBezierPoint(easedT, controls.p0, controls.p1, controls.p2, controls.p3);
      point = this.applyMicroCorrections(point, index, linearT);
      point = this.applyProgressiveJitter(point, index, easedT, distance, velocityProfile[index - 1], jitterStdDev);
      point = this.applyAttentionError(point);
      point = this.applySubMovement(point, linearT);
      point = this.applyAngularVariation(point, index, points);
      point.x = this.clamp(point.x, 0, viewport.width - 1);
      point.y = this.clamp(point.y, 0, viewport.height - 1);
      points.push(point);
    }
    return points;
  }

  applyMicroCorrections(point, index, linearT) {
    if (Math.random() >= this.config.microCorrectionFrequency || linearT <= 0.2 || linearT >= 0.9) {
      return point;
    }
    const correctionAngle = Math.random() * Math.PI * 2;
    const correctionMagnitude = this.randomGaussian(0, 4 * this.config.fatigueMultiplier);
    for (let depth = 0; depth < this.config.fractalDepth; depth += 1) {
      const scale = Math.pow(0.5, depth);
      const fractalNoise = this.perlinNoise(
        index * 0.1 * (depth + 1), linearT * 10 * (depth + 1), this.motionState.perlinSeed + depth
      );
      point.x += Math.cos(correctionAngle) * correctionMagnitude * scale + fractalNoise * scale;
      point.y += Math.sin(correctionAngle) * correctionMagnitude * scale + fractalNoise * scale;
    }
    return point;
  }

  applyProgressiveJitter(point, index, easedT, distance, velocityInfluence, jitterStdDev) {
    const adaptiveJitter = jitterStdDev * Math.min(1.5, ((1 - easedT) * distance) / 70) * (0.8 + velocityInfluence * 0.4);
    const gaussianNoise = this.randomGaussian(0, adaptiveJitter);
    const perlinNoiseX = this.perlinNoise(index * 0.15, 0, this.motionState.perlinSeed) * adaptiveJitter * 0.3;
    const perlinNoiseY = this.perlinNoise(0, index * 0.15, this.motionState.perlinSeed + 1) * adaptiveJitter * 0.3;
    point.x += gaussianNoise + perlinNoiseX;
    point.y += gaussianNoise + perlinNoiseY;
    return point;
  }

  applyAttentionError(point) {
    if (this.config.attentionSpan >= 0.95 || Math.random() <= this.config.attentionSpan) return point;
    const errorMagnitude = (1 - this.config.attentionSpan) * 18 * this.config.fatigueMultiplier;
    point.x += this.randomGaussian(0, errorMagnitude * 0.25);
    point.y += this.randomGaussian(0, errorMagnitude * 0.25);
    return point;
  }

  applySubMovement(point, linearT) {
    if (linearT <= 0.3 || linearT >= 0.85 || Math.random() >= 0.12) return point;
    const subMovement = this.randomGaussian(0, 2.5 * this.config.fatigueMultiplier);
    point.x += subMovement;
    point.y += subMovement;
    return point;
  }

  applyAngularVariation(point, index, points) {
    if (index <= 1 || Math.random() >= 0.2) return point;
    const previous = points[points.length - 1];
    const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
    const adjustedAngle = angle + this.randomGaussian(0, 0.08);
    const distance = this.calculateDistance(previous, point);
    point.x = previous.x + Math.cos(adjustedAngle) * distance;
    point.y = previous.y + Math.sin(adjustedAngle) * distance;
    return point;
  }

  /**
   * Generate realistic velocity profile (bell curve for ballistic movements)
   * Based on research: human movements follow asymmetric bell-shaped velocity profiles
   */
  generateVelocityProfile(numPoints, distance) {
    const profile = [];
    const peakPosition = 0.40 + Math.random() * 0.15; // Peak velocity at 40-55% of movement

    for (let i = 0; i < numPoints; i++) {
      const t = i / numPoints;

      // Asymmetric Gaussian (skewed bell curve)
      let velocity;
      if (t < peakPosition) {
        // Acceleration phase (slightly faster rise)
        const normT = t / peakPosition;
        velocity = Math.exp(-Math.pow((normT - 1) * 2.2, 2));
      } else {
        // Deceleration phase (slower, more controlled)
        const normT = (t - peakPosition) / (1 - peakPosition);
        velocity = Math.exp(-Math.pow(normT * 2.8, 2));
      }

      // Add natural variation with Perlin noise
      const noiseVariation = this.perlinNoise(i * 0.1, 0, this.motionState.perlinSeed + 100);
      velocity *= (1 + noiseVariation * 0.15);

      // Minimum velocity (never completely stop in the middle)
      velocity = Math.max(0.1, velocity);

      profile.push(velocity);
    }

    return profile;
  }

  /**
   * Realistic control points
   */
  calculateRealisticControlPoints(startX, startY, targetX, targetY, D, options) {
    const dx = targetX - startX;
    const dy = targetY - startY;

    const baseDeviation = D * (0.10 + Math.random() * 0.32);
    const deviation = options.isApproach ? baseDeviation * 0.35 : baseDeviation;

    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = -dy / length;
    const perpY = dx / length;

    const directionBias = Math.random() < 0.65 ? 1 : -1;

    const c1FactorBase = 0.18 + Math.random() * 0.24;
    const c2FactorBase = 0.54 + Math.random() * 0.28;

    const asymmetry = (Math.random() - 0.5) * 0.22;
    const c1Factor = this.clamp(c1FactorBase + asymmetry, 0.15, 0.48);
    const c2Factor = this.clamp(c2FactorBase - asymmetry, 0.50, 0.88);

    const c1Deviation = deviation * (0.5 + Math.random() * 0.6);
    const c2Deviation = deviation * (0.4 + Math.random() * 0.7);

    const fatigueImpact = this.config.fatigueMultiplier;
    const c1x = startX + dx * c1Factor + directionBias * c1Deviation * perpX * fatigueImpact;
    const c1y = startY + dy * c1Factor + directionBias * c1Deviation * perpY * fatigueImpact;

    const c2x = startX + dx * c2Factor + directionBias * c2Deviation * perpX * fatigueImpact;
    const c2y = startY + dy * c2Factor + directionBias * c2Deviation * perpY * fatigueImpact;

    return {
      p0: { x: startX, y: startY },
      p1: { x: c1x, y: c1y },
      p2: { x: c2x, y: c2y },
      p3: { x: targetX, y: targetY }
    };
  }

  /**
   * Multi-layer easing with advanced entropy (2025+ enhanced)
   */
  multiLayerEasing(t, distance) {
    let eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Micro-variations with fractal noise
    const microVariation = (Math.random() - 0.5) * 0.02;
    const fractalVariation = this.perlinNoise(t * 5, distance * 0.01, this.motionState.perlinSeed) * 0.015;
    eased += microVariation + fractalVariation;

    // Tremor (high-frequency noise) with temporal correlation
    const tremorPhase = Date.now() * 0.01 + t * Math.PI * 8;
    const tremor = Math.sin(tremorPhase) * 0.008 * this.motionState.temporalCorrelation;
    eased += tremor;

    // Attention lapses with entropy-based probability
    const currentEntropy = this.motionState.entropyAccumulator % 1;
    const lapseProb = (1 - this.config.attentionSpan) * (1 + currentEntropy) * 0.1;
    if (Math.random() < lapseProb) {
      const lapse = this.randomGaussian(0, 0.025);
      eased += lapse;
      this.log('Attention lapse at t=', t.toFixed(3));
    }

    // Distance-based hesitation with Fitts's Law influence
    const ID = Math.log2(distance / 100 + 1);
    const hesitationProb = 0.04 * (ID / 5); // Higher ID = more difficult = more hesitation
    if (distance > 500 && t > 0.35 && t < 0.65 && Math.random() < hesitationProb) {
      eased *= 0.92;
    }

    // Sub-pixel precision errors (humans can't be perfectly precise)
    if (t > 0.8) {
      const precisionError = this.randomGaussian(0, 0.008 * this.config.fatigueMultiplier);
      eased += precisionError;
    }

    return this.clamp(eased, 0, 1);
  }

  /**
   * Realistic overshoot
   */
  handleRealisticOvershoot(startX, startY, targetX, targetY, box, viewport, points, options, D, W) {
    const adjustedOvershootProb = (options.overshootProb ?? 0.16) * this.config.fatigueMultiplier;
    const isRandomTarget = !box;

    const shouldOvershoot = !isRandomTarget &&
                            !options.isApproach &&
                            D > 120 &&
                            Math.random() < adjustedOvershootProb &&
                            this.config.attentionSpan < 0.92;

    if (!shouldOvershoot) {
      return { points, finalPos: { x: targetX, y: targetY } };
    }

    const dx = targetX - startX;
    const dy = targetY - startY;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const dirX = dx / length;
    const dirY = dy / length;

    let overshootFactor = (0.08 + Math.random() * 0.20) * this.config.fatigueMultiplier;
    let overshootDist = overshootFactor * W;

    let overshootX = targetX + dirX * overshootDist;
    let overshootY = targetY + dirY * overshootDist;

    const margin = 20;
    if (overshootX < margin || overshootX >= viewport.width - margin ||
        overshootY < margin || overshootY >= viewport.height - margin) {
      overshootDist *= 0.5;
      overshootX = targetX + dirX * overshootDist;
      overshootY = targetY + dirY * overshootDist;
    }

    overshootX = this.clamp(overshootX, margin, viewport.width - margin);
    overshootY = this.clamp(overshootY, margin, viewport.height - margin);

    const overshootResult = this.calculateHumanBezierPoints({
      startX, startY, targetX: overshootX, targetY: overshootY, box, viewport,
      options: { ...options, overshootProb: 0 }
    });

    const correctionPoints = this.generateRealisticCorrectionPath(
      overshootX, overshootY, targetX, targetY, viewport, options
    );

    return {
      points: overshootResult.points.concat(correctionPoints),
      finalPos: { x: targetX, y: targetY }
    };
  }

  /**
   * Correction path
   */
  generateRealisticCorrectionPath(overshootX, overshootY, targetX, targetY, viewport, options) {
    const correctionD = this.calculateDistance(
      { x: overshootX, y: overshootY },
      { x: targetX, y: targetY }
    );

    const correctionNumPoints = Math.max(8, Math.round(correctionD / 10));
    const baseJitter = options.jitterStdDev ?? 1.5;
    const jitterStdDev = baseJitter * 0.6 * this.config.fatigueMultiplier;

    const dx = targetX - overshootX;
    const dy = targetY - overshootY;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;

    const correctionDeviation = correctionD * (0.03 + Math.random() * 0.09);
    const perpX = -dy / length;
    const perpY = dx / length;
    const correctionSign = Math.random() < 0.5 ? -1 : 1;

    const c1x = overshootX + dx * 0.32 + correctionSign * correctionDeviation * perpX * Math.random();
    const c1y = overshootY + dy * 0.32 + correctionSign * correctionDeviation * perpY * Math.random();
    const c2x = overshootX + dx * 0.75 + correctionSign * correctionDeviation * perpX * Math.random();
    const c2y = overshootY + dy * 0.75 + correctionSign * correctionDeviation * perpY * Math.random();

    const p0 = { x: overshootX, y: overshootY };
    const p1 = { x: c1x, y: c1y };
    const p2 = { x: c2x, y: c2y };
    const p3 = { x: targetX, y: targetY };

    const correctionPoints = [];

    for (let i = 1; i <= correctionNumPoints; i++) {
      const linearT = i / correctionNumPoints;
      const easedT = this.multiLayerEasing(linearT, correctionD);

      let point = this.getBezierPoint(easedT, p0, p1, p2, p3);

      point.x += this.randomGaussian(0, jitterStdDev);
      point.y += this.randomGaussian(0, jitterStdDev);

      point.x = this.clamp(point.x, 0, viewport.width - 1);
      point.y = this.clamp(point.y, 0, viewport.height - 1);

      correctionPoints.push(point);
    }

    return correctionPoints;
  }

  /**
   * Micro adjustment
   */
  async microMouseAdjustment() {
    if (!this.lastPos) return;

    const microX = this.lastPos.x + this.randomGaussian(0, 2.5 * this.config.fatigueMultiplier);
    const microY = this.lastPos.y + this.randomGaussian(0, 2.5 * this.config.fatigueMultiplier);

    const viewport = await this.getViewport();

    try {
      await this.page.mouse.move(
        this.clamp(microX, 0, viewport.width - 1),
        this.clamp(microY, 0, viewport.height - 1)
      );
    } catch (error) {
      // Silent
    }
  }

  /**
   * Bezier point
   */
  getBezierPoint(t, p0, p1, p2, p3) {
    const omt = 1 - t;
    const omt2 = omt * omt;
    const omt3 = omt2 * omt;
    const t2 = t * t;
    const t3 = t2 * t;

    return {
      x: p0.x * omt3 + 3 * p1.x * omt2 * t + 3 * p2.x * omt * t2 + p3.x * t3,
      y: p0.y * omt3 + 3 * p1.y * omt2 * t + 3 * p2.y * omt * t2 + p3.y * t3
    };
  }

  /**
   * Easing
   */
  easeInOutCubic(t) {
    const variance = (Math.random() - 0.5) * 0.018;
    t = this.clamp(t + variance, 0, 1);

    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Gaussian
   */
  randomGaussian(mean = 0, stdDev = 1) {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdDev + mean;
  }

  /**
   * Perlin noise for natural entropy (fractal-like randomness)
   */
  perlinNoise(x, y, seed) {
    const hash = (n) => {
      n = Math.sin(n + seed) * 43758.5453123;
      return n - Math.floor(n);
    };

    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    const lerp = (a, b, t) => a + t * (b - a);

    const grad = (h, x, y) => {
      const v = (h & 1) === 0 ? x : y;
      return ((h & 2) === 0 ? -v : v);
    };

    const a = hash(xi + hash(yi));
    const b = hash(xi + 1 + hash(yi));
    const c = hash(xi + hash(yi + 1));
    const d = hash(xi + 1 + hash(yi + 1));

    const u = fade(xf);
    const v = fade(yf);

    const x1 = lerp(grad(a * 255, xf, yf), grad(b * 255, xf - 1, yf), u);
    const x2 = lerp(grad(c * 255, xf, yf - 1), grad(d * 255, xf - 1, yf - 1), u);

    return lerp(x1, x2, v);
  }

  /**
   * Calculate realistic movement entropy (measure of unpredictability)
   */
  calculateEntropy(points) {
    if (points.length < 3) return 0.5;

    const velocities = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const v = Math.sqrt(dx * dx + dy * dy);
      velocities.push(v);
    }

    // Calculate entropy using velocity distribution
    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
    const entropy = Math.log2(1 + variance / (mean + 1));

    return Math.min(1, entropy / 3); // Normalize to 0-1
  }

  /**
   * Smooth jerk calculation (third derivative)
   */
  calculateSmoothJerk(prevJerk, targetJerk) {
    const smoothness = this.config.jerkSmoothness;
    return {
      x: prevJerk.x * smoothness + targetJerk.x * (1 - smoothness),
      y: prevJerk.y * smoothness + targetJerk.y * (1 - smoothness),
    };
  }

  /**
   * Human reaction delay
   */
  async humanReactionDelay() {
    const baseTime = this.config.baseReactionTime;
    const variance = this.config.reactionTimeVariance;

    const attentionFactor = 1 + (1 - this.config.attentionSpan) * 0.6;
    const fatigueFactor = this.config.fatigueMultiplier;

    const reactionTime = Math.max(85, this.randomGaussian(baseTime * attentionFactor * fatigueFactor, variance));

    await this.randomDelay(reactionTime * 0.75, reactionTime * 1.25);
  }

  /**
   * Random delay
   */
  async randomDelay(min, max) {
    const microVar = (Math.random() - 0.5) * 10;
    const delay = min + Math.random() * (max - min) + microVar;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
  }

  /**
   * Distance
   */
  calculateDistance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Clamp
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  /**
   * Initialize
   */
  initializePosition(viewport) {
    const margin = 120;
    const x = margin + Math.pow(Math.random(), 1.3) * (viewport.width - 2 * margin);
    const y = margin + Math.random() * (viewport.height - 2 * margin);

    this.lastPos = { x, y };
    this.lastMoveTime = Date.now();
    this.log('Position initialized:', this.lastPos);
  }

  /**
   * Apply COHERENT fatigue
   */
  applyFatigue(baseValue) {
    if (!this.config.fatigueEnabled) return baseValue;

    if (this.config.actionCount > this.config.maxFatigue) {
      this.config.actionCount = Math.floor(this.config.fatigueThreshold * 0.8);
      this.config.attentionSpan = Math.min(0.96, this.config.attentionSpan + 0.08);
      this.config.fatigueMultiplier = 1.0;
      this.log('Fatigue reset');
    }

    if (this.config.actionCount > this.config.fatigueThreshold) {
      const excess = this.config.actionCount - this.config.fatigueThreshold;
      const fatigueLevel = excess / this.config.fatigueThreshold;

      // Unified fatigue multiplier (affects all aspects coherently)
      this.config.fatigueMultiplier = 1.0 + fatigueLevel * 0.4; // Up to 40% slower/less precise

      return Math.round(baseValue * Math.min(1 + fatigueLevel * 0.018, 1.45));
    }

    return baseValue;
  }

  /**
   * Update action count
   */
  updateActionCount() {
    this.config.actionCount++;

    if (this.config.actionCount % 45 === 0) {
      const recovery = Math.floor(15 + Math.random() * 10);
      this.config.actionCount = Math.max(0, this.config.actionCount - recovery);
      this.config.attentionSpan = Math.min(0.96, this.config.attentionSpan + 0.04);
      this.config.fatigueMultiplier = Math.max(1.0, this.config.fatigueMultiplier * 0.85);
      this.log('Recovery applied');
    }

    this.config.attentionSpan = Math.max(
      this.config.minAttentionSpan,
      this.config.attentionSpan - 0.0008
    );
  }

  /**
   * Add to history
   */
  addToHistory(position) {
    this.moveHistory.push(position);
    if (this.moveHistory.length > this.maxHistoryLength) {
      this.moveHistory.shift();
    }
  }

  /**
   * Stats
   */
  getMovementStats() {
    if (this.moveHistory.length < 2) return null;

    const distances = [];
    const timeDiffs = [];

    for (let i = 1; i < this.moveHistory.length; i++) {
      const dist = this.calculateDistance(this.moveHistory[i - 1], this.moveHistory[i]);
      const timeDiff = this.moveHistory[i].time - this.moveHistory[i - 1].time;
      distances.push(dist);
      timeDiffs.push(timeDiff);
    }

    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const avgTime = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

    return {
      averageDistance: avgDistance,
      averageTime: avgTime,
      averageSpeed: avgDistance / avgTime,
      totalMoves: this.moveHistory.length,
      actionCount: this.config.actionCount,
      attentionSpan: this.config.attentionSpan,
      fatigueLevel: Math.max(0, this.config.actionCount - this.config.fatigueThreshold),
      fatigueMultiplier: this.config.fatigueMultiplier
    };
  }

  /**
   * Reset
   */
  reset() {
    this.config.actionCount = 0;
    this.config.attentionSpan = 0.88 + Math.random() * 0.10;
    this.config.fatigueMultiplier = 1.0;
    this.moveHistory = [];
    this.lastPos = null;
    this.invalidateViewportCache();

    // Reset advanced motion state (2025+ enhancement)
    this.motionState = {
      lastVelocity: { x: 0, y: 0 },
      lastAcceleration: { x: 0, y: 0 },
      lastJerk: { x: 0, y: 0 },
      temporalCorrelation: 0.5,
      entropyAccumulator: 0,
      perlinSeed: Math.random() * 10000,
      pollingPhase: Math.random(),
    };

    this.log('State reset complete (with advanced motion state)');
  }
}

export default ShyMouse;
export { ShyMouse };
