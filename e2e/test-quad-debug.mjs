import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox']
});

const page = await browser.newPage();

const consoleMessages = [];
page.on('console', msg => {
  consoleMessages.push({ type: msg.type(), text: msg.text() });
});

page.on('pageerror', err => {
  consoleMessages.push({ type: 'pageerror', text: err.message, stack: err.stack });
});

page.on('requestfailed', req => {
  consoleMessages.push({ type: 'requestfailed', text: `${req.url()} - ${req.failure()?.errorText}` });
});

try {
  await page.goto('http://localhost:8789/demo/quad-test.html', { waitUntil: 'networkidle0', timeout: 15000 });
  console.log('Page loaded');
  
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\n=== Console Messages ===');
  for (const msg of consoleMessages) {
    console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
    if (msg.stack) console.log(msg.stack);
  }
  
  const result = await page.evaluate(() => {
    const panelQuad = document.getElementById('panel-quad')?.querySelector('.stats')?.textContent;
    const panelFull = document.getElementById('panel-full')?.querySelector('.stats')?.textContent;
    const diffStats = document.getElementById('diff-stats')?.textContent;
    const perf = document.getElementById('performance')?.textContent?.substring(0, 300);
    
    const dmapQuadRaw = document.getElementById('dmap-quad-raw');
    const dmapFull = document.getElementById('dmap-full');
    
    let quadRawSample = null, fullSample = null;
    try {
      quadRawSample = Array.from(dmapQuadRaw?.getContext('2d')?.getImageData(10, 10, 1, 1).data || []);
    } catch(e) { quadRawSample = e.message; }
    try {
      fullSample = Array.from(dmapFull?.getContext('2d')?.getImageData(10, 10, 1, 1).data || []);
    } catch(e) { fullSample = e.message; }
    
    return { panelQuad, panelFull, diffStats, perf, quadRawSample, fullSample };
  });
  console.log('\n=== Page State ===');
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.log('Error:', e.message);
  console.log('\n=== Console Messages Before Error ===');
  for (const msg of consoleMessages) {
    console.log(`[${msg.type.toUpperCase()}] ${msg.text}`);
  }
}

await browser.close();
