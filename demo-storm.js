// demo-storm.js - Shows what happens WITHOUT throttling (RETRY STORM!)
// This demonstrates the problem we're solving

import { setTimeout as sleep } from 'node:timers/promises';

console.log('='.repeat(60));
console.log('⚠️  RETRY STORM DEMO (WITHOUT PROTECTION)');
console.log('='.repeat(60));
console.log('\nScenario: System restarts and tries to send ALL messages at once!\n');

// Create 1000 pending messages
const messages = [];
for (let i = 0; i < 1000; i++) {
  messages.push({
    id: `msg-${i+1}`,
    content: `Hello message ${i+1}`,
    status: 'pending'
  });
}

let sentCount = 0;
let errorCount = 0;
const startTime = Date.now();

// Simulated server that crashes under load
async function sendToServer() {
  // Server gets overwhelmed with too many concurrent requests
  await sleep(Math.random() * 50);
  
  // High error rate when overwhelmed (50% errors!)
  if (Math.random() < 0.5) {
    errorCount++;
    throw new Error('Server overloaded!');
  }
  
  sentCount++;
  return { success: true };
}

// BAD APPROACH: Send everything at once!
async function sendAllAtOnce() {
  console.log('💥 SENDING ALL 1000 MESSAGES AT ONCE...\n');
  
  const promises = messages.map(async (msg) => {
    try {
      await sendToServer();
      msg.status = 'sent';
    } catch (error) {
      msg.status = 'failed';
    }
  });
  
  // This creates a thundering herd!
  await Promise.all(promises);
  
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log('='.repeat(60));
  console.log('💥 STORM RESULTS (WITHOUT THROTTLING):');
  console.log('='.repeat(60));
  console.log(`❌ Failed: ${errorCount} messages (${(errorCount/1000*100).toFixed(1)}% error rate!)`);
  console.log(`✅ Sent: ${sentCount} messages`);
  console.log(`⏱️  Time: ${elapsed.toFixed(2)} seconds`);
  console.log(`📈 Burst RPS: ${(1000 / elapsed).toFixed(0)} requests/second`);
  console.log('\n⚠️  PROBLEMS CAUSED:');
  console.log('1. Server overwhelmed - 50% error rate!');
  console.log('2. Massive burst of ' + Math.floor(1000/elapsed) + ' RPS crashed the server');
  console.log('3. Need to retry 500+ failed messages');
  console.log('4. Retries will cause ANOTHER storm!');
  console.log('\nThis is why we need throttling! Run demo.js to see the solution.');
}

sendAllAtOnce().catch(console.error);