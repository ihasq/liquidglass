const puppeteer = require('puppeteer');

(async () => {
  const url = process.argv[2] || 'http://localhost:8788/';
  const output = process.argv[3] || 'e2e/debug/screenshot.png';

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: output, fullPage: false });
  await browser.close();
  console.log('Screenshot saved to', output);
})();
