import puppeteer from 'puppeteer';

/**
 * Exact reproduction of user-reported bug:
 * 1. Access page
 * 2. WITHOUT touching any element, change renderer from GPU to WASM-SIMD
 * 3. Radius changes work correctly
 * 4. Width/height resize causes texture collapse
 */
async function runTest() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  
  // Capture all console output
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Progressive]') || text.includes('[Throttle]') || 
        text.includes('WASM') || text.includes('Error') || text.includes('error')) {
      console.log(`  [console] ${msg.type()}: ${text.substring(0, 200)}`);
    }
  });
  
  console.log('Step 1: Load page');
  await page.goto('http://localhost:8787/demo/parameter-lab/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.glass-panel', { timeout: 10000 });
  console.log('  Page loaded, waiting for initial render...');
  await new Promise(r => setTimeout(r, 1000));
  
  // Verify initial state (GPU renderer)
  const initialState = await page.evaluate(() => {
    const img = document.querySelector('feImage[result="dNew"], feImage[result="dImgNew"]');
    if (!img) return { status: 'no-filter' };
    const href = img.getAttribute('href');
    return { status: 'ok', hasDataUrl: !!href?.startsWith('data:image/png') };
  });
  console.log(`  Initial state: ${JSON.stringify(initialState)}`);

  console.log('\nStep 2: Switch renderer to WASM-SIMD (WITHOUT touching any element)');
  const switched = await page.evaluate(() => {
    const controls = document.querySelectorAll('.control');
    for (const control of controls) {
      const label = control.querySelector('.control-label');
      if (label && label.textContent.includes('Displacement Renderer')) {
        const btns = control.querySelectorAll('.view-mode-btn');
        for (const btn of btns) {
          if (btn.textContent === 'WASM-SIMD') {
            btn.click();
            return btn.textContent;
          }
        }
      }
    }
    return null;
  });
  
  if (!switched) {
    console.log('  ERROR: Could not find WASM-SIMD button');
    await browser.close();
    return 1;
  }
  console.log(`  Clicked: ${switched}`);
  await new Promise(r => setTimeout(r, 800));
  
  // Check displacement map after renderer switch
  const afterSwitch = await checkDisplacementMap(page);
  console.log(`  After switch: ${afterSwitch.summary}`);
  if (!afterSwitch.isCorrect && !afterSwitch.error) {
    console.log('  ❌ TEXTURE COLLAPSE detected after renderer switch!');
    console.log(`     Center pixel: ${JSON.stringify(afterSwitch.center)}`);
  }

  console.log('\nStep 3: Change radius (should work)');
  // Change radius via slider
  await page.evaluate(() => {
    const controls = document.querySelectorAll('.control');
    for (const control of controls) {
      const label = control.querySelector('.control-label');
      if (label && label.textContent.includes('Corner Radius')) {
        const slider = control.querySelector('input[type="range"]');
        if (slider) {
          slider.value = '50';
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  });
  await new Promise(r => setTimeout(r, 600));
  
  const afterRadius = await checkDisplacementMap(page);
  console.log(`  After radius change: ${afterRadius.summary}`);
  if (!afterRadius.isCorrect && !afterRadius.error) {
    console.log('  ❌ TEXTURE COLLAPSE detected after radius change!');
    console.log(`     Center pixel: ${JSON.stringify(afterRadius.center)}`);
  }

  console.log('\nStep 4: Resize width/height (may cause texture collapse)');
  // Resize via width slider
  for (let w = 320; w <= 600; w += 50) {
    await page.evaluate((width) => {
      const controls = document.querySelectorAll('.control');
      for (const control of controls) {
        const label = control.querySelector('.control-label');
        if (label && label.textContent === 'Width') {
          const slider = control.querySelector('input[type="range"]');
          if (slider) {
            slider.value = String(width);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
    }, w);
    await new Promise(r => setTimeout(r, 50));
  }
  
  await new Promise(r => setTimeout(r, 600));
  
  const afterResize = await checkDisplacementMap(page);
  console.log(`  After resize: ${afterResize.summary}`);
  if (!afterResize.isCorrect && !afterResize.error) {
    console.log('  ❌ TEXTURE COLLAPSE detected after resize!');
    console.log(`     Center pixel: ${JSON.stringify(afterResize.center)}`);
  }

  // Additional resize cycles
  console.log('\nStep 5: Multiple resize cycles');
  let failures = 0;
  
  for (let cycle = 0; cycle < 5; cycle++) {
    // Resize down
    for (let w = 600; w >= 200; w -= 80) {
      await page.evaluate((width) => {
        const el = document.querySelector('.interactive-element .glass-panel');
        if (el) el.style.width = `${width}px`;
      }, w);
      await new Promise(r => setTimeout(r, 10));
    }
    
    // Resize up
    for (let w = 200; w <= 600; w += 80) {
      await page.evaluate((width) => {
        const el = document.querySelector('.interactive-element .glass-panel');
        if (el) el.style.width = `${width}px`;
      }, w);
      await new Promise(r => setTimeout(r, 10));
    }
    
    await new Promise(r => setTimeout(r, 400));
    
    const check = await checkDisplacementMap(page);
    console.log(`  Cycle ${cycle + 1}: ${check.summary}`);
    if (!check.isCorrect && !check.error) {
      failures++;
      console.log(`    ❌ FAILURE: ${JSON.stringify(check.center)}`);
    }
  }

  console.log('\n=== Final Result ===');
  console.log(`Failures: ${failures}/5`);
  
  await browser.close();
  return failures;
}

async function checkDisplacementMap(page) {
  return await page.evaluate(() => {
    const img = document.querySelector('feImage[result="dNew"], feImage[result="dImgNew"]');
    if (!img) return { error: 'No feImage', summary: 'ERROR: No feImage' };
    
    const href = img.getAttribute('href');
    if (!href?.startsWith('data:image/png')) {
      return { error: 'No data URL', summary: 'ERROR: No data URL' };
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
          summary: isCorrect 
            ? `OK @ ${image.width}x${image.height} (${r},${g},${b})` 
            : `FAIL @ ${image.width}x${image.height} (${r},${g},${b})`
        });
      };
      image.onerror = () => resolve({ 
        error: 'Decode failed', 
        summary: 'ERROR: Decode failed' 
      });
      image.src = href;
    });
  });
}

runTest().then(failures => {
  process.exit(failures > 0 ? 1 : 0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
