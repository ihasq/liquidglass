// Test CSS + SVG displacement map approach
const puppeteer = require('puppeteer');
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const OUTPUT_DIR = join(__dirname, '..', 'e2e/debug/css-svg-test');
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 2 });

  await page.goto('http://localhost:3342/demo/svg-css-displacement-test.html', {
    waitUntil: 'networkidle0'
  });
  await new Promise(r => setTimeout(r, 2000));

  // Capture full page
  const fullShot = await page.screenshot({ type: 'png' });
  writeFileSync(join(OUTPUT_DIR, 'full-page.png'), fullShot);

  // Get console output
  const output = await page.$eval('#output', el => el.textContent);
  console.log('Page output:');
  console.log(output);

  // Capture each panel
  for (const id of ['kube-panel', 'css-fo-panel', 'css-layered-panel']) {
    const el = await page.$(`#${id}`);
    if (el) {
      const shot = await el.screenshot({ type: 'png' });
      writeFileSync(join(OUTPUT_DIR, `${id}.png`), shot);
      console.log(`Saved ${id}.png`);
    }
  }

  await browser.close();
  console.log(`\nOutput saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
