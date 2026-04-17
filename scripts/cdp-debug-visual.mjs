/**
 * CDP Debug Script - Visual test with non-headless browser
 * This will open a real browser window for manual verification
 */

import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser (non-headless)...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
    defaultViewport: null
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      console.log(`[PAGE ${msg.type()}]`, msg.text());
    }
  });

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== Testing border-radius issue ===\n');

  // Test 1: Check if border-radius is connected to CSS Property Engine
  console.log('Test 1: Checking CSS Property Engine registration...');
  const engineCheck = await page.evaluate(() => {
    // Check if border-radius has a --liquidglass- prefix property
    const glass = document.querySelector('.glass-panel');
    const style = getComputedStyle(glass);

    const props = [];
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--liquidglass')) {
        props.push(prop);
      }
    }

    return {
      registeredProps: props,
      borderRadius: style.borderRadius,
      hasBorderRadiusProp: props.some(p => p.includes('radius'))
    };
  });
  console.log('Engine check:', engineCheck);

  // Test 2: Check element selection mechanism
  console.log('\nTest 2: Element selection test...');

  // Click on element using actual coordinates
  const box = await page.$eval('#element-1', el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
  });

  console.log('Clicking at:', box);
  await page.mouse.click(box.x, box.y);
  await new Promise(r => setTimeout(r, 500));

  const selectionCheck = await page.evaluate(() => {
    const selected = document.querySelector('.interactive-element.selected');
    return {
      selectedId: selected?.id || null,
      hasSelectedClass: !!selected
    };
  });
  console.log('Selection result:', selectionCheck);

  // Test 3: Change border-radius via input event
  console.log('\nTest 3: Border-radius slider test...');

  const beforeSlider = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    const slider = document.getElementById('radius');
    const valDisplay = document.getElementById('radius-val');
    return {
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      sliderValue: slider.value,
      displayValue: valDisplay.textContent
    };
  });
  console.log('Before slider change:', beforeSlider);

  // Focus on slider and change value
  await page.focus('#radius');
  await page.evaluate(() => {
    const slider = document.getElementById('radius');
    slider.value = '60';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 500));

  const afterSlider = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    const slider = document.getElementById('radius');
    const valDisplay = document.getElementById('radius-val');
    const el1 = document.getElementById('element-1');
    return {
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      sliderValue: slider.value,
      displayValue: valDisplay.textContent,
      datasetRadius: el1.dataset.radius
    };
  });
  console.log('After slider change:', afterSlider);

  // Test 4: Direct style manipulation
  console.log('\nTest 4: Direct style manipulation test...');

  const directTest = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');

    const before = glass.style.borderRadius;
    glass.style.borderRadius = '80px';

    // Wait for MutationObserver to fire
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          before,
          after: glass.style.borderRadius,
          computed: getComputedStyle(glass).borderRadius
        });
      }, 300);
    });
  });
  console.log('Direct style test:', directTest);

  // Test 5: Check FilterManager state
  console.log('\nTest 5: FilterManager state check...');

  const fmCheck = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    const marker = glass.querySelector('span[class^="_lg"]');
    const filter = marker ? document.querySelector(`filter#${marker.className.replace('_lg', '_lg')}`) : null;

    // Check SVG filter
    const svgFilters = document.querySelectorAll('svg[aria-hidden="true"] filter');

    return {
      hasMarker: !!marker,
      markerClass: marker?.className,
      filterCount: svgFilters.length,
      backdropFilter: getComputedStyle(glass).backdropFilter
    };
  });
  console.log('FilterManager state:', fmCheck);

  // Test 6: Check if CSS Property Engine is interfering
  console.log('\nTest 6: CSS Property Engine callback test...');

  const callbackTest = await page.evaluate(async () => {
    // This checks if changing border-radius triggers any unexpected behavior
    const glass = document.querySelector('#element-1 .glass-panel');

    // Record current backdrop-filter
    const initialBackdrop = getComputedStyle(glass).backdropFilter;

    // Change border-radius
    glass.style.borderRadius = '90px';

    // Wait for updates
    await new Promise(r => setTimeout(r, 500));

    return {
      initialBackdrop,
      finalBackdrop: getComputedStyle(glass).backdropFilter,
      backdropChanged: initialBackdrop !== getComputedStyle(glass).backdropFilter,
      finalBorderRadius: getComputedStyle(glass).borderRadius
    };
  });
  console.log('Callback test:', callbackTest);

  console.log('\n=== Summary ===');
  console.log('The issue appears to be:', selectionCheck.hasSelectedClass
    ? 'Border-radius slider does not update the visual style even when element is selected'
    : 'Element selection via click does not work properly');

  // Keep browser open for manual inspection
  console.log('\nBrowser will stay open for 30 seconds for manual inspection...');
  await new Promise(r => setTimeout(r, 30000));

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
