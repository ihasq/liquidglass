const puppeteer = require('puppeteer');

async function visualTest() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  await page.goto('http://localhost:8788/demo/kube-comparison.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 2000));

  // Uncheck Kube displacement
  await page.click('#use-kube-disp');
  await new Promise(r => setTimeout(r, 500));

  // Set high scale for more visible effect
  await page.evaluate(() => {
    document.getElementById('filter-scale').value = '150';
    document.getElementById('filter-scale').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));

  // Test thickness values
  const thicknessValues = [0.5, 1.0, 2.0, 3.0];
  
  for (const val of thicknessValues) {
    await page.evaluate((v) => {
      document.getElementById('disp-thickness').value = v.toString();
      document.getElementById('disp-thickness').dispatchEvent(new Event('input', { bubbles: true }));
    }, val);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: `e2e/debug/thickness-visual-${val}.png` });
    console.log(`Thickness ${val}: screenshot saved`);
  }

  await browser.close();
  console.log('\nCheck e2e/debug/thickness-visual-*.png');
}

visualTest().catch(console.error);
