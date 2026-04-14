const puppeteer = require('puppeteer');

async function finalTest() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  await page.goto('http://localhost:8788/demo/kube-comparison.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 2000));

  // Screenshot 1: Initial (Kube disp checked)
  await page.screenshot({ path: 'e2e/debug/final-1-initial.png' });
  console.log('1. Initial state (Kube disp + Our spec)');

  // Screenshot 2: Uncheck both to use fully our generation
  await page.click('#use-kube-disp');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/final-2-our-disp.png' });
  console.log('2. Our displacement (unchecked Kube disp)');

  // Screenshot 3: Max refraction level
  await page.evaluate(() => {
    document.getElementById('disp-level').value = '1.5';
    document.getElementById('disp-level').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/final-3-max-refraction.png' });
  console.log('3. Max refraction level (1.5)');

  // Screenshot 4: High scale
  await page.evaluate(() => {
    document.getElementById('filter-scale').value = '180';
    document.getElementById('filter-scale').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/final-4-high-scale.png' });
  console.log('4. High displacement scale (180)');

  // Screenshot 5: Low scale for subtle effect
  await page.evaluate(() => {
    document.getElementById('filter-scale').value = '30';
    document.getElementById('filter-scale').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'e2e/debug/final-5-low-scale.png' });
  console.log('5. Low displacement scale (30)');

  console.log('\nScreenshots saved to e2e/debug/final-*.png');
  await browser.close();
}

finalTest().catch(console.error);
