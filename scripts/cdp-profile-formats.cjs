/**
 * CDP Performance Profiling for different image formats
 */

const http = require('http');
const WebSocket = require('ws');

async function getWebSocketUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const pages = JSON.parse(data);
        const page = pages.find(p => p.type === 'page');
        if (page) resolve(page.webSocketDebuggerUrl);
        else reject(new Error('No page found'));
      });
    }).on('error', reject);
  });
}

async function profileFormat(ws, send, format) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing format: ${format.toUpperCase()}`);
  console.log('='.repeat(60));

  // Set format
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('image-format').value = '${format}';
      document.getElementById('image-format').dispatchEvent(new Event('change'));
    `
  });
  await new Promise(r => setTimeout(r, 500));

  // Configure: 3 elements, speed 8
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('element-count').value = 3;
      document.getElementById('element-count').dispatchEvent(new Event('input'));
      document.getElementById('speed').value = 8;
      document.getElementById('speed').dispatchEvent(new Event('input'));
    `
  });
  await new Promise(r => setTimeout(r, 500));

  // Start profiler
  await send('Profiler.start');

  // Start animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('start-btn').click()`
  });

  // Profile for 3 seconds
  await new Promise(r => setTimeout(r, 3000));

  // Stop animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  // Get profile
  const profile = await send('Profiler.stop');

  // Analyze
  const nodes = profile.profile.nodes;
  const samples = profile.profile.samples;
  const timeDeltas = profile.profile.timeDeltas;

  const nodeMap = new Map();
  const selfTime = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    selfTime.set(node.id, 0);
  }

  let totalTime = 0;
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    selfTime.set(nodeId, (selfTime.get(nodeId) || 0) + delta);
    totalTime += delta;
  }

  // Find toDataURL time
  let toDataUrlTime = 0;
  let wasmTime = 0;
  let putImageDataTime = 0;

  for (const [nodeId, time] of selfTime.entries()) {
    const node = nodeMap.get(nodeId);
    if (node?.callFrame?.functionName) {
      const name = node.callFrame.functionName;
      if (name === 'toDataURL') {
        toDataUrlTime += time;
      } else if (name.includes('wasm-function')) {
        wasmTime += time;
      } else if (name === 'putImageData') {
        putImageDataTime += time;
      }
    }
  }

  console.log(`\nResults for ${format.toUpperCase()}:`);
  console.log(`  Total time: ${(totalTime/1000).toFixed(1)}ms`);
  console.log(`  toDataURL:  ${(toDataUrlTime/1000).toFixed(1)}ms (${(toDataUrlTime/totalTime*100).toFixed(1)}%)`);
  console.log(`  WASM:       ${(wasmTime/1000).toFixed(1)}ms (${(wasmTime/totalTime*100).toFixed(1)}%)`);
  console.log(`  putImageData: ${(putImageDataTime/1000).toFixed(1)}ms (${(putImageDataTime/totalTime*100).toFixed(1)}%)`);

  return {
    format,
    totalTime,
    toDataUrlTime,
    wasmTime,
    putImageDataTime
  };
}

async function runProfile() {
  const wsUrl = await getWebSocketUrl();
  console.log('Connecting to Chrome...');

  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise(r => ws.on('open', r));
  console.log('Connected!');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Profiler.enable');

  // Navigate to stress test
  console.log('Loading stress test page...');
  await send('Page.navigate', { url: 'http://localhost:8789/demo/stress-test.html' });
  await new Promise(r => setTimeout(r, 3000));

  // Test each format
  const results = [];
  for (const format of ['png', 'webp', 'jpeg']) {
    const result = await profileFormat(ws, send, format);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY - toDataURL Performance by Format');
  console.log('='.repeat(60));
  console.log('\nFormat   | Encode Time | % of Total | Speedup vs PNG');
  console.log('-'.repeat(55));

  const pngResult = results.find(r => r.format === 'png');
  for (const r of results) {
    const speedup = pngResult ? (pngResult.toDataUrlTime / r.toDataUrlTime).toFixed(2) : '-';
    console.log(`${r.format.padEnd(8)} | ${(r.toDataUrlTime/1000).toFixed(1).padStart(7)}ms | ${(r.toDataUrlTime/r.totalTime*100).toFixed(1).padStart(8)}% | ${speedup}x`);
  }

  ws.close();
}

runProfile().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
