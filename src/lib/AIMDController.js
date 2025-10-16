/**
 * AIMD (Additive Increase Multiplicative Decrease) Rate Controller
 * 
 * Automatically adjusts rate based on error signals:
 * - When stable: Additive increase (slow ramp up)
 * - When errors: Multiplicative decrease (fast back off)
 * 
 * Usage:
 * const controller = new AIMDController({
 *   initialRate: 5,
 *   minRate: 1,
 *   maxRate: 100
 * });
 * 
 * // Update metrics and get new rate
 * const newRate = controller.update(errorRate, p95Latency);
 */

export class AIMDController {
  constructor(options = {}) {
    // Rate limits
    this.currentRate = options.initialRate || 5;
    this.minRate = options.minRate || 1;
    this.maxRate = options.maxRate || 100;
    
    // AIMD parameters
    this.additiveStep = options.additiveStep || 1;
    this.multiplicativeFactor = options.multiplicativeFactor || 0.5;
    
    // Thresholds for triggering decrease
    this.errorThreshold = options.errorThreshold || 0.05; // 5% error rate
    this.latencyThreshold = options.latencyThreshold || 400; // 400ms p95
    
    // Warmup configuration
    this.warmupDuration = options.warmupDuration || 60000; // 60 seconds
    this.warmupRate = options.warmupRate || 1;
    this.startTime = Date.now();
    this.warmupComplete = false;
    
    // Rate change callback
    this.onRateChange = options.onRateChange || (() => {});
  }

  /**
   * Update rate based on current metrics
   */
  update(errorRate, p95Latency) {
    // Check if still in warmup
    if (!this.warmupComplete && Date.now() - this.startTime < this.warmupDuration) {
      return this.warmupRate;
    }
    
    // Mark warmup as complete
    if (!this.warmupComplete) {
      this.warmupComplete = true;
      this.onRateChange(this.warmupRate, this.currentRate, 'warmup_complete');
    }
    
    const oldRate = this.currentRate;
    
    // Check if we should decrease (bad conditions)
    if (errorRate > this.errorThreshold || p95Latency > this.latencyThreshold) {
      // Multiplicative decrease
      this.currentRate = Math.max(
        this.minRate,
        Math.floor(this.currentRate * this.multiplicativeFactor)
      );
      
      if (oldRate !== this.currentRate) {
        this.onRateChange(oldRate, this.currentRate, 'decrease', {
          errorRate,
          p95Latency
        });
      }
    } else {
      // Additive increase (stable conditions)
      this.currentRate = Math.min(
        this.maxRate,
        this.currentRate + this.additiveStep
      );
      
      if (oldRate !== this.currentRate) {
        this.onRateChange(oldRate, this.currentRate, 'increase', {
          errorRate,
          p95Latency
        });
      }
    }
    
    return this.currentRate;
  }

  /**
   * Get current rate (considers warmup)
   */
  getCurrentRate() {
    if (!this.warmupComplete && Date.now() - this.startTime < this.warmupDuration) {
      return this.warmupRate;
    }
    return this.currentRate;
  }

  /**
   * Force set rate (bypasses AIMD logic)
   */
  setRate(rate) {
    this.currentRate = Math.max(this.minRate, Math.min(this.maxRate, rate));
    return this.currentRate;
  }

  /**
   * Reset controller to initial state
   */
  reset() {
    this.currentRate = this.minRate;
    this.warmupComplete = false;
    this.startTime = Date.now();
  }

  /**
   * Get controller state
   */
  getState() {
    return {
      currentRate: this.getCurrentRate(),
      isWarmup: !this.warmupComplete && Date.now() - this.startTime < this.warmupDuration,
      minRate: this.minRate,
      maxRate: this.maxRate
    };
  }
}

export default AIMDController;