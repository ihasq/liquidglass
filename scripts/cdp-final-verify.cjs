/**
 * Final comprehensive verification
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

async function runTest() {
  const wsUrl = await getWebSocketUrl();
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
  console.log('=== Final Comprehensive Verification ===\n');

  await send('Page.enable');
  await send('Runtime.enable');

  // Test 1: Static rendering
  console.log('Test 1: Static Rendering');
  await send('Page.navigate', { url: 'http://localhost:8788/e2e/multi-element-test.html' });
  await new Promise(r => setTimeout(r, 5000));

  const staticResult = await send('Runtime.evaluate', {
    expression: `window.__testResult`,
    returnByValue: true
  });
  console.log('  Result:', staticResult?.result?.value?.allPass ? 'PASS' : 'FAIL');

  // Test 2: Dynamic resize with verification
  console.log('\nTest 2: Dynamic Resize (20 iterations)');
  await send('Page.navigate', { url: 'http://localhost:8788/e2e/dynamic-resize-test.html' });
  await new Promise(r => setTimeout(r, 10000));

  const dynamicResult = await send('Runtime.evaluate', {
    expression: `window.__testResult`,
    returnByValue: true
  });
  const dr = dynamicResult?.result?.value;
  console.log(`  Result: ${dr?.passed}/${dr?.total} passed - ${dr?.allPass ? 'PASS' : 'FAIL'}`);

  // Test 3: Stress test - check for filter consistency
  console.log('\nTest 3: Animation Stress Test (5 elements, high speed)');
  await send('Page.navigate', { url: 'http://localhost:8788/demo/stress-test.html' });
  await new Promise(r => setTimeout(r, 3000));

  // Configure stress test
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('element-count').value = 5;
      document.getElementById('element-count').dispatchEvent(new Event('input'));
      document.getElementById('speed').value = 10;
      document.getElementById('speed').dispatchEvent(new Event('input'));
      document.getElementById('animation-type').value = 'both';
      document.getElementById('animation-type').dispatchEvent(new Event('change'));
    `
  });
  await new Promise(r => setTimeout(r, 500));

  // Start animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('start-btn').click()`
  });

  // Check for filter presence (no gaps)
  let noFilterCount = 0;
  let totalChecks = 0;
  let internalMismatch = 0;  // Filter dimensions don't match viewBox

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));

    const result = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('liquid-glass');
          const data = [];

          for (const el of elements) {
            const style = getComputedStyle(el);
            const backdrop = style.backdropFilter || style.webkitBackdropFilter;
            const filterMatch = backdrop?.match(/url\\(["']?#([^"')]+)["']?\\)/);

            if (!filterMatch) {
              data.push({ hasFilter: false });
              continue;
            }

            const filterId = filterMatch[1];
            const svg = document.querySelector('svg');
            const filter = svg?.querySelector('#' + filterId);
            const feImage = filter?.querySelector('feImage[result="d"]');

            if (!feImage) {
              data.push({ hasFilter: false });
              continue;
            }

            const feWidth = parseInt(feImage.getAttribute('width'));
            const feHeight = parseInt(feImage.getAttribute('height'));

            // Check viewBox consistency
            const href = feImage.getAttribute('href') || '';
            let vbWidth = 0, vbHeight = 0;

            if (href.startsWith('data:image/svg+xml')) {
              const decoded = decodeURIComponent(href.replace('data:image/svg+xml,', ''));
              const vbMatch = decoded.match(/viewBox="(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)"/);
              if (vbMatch) {
                vbWidth = parseInt(vbMatch[3]);
                vbHeight = parseInt(vbMatch[4]);
              }
            }

            // Internal consistency: feImage size should match viewBox size
            const internalMatch = (vbWidth > 0 && vbHeight > 0)
              ? (feWidth === vbWidth && feHeight === vbHeight)
              : true;

            data.push({
              hasFilter: true,
              internalMatch,
              feWidth, feHeight, vbWidth, vbHeight
            });
          }

          return JSON.stringify(data);
        })()
      `,
      returnByValue: true
    });

    if (result?.result?.value) {
      const frameData = JSON.parse(result.result.value);
      totalChecks += frameData.length;
      noFilterCount += frameData.filter(d => !d.hasFilter).length;
      internalMismatch += frameData.filter(d => d.hasFilter && !d.internalMatch).length;
    }
  }

  // Stop animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  console.log(`  Total checks: ${totalChecks}`);
  console.log(`  No filter (gaps): ${noFilterCount} (${(noFilterCount/totalChecks*100).toFixed(2)}%)`);
  console.log(`  Internal mismatch: ${internalMismatch} (${(internalMismatch/totalChecks*100).toFixed(2)}%)`);
  console.log(`  Result: ${noFilterCount === 0 && internalMismatch === 0 ? 'PASS' : 'ISSUES DETECTED'}`);

  // Final summary
  console.log('\n=== Summary ===');
  const allPass =
    staticResult?.result?.value?.allPass &&
    dr?.allPass &&
    noFilterCount === 0 &&
    internalMismatch === 0;

  if (allPass) {
    console.log('ALL TESTS PASSED');
    console.log('- Static pixel comparison: identical');
    console.log('- Dynamic resize: 100% consistent');
    console.log('- Animation stress: no gaps, no internal mismatches');
  } else {
    console.log('SOME TESTS FAILED');
    if (!staticResult?.result?.value?.allPass) console.log('- Static test failed');
    if (!dr?.allPass) console.log('- Dynamic resize test failed');
    if (noFilterCount > 0) console.log('- Filter gaps detected during animation');
    if (internalMismatch > 0) console.log('- Internal filter mismatches detected');
  }

  ws.close();
}

runTest().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
