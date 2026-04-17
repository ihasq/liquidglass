import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox']
});

const page = await browser.newPage();

const consoleMessages = [];
const requestErrors = [];

page.on('console', async msg => {
  let text = msg.text();
  const args = msg.args();
  
  // Try to resolve JSHandle@error
  if (text === 'JSHandle@error' && args.length > 0) {
    try {
      const errorValue = await args[0].jsonValue();
      text = JSON.stringify(errorValue);
    } catch (e) {
      // Try to get error properties
      try {
        text = await args[0].evaluate(e => {
          if (e instanceof Error) return e.stack || e.message;
          return String(e);
        });
      } catch (e2) {}
    }
  }
  
  consoleMessages.push({ type: msg.type(), text, location: msg.location() });
});

page.on('pageerror', err => {
  consoleMessages.push({ type: 'pageerror', text: err.message, stack: err.stack });
});

page.on('requestfailed', req => {
  requestErrors.push({
    url: req.url(),
    error: req.failure()?.errorText
  });
});

page.on('response', response => {
  if (response.status() >= 400) {
    requestErrors.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText()
    });
  }
});

try {
  await page.goto('http://localhost:8789/demo/quad-test.html', { waitUntil: 'networkidle0', timeout: 20000 });
  console.log('Page loaded');
  
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('\n=== Request Errors ===');
  for (const err of requestErrors) {
    console.log(JSON.stringify(err));
  }
  
  console.log('\n=== Console Messages ===');
  for (const msg of consoleMessages) {
    if (msg.type !== 'debug' && msg.type !== 'log') {
      console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
      if (msg.location?.url) console.log(`  at ${msg.location.url}:${msg.location.lineNumber}`);
    }
  }
  
  const result = await page.evaluate(() => {
    const dmapFull = document.getElementById('dmap-full');
    const ctx = dmapFull?.getContext('2d');
    const data = ctx?.getImageData(0, 0, 5, 5).data;
    return {
      panelQuad: document.getElementById('panel-quad')?.querySelector('.stats')?.textContent,
      panelFull: document.getElementById('panel-full')?.querySelector('.stats')?.textContent,
      diffStats: document.getElementById('diff-stats')?.textContent,
      fullCanvasSize: { w: dmapFull?.width, h: dmapFull?.height },
      fullPixelData: data ? Array.from(data.slice(0, 20)) : null
    };
  });
  console.log('\n=== Page State ===');
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

await browser.close();
