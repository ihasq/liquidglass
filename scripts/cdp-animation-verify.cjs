/**
 * CDP script to verify animation consistency
 * Uses raw WebSocket to communicate with Chrome DevTools
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

  // Enable domains
  await send('Page.enable');
  await send('Runtime.enable');

  // Navigate to stress test
  await send('Page.navigate', { url: 'http://localhost:8788/demo/stress-test.html' });

  // Wait for load
  await new Promise(r => setTimeout(r, 3000));
  console.log('Page loaded, starting animation...');

  // Start animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('start-btn').click()`
  });

  console.log('Animation started, collecting frames...');

  const mismatches = [];

  // Collect data for 3 seconds during animation
  for (let i = 0; i < 30; i++) {
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

            // Get computed filter
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

            // Check viewBox in href
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

            data.push({
              elWidth,
              elHeight,
              feWidth,
              feHeight,
              vbWidth,
              vbHeight,
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

      for (const d of frameData) {
        if (d.error) {
          console.log(`Frame ${i}: ERROR - ${d.error}`);
        } else if (!d.match) {
          console.log(`Frame ${i}: MISMATCH - Element ${d.elWidth}x${d.elHeight} vs Filter ${d.feWidth}x${d.feHeight}`);
          mismatches.push({ frame: i, ...d });
        }
      }
    }
  }

  // Stop animation
  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  console.log('\n=== Results ===');
  console.log(`Frames checked: 30`);
  console.log(`Mismatches: ${mismatches.length}`);

  if (mismatches.length === 0) {
    console.log('\nSUCCESS: All frames consistent');
  } else {
    console.log('\nISSUE: Size mismatches detected');
    console.log('Sample mismatches:', mismatches.slice(0, 5));
  }

  ws.close();
}

runTest().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
