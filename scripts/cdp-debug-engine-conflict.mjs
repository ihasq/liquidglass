/**
 * CDP Debug Script - CSS Property Engine vs FilterManager conflict test
 *
 * Tests if the CSS Property Engine interferes with FilterManager's
 * MutationObserver for border-radius changes.
 */

import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[PAGE ${msg.type()}]`, msg.text());
    }
  });

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== TEST 1: MutationObserver firing test ===\n');

  const test1 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');
    const results = {
      observersFired: [],
      initialBorderRadius: getComputedStyle(glass).borderRadius,
    };

    // Find all MutationObservers watching this element
    // We can't directly access them, but we can create a test observer
    // and see what happens when we change the style

    // Create a custom observer to track changes
    let changeDetected = false;
    const testObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'style') {
          changeDetected = true;
          results.observersFired.push({
            type: 'style',
            oldValue: m.oldValue,
            newValue: glass.style.cssText.slice(0, 100)
          });
        }
      }
    });

    testObserver.observe(glass, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true
    });

    // Change border-radius
    glass.style.borderRadius = '99px';

    // Wait for observers to fire
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    testObserver.disconnect();

    results.finalBorderRadius = getComputedStyle(glass).borderRadius;
    results.changeDetected = changeDetected;

    return results;
  });

  console.log('Test 1 results:', test1);

  console.log('\n=== TEST 2: Check if FilterManager receives the change ===\n');

  const test2 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Check initial displacement map
    const filter = document.querySelector('svg[aria-hidden="true"] defs filter');
    const initialDispUrl = filter?.querySelector('feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 50);

    // Change border-radius
    const prevRadius = glass.style.borderRadius;
    glass.style.borderRadius = '5px'; // Very small radius

    // Wait for FilterManager to process
    await new Promise(r => setTimeout(r, 800));

    const finalDispUrl = filter?.querySelector('feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 50);

    return {
      prevRadius,
      newRadius: glass.style.borderRadius,
      initialDispUrl,
      finalDispUrl,
      dispMapChanged: initialDispUrl !== finalDispUrl
    };
  });

  console.log('Test 2 results:', test2);

  console.log('\n=== TEST 3: Check CSS Property Engine behavior ===\n');

  const test3 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Get current CSS custom properties
    const style = getComputedStyle(glass);
    const refraction = style.getPropertyValue('--liquidglass-refraction');
    const thickness = style.getPropertyValue('--liquidglass-thickness');

    // Check if changing a liquidglass property triggers update
    const initialDispUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 50);

    // Change thickness (this should trigger CSS Property Engine callback)
    glass.style.setProperty('--liquidglass-thickness', '90');

    await new Promise(r => setTimeout(r, 500));

    const afterThicknessUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 50);

    // Now change border-radius (this should NOT trigger CSS Property Engine, only FilterManager)
    glass.style.borderRadius = '2px';

    await new Promise(r => setTimeout(r, 500));

    const afterRadiusUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 50);

    return {
      initialRefraction: refraction,
      initialThickness: thickness,
      initialDispUrl,
      afterThicknessUrl,
      afterRadiusUrl,
      thicknessChangedMap: initialDispUrl !== afterThicknessUrl,
      radiusChangedMap: afterThicknessUrl !== afterRadiusUrl,
      finalRadius: getComputedStyle(glass).borderRadius
    };
  });

  console.log('Test 3 results:', test3);

  console.log('\n=== TEST 4: Direct slider interaction simulation ===\n');

  const test4 = await page.evaluate(async () => {
    const element1 = document.getElementById('element-1');
    const glass = element1.querySelector('.glass-panel');
    const slider = document.getElementById('radius');

    // Step 1: Reset state
    glass.style.borderRadius = '24px';
    element1.dataset.radius = '24';

    // Step 2: Simulate proper selection (like in the demo)
    // This is what startDrag -> selectElement does
    document.querySelectorAll('.interactive-element').forEach(e => e.classList.remove('selected'));
    element1.classList.add('selected');

    // The key issue: we need to set the module-scoped `selectedElement` variable
    // But we can't access it from here because it's in module scope!

    // Step 3: Try triggering the slider input
    slider.value = '77';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 300));

    return {
      sliderValue: slider.value,
      displayValue: document.getElementById('radius-val').textContent,
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      datasetRadius: element1.dataset.radius,
      hasSelectedClass: element1.classList.contains('selected'),
      // The updateAllGlasses function checks for `selectedElement` which is a module variable
      // We added the class but didn't set the variable!
    };
  });

  console.log('Test 4 results:', test4);

  console.log('\n=== TEST 5: Proper mousedown selection ===\n');

  const test5 = await page.evaluate(async () => {
    const element1 = document.getElementById('element-1');
    const glass = element1.querySelector('.glass-panel');
    const slider = document.getElementById('radius');

    // Reset
    glass.style.borderRadius = '24px';
    element1.dataset.radius = '24';

    // Proper selection via mousedown event (this sets the module-scoped selectedElement)
    const rect = element1.getBoundingClientRect();
    const mouseEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    });
    element1.dispatchEvent(mouseEvent);

    // mouseup to complete
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await new Promise(r => setTimeout(r, 100));

    // Now change slider
    slider.value = '88';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 300));

    return {
      sliderValue: slider.value,
      displayValue: document.getElementById('radius-val').textContent,
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      datasetRadius: element1.dataset.radius,
      hasSelectedClass: element1.classList.contains('selected'),
    };
  });

  console.log('Test 5 results:', test5);

  console.log('\n=== CONCLUSION ===');

  if (test5.inlineStyle === '88px' && test5.datasetRadius === '88') {
    console.log('When properly selected via mousedown, the slider WORKS correctly.');
    console.log('The issue is with how Puppeteer page.click() triggers selection.');
  } else {
    console.log('There is a REAL BUG: even with proper selection, the slider does not work.');
  }

  if (!test3.radiusChangedMap) {
    console.log('\nWARNING: Displacement map did NOT update when border-radius changed!');
    console.log('This suggests FilterManager is not receiving the style change notification.');
  } else {
    console.log('\nDisplacement map DID update when border-radius changed.');
    console.log('FilterManager is working correctly.');
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
