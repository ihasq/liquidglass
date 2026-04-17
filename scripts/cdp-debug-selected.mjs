/**
 * CDP Debug Script - selectedElement investigation
 */

import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable console output from page
  page.on('console', msg => {
    console.log('[PAGE]', msg.text());
  });

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  // Check initial selectedElement state
  const initialSelected = await page.evaluate(() => {
    return {
      selectedElement: window.selectedElement ? window.selectedElement.id : null,
      interactiveElementsCount: document.querySelectorAll('.interactive-element').length
    };
  });
  console.log('Initial state:', initialSelected);

  // Try clicking element-1
  console.log('\nClicking #element-1...');
  await page.click('#element-1');
  await new Promise(r => setTimeout(r, 500));

  // Check selected state after click
  const afterClick = await page.evaluate(() => {
    // selectedElement is a local variable in the module scope, not on window
    // Let's check the class instead
    const selected = document.querySelector('.interactive-element.selected');
    return {
      selectedId: selected ? selected.id : null,
      hasSelectedClass: !!selected
    };
  });
  console.log('After click (via class):', afterClick);

  // Manually trigger selection and then slider change
  console.log('\nManually setting selection and changing radius...');

  const result = await page.evaluate(() => {
    // Find the slider and element
    const slider = document.getElementById('radius');
    const element1 = document.getElementById('element-1');
    const glass = element1.querySelector('.glass-panel');

    // Get initial values
    const before = {
      sliderValue: slider.value,
      datasetRadius: element1.dataset.radius,
      inlineBorderRadius: glass.style.borderRadius,
      computedBorderRadius: getComputedStyle(glass).borderRadius,
      hasSelectedClass: element1.classList.contains('selected')
    };

    // Simulate clicking the element to select it
    // Manually add the 'selected' class like selectElement() does
    document.querySelectorAll('.interactive-element').forEach(e => e.classList.remove('selected'));
    element1.classList.add('selected');

    // Check if controls are updated when an element is selected
    // The issue might be that updateAllGlasses() checks for `selectedElement`
    // which is a module-scoped variable, not accessible here

    // Change slider
    slider.value = '60';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    // Check values after
    return {
      before,
      after: {
        sliderValue: slider.value,
        datasetRadius: element1.dataset.radius,
        inlineBorderRadius: glass.style.borderRadius,
        computedBorderRadius: getComputedStyle(glass).borderRadius,
        hasSelectedClass: element1.classList.contains('selected'),
        sliderDisplayValue: document.getElementById('radius-val').textContent
      }
    };
  });

  console.log('Before:', result.before);
  console.log('After:', result.after);

  // The issue: selectedElement is a module-scoped variable
  // When we click, does it get set?
  console.log('\n=== Testing actual mousedown event ===');

  // Dispatch actual mousedown event
  const mousedownTest = await page.evaluate(async () => {
    const element1 = document.getElementById('element-1');
    const glass = element1.querySelector('.glass-panel');

    // Store initial
    const initial = {
      datasetRadius: element1.dataset.radius,
      inlineBorderRadius: glass.style.borderRadius
    };

    // Create and dispatch mousedown event on the element
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 300
    });
    element1.dispatchEvent(event);

    // Also mouseup to complete the interaction
    const upEvent = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(upEvent);

    // Wait a frame
    await new Promise(r => requestAnimationFrame(r));

    // Check if selected
    const isSelected = element1.classList.contains('selected');

    // Now change radius slider
    const slider = document.getElementById('radius');
    slider.value = '75';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for updates
    await new Promise(r => setTimeout(r, 100));

    return {
      initial,
      isSelected,
      final: {
        datasetRadius: element1.dataset.radius,
        inlineBorderRadius: glass.style.borderRadius,
        computedBorderRadius: getComputedStyle(glass).borderRadius
      }
    };
  });

  console.log('Mousedown test result:', JSON.stringify(mousedownTest, null, 2));

  // Let's check the actual updateAllGlasses function behavior
  console.log('\n=== Checking updateAllGlasses logic ===');

  const updateTest = await page.evaluate(async () => {
    const results = [];

    // Find the controls object - it's in module scope
    // We need to check if the radius control updates all glasses or just selected

    // Look at the actual behavior: when radius slider changes, what happens?
    const glass1 = document.querySelector('#element-1 .glass-panel');
    const glass2 = document.querySelector('#element-2 .glass-panel');
    const glass3 = document.querySelector('#element-3 .glass-panel');

    results.push({
      test: 'Initial',
      glass1: glass1.style.borderRadius,
      glass2: glass2.style.borderRadius,
      glass3: glass3.style.borderRadius
    });

    // Select element-1 via mousedown
    const e1 = document.getElementById('element-1');
    e1.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await new Promise(r => setTimeout(r, 50));

    // Change radius
    const slider = document.getElementById('radius');
    slider.value = '88';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 100));

    results.push({
      test: 'After changing radius with element-1 selected',
      glass1: glass1.style.borderRadius,
      glass2: glass2.style.borderRadius,
      glass3: glass3.style.borderRadius,
      element1dataset: document.getElementById('element-1').dataset.radius,
      sliderValue: slider.value
    });

    return results;
  });

  console.log('Update test results:');
  for (const r of updateTest) {
    console.log(r);
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
