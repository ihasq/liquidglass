/**
 * CDP Debug Script - border-radius issue investigation
 *
 * Uses Puppeteer to:
 * 1. Open parameter-lab.html
 * 2. Change border-radius slider
 * 3. Capture performance trace with call stacks
 */

import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable CDP sessions
  const client = await page.target().createCDPSession();

  // Enable performance tracing
  await client.send('Performance.enable');

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  // Wait for glass effect to initialize
  await new Promise(r => setTimeout(r, 2000));

  console.log('Initial state - checking glass-panel computed styles...');

  // Check initial state
  const initialState = await page.evaluate(() => {
    const glass = document.querySelector('.glass-panel');
    const computed = getComputedStyle(glass);
    return {
      borderRadius: computed.borderRadius,
      borderTopLeftRadius: computed.borderTopLeftRadius,
      backdropFilter: computed.backdropFilter,
      inlineStyle: glass.style.cssText
    };
  });
  console.log('Initial state:', initialState);

  // Start performance tracing
  console.log('\nStarting performance trace...');
  await client.send('Tracing.start', {
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'v8.execute',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-v8.cpu_profiler'
      ],
      enableSampling: true,
      enableSystrace: false,
    }
  });

  // Select element-1 by clicking
  console.log('Clicking on element-1 to select it...');
  await page.click('#element-1');
  await new Promise(r => setTimeout(r, 500));

  // Now change border-radius slider
  console.log('Changing border-radius slider from 24 to 50...');

  // Get initial border-radius
  const beforeChange = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    return {
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      sliderValue: document.getElementById('radius').value
    };
  });
  console.log('Before change:', beforeChange);

  // Change slider value
  await page.evaluate(() => {
    const slider = document.getElementById('radius');
    slider.value = '50';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Wait for potential updates
  await new Promise(r => setTimeout(r, 500));

  // Check after change
  const afterChange = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    return {
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      sliderValue: document.getElementById('radius').value,
      datasetRadius: document.getElementById('element-1').dataset.radius
    };
  });
  console.log('After change:', afterChange);

  // Stop tracing and get trace data
  const traceData = await new Promise((resolve) => {
    const chunks = [];
    client.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
    client.on('Tracing.tracingComplete', () => resolve(chunks));
    client.send('Tracing.end');
  });

  // Analyze trace for relevant function calls
  console.log('\n=== TRACE ANALYSIS ===');
  console.log(`Total trace events: ${traceData.length}`);

  // Find function calls related to liquidglass, FilterManager, MutationObserver
  const relevantEvents = traceData.filter(event => {
    if (event.cat === 'devtools.timeline' && event.name === 'FunctionCall') {
      const stack = event.args?.data?.stackTrace || [];
      return stack.some(frame =>
        frame.url?.includes('liquidglass') ||
        frame.functionName?.includes('FilterManager') ||
        frame.functionName?.includes('mutation') ||
        frame.functionName?.includes('Observer') ||
        frame.functionName?.includes('styleObserver') ||
        frame.functionName?.includes('_scheduleRender') ||
        frame.functionName?.includes('_render') ||
        frame.functionName?.includes('borderRadius')
      );
    }
    return false;
  });

  console.log(`\nRelevant function calls: ${relevantEvents.length}`);

  // Group by unique call stacks
  const uniqueStacks = new Map();
  for (const event of relevantEvents) {
    const stack = event.args?.data?.stackTrace || [];
    const key = stack.map(f => `${f.functionName}@${f.url?.split('/').pop()}:${f.lineNumber}`).join(' -> ');
    if (!uniqueStacks.has(key)) {
      uniqueStacks.set(key, { count: 0, stack });
    }
    uniqueStacks.get(key).count++;
  }

  console.log('\nUnique call stacks (showing top 20):');
  const sortedStacks = [...uniqueStacks.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, data] of sortedStacks.slice(0, 20)) {
    console.log(`\n[Count: ${data.count}]`);
    for (const frame of data.stack.slice(0, 5)) {
      console.log(`  ${frame.functionName || '(anonymous)'} @ ${frame.url?.split('/').pop() || '?'}:${frame.lineNumber}`);
    }
  }

  // Now specifically test if MutationObserver fires for style change
  console.log('\n=== MUTATION OBSERVER TEST ===');

  const mutationTest = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const glass = document.querySelector('#element-1 .glass-panel');
      const results = {
        observerCreated: false,
        styleChangeFired: false,
        events: []
      };

      // Create test observer
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          results.events.push({
            type: m.type,
            attributeName: m.attributeName,
            oldValue: m.oldValue,
            target: m.target.className
          });
          if (m.attributeName === 'style') {
            results.styleChangeFired = true;
          }
        }
      });

      observer.observe(glass, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
      results.observerCreated = true;

      // Change border-radius via style
      const prevStyle = glass.style.borderRadius;
      glass.style.borderRadius = '60px';

      // Wait for observer to fire (async)
      setTimeout(() => {
        observer.disconnect();
        results.finalBorderRadius = glass.style.borderRadius;
        results.prevBorderRadius = prevStyle;
        resolve(results);
      }, 100);
    });
  });

  console.log('Mutation test results:', mutationTest);

  // Check if FilterManager's styleObserver is set up
  console.log('\n=== FILTER MANAGER STATE CHECK ===');

  const fmState = await page.evaluate(() => {
    // Try to access the FilterManager state via window or module
    const glass = document.querySelector('#element-1 .glass-panel');

    // Check if element has marker element (sign of FilterManager attachment)
    const marker = glass.querySelector('span[class^="_lg"]');

    // Check backdrop-filter
    const computed = getComputedStyle(glass);

    // Check if there's an SVG filter defined
    const svgDefs = document.querySelector('svg[aria-hidden="true"] defs');
    const filterCount = svgDefs ? svgDefs.querySelectorAll('filter').length : 0;

    return {
      hasMarker: !!marker,
      markerClass: marker?.className,
      backdropFilter: computed.backdropFilter,
      svgFilterCount: filterCount,
      currentBorderRadius: computed.borderRadius,
      inlineStyleBorderRadius: glass.style.borderRadius
    };
  });

  console.log('FilterManager state:', fmState);

  // Final test: Change via slider and check if displacement map updates
  console.log('\n=== DISPLACEMENT MAP UPDATE TEST ===');

  await page.evaluate(() => {
    // Reset border-radius
    const slider = document.getElementById('radius');
    slider.value = '24';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 300));

  const beforeSVG = await page.evaluate(() => {
    const filter = document.querySelector('svg[aria-hidden="true"] defs filter');
    if (!filter) return null;
    const dispImage = filter.querySelector('feImage[result="dImgNew"]');
    return dispImage?.getAttribute('href')?.slice(0, 100);
  });

  // Change border-radius significantly
  await page.evaluate(() => {
    const slider = document.getElementById('radius');
    slider.value = '80';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 500));

  const afterSVG = await page.evaluate(() => {
    const filter = document.querySelector('svg[aria-hidden="true"] defs filter');
    if (!filter) return null;
    const dispImage = filter.querySelector('feImage[result="dImgNew"]');
    return dispImage?.getAttribute('href')?.slice(0, 100);
  });

  console.log('Before slider change (first 100 chars of data URL):', beforeSVG);
  console.log('After slider change (first 100 chars of data URL):', afterSVG);
  console.log('Data URL changed:', beforeSVG !== afterSVG);

  // Check final computed style
  const finalState = await page.evaluate(() => {
    const glass = document.querySelector('#element-1 .glass-panel');
    return {
      inlineStyle: glass.style.borderRadius,
      computed: getComputedStyle(glass).borderRadius,
      sliderValue: document.getElementById('radius').value
    };
  });
  console.log('Final state:', finalState);

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
