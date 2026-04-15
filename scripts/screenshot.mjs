import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

await page.goto('http://localhost:8789/demo/parameter-lab.html', {
  waitUntil: 'networkidle0',
  timeout: 30000
});

// Wait for liquid-glass elements to render
await page.waitForSelector('liquid-glass', { timeout: 10000 });
await new Promise(r => setTimeout(r, 2000));

await page.screenshot({
  path: '/tmp/liquidglass-lab.png',
  fullPage: false
});

console.log('Screenshot saved to /tmp/liquidglass-lab.png');

await browser.close();
