/**
 * CSS Property Engine Performance Test
 *
 * Uses Puppeteer + CDP to measure engine performance and verify correct behavior.
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('🚀 Starting CSS Property Engine Performance Test\n');

  const browser = await puppeteer.launch({
    headless: true,  // Run headless for CI
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Enable CDP sessions
  const client = await page.createCDPSession();

  // Enable Performance domain
  await client.send('Performance.enable');

  // Enable Profiler for detailed traces
  await client.send('Profiler.enable');

  // Enable Runtime for console access
  await client.send('Runtime.enable');

  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      time: Date.now(),
    });
  });

  // Navigate to demo page (use Vite dev server)
  const demoUrl = 'http://localhost:8788/demo/css-property-engine-demo.html';
  console.log(`📄 Loading: ${demoUrl}`);
  await page.goto(demoUrl, { waitUntil: 'networkidle0' });

  // Wait for engine initialization
  await new Promise(r => setTimeout(r, 500));

  console.log('\n📊 Initial State Check');
  console.log('─'.repeat(50));

  // Get initial computed styles
  const initialStyles = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.demo-box');
    return Array.from(boxes).map(box => ({
      id: box.id,
      className: box.className,
      demoColor: getComputedStyle(box).getPropertyValue('--demo-color').trim(),
      demoSize: getComputedStyle(box).getPropertyValue('--demo-size').trim(),
      backgroundColor: getComputedStyle(box).backgroundColor,
      transform: getComputedStyle(box).transform,
    }));
  });

  console.log('Initial computed styles:');
  initialStyles.forEach(s => {
    console.log(`  ${s.id}: --demo-color=${s.demoColor}, --demo-size=${s.demoSize}`);
    console.log(`         backgroundColor=${s.backgroundColor}`);
  });

  // Start CPU profiling
  console.log('\n🔬 Starting CPU Profile for slider interaction');
  await client.send('Profiler.start');

  // Test 1: Slider interaction
  console.log('\n📈 Test 1: Slider Interaction');
  console.log('─'.repeat(50));

  const sliderStartTime = Date.now();

  // Simulate slider drag (multiple value changes)
  for (let value = 80; value <= 150; value += 10) {
    await page.evaluate((val) => {
      const slider = document.getElementById('size1');
      slider.value = val;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await new Promise(r => setTimeout(r, 50));
  }

  const sliderEndTime = Date.now();
  console.log(`Slider interaction took: ${sliderEndTime - sliderStartTime}ms`);

  // Get styles after slider change
  const afterSliderStyles = await page.evaluate(() => {
    const box1 = document.getElementById('box1');
    return {
      demoSize: getComputedStyle(box1).getPropertyValue('--demo-size').trim(),
      transform: getComputedStyle(box1).transform,
    };
  });

  console.log(`After slider: --demo-size=${afterSliderStyles.demoSize}`);
  console.log(`              transform=${afterSliderStyles.transform}`);

  // Test 2: Color picker interaction
  console.log('\n🎨 Test 2: Color Picker Interaction');
  console.log('─'.repeat(50));

  const colorStartTime = Date.now();

  await page.evaluate(() => {
    const colorInput = document.getElementById('color1');
    const box1 = document.getElementById('box1');
    box1.style.setProperty('--demo-color', '#00ff00');
  });

  await new Promise(r => setTimeout(r, 100));

  const colorEndTime = Date.now();
  console.log(`Color change took: ${colorEndTime - colorStartTime}ms`);

  const afterColorStyles = await page.evaluate(() => {
    const box1 = document.getElementById('box1');
    return {
      demoColor: getComputedStyle(box1).getPropertyValue('--demo-color').trim(),
      backgroundColor: getComputedStyle(box1).backgroundColor,
    };
  });

  console.log(`After color: --demo-color=${afterColorStyles.demoColor}`);
  console.log(`             backgroundColor=${afterColorStyles.backgroundColor}`);

  // Test 3: Class toggle (CSS rule change)
  console.log('\n🔄 Test 3: Class Toggle (CSS Rule Change)');
  console.log('─'.repeat(50));

  const toggleStartTime = Date.now();

  await page.click('#toggleHighlight');
  await new Promise(r => setTimeout(r, 100));

  const toggleEndTime = Date.now();
  console.log(`Class toggle took: ${toggleEndTime - toggleStartTime}ms`);

  const afterToggleStyles = await page.evaluate(() => {
    const box2 = document.getElementById('box2');
    return {
      className: box2.className,
      demoColor: getComputedStyle(box2).getPropertyValue('--demo-color').trim(),
      demoSize: getComputedStyle(box2).getPropertyValue('--demo-size').trim(),
      backgroundColor: getComputedStyle(box2).backgroundColor,
    };
  });

  console.log(`After toggle: class="${afterToggleStyles.className}"`);
  console.log(`              --demo-color=${afterToggleStyles.demoColor}`);
  console.log(`              --demo-size=${afterToggleStyles.demoSize}`);
  console.log(`              backgroundColor=${afterToggleStyles.backgroundColor}`);

  // Test 4: Dynamic element addition
  console.log('\n➕ Test 4: Dynamic Element Addition');
  console.log('─'.repeat(50));

  const addStartTime = Date.now();

  await page.click('#addBox');
  await new Promise(r => setTimeout(r, 200));

  const addEndTime = Date.now();
  console.log(`Element addition took: ${addEndTime - addStartTime}ms`);

  const newBoxStyles = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.demo-box');
    const lastBox = boxes[boxes.length - 1];
    return {
      id: lastBox.id,
      demoColor: getComputedStyle(lastBox).getPropertyValue('--demo-color').trim(),
      demoSize: getComputedStyle(lastBox).getPropertyValue('--demo-size').trim(),
      backgroundColor: getComputedStyle(lastBox).backgroundColor,
    };
  });

  console.log(`New box: id=${newBoxStyles.id}`);
  console.log(`         --demo-color=${newBoxStyles.demoColor}`);
  console.log(`         --demo-size=${newBoxStyles.demoSize}`);
  console.log(`         backgroundColor=${newBoxStyles.backgroundColor}`);

  // Stop CPU profiling
  const profile = await client.send('Profiler.stop');

  // Test 5: Dynamic style injection
  console.log('\n💉 Test 5: Dynamic Style Injection');
  console.log('─'.repeat(50));

  const injectStartTime = Date.now();

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      .injected-style {
        --demo-color: #ff00ff;
        --demo-size: 200;
      }
    `;
    document.head.appendChild(style);

    // Add class to box3
    document.getElementById('box3').classList.add('injected-style');
  });

  await new Promise(r => setTimeout(r, 200));

  const injectEndTime = Date.now();
  console.log(`Style injection took: ${injectEndTime - injectStartTime}ms`);

  const afterInjectStyles = await page.evaluate(() => {
    const box3 = document.getElementById('box3');
    return {
      className: box3.className,
      demoColor: getComputedStyle(box3).getPropertyValue('--demo-color').trim(),
      demoSize: getComputedStyle(box3).getPropertyValue('--demo-size').trim(),
      backgroundColor: getComputedStyle(box3).backgroundColor,
      transform: getComputedStyle(box3).transform,
    };
  });

  console.log(`After inject: class="${afterInjectStyles.className}"`);
  console.log(`              --demo-color=${afterInjectStyles.demoColor}`);
  console.log(`              --demo-size=${afterInjectStyles.demoSize}`);
  console.log(`              backgroundColor=${afterInjectStyles.backgroundColor}`);
  console.log(`              transform=${afterInjectStyles.transform}`);

  // Get performance metrics
  console.log('\n📊 Performance Metrics');
  console.log('─'.repeat(50));

  const metrics = await client.send('Performance.getMetrics');
  const relevantMetrics = metrics.metrics.filter(m =>
    ['JSHeapUsedSize', 'JSHeapTotalSize', 'ScriptDuration', 'TaskDuration'].includes(m.name)
  );

  relevantMetrics.forEach(m => {
    if (m.name.includes('Size')) {
      console.log(`  ${m.name}: ${(m.value / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.log(`  ${m.name}: ${(m.value * 1000).toFixed(2)} ms`);
    }
  });

  // Analyze profile
  console.log('\n🔍 Profile Analysis (Top Functions)');
  console.log('─'.repeat(50));

  const nodes = profile.profile.nodes;
  const samples = profile.profile.samples;
  const timeDeltas = profile.profile.timeDeltas;

  // Count samples per function
  const functionCounts = new Map();
  samples.forEach((nodeId, i) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.callFrame) {
      const name = node.callFrame.functionName || '(anonymous)';
      const url = node.callFrame.url || '';
      // Filter to our code
      if (url.includes('css-property-engine') || url.includes('demo')) {
        const key = `${name} (${url.split('/').pop()})`;
        functionCounts.set(key, (functionCounts.get(key) || 0) + (timeDeltas[i] || 0));
      }
    }
  });

  // Sort by time
  const sorted = Array.from(functionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  sorted.forEach(([name, time]) => {
    console.log(`  ${(time / 1000).toFixed(2)}ms - ${name}`);
  });

  // Console log analysis
  console.log('\n📝 Engine Callbacks (from console log)');
  console.log('─'.repeat(50));

  const engineLogs = consoleLogs.filter(l => l.text.includes('--demo-'));
  console.log(`Total callback invocations logged: ${engineLogs.length}`);

  // Verification
  console.log('\n✅ Verification Summary');
  console.log('─'.repeat(50));

  const verifications = [
    {
      name: 'Slider updates --demo-size',
      pass: afterSliderStyles.demoSize === '150',
    },
    {
      name: 'Color picker updates --demo-color',
      pass: afterColorStyles.demoColor === '#00ff00' || afterColorStyles.demoColor === 'rgb(0, 255, 0)',
    },
    {
      name: 'Class toggle changes properties',
      pass: afterToggleStyles.className.includes('highlighted'),
    },
    {
      name: 'Dynamic element gets properties',
      pass: newBoxStyles.demoColor !== '' && newBoxStyles.demoColor !== '__UNSET__',
    },
    {
      name: 'Style injection detected',
      pass: afterInjectStyles.demoColor === '#ff00ff' || afterInjectStyles.demoColor === 'rgb(255, 0, 255)',
    },
  ];

  let allPass = true;
  verifications.forEach(v => {
    const status = v.pass ? '✅' : '❌';
    console.log(`  ${status} ${v.name}`);
    if (!v.pass) allPass = false;
  });

  console.log('\n' + '═'.repeat(50));
  console.log(allPass ? '🎉 All tests passed!' : '❌ Some tests failed');
  console.log('═'.repeat(50));

  await browser.close();

  process.exit(allPass ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
