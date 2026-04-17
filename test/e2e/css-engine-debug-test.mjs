/**
 * CSS Property Engine Debug Test
 */

import puppeteer from 'puppeteer';

async function runTest() {
  console.log('🔍 CSS Property Engine Debug Test\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Capture all console messages
  page.on('console', msg => {
    console.log(`[BROWSER ${msg.type()}]`, msg.text());
  });

  page.on('pageerror', err => {
    console.log('[BROWSER ERROR]', err.message);
  });

  await page.goto('http://localhost:8788/demo/css-property-engine-demo.html', {
    waitUntil: 'networkidle0'
  });

  await new Promise(r => setTimeout(r, 500));

  // Debug: Check engine state
  console.log('\n📋 Engine State Check');
  console.log('─'.repeat(50));

  const engineState = await page.evaluate(() => {
    // Access engine internals via window
    const engine = window.__cssPropertyEngine;
    if (!engine) {
      return { error: 'Engine not found on window' };
    }

    return {
      initialized: engine._initialized,
      propertiesCount: engine._properties?.size || 0,
      trackedElementsCount: engine._trackedElements?.size || 0,
      hasPropertyPattern: !!engine._propertyPattern,
      propertyPatternSource: engine._propertyPattern?.source || null,
    };
  });

  console.log('Engine state:', engineState);

  // Debug: Manual property change
  console.log('\n🧪 Manual Property Change Test');
  console.log('─'.repeat(50));

  const result = await page.evaluate(() => {
    const box1 = document.getElementById('box1');

    // Get initial values
    const before = {
      cssText: box1.style.cssText,
      demoColor: getComputedStyle(box1).getPropertyValue('--demo-color').trim(),
      backgroundColor: box1.style.backgroundColor,
    };

    // Change property
    box1.style.setProperty('--demo-color', '#00ff00');

    // Get after values (immediately)
    const afterImmediate = {
      cssText: box1.style.cssText,
      demoColor: getComputedStyle(box1).getPropertyValue('--demo-color').trim(),
      backgroundColor: box1.style.backgroundColor,
    };

    return { before, afterImmediate };
  });

  console.log('Before:', result.before);
  console.log('After (immediate):', result.afterImmediate);

  // Wait for engine to process
  await new Promise(r => setTimeout(r, 200));

  const afterDelay = await page.evaluate(() => {
    const box1 = document.getElementById('box1');
    return {
      cssText: box1.style.cssText,
      demoColor: getComputedStyle(box1).getPropertyValue('--demo-color').trim(),
      backgroundColor: box1.style.backgroundColor,
      computedBg: getComputedStyle(box1).backgroundColor,
    };
  });

  console.log('After (200ms delay):', afterDelay);

  // Check if MutationObserver fires
  console.log('\n🔬 MutationObserver Test');
  console.log('─'.repeat(50));

  const mutationTest = await page.evaluate(async () => {
    return new Promise(resolve => {
      const box1 = document.getElementById('box1');
      const mutations = [];

      const observer = new MutationObserver(list => {
        for (const mutation of list) {
          mutations.push({
            type: mutation.type,
            attributeName: mutation.attributeName,
            oldValue: mutation.oldValue,
          });
        }
      });

      observer.observe(box1, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        attributeOldValue: true,
      });

      // Change style
      box1.style.setProperty('--demo-color', '#ff0000');

      // Wait a tick
      setTimeout(() => {
        observer.disconnect();
        resolve({
          mutationsCount: mutations.length,
          mutations,
          finalCssText: box1.style.cssText,
        });
      }, 50);
    });
  });

  console.log('Mutations detected:', mutationTest.mutationsCount);
  console.log('Mutations:', mutationTest.mutations);
  console.log('Final cssText:', mutationTest.finalCssText);

  // Check pattern matching
  console.log('\n🔍 Pattern Matching Test');
  console.log('─'.repeat(50));

  const patternTest = await page.evaluate(() => {
    const testCssText = '--demo-color: red; --demo-size: 100;';
    const pattern = /--(?:demo-color|demo-size)\s*:/i;

    return {
      testCssText,
      patternSource: pattern.source,
      matches: pattern.test(testCssText),
    };
  });

  console.log('Pattern test:', patternTest);

  // Force rescan and check
  console.log('\n🔄 Force Rescan Test');
  console.log('─'.repeat(50));

  await page.evaluate(() => {
    // Set a distinct color
    const box1 = document.getElementById('box1');
    box1.style.setProperty('--demo-color', '#abcdef');
  });

  // Call rescan
  await page.evaluate(() => {
    const engine = window.__cssPropertyEngine;
    if (engine) {
      engine.rescan();
    }
  });

  await new Promise(r => setTimeout(r, 100));

  const afterRescan = await page.evaluate(() => {
    const box1 = document.getElementById('box1');
    return {
      demoColor: getComputedStyle(box1).getPropertyValue('--demo-color').trim(),
      backgroundColor: box1.style.backgroundColor,
      computedBg: getComputedStyle(box1).backgroundColor,
    };
  });

  console.log('After rescan:', afterRescan);

  await browser.close();
  console.log('\n✅ Debug test complete');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
