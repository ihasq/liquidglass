/**
 * CDP Performance Profiling for stress test
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

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

async function runProfile() {
  const wsUrl = await getWebSocketUrl();
  console.log('Connecting to Chrome...');

  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();
  const traceEvents = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    // Collect trace events
    if (msg.method === 'Tracing.dataCollected') {
      traceEvents.push(...msg.params.value);
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

  // Configure test: 3 elements, speed 8
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('element-count').value = 3;
      document.getElementById('element-count').dispatchEvent(new Event('input'));
      document.getElementById('speed').value = 8;
      document.getElementById('speed').dispatchEvent(new Event('input'));
    `
  });
  await new Promise(r => setTimeout(r, 500));

  // Start CPU profiling
  console.log('Starting profiler...');
  await send('Profiler.start');

  // Start animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('start-btn').click()`
  });

  console.log('Profiling for 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  // Stop animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  // Stop profiler and get results
  console.log('Stopping profiler...');
  const profile = await send('Profiler.stop');

  // Analyze profile
  console.log('\n=== CPU Profile Analysis ===\n');

  const nodes = profile.profile.nodes;
  const samples = profile.profile.samples;
  const timeDeltas = profile.profile.timeDeltas;

  // Build call tree and calculate self time
  const nodeMap = new Map();
  const selfTime = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    selfTime.set(node.id, 0);
  }

  // Calculate time spent in each node
  let totalTime = 0;
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    selfTime.set(nodeId, (selfTime.get(nodeId) || 0) + delta);
    totalTime += delta;
  }

  // Get top functions by self time
  const hotFunctions = [];
  for (const [nodeId, time] of selfTime.entries()) {
    const node = nodeMap.get(nodeId);
    if (node && node.callFrame && time > 0) {
      const cf = node.callFrame;
      // Filter out idle and native functions
      if (cf.functionName && !cf.functionName.includes('(idle)')) {
        hotFunctions.push({
          name: cf.functionName || '(anonymous)',
          url: cf.url || '',
          line: cf.lineNumber,
          time: time,
          percent: (time / totalTime * 100).toFixed(2)
        });
      }
    }
  }

  // Sort by time
  hotFunctions.sort((a, b) => b.time - a.time);

  console.log('Top 20 Hot Functions:');
  console.log('─'.repeat(80));

  for (const fn of hotFunctions.slice(0, 20)) {
    const shortUrl = fn.url.replace(/.*\//, '').replace(/\?.*/, '');
    const location = shortUrl ? `${shortUrl}:${fn.line}` : '(native)';
    console.log(`${fn.percent.padStart(6)}%  ${(fn.time/1000).toFixed(1).padStart(6)}ms  ${fn.name.substring(0, 40).padEnd(40)}  ${location}`);
  }

  // Look for specific patterns
  console.log('\n=== Bottleneck Analysis ===\n');

  const patterns = {
    'toDataURL': { time: 0, count: 0 },
    'getImageData': { time: 0, count: 0 },
    'putImageData': { time: 0, count: 0 },
    'drawImage': { time: 0, count: 0 },
    'encodeURIComponent': { time: 0, count: 0 },
    'generateDisplacementMap': { time: 0, count: 0 },
    'registerSlot': { time: 0, count: 0 },
    'createSlotSvgUrl': { time: 0, count: 0 },
    'getAtlasDataUrl': { time: 0, count: 0 },
    'updateAtlas': { time: 0, count: 0 },
    'render': { time: 0, count: 0 },
    'createFilter': { time: 0, count: 0 },
  };

  for (const fn of hotFunctions) {
    for (const pattern of Object.keys(patterns)) {
      if (fn.name.toLowerCase().includes(pattern.toLowerCase())) {
        patterns[pattern].time += fn.time;
        patterns[pattern].count++;
      }
    }
  }

  console.log('Time by operation:');
  for (const [name, data] of Object.entries(patterns)) {
    if (data.time > 0) {
      console.log(`  ${name}: ${(data.time/1000).toFixed(1)}ms (${(data.time/totalTime*100).toFixed(2)}%)`);
    }
  }

  console.log(`\nTotal profiled time: ${(totalTime/1000).toFixed(1)}ms`);

  ws.close();
}

runProfile().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
