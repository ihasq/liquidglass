const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

async function testAllParams() {
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

  // Take baseline
  await page.screenshot({ path: 'e2e/debug/param-baseline.png' });

  const params = [
    { id: 'disp-ri', name: 'Refractive Index', min: '1.0', max: '3.0' },
    { id: 'disp-level', name: 'Refraction Level', min: '0', max: '1.5' },
    { id: 'disp-thickness', name: 'Thickness', min: '0.5', max: '3.0' },
    { id: 'disp-radius', name: 'Border Radius', min: '0', max: '75' },
    { id: 'filter-scale', name: 'Disp Scale', min: '0', max: '200' },
    { id: 'spec-intensity', name: 'Specular Intensity', min: '0', max: '1.0' },
  ];

  const baseline = PNG.sync.read(fs.readFileSync('e2e/debug/param-baseline.png'));

  console.log('Parameter sensitivity test (compared to baseline):\n');

  for (const param of params) {
    // Set to min
    await page.evaluate((p) => {
      const el = document.getElementById(p.id);
      el.value = p.min;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, param);
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `e2e/debug/param-${param.id}-min.png` });

    // Set to max
    await page.evaluate((p) => {
      const el = document.getElementById(p.id);
      el.value = p.max;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, param);
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `e2e/debug/param-${param.id}-max.png` });

    // Compare
    const imgMin = PNG.sync.read(fs.readFileSync(`e2e/debug/param-${param.id}-min.png`));
    const imgMax = PNG.sync.read(fs.readFileSync(`e2e/debug/param-${param.id}-max.png`));
    
    const diffMin = pixelmatch(baseline.data, imgMin.data, null, baseline.width, baseline.height, { threshold: 0.1 });
    const diffMax = pixelmatch(baseline.data, imgMax.data, null, baseline.width, baseline.height, { threshold: 0.1 });
    const diffRange = pixelmatch(imgMin.data, imgMax.data, null, baseline.width, baseline.height, { threshold: 0.1 });

    console.log(`${param.name}:`);
    console.log(`  Min (${param.min}): ${diffMin} px from baseline`);
    console.log(`  Max (${param.max}): ${diffMax} px from baseline`);
    console.log(`  Min→Max range: ${diffRange} px\n`);

    // Reset to baseline value
    await page.evaluate((p) => {
      const el = document.getElementById(p.id);
      // Reset to middle/default
      const mid = (parseFloat(p.min) + parseFloat(p.max)) / 2;
      el.value = mid.toString();
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, param);
    await new Promise(r => setTimeout(r, 200));
  }

  await browser.close();
}

testAllParams().catch(console.error);
