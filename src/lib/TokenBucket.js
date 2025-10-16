/**
 * Token Bucket Rate Limiter
 * 
 * Usage:
 * const bucket = new TokenBucket(5); // 5 requests per second
 * await bucket.take();               // Wait for available token
 * bucket.setRate(10);                // Adjust rate dynamically
 */

import { setTimeout as sleep } from 'node:timers/promises';

export class TokenBucket {
  constructor(ratePerSec) {
    this.capacity = ratePerSec;
    this.tokens = ratePerSec;
    this.rate = ratePerSec;
    this.lastRefill = Date.now();
  }

  /**
   * Dynamically adjust the rate limit
   */
  setRate(ratePerSec) {
    this.capacity = ratePerSec;
    this.rate = ratePerSec;
    this.tokens = Math.min(this.tokens, this.capacity);
  }

  /**
   * Refill tokens based on time elapsed
   */
  refill() {
    const now = Date.now();
    const deltaSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + deltaSeconds * this.rate
    );
    this.lastRefill = now;
  }

  /**
   * Wait for an available token (blocks until available)
   */
  async take() {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(10); // Check every 10ms
    }
  }

  /**
   * Check if token is available without waiting
   */
  tryTake() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Get current token count
   */
  getAvailableTokens() {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export default TokenBucket;