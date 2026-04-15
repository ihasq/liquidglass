/**
 * CDP script to verify pixel-level correctness of displacement maps
 * during animation - checks that atlas matches canvas-generator reference
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
        if (page) {
          resolve(page.webSocketDebuggerUrl);
        } else {
          reject(new Error('No page found'));
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  const wsUrl = await getWebSocketUrl();
  console.log('Connecting to:', wsUrl);

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

  // Run multi-element test
  console.log('\n=== Multi-Element Pixel Test ===');
  await send('Page.navigate', { url: 'http://localhost:8788/e2e/multi-element-test.html' });
  await new Promise(r => setTimeout(r, 5000));

  const multiResult = await send('Runtime.evaluate', {
    expression: `window.__testResult`,
    returnByValue: true
  });

  if (multiResult && multiResult.result && multiResult.result.value) {
    const result = multiResult.result.value;
    console.log('Multi-element test:', result.allPass ? 'PASSED' : 'FAILED');
  } else {
    console.log('Multi-element test: No result');
  }

  // Run dynamic resize test
  console.log('\n=== Dynamic Resize Pixel Test ===');
  await send('Page.navigate', { url: 'http://localhost:8788/e2e/dynamic-resize-test.html' });
  await new Promise(r => setTimeout(r, 10000)); // Longer wait for 20 iterations

  const dynamicResult = await send('Runtime.evaluate', {
    expression: `window.__testResult`,
    returnByValue: true
  });

  if (dynamicResult && dynamicResult.result && dynamicResult.result.value) {
    const result = dynamicResult.result.value;
    console.log(`Dynamic resize test: ${result.passed}/${result.total} passed`);
    console.log('All pass:', result.allPass ? 'YES' : 'NO');
  } else {
    console.log('Dynamic resize test: No result');
  }

  // Run atlas pixel test
  console.log('\n=== Atlas vs Canvas-Generator Pixel Test ===');
  await send('Page.navigate', { url: 'http://localhost:8788/e2e/atlas-pixel-test.html' });
  await new Promise(r => setTimeout(r, 4000));

  const atlasResult = await send('Runtime.evaluate', {
    expression: `window.__testResult`,
    returnByValue: true
  });

  if (atlasResult && atlasResult.result && atlasResult.result.value) {
    const result = atlasResult.result.value;
    console.log('Atlas pixel test:', result.pass ? 'PASSED' : 'FAILED');
    console.log(`  Max diff: ${result.maxDiff}`);
    console.log(`  Avg diff: ${result.avgDiff?.toFixed(4)}`);
    console.log(`  Mismatch pixels: ${result.mismatchPct}%`);
  } else {
    console.log('Atlas pixel test: No result');
  }

  console.log('\n=== All Tests Complete ===');
  ws.close();
}

runTest().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
