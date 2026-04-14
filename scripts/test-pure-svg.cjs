const puppeteer = require('puppeteer');

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  await page.goto('http://localhost:8788/demo/pure-svg-displacement.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: 'e2e/debug/pure-svg-displacement.png' });
  console.log('Screenshot saved to e2e/debug/pure-svg-displacement.png');

  await browser.close();
}

main().catch(console.error);
