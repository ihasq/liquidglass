const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  await page.goto('http://localhost:8788/demo/svg-gradient-displacement.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: 'e2e/debug/svg-gradient-test.png' });

  // Get console logs
  page.on('console', msg => console.log('Browser:', msg.text()));

  console.log('Screenshot saved to e2e/debug/svg-gradient-test.png');

  await browser.close();
}

main().catch(console.error);
