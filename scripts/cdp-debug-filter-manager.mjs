/**
 * CDP Debug Script - FilterManager re-render investigation
 *
 * Tests why displacement map is not updating when border-radius changes
 */

import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Capture console logs from page
  page.on('console', msg => {
    const text = msg.text();
    // Filter for LiquidGlass debug logs
    if (text.includes('[LiquidGlass]') || text.includes('[Throttle]') ||
        text.includes('[Prediction]') || text.includes('[Morph]') ||
        text.includes('[Progressive]') || text.includes('[Interval]')) {
      console.log('[PAGE]', text);
    }
  });

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== Enabling debug logging ===\n');

  // Enable debug logging in the library
  await page.evaluate(() => {
    // Try to enable debug logging if available
    if (typeof window.lgc_dev !== 'undefined' && window.lgc_dev.debug) {
      window.lgc_dev.debug.log.throttle.enable();
      window.lgc_dev.debug.log.prediction.enable();
      window.lgc_dev.debug.log.morph.enable();
      window.lgc_dev.debug.log.progressive.enable();
      window.lgc_dev.debug.log.interval.enable();
      console.log('Debug logging enabled');
    } else {
      console.log('Debug logging not available (not in dev mode)');
    }
  });

  console.log('\n=== TEST: Direct border-radius change ===\n');

  const test1 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Get initial state
    const initialRadius = getComputedStyle(glass).borderRadius;
    const initialDispUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    console.log('Initial radius:', initialRadius);
    console.log('Changing border-radius...');

    // Change border-radius
    glass.style.borderRadius = '80px';

    // Check immediately
    const immediateRadius = getComputedStyle(glass).borderRadius;
    const immediateDispUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    console.log('After change (immediate):', immediateRadius);

    // Wait 100ms
    await new Promise(r => setTimeout(r, 100));
    const after100 = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Wait 300ms more
    await new Promise(r => setTimeout(r, 300));
    const after400 = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Wait 500ms more
    await new Promise(r => setTimeout(r, 500));
    const after900 = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Wait 1000ms more
    await new Promise(r => setTimeout(r, 1000));
    const after1900 = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    return {
      initialRadius,
      immediateRadius,
      initialDispUrl,
      immediateDispUrl,
      after100,
      after400,
      after900,
      after1900,
      changedAt100: initialDispUrl !== after100,
      changedAt400: initialDispUrl !== after400,
      changedAt900: initialDispUrl !== after900,
      changedAt1900: initialDispUrl !== after1900
    };
  });

  console.log('Test 1 results:', JSON.stringify(test1, null, 2));

  console.log('\n=== TEST 2: Check FilterManager state ===\n');

  const test2 = await page.evaluate(async () => {
    // Check if FilterManager has the element registered
    const glass = document.querySelector('#element-1 .glass-panel');

    // Look for marker element (sign of attachment)
    const marker = glass.querySelector('span[class^="_lg"]');

    // Check SVG filter
    const filters = document.querySelectorAll('svg[aria-hidden="true"] defs filter');

    // Check backdrop-filter
    const computed = getComputedStyle(glass);

    return {
      hasMarker: !!marker,
      markerClass: marker?.className,
      filterCount: filters.length,
      backdropFilter: computed.backdropFilter,
      borderRadius: computed.borderRadius,
      // Check if there are multiple filters (one for each element)
      filterIds: Array.from(filters).map(f => f.id)
    };
  });

  console.log('Test 2 results:', JSON.stringify(test2, null, 2));

  console.log('\n=== TEST 3: Check if CSS Property Engine is running ===\n');

  const test3 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Check for CSS Property Engine style element
    const engineStyle = document.querySelector('style[data-css-property-engine]');
    const propsStyle = document.querySelector('style[data-liquid-glass-props]');

    // Check if CSS custom properties are registered
    const computed = getComputedStyle(glass);
    const refraction = computed.getPropertyValue('--liquidglass-refraction');

    return {
      hasEngineStyle: !!engineStyle,
      hasPropsStyle: !!propsStyle,
      refraction,
      // Check the @property rules
      engineStyleContent: engineStyle?.textContent?.slice(0, 500),
    };
  });

  console.log('Test 3 results:', JSON.stringify(test3, null, 2));

  console.log('\n=== TEST 4: Force refresh and check ===\n');

  const test4 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Get initial
    const initial = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Change a CSS custom property (this should trigger CSS Property Engine)
    glass.style.setProperty('--liquidglass-refraction', '99');

    // Wait for update
    await new Promise(r => setTimeout(r, 500));

    const afterRefraction = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Change border-radius
    glass.style.borderRadius = '10px';

    // Wait longer
    await new Promise(r => setTimeout(r, 1000));

    const afterRadius = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    return {
      initial,
      afterRefraction,
      afterRadius,
      refractionChangedMap: initial !== afterRefraction,
      radiusChangedMap: afterRefraction !== afterRadius,
      finalRadius: getComputedStyle(glass).borderRadius
    };
  });

  console.log('Test 4 results:', JSON.stringify(test4, null, 2));

  console.log('\n=== TEST 5: Manual trigger resize ===\n');

  const test5 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Get initial
    const initial = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);
    const initialRadius = getComputedStyle(glass).borderRadius;

    // Change border-radius
    glass.style.borderRadius = '50px';

    // Also change size slightly (this should trigger ResizeObserver)
    glass.style.width = '321px';

    await new Promise(r => setTimeout(r, 500));

    const afterSizeChange = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    // Reset size
    glass.style.width = '320px';

    await new Promise(r => setTimeout(r, 500));

    const afterReset = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href')?.slice(0, 80);

    return {
      initial,
      initialRadius,
      afterSizeChange,
      afterReset,
      mapChanged: initial !== afterSizeChange || initial !== afterReset,
      finalRadius: getComputedStyle(glass).borderRadius
    };
  });

  console.log('Test 5 results:', JSON.stringify(test5, null, 2));

  console.log('\n=== CONCLUSION ===');

  if (!test1.changedAt1900) {
    console.log('BUG CONFIRMED: Displacement map does NOT update on border-radius change!');
    console.log('Even after 1900ms, the displacement map remains unchanged.');
    console.log('This means FilterManager._scheduleRender() is not being called,');
    console.log('or _render() is not generating a new displacement map.');
  }

  if (test4.refractionChangedMap) {
    console.log('\nChanging --liquidglass-refraction DOES update the map.');
    console.log('This suggests CSS Property Engine callbacks are working.');
  } else {
    console.log('\nChanging --liquidglass-refraction does NOT update the map.');
    console.log('This suggests CSS Property Engine callbacks are also broken.');
  }

  if (test5.mapChanged) {
    console.log('\nChanging SIZE does update the map.');
    console.log('This suggests ResizeObserver is working.');
  } else {
    console.log('\nChanging SIZE does NOT update the map.');
    console.log('This suggests ResizeObserver is also broken.');
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
