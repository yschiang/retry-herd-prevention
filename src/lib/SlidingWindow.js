/**
 * Sliding Window Metrics Collector
 * 
 * Tracks metrics over a rolling time window
 * 
 * Usage:
 * const metrics = new SlidingWindow({ windowMs: 30000 }); // 30 second window
 * metrics.record(latency, success);
 * const errorRate = metrics.getErrorRate();
 * const p95 = metrics.getP95Latency();
 */

export class SlidingWindow {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 30000; // Default 30 seconds
    this.dataPoints = [];
    this.totalCount = 0;
    this.successCount = 0;
  }

  /**
   * Record a data point
   */
  record(latencyMs, success) {
    const now = Date.now();
    
    // Add new data point
    this.dataPoints.push({
      timestamp: now,
      latency: latencyMs,
      success: success
    });
    
    // Update counters
    this.totalCount++;
    if (success) this.successCount++;
    
    // Clean old data points outside window
    this.cleanup();
  }

  /**
   * Remove data points outside the window
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    
    // Remove old points
    while (this.dataPoints.length > 0 && this.dataPoints[0].timestamp < cutoff) {
      this.dataPoints.shift();
    }
  }

  /**
   * Get error rate in the window
   */
  getErrorRate() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const failures = this.dataPoints.filter(p => !p.success).length;
    return failures / this.dataPoints.length;
  }

  /**
   * Get success rate in the window
   */
  getSuccessRate() {
    return 1 - this.getErrorRate();
  }

  /**
   * Get P95 latency in the window
   */
  getP95Latency() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const latencies = this.dataPoints
      .map(p => p.latency)
      .sort((a, b) => a - b);
    
    const index = Math.floor(latencies.length * 0.95);
    return latencies[index];
  }

  /**
   * Get P99 latency in the window
   */
  getP99Latency() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const latencies = this.dataPoints
      .map(p => p.latency)
      .sort((a, b) => a - b);
    
    const index = Math.floor(latencies.length * 0.99);
    return latencies[index];
  }

  /**
   * Get average latency in the window
   */
  getAverageLatency() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const sum = this.dataPoints.reduce((acc, p) => acc + p.latency, 0);
    return sum / this.dataPoints.length;
  }

  /**
   * Get median latency in the window
   */
  getMedianLatency() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const latencies = this.dataPoints
      .map(p => p.latency)
      .sort((a, b) => a - b);
    
    const mid = Math.floor(latencies.length / 2);
    
    if (latencies.length % 2 === 0) {
      return (latencies[mid - 1] + latencies[mid]) / 2;
    } else {
      return latencies[mid];
    }
  }

  /**
   * Get request count in the window
   */
  getRequestCount() {
    this.cleanup();
    return this.dataPoints.length;
  }

  /**
   * Get throughput (requests per second) in the window
   */
  getThroughput() {
    this.cleanup();
    
    if (this.dataPoints.length === 0) return 0;
    
    const duration = (Date.now() - this.dataPoints[0].timestamp) / 1000;
    return duration > 0 ? this.dataPoints.length / duration : 0;
  }

  /**
   * Get all metrics as an object
   */
  getMetrics() {
    this.cleanup();
    
    return {
      requestCount: this.getRequestCount(),
      errorRate: this.getErrorRate(),
      successRate: this.getSuccessRate(),
      p95Latency: this.getP95Latency(),
      p99Latency: this.getP99Latency(),
      avgLatency: this.getAverageLatency(),
      medianLatency: this.getMedianLatency(),
      throughput: this.getThroughput(),
      totalCount: this.totalCount,
      totalSuccess: this.successCount
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.dataPoints = [];
    this.totalCount = 0;
    this.successCount = 0;
  }
}

export default SlidingWindow;