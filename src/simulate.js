// simulate.js  —  Node 18+ (ESM)
// 執行前：npm i p-queue undici
// 說明：這是一個「無 DB、無 chat server 觀測」的完整節流與重送模擬。
// - 用 in-memory 陣列假裝 DB（訊息狀態/退避時間等）
// - 用 fakeChatServerAPI 模擬真實世界：成功/慢、429/503、逾時
// - 你可以調參數觀察：啟動洪峰是否被壓平、遇到錯誤時是否自動降速、是否能穩定清空佇列

import PQueue from 'p-queue';
import { setTimeout as sleep } from 'node:timers/promises';

// ==================== 可調參數（主要開關在這） ====================
const SEED_MESSAGES = 5000;   // 模擬重啟後堆積的未送訊息
const BATCH_SIZE     = 200;   // 每批抓取數
const CONCURRENCY    = 6;     // 最大併發

let   MAX_RPS        = 5;     // ★ 穩態上限 RPS：你的需求
const WARMUP_RPS     = 1;     // 暖身起始 RPS（前 60 秒）
const WARMUP_MS      = 60_000;
const RAMP_STEP      = 1;     // 每 30 秒 +1 rps（若健康）
const RAMP_EVERY     = 30_000;

const RETRY_MAX      = 8;     // 單筆重試上限
const BACKOFF_CAP_S  = 300;   // 退避上限（秒）

// ==================== In-memory "DB"（用陣列當假資料庫） ====================
/*
  訊息資料結構：
  {
    id: string,
    payload: any,
    status: 'PENDING'|'SENDING'|'SENT'|'FAILED'|'DLQ',
    attempt_count: number,
    next_attempt_at: number
  }
*/
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

// ==================== Token Bucket：單機 RPS 限速 ====================
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

// ==================== 客戶端可觀測訊號（滑動視窗：30 秒） ====================
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

// ==================== 斷路器（Closed → Open → HalfOpen） ====================
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
        this.halfOpenUntil = now + 10_000; // 探測 10 秒
        this.consecutiveFailures = 0;
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
    }
  },
  onFailure() {
    this.consecutiveFailures++;
    if (this.state === 'Closed' && this.consecutiveFailures >= 10) {
      this.state = 'Open';
      this.openedAt = Date.now();
    } else if (this.state === 'HalfOpen') {
      this.state = 'Open';
      this.openedAt = Date.now();
    }
  }
};

// ==================== 模擬 chat server ====================
async function fakeChatServerAPI({ id, payload }) {
  // 延遲分佈：大多數快、少數慢
  const r = Math.random();
  const delay =
    r < 0.70 ? 30 :
    r < 0.90 ? 120 :
               600 + Math.floor(Math.random()*200);
  await sleep(delay);

  // 錯誤/限流/逾時 機率
  const e = Math.random();
  if      (e < 0.05) return { ok: false, status: 429, retryAfterMs: 1000 + Math.floor(Math.random()*2000) };
  else if (e < 0.08) return { ok: false, status: 503 };
  else if (e < 0.10) throw new Error('ETIMEDOUT');
  return { ok: true, status: 200 };
}

// ==================== 發送 + 重試（退避 + 抖動 + 尊重 Retry-After） ====================
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

// ==================== 假 DB 操作 ====================
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

// ==================== 併發隊列 + 節流核心 ====================
const queue = new PQueue({ concurrency: CONCURRENCY });
async function processBatch(rows) {
  for (const row of rows) {
    queue.add(async () => {
      while (CB.shouldBlock()) await sleep(50); // Open → 暫停
      await bucket.take();                      // Token Bucket 限 RPS
      const res = await sendToChatServer(row);
      if (res.ok) await dbMarkSent(row.id);
      else        await onFail(row);
    });
  }
  await queue.onIdle();
}

// ==================== 暖身 + 自動加/降速（AIMD） ====================
async function controller() {
  await sleep(WARMUP_MS);
  bucket.setRate(MAX_RPS); // 暖身結束 → 切到上限（5）

  setInterval(() => {
    const e = errorRate();
    const p = p95Latency();
    if (e > 0.05 || p > 400) {
      MAX_RPS = Math.max(1, Math.floor(MAX_RPS * 0.5)); // 乘性降速
      bucket.setRate(MAX_RPS);
    } else {
      MAX_RPS += RAMP_STEP;                              // 緩慢加速
      bucket.setRate(MAX_RPS);
    }
    if (CB.state === 'HalfOpen') {
      bucket.setRate(Math.min(MAX_RPS, CB.HALF_OPEN_PROBE_RPS));
    }
  }, RAMP_EVERY);

  // 每 10 秒輸出一次統計
  setInterval(() => {
    const stats = {
      queue_depth: pendingDepth(),
      rps_cap: MAX_RPS,
      p95_ms: Math.round(p95Latency()),
      error_rate: (errorRate()*100).toFixed(1) + '%',
      breaker: CB.state,
      sent_total: sentCount,
    };
    console.log('[stats]', new Date().toISOString(), stats);
  }, 10_000);
}

// ==================== 主循環（永遠分批） ====================
let shuttingDown = false;
async function main() {
  controller().catch(console.error);
  process.on('SIGTERM', async () => {
    shuttingDown = true;
    await queue.onIdle();
    process.exit(0);
  });

  for (;;) {
    if (shuttingDown) break;
    const rows = await dbFetchBatch(BATCH_SIZE);
    if (rows.length) await processBatch(rows);
    else await sleep(300);
    if (DB.every(m => m.status === 'SENT' || m.status === 'DLQ')) {
      console.log('All done. SENT:', DB.filter(m=>m.status==='SENT').length,
                  'DLQ:', DB.filter(m=>m.status==='DLQ').length);
      process.exit(0);
    }
  }
}
main().catch(e => { console.error('fatal', e); process.exit(1); });
