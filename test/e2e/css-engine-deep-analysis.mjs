/**
 * Deep Performance Analysis for CSS Property Engine
 *
 * Analyzes:
 * - getComputedStyle call frequency and cost
 * - Stack traces during style changes
 * - Layout thrashing patterns
 * - Memory allocation patterns
 */

import puppeteer from 'puppeteer';

async function runDeepAnalysis() {
  console.log('🔬 CSS Property Engine Deep Performance Analysis\n');
  console.log('═'.repeat(70));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const client = await page.createCDPSession();

  // Enable detailed tracing
  await client.send('Performance.enable');
  await client.send('Profiler.enable');
  await client.send('Runtime.enable');
  await client.send('Debugger.enable');

  // Track getComputedStyle calls
  const computedStyleCalls = [];
  let instrumentationEnabled = false;

  // Navigate
  await page.goto('http://localhost:8788/demo/css-property-engine-demo.html', {
    waitUntil: 'networkidle0'
  });

  await new Promise(r => setTimeout(r, 500));

  // Inject instrumentation for getComputedStyle tracking
  await page.evaluate(() => {
    window.__perfData = {
      getComputedStyleCalls: [],
      mutationCallbacks: 0,
      rafCallbacks: 0,
      lastCallStack: null,
    };

    // Wrap getComputedStyle
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(element, pseudoElt) {
      const stack = new Error().stack;
      const start = performance.now();
      const result = originalGetComputedStyle.call(this, element, pseudoElt);
      const end = performance.now();

      window.__perfData.getComputedStyleCalls.push({
        time: end - start,
        elementId: element.id || element.className,
        stack: stack.split('\n').slice(1, 5).join('\n'),
        timestamp: performance.now(),
      });

      return result;
    };

    // Track RAF calls
    const originalRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
      window.__perfData.rafCallbacks++;
      return originalRAF.call(this, callback);
    };
  });

  console.log('\n📊 Test 1: Rapid Slider Interaction (Stress Test)');
  console.log('─'.repeat(70));

  // Clear metrics
  await page.evaluate(() => {
    window.__perfData.getComputedStyleCalls = [];
    window.__perfData.rafCallbacks = 0;
  });

  // Start CPU profile
  await client.send('Profiler.start');

  const stressStartTime = Date.now();

  // Rapid slider changes (60 changes = simulating 1 second of drag at 60fps)
  for (let i = 0; i < 60; i++) {
    const value = 80 + Math.sin(i * 0.1) * 35;
    await page.evaluate((val) => {
      const slider = document.getElementById('size1');
      slider.value = val;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await new Promise(r => setTimeout(r, 16)); // ~60fps
  }

  const stressEndTime = Date.now();

  // Stop profiling
  const profile = await client.send('Profiler.stop');

  // Get metrics
  const stressMetrics = await page.evaluate(() => {
    const data = window.__perfData;
    const calls = data.getComputedStyleCalls;

    // Group calls by source (stack)
    const bySource = {};
    for (const call of calls) {
      const key = call.stack.includes('_checkElement') ? '_checkElement' :
                  call.stack.includes('_mightHave') ? '_mightHaveRegisteredProperties' :
                  call.stack.includes('demo.html') ? 'demo-callback' : 'other';
      bySource[key] = (bySource[key] || 0) + 1;
    }

    return {
      totalCalls: calls.length,
      totalTime: calls.reduce((sum, c) => sum + c.time, 0),
      avgTime: calls.length > 0 ? calls.reduce((sum, c) => sum + c.time, 0) / calls.length : 0,
      maxTime: calls.length > 0 ? Math.max(...calls.map(c => c.time)) : 0,
      bySource,
      rafCallbacks: data.rafCallbacks,
      sampleStacks: calls.slice(0, 3).map(c => c.stack),
    };
  });

  console.log(`Duration: ${stressEndTime - stressStartTime}ms (60 slider events)`);
  console.log(`\ngetComputedStyle Analysis:`);
  console.log(`  Total calls: ${stressMetrics.totalCalls}`);
  console.log(`  Total time: ${stressMetrics.totalTime.toFixed(2)}ms`);
  console.log(`  Avg per call: ${stressMetrics.avgTime.toFixed(3)}ms`);
  console.log(`  Max single call: ${stressMetrics.maxTime.toFixed(3)}ms`);
  console.log(`  RAF callbacks: ${stressMetrics.rafCallbacks}`);
  console.log(`\nCalls by source:`);
  for (const [source, count] of Object.entries(stressMetrics.bySource)) {
    console.log(`    ${source}: ${count}`);
  }

  // Profile analysis
  console.log('\n📈 CPU Profile Hotspots:');
  console.log('─'.repeat(70));

  const nodes = profile.profile.nodes;
  const samples = profile.profile.samples;
  const timeDeltas = profile.profile.timeDeltas;

  // Aggregate time by function
  const functionTimes = new Map();
  samples.forEach((nodeId, i) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.callFrame) {
      const name = node.callFrame.functionName || '(anonymous)';
      const url = node.callFrame.url || '';

      // Filter to relevant code
      if (url.includes('css-property-engine') || url.includes('demo') || !url) {
        const key = `${name}`;
        const time = timeDeltas[i] || 0;
        functionTimes.set(key, (functionTimes.get(key) || 0) + time);
      }
    }
  });

  // Sort and display top functions
  const sorted = Array.from(functionTimes.entries())
    .filter(([name]) => name !== '(idle)' && name !== '(program)')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  sorted.forEach(([name, time]) => {
    const percentage = ((time / 1000) / (stressEndTime - stressStartTime) * 100).toFixed(1);
    console.log(`  ${(time / 1000).toFixed(2)}ms (${percentage}%) - ${name}`);
  });

  // Test 2: Style injection stress
  console.log('\n\n📊 Test 2: Dynamic Style Injection');
  console.log('─'.repeat(70));

  await page.evaluate(() => {
    window.__perfData.getComputedStyleCalls = [];
    window.__perfData.rafCallbacks = 0;
  });

  const injectStartTime = Date.now();

  // Inject multiple style rules rapidly
  for (let i = 0; i < 10; i++) {
    await page.evaluate((idx) => {
      const style = document.createElement('style');
      style.textContent = `
        .dynamic-${idx} {
          --demo-color: hsl(${idx * 36}, 70%, 50%);
          --demo-size: ${100 + idx * 5};
        }
      `;
      document.head.appendChild(style);
    }, i);
    await new Promise(r => setTimeout(r, 20));
  }

  const injectEndTime = Date.now();

  const injectMetrics = await page.evaluate(() => {
    return {
      totalCalls: window.__perfData.getComputedStyleCalls.length,
      totalTime: window.__perfData.getComputedStyleCalls.reduce((sum, c) => sum + c.time, 0),
      rafCallbacks: window.__perfData.rafCallbacks,
    };
  });

  console.log(`Duration: ${injectEndTime - injectStartTime}ms (10 style injections)`);
  console.log(`getComputedStyle calls: ${injectMetrics.totalCalls}`);
  console.log(`Total getComputedStyle time: ${injectMetrics.totalTime.toFixed(2)}ms`);

  // Test 3: Layout thrashing detection
  console.log('\n\n📊 Test 3: Layout Thrashing Analysis');
  console.log('─'.repeat(70));

  await page.evaluate(() => {
    window.__perfData.getComputedStyleCalls = [];
    window.__layoutReads = 0;
    window.__layoutWrites = 0;

    // Track layout-triggering operations
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      get() {
        window.__layoutReads++;
        return originalOffsetWidth.get.call(this);
      }
    });
  });

  // Simulate interleaved reads/writes
  await page.evaluate(() => {
    const boxes = document.querySelectorAll('.demo-box');
    for (const box of boxes) {
      // This pattern causes layout thrashing:
      // read -> write -> read -> write
      const width = box.offsetWidth; // Read
      box.style.setProperty('--demo-size', '110'); // Write
      const newWidth = box.offsetWidth; // Force layout
    }
  });

  const thrashMetrics = await page.evaluate(() => ({
    layoutReads: window.__layoutReads,
    computedStyleCalls: window.__perfData.getComputedStyleCalls.length,
  }));

  console.log(`Layout reads (offsetWidth): ${thrashMetrics.layoutReads}`);
  console.log(`getComputedStyle calls during test: ${thrashMetrics.computedStyleCalls}`);

  // Memory analysis
  console.log('\n\n📊 Test 4: Memory Analysis');
  console.log('─'.repeat(70));

  const heapBefore = await page.evaluate(() => {
    if (window.gc) window.gc();
    return performance.memory?.usedJSHeapSize || 0;
  });

  // Add many elements
  await page.evaluate(() => {
    const container = document.getElementById('container');
    for (let i = 0; i < 100; i++) {
      const box = document.createElement('div');
      box.className = 'demo-box';
      box.id = `stress-box-${i}`;
      box.style.setProperty('--demo-color', `hsl(${i * 3.6}, 70%, 50%)`);
      box.style.setProperty('--demo-size', `${80 + (i % 40)}`);
      box.textContent = `Box ${i}`;
      container.appendChild(box);
    }
  });

  await new Promise(r => setTimeout(r, 500));

  const heapAfter = await page.evaluate(() => {
    return performance.memory?.usedJSHeapSize || 0;
  });

  console.log(`Heap before: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap after: ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Delta: ${((heapAfter - heapBefore) / 1024).toFixed(2)} KB`);

  const engineState = await page.evaluate(() => {
    const engine = window.__cssPropertyEngine;
    return engine ? {
      trackedElements: engine._trackedElements?.size || 0,
      pendingChecks: engine._pendingChecks?.size || 0,
      selectorCacheSize: engine._selectorCache?.size || 0,
    } : null;
  });

  if (engineState) {
    console.log(`\nEngine State:`);
    console.log(`  Tracked elements: ${engineState.trackedElements}`);
    console.log(`  Pending checks: ${engineState.pendingChecks}`);
    console.log(`  Selector cache size: ${engineState.selectorCacheSize}`);
  }

  // Summary and recommendations
  console.log('\n\n' + '═'.repeat(70));
  console.log('📋 OPTIMIZATION OPPORTUNITIES');
  console.log('═'.repeat(70));

  const opportunities = [];

  // Analyze getComputedStyle calls
  if (stressMetrics.totalCalls > 60) {
    opportunities.push({
      severity: 'HIGH',
      area: 'getComputedStyle batching',
      detail: `${stressMetrics.totalCalls} calls for 60 events. Consider batching reads.`,
      suggestion: 'Read all properties in one getComputedStyle call per element per frame',
    });
  }

  if (stressMetrics.avgTime > 0.5) {
    opportunities.push({
      severity: 'MEDIUM',
      area: 'getComputedStyle cost',
      detail: `Average ${stressMetrics.avgTime.toFixed(3)}ms per call`,
      suggestion: 'Cache computed style references within RAF callback',
    });
  }

  if (injectMetrics.totalCalls > 50) {
    opportunities.push({
      severity: 'MEDIUM',
      area: 'Style injection handling',
      detail: `${injectMetrics.totalCalls} getComputedStyle calls for 10 style injections`,
      suggestion: 'Debounce style injection scanning more aggressively',
    });
  }

  if (thrashMetrics.layoutReads > 3) {
    opportunities.push({
      severity: 'LOW',
      area: 'Layout thrashing',
      detail: `${thrashMetrics.layoutReads} layout reads detected`,
      suggestion: 'Batch layout reads before writes in callbacks',
    });
  }

  // Additional suggestions based on code analysis
  opportunities.push({
    severity: 'INFO',
    area: 'CSS.supports check',
    detail: 'No feature detection for @property support',
    suggestion: 'Add CSS.supports("@property", "--x") fallback path',
  });

  opportunities.push({
    severity: 'INFO',
    area: 'Weak reference for cache',
    detail: 'Selector cache uses strong references',
    suggestion: 'Consider WeakRef for cached element arrays to allow GC',
  });

  for (const opp of opportunities) {
    const icon = opp.severity === 'HIGH' ? '🔴' :
                 opp.severity === 'MEDIUM' ? '🟡' :
                 opp.severity === 'LOW' ? '🟢' : '💡';
    console.log(`\n${icon} [${opp.severity}] ${opp.area}`);
    console.log(`   Issue: ${opp.detail}`);
    console.log(`   Suggestion: ${opp.suggestion}`);
  }

  // Sample stack traces
  if (stressMetrics.sampleStacks && stressMetrics.sampleStacks.length > 0) {
    console.log('\n\n📚 Sample getComputedStyle Stack Traces:');
    console.log('─'.repeat(70));
    stressMetrics.sampleStacks.forEach((stack, i) => {
      console.log(`\n[${i + 1}]`);
      console.log(stack);
    });
  }

  await browser.close();

  console.log('\n\n✅ Deep analysis complete');
}

runDeepAnalysis().catch(err => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
