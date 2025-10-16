/**
 * Circuit Breaker Pattern
 * 
 * States: Closed -> Open -> HalfOpen -> Closed
 * 
 * Usage:
 * const breaker = new CircuitBreaker();
 * if (!breaker.shouldBlock()) {
 *   try {
 *     await makeRequest();
 *     breaker.onSuccess();
 *   } catch (error) {
 *     breaker.onFailure();
 *   }
 * }
 */

export class CircuitBreaker {
  constructor(options = {}) {
    this.state = 'Closed';
    this.openedAt = 0;
    this.halfOpenUntil = 0;
    this.consecutiveFailures = 0;
    
    // Configurable thresholds
    this.failureThreshold = options.failureThreshold || 10;
    this.openDurationMs = options.openDurationMs || 30000; // 30 seconds
    this.halfOpenDurationMs = options.halfOpenDurationMs || 10000; // 10 seconds
    this.halfOpenProbeLimit = options.halfOpenProbeLimit || 3; // RPS during probe
    
    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
  }

  /**
   * Check if requests should be blocked
   */
  shouldBlock() {
    const now = Date.now();
    
    if (this.state === 'Open') {
      // Check if it's time to try again
      if (now - this.openedAt >= this.openDurationMs) {
        this.transition('HalfOpen');
        this.halfOpenUntil = now + this.halfOpenDurationMs;
        this.consecutiveFailures = 0;
      } else {
        return true; // Block request
      }
    }
    
    return false;
  }

  /**
   * Record successful request
   */
  onSuccess() {
    this.consecutiveFailures = 0;
    
    if (this.state === 'HalfOpen' && Date.now() > this.halfOpenUntil) {
      // Probe period successful, close the breaker
      this.transition('Closed');
    }
  }

  /**
   * Record failed request
   */
  onFailure() {
    this.consecutiveFailures++;
    
    if (this.state === 'Closed' && this.consecutiveFailures >= this.failureThreshold) {
      // Too many failures, open the breaker
      this.transition('Open');
      this.openedAt = Date.now();
    } else if (this.state === 'HalfOpen') {
      // Probe failed, reopen the breaker
      this.transition('Open');
      this.openedAt = Date.now();
    }
  }

  /**
   * Transition to new state
   */
  transition(newState) {
    const oldState = this.state;
    this.state = newState;
    this.onStateChange(oldState, newState);
  }

  /**
   * Get current state info
   */
  getState() {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      isBlocking: this.shouldBlock()
    };
  }

  /**
   * Reset breaker to closed state
   */
  reset() {
    this.state = 'Closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenUntil = 0;
  }

  /**
   * Get rate limit for half-open state
   */
  getHalfOpenRateLimit() {
    return this.state === 'HalfOpen' ? this.halfOpenProbeLimit : null;
  }
}

export default CircuitBreaker;