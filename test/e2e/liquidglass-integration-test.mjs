/**
 * Liquid Glass Integration Test
 *
 * Verifies that the CSS Property Engine is correctly integrated with liquidglass
 */

import puppeteer from 'puppeteer';

async function test() {
  console.log('🧪 Liquid Glass Integration Test\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    errors.push(err.message);
  });

  // Load parameter-lab demo
  console.log('Loading parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await new Promise(r => setTimeout(r, 1000));

  // Check engine state
  const engineState = await page.evaluate(() => {
    // Check for CSS Property Engine
    const engineStyle = document.querySelector('style[data-css-property-engine]');

    // Check for liquidglass SVG filters
    const svgRoot = document.querySelector('svg[aria-hidden="true"]');
    const filters = svgRoot ? svgRoot.querySelectorAll('filter') : [];

    // Check for elements with liquidglass properties
    const allElements = document.querySelectorAll('*');
    let elementsWithProps = 0;
    for (const el of allElements) {
      const style = getComputedStyle(el);
      const refraction = style.getPropertyValue('--liquidglass-refraction').trim();
      if (refraction && refraction !== '__UNSET__' && !isNaN(parseFloat(refraction))) {
        elementsWithProps++;
      }
    }

    // Check for backdrop-filter application
    const backdropElements = [];
    const sheets = document.styleSheets;
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.style && rule.style.backdropFilter && rule.style.backdropFilter.includes('url(#')) {
            backdropElements.push(rule.selectorText);
          }
        }
      } catch (e) {
        // Cross-origin
      }
    }

    return {
      hasEngineStyle: !!engineStyle,
      filterCount: filters.length,
      elementsWithLiquidglassProps: elementsWithProps,
      backdropFilterRules: backdropElements.length,
      backdropSelectors: backdropElements.slice(0, 5),
    };
  });

  console.log('\n📊 Engine State:');
  console.log(`  CSS Property Engine style injected: ${engineState.hasEngineStyle ? '✅' : '❌'}`);
  console.log(`  SVG filters created: ${engineState.filterCount}`);
  console.log(`  Elements with --liquidglass-* props: ${engineState.elementsWithLiquidglassProps}`);
  console.log(`  Backdrop-filter rules: ${engineState.backdropFilterRules}`);

  if (engineState.backdropSelectors.length > 0) {
    console.log(`  Sample selectors: ${engineState.backdropSelectors.join(', ')}`);
  }

  // Test dynamic property change
  console.log('\n🔄 Testing dynamic property change...');

  const dynamicTestResult = await page.evaluate(() => {
    // Find a panel with liquidglass properties
    const panels = document.querySelectorAll('.glass-panel, [class*="panel"]');
    if (panels.length === 0) return { error: 'No panels found' };

    const panel = panels[0];

    // Get initial refraction value
    const initialRefraction = getComputedStyle(panel).getPropertyValue('--liquidglass-refraction').trim();

    // Change refraction
    panel.style.setProperty('--liquidglass-refraction', '99');

    // Wait a tick for engine to process
    return new Promise(resolve => {
      setTimeout(() => {
        const newRefraction = getComputedStyle(panel).getPropertyValue('--liquidglass-refraction').trim();
        resolve({
          panelClass: panel.className,
          initialRefraction,
          newRefraction,
          changed: newRefraction === '99',
        });
      }, 100);
    });
  });

  if (dynamicTestResult.error) {
    console.log(`  ❌ ${dynamicTestResult.error}`);
  } else {
    console.log(`  Panel: ${dynamicTestResult.panelClass}`);
    console.log(`  Initial refraction: ${dynamicTestResult.initialRefraction}`);
    console.log(`  After setProperty: ${dynamicTestResult.newRefraction}`);
    console.log(`  Dynamic change detected: ${dynamicTestResult.changed ? '✅' : '❌'}`);
  }

  // Check for errors
  if (errors.length > 0) {
    console.log('\n⚠️ Console errors:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  // Summary
  const success = engineState.hasEngineStyle &&
                  (engineState.filterCount > 0 || engineState.elementsWithLiquidglassProps > 0);

  console.log('\n' + '═'.repeat(50));
  console.log(success ? '✅ Integration test PASSED' : '❌ Integration test FAILED');
  console.log('═'.repeat(50));

  await browser.close();
  process.exit(success ? 0 : 1);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
