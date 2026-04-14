const puppeteer = require('puppeteer');

async function testSliders() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  // Capture console logs
  page.on('console', msg => console.log('Browser:', msg.text()));
  page.on('pageerror', err => console.log('Page error:', err.message));

  console.log('Navigating to comparison page...');
  await page.goto('http://localhost:8788/demo/kube-comparison.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  // Take initial screenshot
  await page.screenshot({ path: 'e2e/debug/slider-test-1-initial.png' });
  console.log('1. Initial screenshot saved');

  // Check initial state
  let values = await page.evaluate(() => ({
    useKubeDisp: document.getElementById('use-kube-disp')?.checked,
    dispLevel: document.getElementById('disp-level')?.value,
    ourDispHref: document.getElementById('our-disp-img')?.getAttribute('href')?.substring(0, 30)
  }));
  console.log('Initial values:', values);

  // Uncheck "Use Kube.io displacement"
  console.log('\n2. Unchecking Kube displacement...');
  await page.click('#use-kube-disp');
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'e2e/debug/slider-test-2-uncheck-disp.png' });

  values = await page.evaluate(() => ({
    useKubeDisp: document.getElementById('use-kube-disp')?.checked,
    ourDispHref: document.getElementById('our-disp-img')?.getAttribute('href')?.substring(0, 30)
  }));
  console.log('After uncheck:', values);

  // Change refraction level slider to max
  console.log('\n3. Changing refraction level to 1.5...');
  await page.evaluate(() => {
    const slider = document.getElementById('disp-level');
    if (slider) {
      slider.value = '1.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'e2e/debug/slider-test-3-refraction.png' });

  // Change displacement scale to 200
  console.log('\n4. Changing displacement scale to 200...');
  await page.evaluate(() => {
    const slider = document.getElementById('filter-scale');
    if (slider) {
      slider.value = '200';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'e2e/debug/slider-test-4-scale.png' });

  // Check final scale value
  const finalScale = await page.evaluate(() => 
    document.getElementById('our-disp-map')?.getAttribute('scale')
  );
  console.log('Final scale attribute:', finalScale);

  console.log('\nDone. Check e2e/debug/slider-test-*.png');
  await browser.close();
}

testSliders().catch(console.error);
