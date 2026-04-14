const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

async function testThickness() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  await page.goto('http://localhost:8788/demo/kube-comparison.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 2000));

  // First, uncheck Kube displacement to use our generation
  await page.click('#use-kube-disp');
  await new Promise(r => setTimeout(r, 500));

  // Screenshot with default thickness (1.0)
  await page.screenshot({ path: 'e2e/debug/thickness-1-default.png' });
  const val1 = await page.evaluate(() => document.getElementById('disp-thickness').value);
  console.log(`1. Default thickness: ${val1}`);

  // Change thickness to 0.5
  await page.evaluate(() => {
    const slider = document.getElementById('disp-thickness');
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/thickness-2-half.png' });
  const val2 = await page.evaluate(() => document.getElementById('disp-thickness').value);
  console.log(`2. Half thickness: ${val2}`);

  // Change thickness to 3.0 (max)
  await page.evaluate(() => {
    const slider = document.getElementById('disp-thickness');
    slider.value = '3.0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/thickness-3-max.png' });
  const val3 = await page.evaluate(() => document.getElementById('disp-thickness').value);
  console.log(`3. Max thickness: ${val3}`);

  await browser.close();

  // Compare screenshots
  const img1 = PNG.sync.read(fs.readFileSync('e2e/debug/thickness-1-default.png'));
  const img2 = PNG.sync.read(fs.readFileSync('e2e/debug/thickness-2-half.png'));
  const img3 = PNG.sync.read(fs.readFileSync('e2e/debug/thickness-3-max.png'));

  const diff12 = pixelmatch(img1.data, img2.data, null, img1.width, img1.height, { threshold: 0.1 });
  const diff13 = pixelmatch(img1.data, img3.data, null, img1.width, img1.height, { threshold: 0.1 });

  console.log(`\nPixel differences:`);
  console.log(`  Default (1.0) vs Half (0.5): ${diff12} pixels`);
  console.log(`  Default (1.0) vs Max (3.0): ${diff13} pixels`);
}

testThickness().catch(console.error);
