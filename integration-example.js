// integration-example.js
// Real-world example: Adding throttling to existing chat client

import { TokenBucket, CircuitBreaker, SlidingWindow } from './src/lib/index.js';

/**
 * BEFORE: Typical chat client without protection
 */
class OriginalChatClient {
  constructor(apiEndpoint) {
    this.apiEndpoint = apiEndpoint;
  }
  
  async sendMessage(message) {
    // Direct API call - NO PROTECTION!
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  }
  
  // Batch sending - DANGER: Can create retry storms!
  async sendBatch(messages) {
    const promises = messages.map(msg => this.sendMessage(msg));
    return await Promise.all(promises); // ALL AT ONCE!
  }
}

/**
 * AFTER: Protected chat client with progressive enhancement
 */
class ProtectedChatClient {
  constructor(apiEndpoint, options = {}) {
    this.apiEndpoint = apiEndpoint;
    
    // Phase 1: Add basic rate limiting
    this.rateLimiter = new TokenBucket(options.maxRPS || 10);
    
    // Phase 2: Add metrics collection
    this.metrics = new SlidingWindow({ windowMs: 30000 });
    
    // Phase 3: Add circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold || 5,
      onStateChange: (from, to) => {
        console.log(`🔴 Chat Client Circuit Breaker: ${from} → ${to}`);
        // Integrate with your monitoring system here
        this.notifyMonitoring('circuit_breaker_state_change', { from, to });
      }
    });
    
    // Internal counters
    this.totalSent = 0;
    this.totalFailed = 0;
  }
  
  async sendMessage(message) {
    // Step 1: Check circuit breaker
    if (this.circuitBreaker.shouldBlock()) {
      const error = new Error('Circuit breaker is open - service unavailable');
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }
    
    // Step 2: Apply rate limiting
    await this.rateLimiter.take();
    
    // Step 3: Send with metrics tracking
    const start = Date.now();
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      
      const latency = Date.now() - start;
      
      if (!response.ok) {
        // Record failure
        this.metrics.record(latency, false);
        this.circuitBreaker.onFailure();
        this.totalFailed++;
        
        const error = new Error(`API error: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      
      // Record success
      this.metrics.record(latency, true);
      this.circuitBreaker.onSuccess();
      this.totalSent++;
      
      return await response.json();
      
    } catch (error) {
      const latency = Date.now() - start;
      
      // Handle network errors (timeouts, etc)
      this.metrics.record(latency, false);
      this.circuitBreaker.onFailure();
      this.totalFailed++;
      
      throw error;
    }
  }
  
  // Protected batch sending - NO MORE STORMS!
  async sendBatch(messages) {
    const results = [];
    const errors = [];
    
    // Send one by one, respecting rate limits
    for (let i = 0; i < messages.length; i++) {
      try {
        const result = await this.sendMessage(messages[i]);
        results.push({ index: i, success: true, result });
      } catch (error) {
        results.push({ index: i, success: false, error: error.message });
        errors.push({ index: i, error });
      }
    }
    
    return {
      total: messages.length,
      successful: results.filter(r => r.success).length,
      failed: errors.length,
      results,
      errors
    };
  }
  
  // Health monitoring
  getHealthStatus() {
    const metrics = this.metrics.getMetrics();
    const circuitState = this.circuitBreaker.getState();
    
    return {
      // Component status
      rateLimiter: {
        currentRate: this.rateLimiter.rate,
        availableTokens: this.rateLimiter.getAvailableTokens()
      },
      circuitBreaker: {
        state: circuitState.state,
        failures: circuitState.consecutiveFailures,
        isBlocking: circuitState.isBlocking
      },
      
      // Performance metrics
      performance: {
        requestCount: metrics.requestCount,
        errorRate: (metrics.errorRate * 100).toFixed(1) + '%',
        avgLatency: Math.round(metrics.avgLatency) + 'ms',
        p95Latency: Math.round(metrics.p95Latency) + 'ms',
        throughput: metrics.throughput.toFixed(2) + ' req/s'
      },
      
      // Business metrics
      business: {
        totalSent: this.totalSent,
        totalFailed: this.totalFailed,
        successRate: ((this.totalSent / (this.totalSent + this.totalFailed)) * 100).toFixed(1) + '%'
      }
    };
  }
  
  // Integration with monitoring systems
  notifyMonitoring(event, data) {
    // Replace with your monitoring system (DataDog, New Relic, etc)
    console.log(`[MONITORING] ${event}:`, data);
  }
}

/**
 * BASIC COMPONENT EXAMPLES
 */

async function demonstrateBasicComponents() {
  console.log('🔧 Basic Component Usage Examples\n');

  // 1. Token Bucket Demo
  console.log('1. Token Bucket Rate Limiter:');
  const rateLimiter = new TokenBucket(3); // 3 requests per second
  console.log('   Sending 5 requests with 3 RPS limit...');
  const start = Date.now();
  
  for (let i = 1; i <= 5; i++) {
    await rateLimiter.take();
    console.log(`   Request ${i} sent at +${Date.now() - start}ms`);
  }
  console.log('   Notice the controlled spacing!\n');

  // 2. Circuit Breaker Demo
  console.log('2. Circuit Breaker:');
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    onStateChange: (from, to) => {
      console.log(`   Circuit Breaker: ${from} → ${to}`);
    }
  });
  
  for (let i = 1; i <= 5; i++) {
    if (!breaker.shouldBlock()) {
      console.log(`   Request ${i}: Failed (simulated)`);
      breaker.onFailure();
    } else {
      console.log(`   Request ${i}: Blocked by circuit breaker`);
    }
  }
  console.log('');

  // 3. Sliding Window Metrics Demo
  console.log('3. Sliding Window Metrics:');
  const metrics = new SlidingWindow({ windowMs: 10000 });
  
  // Record sample data
  metrics.record(50, true);   // 50ms success
  metrics.record(120, true);  // 120ms success
  metrics.record(300, false); // 300ms failure
  metrics.record(80, true);   // 80ms success
  metrics.record(500, false); // 500ms failure
  
  console.log('   Metrics:', JSON.stringify(metrics.getMetrics(), null, 2));
  console.log('');
}

/**
 * INTEGRATION EXAMPLES
 */

async function demonstrateIntegration() {
  console.log('🔧 Chat Client Integration Example\n');
  
  // Create protected client
  const chatClient = new ProtectedChatClient('https://api.example.com/messages', {
    maxRPS: 5,           // Start conservative
    failureThreshold: 3  // Open circuit after 3 failures
  });
  
  console.log('1. Single message sending:');
  try {
    const result = await chatClient.sendMessage({
      text: 'Hello world!',
      channelId: 'general',
      userId: 'user123'
    });
    console.log('   ✅ Message sent successfully');
  } catch (error) {
    console.log('   ❌ Failed:', error.message);
  }
  
  console.log('\n2. Batch sending (protected):');
  const messages = Array.from({ length: 20 }, (_, i) => ({
    text: `Batch message ${i + 1}`,
    channelId: 'general',
    userId: 'user123'
  }));
  
  try {
    const batchResult = await chatClient.sendBatch(messages);
    console.log(`   📊 Batch complete: ${batchResult.successful}/${batchResult.total} sent`);
    console.log(`   ⏱️  Time taken: ${batchResult.successful * (1000/5)}ms (rate limited to 5 RPS)`);
  } catch (error) {
    console.log('   ❌ Batch failed:', error.message);
  }
  
  console.log('\n3. Health monitoring:');
  const health = chatClient.getHealthStatus();
  console.log('   📈 Performance:', JSON.stringify(health.performance, null, 2));
  console.log('   🔴 Circuit Breaker:', health.circuitBreaker.state);
  
  console.log('\n🎯 Key Benefits Achieved:');
  console.log('   ✅ No more retry storms during restarts');
  console.log('   ✅ Automatic backpressure when server struggles');
  console.log('   ✅ Circuit breaker prevents cascading failures');
  console.log('   ✅ Real-time monitoring and health checks');
  console.log('   ✅ Gradual, controlled message sending');
}

/**
 * MIGRATION STRATEGY: Gradual Rollout
 */
class GradualMigrationExample {
  constructor(apiEndpoint) {
    this.originalClient = new OriginalChatClient(apiEndpoint);
    this.protectedClient = new ProtectedChatClient(apiEndpoint);
    this.rolloutPercentage = 10; // Start with 10%
  }
  
  async sendMessage(message) {
    // Gradually increase usage of protected client
    const useProtected = Math.random() * 100 < this.rolloutPercentage;
    
    if (useProtected) {
      console.log('   📝 Using PROTECTED client');
      return await this.protectedClient.sendMessage(message);
    } else {
      console.log('   📝 Using ORIGINAL client');
      return await this.originalClient.sendMessage(message);
    }
  }
  
  // Gradually increase rollout based on metrics
  increaseRollout() {
    const health = this.protectedClient.getHealthStatus();
    const errorRate = parseFloat(health.performance.errorRate);
    
    if (errorRate < 5) { // Less than 5% errors
      this.rolloutPercentage = Math.min(100, this.rolloutPercentage + 10);
      console.log(`📈 Increased rollout to ${this.rolloutPercentage}%`);
    } else {
      console.log(`⚠️  High error rate (${errorRate}%), keeping rollout at ${this.rolloutPercentage}%`);
    }
  }
}

// Run demonstrations
async function runAllDemos() {
  await demonstrateBasicComponents();
  await demonstrateIntegration();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllDemos().catch(console.error);
}