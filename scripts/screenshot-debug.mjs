import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 600, deviceScaleFactor: 1.5 });

await page.goto('http://localhost:8789/demo/displacement-debug.html', {
  waitUntil: 'networkidle0',
  timeout: 30000
});

await new Promise(r => setTimeout(r, 1500));

await page.screenshot({
  path: '/tmp/displacement-debug.png',
  fullPage: false
});

console.log('Screenshot saved to /tmp/displacement-debug.png');

await browser.close();
