/**
 * Retry Strategy with Exponential Backoff and Jitter
 * 
 * Usage:
 * const retry = new RetryStrategy();
 * const delayMs = retry.getDelay(attemptNumber);
 * await sleep(delayMs);
 */

export class RetryStrategy {
  constructor(options = {}) {
    // Base delay in milliseconds
    this.baseDelayMs = options.baseDelayMs || 1000;
    
    // Maximum delay cap in milliseconds
    this.maxDelayMs = options.maxDelayMs || 300000; // 5 minutes
    
    // Exponential base (2 = double each time)
    this.exponentialBase = options.exponentialBase || 2;
    
    // Jitter configuration
    this.jitterMs = options.jitterMs || 1000;
    this.jitterType = options.jitterType || 'random'; // 'random', 'full', 'decorrelated'
    
    // Maximum retry attempts
    this.maxAttempts = options.maxAttempts || 8;
    
    // Track last delay for decorrelated jitter
    this.lastDelay = 0;
  }

  /**
   * Calculate delay for given attempt number
   */
  getDelay(attemptNumber, retryAfterMs = null) {
    // If server provides Retry-After, respect it
    if (retryAfterMs && retryAfterMs > 0) {
      return retryAfterMs + this.getJitter();
    }
    
    // Calculate exponential backoff
    const exponentialDelay = Math.min(
      this.baseDelayMs * Math.pow(this.exponentialBase, attemptNumber - 1),
      this.maxDelayMs
    );
    
    // Add jitter based on type
    let finalDelay;
    switch (this.jitterType) {
      case 'full':
        // Full jitter: random between 0 and calculated delay
        finalDelay = Math.random() * exponentialDelay;
        break;
        
      case 'decorrelated':
        // Decorrelated jitter: based on previous delay
        const minDelay = this.baseDelayMs;
        const maxDelay = Math.min(exponentialDelay * 3, this.maxDelayMs);
        finalDelay = Math.random() * (maxDelay - minDelay) + minDelay;
        this.lastDelay = finalDelay;
        break;
        
      case 'random':
      default:
        // Random jitter: add random value to exponential delay
        finalDelay = exponentialDelay + this.getJitter();
        break;
    }
    
    return Math.min(Math.floor(finalDelay), this.maxDelayMs);
  }

  /**
   * Get random jitter value
   */
  getJitter() {
    return Math.floor(Math.random() * this.jitterMs);
  }

  /**
   * Check if should retry based on attempt number
   */
  shouldRetry(attemptNumber, error = null) {
    // Check max attempts
    if (attemptNumber >= this.maxAttempts) {
      return false;
    }
    
    // Check error type (can be customized)
    if (error) {
      // Don't retry on client errors (4xx) except 429
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Execute function with retry logic
   */
  async execute(fn, context = null) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        // Execute the function
        const result = await fn.call(context, attempt);
        return { success: true, result, attempts: attempt };
      } catch (error) {
        lastError = error;
        
        // Check if should retry
        if (!this.shouldRetry(attempt, error)) {
          break;
        }
        
        // Calculate delay
        const delayMs = this.getDelay(
          attempt,
          error.retryAfterMs || null
        );
        
        // Wait before retry
        await this.sleep(delayMs);
      }
    }
    
    // All attempts failed
    return {
      success: false,
      error: lastError,
      attempts: this.maxAttempts
    };
  }

  /**
   * Sleep helper
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get retry statistics
   */
  getStats(attemptNumber) {
    const delays = [];
    for (let i = 1; i <= attemptNumber; i++) {
      delays.push(this.getDelay(i));
    }
    
    const totalDelay = delays.reduce((sum, d) => sum + d, 0);
    
    return {
      attempts: attemptNumber,
      delays: delays,
      totalDelayMs: totalDelay,
      totalDelaySeconds: totalDelay / 1000,
      averageDelayMs: totalDelay / attemptNumber
    };
  }

  /**
   * Reset state (for decorrelated jitter)
   */
  reset() {
    this.lastDelay = 0;
  }
}

export default RetryStrategy;