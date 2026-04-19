import puppeteer from 'puppeteer';

async function runTest() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:8787/demo/parameter-lab/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.glass-panel', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));

  // Enable debug logging
  await page.evaluate(() => {
    window.lgc_dev?.debug?.log?.progressive?.enable();
  });

  // Switch to WASM-SIMD
  console.log('Switching to WASM-SIMD renderer...');
  await page.evaluate(() => {
    // Find the renderer toggle and click wasm option
    const buttons = document.querySelectorAll('.view-mode-btn');
    for (const btn of buttons) {
      if (btn.textContent?.includes('WASM-SIMD')) {
        btn.click();
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 500));

  console.log('Starting rapid resize stress test...');
  
  const results = [];
  
  for (let round = 0; round < 10; round++) {
    console.log(`\n--- Round ${round + 1} ---`);
    
    // Rapid resize sequence via direct style manipulation
    const sizes = round % 2 === 0
      ? [[300, 200], [450, 350], [320, 280], [500, 400], [250, 180]]
      : [[500, 400], [250, 180], [400, 300], [350, 250], [480, 320]];
    
    for (const [w, h] of sizes) {
      await page.evaluate((width, height) => {
        const el = document.querySelector('.interactive-element .glass-panel');
        if (el) {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
        }
      }, w, h);
      await new Promise(r => setTimeout(r, 5 + Math.random() * 20));
    }
    
    await new Promise(r => setTimeout(r, 600));
    
    // Check center pixel of displacement map
    const pixelCheck = await page.evaluate(() => {
      const img = document.querySelector('feImage[result="dNew"], feImage[result="dImgNew"]');
      if (!img) return { error: 'No feImage found' };
      
      const href = img.getAttribute('href');
      if (!href || !href.startsWith('data:image/png')) {
        return { error: 'No valid data URL' };
      }
      
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          
          const cx = Math.floor(image.width / 2);
          const cy = Math.floor(image.height / 2);
          const pixel = ctx.getImageData(cx, cy, 1, 1);
          const [r, g, b, a] = pixel.data;
          
          // Center should be neutral gray: R≈128, G≈128, B≈128
          const isCorrect = r >= 115 && r <= 140 && g >= 115 && g <= 140 && b >= 115 && b <= 140;
          
          resolve({
            dimensions: `${image.width}x${image.height}`,
            center: [r, g, b, a],
            isCorrect,
            issue: isCorrect ? null : `Expected ~128,128,128 but got ${r},${g},${b}`
          });
        };
        image.onerror = () => resolve({ error: 'Image decode failed' });
        image.src = href;
      });
    });
    
    results.push({ round: round + 1, ...pixelCheck });
    
    const status = pixelCheck.error ? '❌ ERROR' : (pixelCheck.isCorrect ? '✓ OK' : '❌ FAIL');
    console.log(`Round ${round + 1}: ${status} - center: ${JSON.stringify(pixelCheck.center)} @ ${pixelCheck.dimensions || 'N/A'}`);
  }
  
  console.log('\n=== Summary ===');
  const failures = results.filter(r => !r.isCorrect && !r.error);
  const errors = results.filter(r => r.error);
  console.log(`OK: ${results.length - failures.length - errors.length}`);
  console.log(`FAIL: ${failures.length}`);
  console.log(`ERROR: ${errors.length}`);
  
  if (failures.length > 0) {
    console.log('\nFailure details:');
    failures.forEach(f => console.log(`  Round ${f.round}: ${JSON.stringify(f.center)} @ ${f.dimensions}`));
  }
  
  await browser.close();
  return failures.length;
}

runTest().then(failures => {
  process.exit(failures > 0 ? 1 : 0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
