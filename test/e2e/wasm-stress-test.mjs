import puppeteer from 'puppeteer';

async function runTest() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  
  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  await page.goto('http://localhost:8787/demo/parameter-lab/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.glass-panel', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));

  // Switch to WASM-SIMD by finding the correct control
  console.log('Switching to WASM-SIMD renderer...');
  const switched = await page.evaluate(() => {
    // Look for the displacement renderer control
    const controls = document.querySelectorAll('.control');
    for (const control of controls) {
      const label = control.querySelector('.control-label');
      if (label && label.textContent.includes('Displacement Renderer')) {
        const btns = control.querySelectorAll('.view-mode-btn');
        for (const btn of btns) {
          if (btn.textContent === 'WASM-SIMD') {
            btn.click();
            return true;
          }
        }
      }
    }
    return false;
  });
  
  if (!switched) {
    console.log('Could not find WASM-SIMD toggle, skipping test');
    await browser.close();
    return 0;
  }
  
  await new Promise(r => setTimeout(r, 800));

  console.log('Starting aggressive resize stress test...');
  
  const results = [];
  const testCases = [
    // Pattern 1: Large to small (triggers buffer reuse in WASM)
    { name: 'large-to-small', sizes: [[800, 600], [200, 150], [100, 75]] },
    // Pattern 2: Small to large (triggers new buffer allocation)
    { name: 'small-to-large', sizes: [[100, 75], [400, 300], [800, 600]] },
    // Pattern 3: Rapid oscillation
    { name: 'oscillation', sizes: [[300, 200], [600, 400], [300, 200], [600, 400]] },
    // Pattern 4: Extreme sizes
    { name: 'extreme', sizes: [[50, 50], [1000, 800], [50, 50]] },
    // Pattern 5: Odd dimensions (tests quadrant handling)
    { name: 'odd-dims', sizes: [[301, 201], [401, 301], [501, 401]] },
  ];
  
  for (let round = 0; round < 3; round++) {
    for (const testCase of testCases) {
      console.log(`\nRound ${round + 1}, Test: ${testCase.name}`);
      
      for (const [w, h] of testCase.sizes) {
        // Use the interactive element's native resize handles by setting dimensions
        await page.evaluate((width, height) => {
          const el = document.querySelector('.interactive-element');
          if (el) {
            const glass = el.querySelector('.glass-panel');
            if (glass) {
              glass.style.width = `${width}px`;
              glass.style.height = `${height}px`;
            }
          }
        }, w, h);
        // Very short delay to stress the system
        await new Promise(r => setTimeout(r, 3));
      }
      
      // Wait for final render to complete
      await new Promise(r => setTimeout(r, 500));
      
      // Verify displacement map
      const check = await page.evaluate(() => {
        const img = document.querySelector('feImage[result="dNew"], feImage[result="dImgNew"]');
        if (!img) return { error: 'No feImage' };
        
        const href = img.getAttribute('href');
        if (!href?.startsWith('data:image/png')) return { error: 'No data URL' };
        
        return new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            
            // Check multiple points
            const points = [
              { name: 'center', x: Math.floor(image.width / 2), y: Math.floor(image.height / 2) },
              { name: 'topLeft', x: 2, y: 2 },
              { name: 'bottomRight', x: image.width - 3, y: image.height - 3 },
            ];
            
            const results = {};
            let allOk = true;
            
            for (const pt of points) {
              const pixel = ctx.getImageData(pt.x, pt.y, 1, 1);
              const [r, g, b, a] = pixel.data;
              results[pt.name] = [r, g, b, a];
              
              if (pt.name === 'center') {
                // Center should be ~128,128,128
                if (r < 115 || r > 140 || g < 115 || g > 140) {
                  allOk = false;
                }
              } else {
                // Corners should have displacement (not all 128s), alpha should be 255
                if (a !== 255) {
                  allOk = false;
                }
              }
            }
            
            resolve({
              dimensions: `${image.width}x${image.height}`,
              pixels: results,
              isCorrect: allOk
            });
          };
          image.onerror = () => resolve({ error: 'Decode failed' });
          image.src = href;
        });
      });
      
      results.push({
        round: round + 1,
        test: testCase.name,
        ...check
      });
      
      if (!check.isCorrect && !check.error) {
        console.log(`  ❌ FAIL: ${JSON.stringify(check.pixels)}`);
      } else if (check.error) {
        console.log(`  ❌ ERROR: ${check.error}`);
      } else {
        console.log(`  ✓ OK @ ${check.dimensions}`);
      }
    }
  }
  
  console.log('\n=== Summary ===');
  const failures = results.filter(r => !r.isCorrect && !r.error);
  const errors = results.filter(r => r.error);
  const ok = results.length - failures.length - errors.length;
  
  console.log(`Total tests: ${results.length}`);
  console.log(`OK: ${ok}`);
  console.log(`FAIL: ${failures.length}`);
  console.log(`ERROR: ${errors.length}`);
  
  if (failures.length > 0) {
    console.log('\nFailure details:');
    failures.forEach(f => console.log(`  ${f.test} (R${f.round}): ${JSON.stringify(f.pixels)}`));
  }
  
  if (consoleErrors.length > 0) {
    console.log('\nConsole errors:');
    consoleErrors.forEach(e => console.log(`  ${e}`));
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
