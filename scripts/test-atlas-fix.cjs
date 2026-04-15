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
  console.log('Connected to Chrome');

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('Loading stress test page...');
  await send('Page.navigate', { url: 'http://localhost:8789/demo/stress-test.html' });
  await new Promise(r => setTimeout(r, 3000));

  // Configure: 3 elements, speed 8, both animation
  await send('Runtime.evaluate', {
    expression: `
      document.getElementById('element-count').value = 3;
      document.getElementById('element-count').dispatchEvent(new Event('input'));
      document.getElementById('speed').value = 8;
      document.getElementById('speed').dispatchEvent(new Event('input'));
      document.getElementById('animation-type').value = 'both';
      document.getElementById('animation-type').dispatchEvent(new Event('change'));
    `
  });
  await new Promise(r => setTimeout(r, 500));

  console.log('Starting animation (3 elements, speed 8)...');
  await send('Runtime.evaluate', {
    expression: `document.getElementById('start-btn').click()`
  });

  // Check internal consistency: feImage dimensions should match viewBox
  let internalMismatches = 0;
  let checks = 0;

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));

    const result = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('liquid-glass');
          const issues = [];

          for (const el of elements) {
            const style = getComputedStyle(el);
            const backdrop = style.backdropFilter || style.webkitBackdropFilter;
            const filterMatch = backdrop?.match(/url\\(["']?#([^"')]+)["']?\\)/);
            if (!filterMatch) continue;

            const svg = document.querySelector('svg');
            const filter = svg?.querySelector('#' + filterMatch[1]);
            const feImage = filter?.querySelector('feImage[result="d"]');
            if (!feImage) continue;

            const feWidth = parseInt(feImage.getAttribute('width'));
            const feHeight = parseInt(feImage.getAttribute('height'));

            const href = feImage.getAttribute('href') || '';
            if (href.startsWith('data:image/svg+xml')) {
              const decoded = decodeURIComponent(href.replace('data:image/svg+xml,', ''));
              const vbMatch = decoded.match(/viewBox="(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)"/);
              if (vbMatch) {
                const vbW = parseInt(vbMatch[3]);
                const vbH = parseInt(vbMatch[4]);
                if (feWidth !== vbW || feHeight !== vbH) {
                  issues.push({ feWidth, feHeight, vbW, vbH });
                }
              }
            }
          }

          return JSON.stringify({ count: elements.length, issues });
        })()
      `,
      returnByValue: true
    });

    if (result?.result?.value) {
      const data = JSON.parse(result.result.value);
      checks += data.count;
      internalMismatches += data.issues.length;
      if (data.issues.length > 0) {
        console.log('Frame ' + i + ':', data.issues);
      }
    }
  }

  await send('Runtime.evaluate', {
    expression: `document.getElementById('stop-btn').click()`
  });

  console.log('\n=== Results ===');
  console.log('Total element-frame checks:', checks);
  console.log('Internal mismatches (feImage vs viewBox):', internalMismatches);
  console.log('Result:', internalMismatches === 0 ? 'PASS' : 'FAIL');

  ws.close();
}

runTest().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
