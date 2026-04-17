#!/usr/bin/env node
/**
 * CDP Performance Profiler with Vite Dev Server
 *
 * Uses Vite for TypeScript transpilation, then profiles with CDP.
 *
 * Usage:
 *   npm run dev &  # Start Vite in background
 *   node scripts/cdp-perf-vite.mjs
 */

import puppeteer from 'puppeteer';

const VITE_URL = process.env.VITE_URL || 'http://localhost:8788/demo/css-property-engine-demo.html';
const HEADLESS = process.argv.includes('--headless');
const AUTO_INTERACT = process.argv.includes('--auto') || HEADLESS;

/**
 * Simulate user interaction with sliders and color pickers
 */
async function simulateInteraction(page) {
  const iterations = 50;

  for (let i = 0; i < iterations; i++) {
    // Simulate slider movement
    await page.evaluate((iter) => {
      const sizeSlider = document.getElementById('size1');
      if (sizeSlider) {
        sizeSlider.value = String(50 + Math.sin(iter * 0.2) * 50);
        sizeSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const colorPicker = document.getElementById('color1');
      if (colorPicker) {
        const hue = (iter * 7) % 360;
        colorPicker.value = `hsl(${hue}, 70%, 50%)`.replace(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/, (_, h, s, l) => {
          // Convert HSL to Hex
          const hVal = parseInt(h) / 360;
          const sVal = parseInt(s) / 100;
          const lVal = parseInt(l) / 100;
          const a = sVal * Math.min(lVal, 1 - lVal);
          const f = (n) => {
            const k = (n + hVal * 12) % 12;
            const color = lVal - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
          };
          return `#${f(0)}${f(8)}${f(4)}`;
        });
        colorPicker.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, i);

    await new Promise(r => setTimeout(r, 50));

    // Add new box every 10 iterations
    if (i % 10 === 9) {
      await page.click('#addBox').catch(() => {});
    }

    // Toggle highlight
    if (i % 15 === 7) {
      await page.click('#toggleHighlight').catch(() => {});
    }
  }

  console.log(`Completed ${iterations} interaction cycles.\n`);
}

async function runProfiler() {
  console.log('\n🔬 CSS Property Engine - CDP Performance Profiler');
  console.log('=' .repeat(60));
  console.log(`\nConnecting to Vite dev server at ${VITE_URL}`);
  console.log('Make sure "npm run dev" is running!\n');

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    devtools: false,
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  const client = await page.target().createCDPSession();

  // Metrics storage
  const metrics = {
    getComputedStyleCalls: [],
    querySelectors: [],
    startTime: Date.now(),
  };

  // Enable CDP domains
  await client.send('Performance.enable');
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
      'blink.user_timing',
    ].join(','),
  });

  // Inject interceptors before page loads
  await page.evaluateOnNewDocument(() => {
    // ════════════════════════════════════════════════════════════════════════
    // getComputedStyle interceptor
    // ════════════════════════════════════════════════════════════════════════
    const _getComputedStyle = window.getComputedStyle;
    window.__gcsLog = [];

    window.getComputedStyle = function(el, pseudo) {
      const err = new Error();
      const stack = err.stack?.split('\n').slice(2, 7).map(s => s.trim()) || [];

      window.__gcsLog.push({
        t: performance.now(),
        el: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        stack,
      });

      // Cap at 2000 entries
      if (window.__gcsLog.length > 2000) window.__gcsLog.shift();

      return _getComputedStyle.call(this, el, pseudo);
    };

    // ════════════════════════════════════════════════════════════════════════
    // querySelectorAll interceptor
    // ════════════════════════════════════════════════════════════════════════
    const _querySelectorAll = Document.prototype.querySelectorAll;
    window.__qsaLog = [];

    Document.prototype.querySelectorAll = function(selector) {
      const err = new Error();
      const stack = err.stack?.split('\n').slice(2, 5).map(s => s.trim()) || [];

      window.__qsaLog.push({
        t: performance.now(),
        selector,
        stack,
      });

      if (window.__qsaLog.length > 2000) window.__qsaLog.shift();

      return _querySelectorAll.call(this, selector);
    };

    // ════════════════════════════════════════════════════════════════════════
    // setAttribute interceptor (for filter updates)
    // ════════════════════════════════════════════════════════════════════════
    const _setAttribute = Element.prototype.setAttribute;
    window.__setAttrLog = [];

    Element.prototype.setAttribute = function(name, value) {
      if (name === 'href' || name === 'stdDeviation' || name === 'scale' || name === 'values') {
        window.__setAttrLog.push({
          t: performance.now(),
          el: this.tagName,
          attr: name,
          valueLen: String(value).length,
        });
        if (window.__setAttrLog.length > 2000) window.__setAttrLog.shift();
      }
      return _setAttribute.call(this, name, value);
    };
  });

  // Navigate
  try {
    await page.goto(VITE_URL, { waitUntil: 'networkidle0', timeout: 10000 });
  } catch (e) {
    console.error('❌ Failed to connect. Is Vite running? (npm run dev)');
    await browser.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 1000));

  if (AUTO_INTERACT) {
    console.log('🤖 Auto-interaction mode: simulating user input...\n');
    await simulateInteraction(page);
  } else {
    console.log('✅ Page loaded. Interact with sliders/color pickers.');
    console.log('─'.repeat(60));
    console.log('Press Ctrl+C to stop and view analysis.\n');
  }

  // Periodic collection
  const collect = async () => {
    try {
      const gcs = await page.evaluate(() => {
        const log = window.__gcsLog || [];
        window.__gcsLog = [];
        return log;
      });
      metrics.getComputedStyleCalls.push(...gcs);

      const qsa = await page.evaluate(() => {
        const log = window.__qsaLog || [];
        window.__qsaLog = [];
        return log;
      });
      metrics.querySelectors.push(...qsa);
    } catch {}
  };

  const interval = setInterval(collect, 500);

  // Cleanup handler
  const analyze = async () => {
    clearInterval(interval);
    await collect();

    // Stop tracing
    const traceChunks = [];
    client.on('Tracing.dataCollected', ({ value }) => traceChunks.push(...value));
    await new Promise(resolve => {
      client.on('Tracing.tracingComplete', resolve);
      client.send('Tracing.end');
    });

    const duration = (Date.now() - metrics.startTime) / 1000;

    console.log('\n\n' + '═'.repeat(60));
    console.log('📊 PERFORMANCE ANALYSIS RESULTS');
    console.log('═'.repeat(60));
    console.log(`Duration: ${duration.toFixed(1)}s\n`);

    // ════════════════════════════════════════════════════════════════════════
    // getComputedStyle Analysis
    // ════════════════════════════════════════════════════════════════════════
    console.log('📌 getComputedStyle');
    console.log('─'.repeat(60));
    console.log(`Total calls: ${metrics.getComputedStyleCalls.length}`);
    console.log(`Rate: ${(metrics.getComputedStyleCalls.length / duration).toFixed(1)}/sec`);

    // Group by stack
    const gcsGroups = new Map();
    for (const call of metrics.getComputedStyleCalls) {
      const key = call.stack.slice(0, 3).join(' | ');
      if (!gcsGroups.has(key)) {
        gcsGroups.set(key, { count: 0, stack: call.stack, elements: new Set() });
      }
      const g = gcsGroups.get(key);
      g.count++;
      g.elements.add(call.el);
    }

    const sortedGcs = [...gcsGroups.entries()].sort((a, b) => b[1].count - a[1].count);

    console.log('\nHotspots (top 5):');
    for (const [, data] of sortedGcs.slice(0, 5)) {
      console.log(`\n  ${data.count}× (${data.elements.size} elements)`);
      for (const line of data.stack.slice(0, 3)) {
        // Extract file:line from stack
        const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) ||
                      line.match(/at\s+(.+?):(\d+):(\d+)/);
        if (match) {
          console.log(`    → ${match[1] || ''} ${match[2] || match[1]}:${match[3] || match[2]}`);
        } else {
          console.log(`    → ${line}`);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // querySelectorAll Analysis
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n\n📌 querySelectorAll');
    console.log('─'.repeat(60));
    console.log(`Total calls: ${metrics.querySelectors.length}`);

    // Group by selector
    const qsaGroups = new Map();
    for (const call of metrics.querySelectors) {
      if (!qsaGroups.has(call.selector)) {
        qsaGroups.set(call.selector, { count: 0, stack: call.stack });
      }
      qsaGroups.get(call.selector).count++;
    }

    const sortedQsa = [...qsaGroups.entries()].sort((a, b) => b[1].count - a[1].count);
    console.log('\nFrequent selectors:');
    for (const [selector, data] of sortedQsa.slice(0, 5)) {
      console.log(`  ${data.count}×  ${selector.slice(0, 60)}${selector.length > 60 ? '...' : ''}`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Trace Analysis
    // ════════════════════════════════════════════════════════════════════════
    const styleRecalcs = traceChunks.filter(e => e.name === 'UpdateLayoutTree' || e.name === 'RecalculateStyles');
    const layouts = traceChunks.filter(e => e.name === 'Layout');
    const paints = traceChunks.filter(e => e.name === 'Paint');

    console.log('\n\n📌 Rendering Pipeline');
    console.log('─'.repeat(60));
    console.log(`Style recalculations: ${styleRecalcs.length} (${(styleRecalcs.length / duration).toFixed(1)}/sec)`);
    console.log(`Layouts:              ${layouts.length} (${(layouts.length / duration).toFixed(1)}/sec)`);
    console.log(`Paints:               ${paints.length} (${(paints.length / duration).toFixed(1)}/sec)`);

    if (styleRecalcs.length > 0) {
      const durations = styleRecalcs.map(e => (e.dur || 0) / 1000);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const max = Math.max(...durations);
      console.log(`\nStyle recalc timing: avg ${avg.toFixed(2)}ms, max ${max.toFixed(2)}ms`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Recommendations
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n\n💡 OPTIMIZATION OPPORTUNITIES');
    console.log('─'.repeat(60));

    const recommendations = [];

    // Check getComputedStyle hotspots
    if (sortedGcs.length > 0 && sortedGcs[0][1].count > 50) {
      const hotspot = sortedGcs[0][1];
      const file = hotspot.stack[0]?.match(/([^/]+\.(?:ts|js)):\d+/)?.[1] || 'unknown';
      recommendations.push({
        severity: '🔴 HIGH',
        issue: `Excessive getComputedStyle: ${hotspot.count} calls`,
        location: file,
        fix: 'Cache borderRadius/style values instead of reading on each update',
      });
    }

    // Check for redundant querySelectorAll
    for (const [selector, data] of sortedQsa.slice(0, 3)) {
      if (data.count > 20 && selector.includes('[style]')) {
        recommendations.push({
          severity: '🟡 MEDIUM',
          issue: `querySelectorAll("${selector}") called ${data.count}×`,
          fix: 'Maintain a Set of tracked elements instead of re-querying',
        });
      }
    }

    // Check style recalc rate
    const recalcRate = styleRecalcs.length / duration;
    if (recalcRate > 60) {
      recommendations.push({
        severity: '🟡 MEDIUM',
        issue: `High style recalc rate: ${recalcRate.toFixed(0)}/sec`,
        fix: 'Batch DOM reads/writes, use requestAnimationFrame',
      });
    }

    if (recommendations.length === 0) {
      console.log('✅ No critical issues found. Performance looks good!');
    } else {
      for (const rec of recommendations) {
        console.log(`\n${rec.severity}: ${rec.issue}`);
        if (rec.location) console.log(`   Location: ${rec.location}`);
        console.log(`   Fix: ${rec.fix}`);
      }
    }

    console.log('\n' + '═'.repeat(60) + '\n');

    await browser.close();
    process.exit(0);
  };

  process.on('SIGINT', analyze);

  if (AUTO_INTERACT) {
    // Auto mode: analyze immediately after simulation
    await analyze();
  } else {
    // Interactive mode: wait for Ctrl+C or timeout
    setTimeout(() => {
      console.log('\n⏱ Auto-stopping after 3 minutes...');
      analyze();
    }, 3 * 60 * 1000);
  }
}

runProfiler().catch(console.error);
