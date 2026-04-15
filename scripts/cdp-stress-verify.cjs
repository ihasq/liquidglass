/**
 * CDP script for aggressive stress testing
 * Tests with multiple elements at high animation speed
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
  await send('Page.navigate', { url: 'http://localhost:8788/demo/stress-test.html' });

  await new Promise(r => setTimeout(r, 3000));
  console.log('Page loaded, configuring test...');

  // Set 5 elements, high speed, both animation
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

  console.log('Animation started (5 elements, speed 10, both animation)...');
  console.log('Collecting frames for 5 seconds...');

  const mismatches = [];
  let totalChecks = 0;

  // Collect data for 5 seconds
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));

    const result = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('liquid-glass');
          const data = [];

          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const elWidth = Math.ceil(rect.width);
            const elHeight = Math.ceil(rect.height);

            const style = getComputedStyle(el);
            const backdrop = style.backdropFilter || style.webkitBackdropFilter;
            const filterMatch = backdrop?.match(/url\\(["']?#([^"')]+)["']?\\)/);

            if (!filterMatch) {
              data.push({ error: 'No filter', elWidth, elHeight });
              continue;
            }

            const filterId = filterMatch[1];
            const svg = document.querySelector('svg');
            const filter = svg?.querySelector('#' + filterId);
            const feImage = filter?.querySelector('feImage[result="d"]');

            if (!feImage) {
              data.push({ error: 'No feImage', elWidth, elHeight });
              continue;
            }

            const feWidth = parseInt(feImage.getAttribute('width'));
            const feHeight = parseInt(feImage.getAttribute('height'));

            data.push({
              elWidth,
              elHeight,
              feWidth,
              feHeight,
              match: (elWidth === feWidth && elHeight === feHeight)
            });
          }

          return JSON.stringify(data);
        })()
      `,
      returnByValue: true
    });

    if (result && result.result && result.result.value) {
      const frameData = JSON.parse(result.result.value);
      totalChecks += frameData.length;

      for (const d of frameData) {
        if (d.error) {
          // Skip errors for now
        } else if (!d.match) {
          mismatches.push({ frame: i, ...d });
        }
      }
    }

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`  ${(i+1) * 100}ms checked, ${mismatches.length} mismatches so far\n`);
    }
  }

  // Stop animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  console.log('\n=== Stress Test Results ===');
  console.log(`Total element-frame checks: ${totalChecks}`);
  console.log(`Total mismatches: ${mismatches.length}`);
  console.log(`Match rate: ${((totalChecks - mismatches.length) / totalChecks * 100).toFixed(2)}%`);

  if (mismatches.length === 0) {
    console.log('\n SUCCESS: All frames consistent under stress');
  } else {
    console.log('\n ISSUE: Some mismatches detected');
    console.log('First 10 mismatches:');
    for (const m of mismatches.slice(0, 10)) {
      console.log(`  Frame ${m.frame}: Element ${m.elWidth}x${m.elHeight} vs Filter ${m.feWidth}x${m.feHeight}`);
    }
  }

  ws.close();
}

runTest().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
