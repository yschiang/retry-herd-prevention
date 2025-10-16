/**
 * Retry Herd Prevention Library
 * 
 * Modular components for building resilient systems:
 * - Rate limiting (Token Bucket)
 * - Circuit breaking 
 * - Adaptive rate control (AIMD)
 * - Metrics collection (Sliding Window)
 * - Retry strategies (Exponential backoff with jitter)
 */

import { TokenBucket } from './TokenBucket.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { AIMDController } from './AIMDController.js';
import { SlidingWindow } from './SlidingWindow.js';
import { RetryStrategy } from './RetryStrategy.js';

// Named exports
export { TokenBucket, CircuitBreaker, AIMDController, SlidingWindow, RetryStrategy };

// Default export with all classes
export default {
  TokenBucket,
  CircuitBreaker,
  AIMDController,
  SlidingWindow,
  RetryStrategy
};