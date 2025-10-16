# Retry Herd Prevention Demo

## The Problem: Retry Storms 🌪️

**Problem**: Node.js applications crash/restart and immediately send thousands of queued messages to chat servers, creating "thundering herd" that overwhelms downstream services.

**Solution**: Multi-layered throttling with client-side signals only:
- ⏱️ **Warmup Period**: 60s at 1 RPS prevents initial burst  
- 🪣 **Token Bucket**: Rate limiting (5 RPS max)
- 🔄 **AIMD**: Auto-adjust rate based on errors & latency
- 🔴 **Circuit Breaker**: Stop when service is down
- 🎯 **Exponential Backoff**: Intelligent retry with jitter
- 📊 **Sliding Window**: 30s metrics for decisions

## Quick Demo

### 1. See the Problem (Retry Storm)
```bash
node demo-storm.js
```

This shows what happens WITHOUT protection:
- 🚨 **18,000+ requests per second burst**
- ❌ **50%+ error rate** 
- 💥 Server crashes from overload
- 🔄 Failed messages retry, causing MORE storms

### 2. See the Solution (Production Implementation)
```bash
node simulate-demo.js  # Enhanced demo with clear real-time output
```

Watch the production-ready solution in action:
- 🎯 **Token Bucket**: Dynamic rate limiting (1-5+ RPS)
- 🔥 **Warmup Period**: 15 seconds at 1 RPS prevents initial spike
- 🚦 **Concurrency Control**: 6 parallel connections max
- 📊 **AIMD Adaptation**: Auto-adjusts rate based on errors & latency
- 🔴 **Circuit Breaker**: Three states (Closed→Open→HalfOpen)
- 📈 **Real-time Stats**: Updates every 5 seconds

### 3. Run Original Simulation
```bash
npm run simulate  # Original src/simulate.js with 5000 messages
```

## Key Components in Production Code

### 1. Token Bucket Rate Limiter
```javascript
// Ensures we never exceed X requests per second
class TokenBucket {
  async waitForToken() {
    // Blocks until a token is available
  }
}
```

### 2. Circuit Breaker
```javascript
// Stops sending when server is down
// States: Closed → Open → HalfOpen
const circuitBreaker = {
  shouldBlock() { /* Prevents cascading failures */ }
}
```

### 3. Adaptive Rate Control (AIMD)
```javascript
// Automatically adjusts rate based on errors
if (errorRate > 5%) {
  rate *= 0.5;  // Multiplicative decrease
} else {
  rate += 1;    // Additive increase  
}
```

### 4. Exponential Backoff with Jitter
```javascript
// Prevents synchronized retries
const backoff = Math.min(2 ** attempt, 300) * 1000;
const jitter = Math.random() * 1000;
await sleep(backoff + jitter);
```

## Code Comparison: Monolithic vs Modular

### 📊 Surprising Result: Nearly Same Size!

| Approach | Lines | Description |
|----------|-------|-------------|
| **Monolithic** (`src/simulate.js`) | 309 | All-in-one implementation |
| **Modular** (`simulate-modular.js`) | 320 | Using lib components |
| **Difference** | **+11** | Only 3.6% more code! |

### When to Use Which?

#### 📈 Use Monolithic (`src/simulate.js`) When:
- 🎓 **Learning**: Understanding the concepts
- ⚡ **Prototyping**: Quick implementation needed
- 📋 **Single Purpose**: Solving exactly this problem

#### 🧩 Use Modular (`src/lib/`) When:
- 🏭 **Production**: Building real systems
- 👥 **Team Development**: Multiple developers
- 🔄 **Reusability**: Components used elsewhere
- ⚙️ **Customization**: Different requirements

### Available Files:

#### Core Implementation:
- **`src/simulate.js`** - Complete monolithic implementation (309 lines)
- **`simulate-demo.js`** - Enhanced demo with clearer output  

#### Modular Components:
- **`src/lib/`** - Individual reusable components
- **`integration-example.js`** - Real-world integration examples

## Architecture Benefits

✅ **No Server Monitoring Required**: Uses only client-visible signals
✅ **Self-Tuning**: Automatically adapts to server capacity  
✅ **Graceful Degradation**: Slows down instead of failing
✅ **Prevention > Reaction**: Warmup prevents initial storms
✅ **Production Ready**: Can swap fake API with real endpoints

## Team Integration

### Quick Start: Use Modular Components
```javascript
// Copy individual components you need
import { TokenBucket } from './src/lib/TokenBucket.js';
import { CircuitBreaker } from './src/lib/CircuitBreaker.js';

const rateLimiter = new TokenBucket(5);
const breaker = new CircuitBreaker();
```

## 🧩 Modular Components Guide

### Available Components

#### 1. TokenBucket.js - Rate Limiting
```javascript
import { TokenBucket } from './src/lib/TokenBucket.js';

const limiter = new TokenBucket(5); // 5 requests/second
await limiter.take(); // Wait for available token
limiter.setRate(10);  // Adjust rate dynamically
```

**When to use**: Prevent overwhelming downstream services with too many requests.

#### 2. CircuitBreaker.js - Failure Protection
```javascript
import { CircuitBreaker } from './src/lib/CircuitBreaker.js';

const breaker = new CircuitBreaker({ failureThreshold: 10 });

if (!breaker.shouldBlock()) {
  try {
    await apiCall();
    breaker.onSuccess();
  } catch (error) {
    breaker.onFailure();
  }
}
```

**When to use**: Stop cascading failures when downstream service is down.

#### 3. AIMDController.js - Adaptive Rate Control
```javascript
import { AIMDController } from './src/lib/AIMDController.js';

const controller = new AIMDController({ initialRate: 5 });
const newRate = controller.update(errorRate, p95Latency);
rateLimiter.setRate(newRate);
```

**When to use**: Automatically adjust rate based on server performance.

#### 4. SlidingWindow.js - Metrics Collection
```javascript
import { SlidingWindow } from './src/lib/SlidingWindow.js';

const metrics = new SlidingWindow({ windowMs: 30000 });
metrics.record(latency, success);

const errorRate = metrics.getErrorRate();
const p95 = metrics.getP95Latency();
```

**When to use**: Track performance metrics for decision making.

#### 5. RetryStrategy.js - Intelligent Retries
```javascript
import { RetryStrategy } from './src/lib/RetryStrategy.js';

const retry = new RetryStrategy({ maxAttempts: 8 });
const result = await retry.execute(async () => {
  return await apiCall();
});
```

**When to use**: Retry failed requests with exponential backoff and jitter.

### Integration Options

#### Option 1: Use Individual Components
```javascript
// Copy just what you need
import { TokenBucket } from './lib/TokenBucket.js';
import { CircuitBreaker } from './lib/CircuitBreaker.js';
```

#### Option 2: Use Complete Package
```javascript
// Import everything at once
import {
  TokenBucket,
  CircuitBreaker,
  AIMDController,
  SlidingWindow,
  RetryStrategy
} from './lib/index.js';
```

#### Option 3: Copy Individual Files
Simply copy specific `.js` files from `src/lib/` to your project!

### Full Implementation:
1. **Study the patterns** in `src/simulate.js` (production code)
2. **Copy modular components** from `src/lib/` 
3. **Run demos** with `simulate-demo.js` to understand behavior
4. **See real integration** with `integration-example.js`
5. **Follow team guide** in `TEAM-GUIDE.md` for safe adoption
6. **Configure parameters** for your load:
   - `MAX_RPS`: Your server's capacity
   - `CONCURRENCY`: Connection pool size
   - `BATCH_SIZE`: Database fetch size
   - `RETRY_MAX`: Maximum retry attempts

## Monitoring

The system outputs real-time metrics:
```
[stats] {
  queue_depth: 4500,    // Pending messages
  rps_cap: 5,           // Current rate limit
  p95_ms: 150,          // 95th percentile latency
  error_rate: '2.1%',   // Recent error rate
  breaker: 'Closed',    // Circuit breaker state
  sent_total: 500       // Total sent
}
```

## Running the Demos for Your Team

```bash
# Step 1: Show the problem
node demo-storm.js          # Instant 18,000+ RPS burst

# Step 2: Show the solution  
node simulate-demo.js       # Controlled, adaptive flow

# Step 3: Review the code
cat src/simulate.js         # Production patterns to copy
```

## What to Observe

When running `simulate-demo.js`, watch for:
1. **Warmup Phase** (0-15s): Stays at 1 RPS despite 2000 pending messages
2. **Rate Adaptation**: "📉 AIMD: Decreased rate 5 → 2 RPS" when errors spike
3. **Circuit Breaker**: May show "🔴 Circuit Breaker: Closed → Open" if many failures
4. **Recovery**: "📈 AIMD: Increased rate" when system stabilizes
5. **Smooth Drainage**: Queue depth decreases steadily without spikes

The key insight: **Controlled, adaptive flow prevents cascading failures**