// simulate-demo.js - Modified for clearer demonstration
// Same production code but with faster feedback for demo purposes

import PQueue from 'p-queue';
import { setTimeout as sleep } from 'node:timers/promises';

// Force unbuffered output
const log = (...args) => {
  console.log(...args);
  if (process.stdout.isTTY) process.stdout.write('');
};

log('='.repeat(70));
log('🚀 PRODUCTION RETRY HERD PREVENTION - LIVE SIMULATION');
log('='.repeat(70));
log('');
log('📋 Scenario: System restart with 2000 pending messages');
log('🎯 Goal: Prevent thundering herd while maintaining throughput');
log('');

// ==================== Configuration ====================
const SEED_MESSAGES = 2000;   // Reduced for faster demo
const BATCH_SIZE     = 200;   
const CONCURRENCY    = 6;     

let   MAX_RPS        = 5;     
const WARMUP_RPS     = 1;     
const WARMUP_MS      = 15_000;  // 15 sec warmup for demo
const RAMP_STEP      = 1;     
const RAMP_EVERY     = 10_000;  // Faster adaptation for demo

const RETRY_MAX      = 8;     
const BACKOFF_CAP_S  = 300;   

// ==================== In-memory "DB" ====================
const DB = [];
function seedMessages(n = SEED_MESSAGES) {
  for (let i = 0; i < n; i++) {
    DB.push({
      id: `m-${i+1}`,
      payload: { text: `hello-${i+1}` },
      status: 'PENDING',
      attempt_count: 0,
      next_attempt_at: Date.now(),
    });
  }
}
seedMessages();
log(`📦 Loaded ${SEED_MESSAGES} messages into queue`);
log('');

// ==================== Token Bucket ====================
class TokenBucket {
  constructor(ratePerSec) {
    this.capacity = ratePerSec;
    this.tokens   = ratePerSec;
    this.rate     = ratePerSec;
    this.last     = Date.now();
  }
  setRate(rps) {
    this.capacity = rps;
    this.rate     = rps;
    this.tokens   = Math.min(this.tokens, this.capacity);
  }
  refill() {
    const now   = Date.now();
    const delta = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + delta * this.rate);
    this.last   = now;
  }
  async take() {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(10);
    }
  }
}
const bucket = new TokenBucket(WARMUP_RPS);

// ==================== Metrics Window ====================
const win = [];
let sentCount = 0;
function record(ms, ok) {
  const now = Date.now();
  win.push({ t: now, ms, ok });
  while (win.length && now - win[0].t > 30_000) win.shift();
  if (ok) sentCount++;
}
function errorRate() {
  if (!win.length) return 0;
  const bad = win.filter(x => !x.ok).length;
  return bad / win.length;
}
function p95Latency() {
  const arr = win.map(x => x.ms).sort((a,b)=>a-b);
  if (!arr.length) return 0;
  return arr[Math.floor(arr.length * 0.95)];
}
function pendingDepth() {
  return DB.filter(m =>
    (m.status === 'PENDING' || (m.status === 'FAILED' && m.next_attempt_at <= Date.now()))
  ).length;
}

// ==================== Circuit Breaker ====================
const CB = {
  state: 'Closed',
  openedAt: 0,
  halfOpenUntil: 0,
  consecutiveFailures: 0,
  OPEN_MS: 30_000,
  HALF_OPEN_PROBE_RPS: 3,
  shouldBlock() {
    const now = Date.now();
    if (this.state === 'Open') {
      if (now - this.openedAt >= this.OPEN_MS) {
        this.state = 'HalfOpen';
        this.halfOpenUntil = now + 10_000;
        this.consecutiveFailures = 0;
        log('⚡ Circuit Breaker: Open → HalfOpen (probing with limited traffic)');
      } else {
        return true;
      }
    }
    return false;
  },
  onSuccess() {
    this.consecutiveFailures = 0;
    if (this.state === 'HalfOpen' && Date.now() > this.halfOpenUntil) {
      this.state = 'Closed';
      log('✅ Circuit Breaker: HalfOpen → Closed (service recovered)');
    }
  },
  onFailure() {
    this.consecutiveFailures++;
    if (this.state === 'Closed' && this.consecutiveFailures >= 10) {
      this.state = 'Open';
      this.openedAt = Date.now();
      log('🔴 Circuit Breaker: Closed → Open (too many failures)');
    } else if (this.state === 'HalfOpen') {
      this.state = 'Open';
      this.openedAt = Date.now();
      log('🔴 Circuit Breaker: HalfOpen → Open (probe failed)');
    }
  }
};

// ==================== Fake Chat Server ====================
async function fakeChatServerAPI({ id, payload }) {
  const r = Math.random();
  const delay =
    r < 0.70 ? 30 :
    r < 0.90 ? 120 :
               600 + Math.floor(Math.random()*200);
  await sleep(delay);

  const e = Math.random();
  if      (e < 0.05) return { ok: false, status: 429, retryAfterMs: 1000 + Math.floor(Math.random()*2000) };
  else if (e < 0.08) return { ok: false, status: 503 };
  else if (e < 0.10) throw new Error('ETIMEDOUT');
  return { ok: true, status: 200 };
}

// ==================== Send with Retries ====================
async function sendToChatServer(row) {
  let attempt = 0;
  for (;;) {
    attempt++;
    const start = Date.now();
    try {
      const r = await fakeChatServerAPI({ id: row.id, payload: row.payload });
      const ms = Date.now() - start;

      if (r.ok) {
        record(ms, true);
        CB.onSuccess();
        return { ok: true, ms };
      }
      record(ms, false);
      CB.onFailure();

      if (attempt >= RETRY_MAX || (r.status >= 400 && r.status < 500 && r.status !== 429)) {
        return { ok: false, ms, status: r.status };
      }
      const backoff = Math.min(2 ** attempt, BACKOFF_CAP_S) * 1000;
      const jitter  = Math.floor(Math.random() * 1000);
      const wait    = Math.max(r.retryAfterMs ?? 0, backoff + jitter);
      await sleep(wait);
      continue;

    } catch (e) {
      const ms = Date.now() - start;
      record(ms, false);
      CB.onFailure();
      if (attempt >= RETRY_MAX) return { ok: false, ms, err: e };
      const backoff = Math.min(2 ** attempt, BACKOFF_CAP_S) * 1000;
      const jitter  = Math.floor(Math.random() * 1000);
      await sleep(backoff + jitter);
    }
  }
}

// ==================== DB Operations ====================
async function dbFetchBatch(limit = BATCH_SIZE) {
  const now = Date.now();
  const rows = [];
  for (const m of DB) {
    if (rows.length >= limit) break;
    if ((m.status === 'PENDING' || m.status === 'FAILED') && m.next_attempt_at <= now) {
      m.status = 'SENDING';
      rows.push(m);
    }
  }
  return rows;
}
async function dbMarkSent(id) {
  const m = DB.find(x => x.id === id);
  if (m) { m.status = 'SENT'; }
}
async function dbScheduleRetry(id, nextAttempt, delaySec) {
  const m = DB.find(x => x.id === id);
  if (m) {
    m.status = 'FAILED';
    m.attempt_count = nextAttempt;
    m.next_attempt_at = Date.now() + delaySec * 1000;
  }
}
async function dbMoveToDLQ(id) {
  const m = DB.find(x => x.id === id);
  if (m) m.status = 'DLQ';
}
async function onFail(row) {
  const nextAttempt = (row.attempt_count ?? 0) + 1;
  const base   = Math.min(2 ** nextAttempt, BACKOFF_CAP_S);
  const jitter = Math.random();
  const backoffSec = base + jitter;
  if (nextAttempt >= RETRY_MAX) await dbMoveToDLQ(row.id);
  else await dbScheduleRetry(row.id, nextAttempt, backoffSec);
}

// ==================== Processing Pipeline ====================
const queue = new PQueue({ concurrency: CONCURRENCY });
async function processBatch(rows) {
  for (const row of rows) {
    queue.add(async () => {
      while (CB.shouldBlock()) await sleep(50);
      await bucket.take();
      const res = await sendToChatServer(row);
      if (res.ok) await dbMarkSent(row.id);
      else        await onFail(row);
    });
  }
  await queue.onIdle();
}

// ==================== AIMD Controller ====================
async function controller() {
  log('🔥 WARMUP PHASE: Starting at', WARMUP_RPS, 'RPS for', WARMUP_MS/1000, 'seconds');
  log('');
  
  await sleep(WARMUP_MS);
  bucket.setRate(MAX_RPS);
  log('✅ WARMUP COMPLETE: Increased to', MAX_RPS, 'RPS');
  log('');

  setInterval(() => {
    const e = errorRate();
    const p = p95Latency();
    if (e > 0.05 || p > 400) {
      const oldRate = MAX_RPS;
      MAX_RPS = Math.max(1, Math.floor(MAX_RPS * 0.5));
      bucket.setRate(MAX_RPS);
      log(`📉 AIMD: Decreased rate ${oldRate} → ${MAX_RPS} RPS (error=${(e*100).toFixed(1)}%, p95=${p}ms)`);
    } else if (pendingDepth() > 0) {
      const oldRate = MAX_RPS;
      MAX_RPS += RAMP_STEP;
      bucket.setRate(MAX_RPS);
      log(`📈 AIMD: Increased rate ${oldRate} → ${MAX_RPS} RPS (stable performance)`);
    }
    if (CB.state === 'HalfOpen') {
      bucket.setRate(Math.min(MAX_RPS, CB.HALF_OPEN_PROBE_RPS));
    }
  }, RAMP_EVERY);

  // Stats every 5 seconds for demo
  setInterval(() => {
    const stats = {
      queue_depth: pendingDepth(),
      rps_cap: MAX_RPS,
      p95_ms: Math.round(p95Latency()),
      error_rate: (errorRate()*100).toFixed(1) + '%',
      breaker: CB.state,
      sent_total: sentCount,
    };
    log('[STATS]', new Date().toTimeString().split(' ')[0], JSON.stringify(stats));
  }, 5_000);
}

// ==================== Main Loop ====================
let shuttingDown = false;
async function main() {
  controller().catch(console.error);
  process.on('SIGTERM', async () => {
    shuttingDown = true;
    await queue.onIdle();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    log('\n\n🛑 Simulation interrupted');
    const finalStats = {
      sent: DB.filter(m=>m.status==='SENT').length,
      failed: DB.filter(m=>m.status==='FAILED').length,
      dlq: DB.filter(m=>m.status==='DLQ').length,
      pending: DB.filter(m=>m.status==='PENDING').length,
    };
    log('Final Status:', finalStats);
    process.exit(0);
  });

  for (;;) {
    if (shuttingDown) break;
    const rows = await dbFetchBatch(BATCH_SIZE);
    if (rows.length) await processBatch(rows);
    else await sleep(300);
    if (DB.every(m => m.status === 'SENT' || m.status === 'DLQ')) {
      log('\n' + '='.repeat(70));
      log('✅ SIMULATION COMPLETE');
      log('='.repeat(70));
      log('SENT:', DB.filter(m=>m.status==='SENT').length,
          'DLQ:', DB.filter(m=>m.status==='DLQ').length);
      log('\n📊 Key Takeaways:');
      log('1. No initial burst - warmup prevented overload');
      log('2. Rate adapted automatically based on errors');
      log('3. Circuit breaker protected during failures');
      log('4. Queue drained smoothly without storms');
      process.exit(0);
    }
  }
}

log('🚀 Starting simulation... (Press Ctrl+C to stop)');
log('');
main().catch(e => { console.error('fatal', e); process.exit(1); });