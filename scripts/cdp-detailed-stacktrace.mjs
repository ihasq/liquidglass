#!/usr/bin/env node
/**
 * CDP Detailed Stack Trace Analysis
 *
 * Captures detailed function-level timing and call graphs
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const DEMO_URL = 'http://localhost:5173/demo/parameter-lab.html';

async function startDevServer() {
  console.log('Starting Vite dev server...');
  const server = spawn('npx', ['vite', '--port', '5173'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server timeout')), 30000);
    server.stdout.on('data', (data) => {
      const str = data.toString();
      if (str.includes('Local:') || str.includes('ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('error', reject);
  });

  return server;
}

async function runDetailedTrace() {
  let server;
  let browser;

  try {
    server = await startDevServer();
    await sleep(2000);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    const client = await page.target().createCDPSession();

    // Inject detailed timing instrumentation
    await page.evaluateOnNewDocument(() => {
      window.__functionTimings = new Map();
      window.__callStack = [];
      window.__resizeTimeline = [];

      // Wrap critical functions for timing
      const wrapFunction = (obj, name, label) => {
        const original = obj[name];
        if (typeof original !== 'function') return;

        obj[name] = function(...args) {
          const start = performance.now();
          window.__callStack.push(label);

          try {
            const result = original.apply(this, args);

            // Handle promises
            if (result && typeof result.then === 'function') {
              return result.then(r => {
                const duration = performance.now() - start;
                recordTiming(label, duration);
                window.__callStack.pop();
                return r;
              });
            }

            const duration = performance.now() - start;
            recordTiming(label, duration);
            return result;
          } finally {
            window.__callStack.pop();
          }
        };
      };

      function recordTiming(label, duration) {
        if (!window.__functionTimings.has(label)) {
          window.__functionTimings.set(label, {
            count: 0,
            totalTime: 0,
            maxTime: 0,
            samples: []
          });
        }
        const entry = window.__functionTimings.get(label);
        entry.count++;
        entry.totalTime += duration;
        entry.maxTime = Math.max(entry.maxTime, duration);
        if (entry.samples.length < 100) {
          entry.samples.push({ duration, stack: [...window.__callStack] });
        }
      }

      // Track toDataURL specifically
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const start = performance.now();
        const result = origToDataURL.apply(this, args);
        const duration = performance.now() - start;
        recordTiming('toDataURL', duration);

        // Track canvas size
        window.__resizeTimeline.push({
          ts: performance.now(),
          event: 'toDataURL',
          w: this.width,
          h: this.height,
          duration
        });

        return result;
      };

      // Track getComputedStyle
      const origGCS = window.getComputedStyle;
      window.getComputedStyle = function(el, ...args) {
        const start = performance.now();
        const result = origGCS.call(this, el, ...args);
        const duration = performance.now() - start;
        recordTiming('getComputedStyle', duration);
        return result;
      };

      // Track getBoundingClientRect
      const origGBCR = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        const start = performance.now();
        const result = origGBCR.call(this);
        const duration = performance.now() - start;
        recordTiming('getBoundingClientRect', duration);
        return result;
      };

      // Track setAttribute
      const origSetAttr = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        const start = performance.now();
        const result = origSetAttr.call(this, name, value);
        const duration = performance.now() - start;
        recordTiming('setAttribute', duration);
        return result;
      };

      // Track ResizeObserver callbacks
      window.__resizeCallbacks = [];
      const OrigRO = ResizeObserver;
      window.ResizeObserver = class extends OrigRO {
        constructor(callback) {
          super((entries, observer) => {
            const start = performance.now();
            window.__resizeTimeline.push({
              ts: start,
              event: 'ResizeObserver.callback.start',
              entries: entries.length
            });

            callback(entries, observer);

            const duration = performance.now() - start;
            recordTiming('ResizeObserver.callback', duration);
            window.__resizeTimeline.push({
              ts: performance.now(),
              event: 'ResizeObserver.callback.end',
              duration
            });
          });
        }
      };
    });

    await page.goto(DEMO_URL, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Instrument the FilterManager methods after page load
    await page.evaluate(() => {
      // Try to access FilterManager via the global or module
      if (window._filterManager) {
        const fm = window._filterManager;
        const methods = ['_render', '_scheduleRender', '_renderWithRefreshRate', '_stretchFilter'];
        for (const method of methods) {
          if (fm[method]) {
            const orig = fm[method].bind(fm);
            fm[method] = function(...args) {
              const start = performance.now();
              const result = orig(...args);
              if (result && typeof result.then === 'function') {
                return result.then(r => {
                  const duration = performance.now() - start;
                  if (!window.__functionTimings.has(method)) {
                    window.__functionTimings.set(method, { count: 0, totalTime: 0, maxTime: 0, samples: [] });
                  }
                  const entry = window.__functionTimings.get(method);
                  entry.count++;
                  entry.totalTime += duration;
                  entry.maxTime = Math.max(entry.maxTime, duration);
                  return r;
                });
              }
              return result;
            };
          }
        }
      }
    });

    console.log('\n========================================');
    console.log('DETAILED STACK TRACE ANALYSIS');
    console.log('========================================\n');

    // Get resize handle position
    const handlePos = await page.evaluate(() => {
      const el = document.querySelector('#element-1');
      if (!el) return null;
      const handle = el.querySelector('.resize-handle.se');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (!handlePos) throw new Error('Could not find resize handle');

    // Clear any existing data
    await page.evaluate(() => {
      window.__functionTimings.clear();
      window.__resizeTimeline = [];
    });

    console.log('Starting precise resize measurement...');

    // Perform controlled resize
    await page.mouse.move(handlePos.x, handlePos.y);
    await page.mouse.down();

    const resizeStart = Date.now();
    const steps = 30;
    const stepDelay = 50;

    for (let i = 0; i < steps; i++) {
      const dx = i * 5; // 5px per step
      const dy = i * 4;
      await page.mouse.move(handlePos.x + dx, handlePos.y + dy);
      await sleep(stepDelay);
    }

    await page.mouse.up();
    await sleep(500);

    const totalDuration = Date.now() - resizeStart;

    // Collect results
    const timings = await page.evaluate(() => {
      const result = {};
      for (const [key, value] of window.__functionTimings) {
        result[key] = {
          count: value.count,
          totalTime: value.totalTime.toFixed(2),
          avgTime: (value.totalTime / value.count).toFixed(2),
          maxTime: value.maxTime.toFixed(2),
        };
      }
      return result;
    });

    const timeline = await page.evaluate(() => window.__resizeTimeline);

    console.log(`\nResize completed: ${steps} steps in ${totalDuration}ms`);
    console.log(`Expected frame budget: ${steps * 16.67}ms (60fps)`);

    console.log('\n📌 Function Timing Breakdown');
    console.log('═'.repeat(70));

    const sortedTimings = Object.entries(timings)
      .sort((a, b) => parseFloat(b[1].totalTime) - parseFloat(a[1].totalTime));

    console.log(`${'Function'.padEnd(35)} ${'Count'.padStart(8)} ${'Total(ms)'.padStart(12)} ${'Avg(ms)'.padStart(10)} ${'Max(ms)'.padStart(10)}`);
    console.log('─'.repeat(70));

    for (const [name, data] of sortedTimings) {
      console.log(`${name.padEnd(35)} ${data.count.toString().padStart(8)} ${data.totalTime.padStart(12)} ${data.avgTime.padStart(10)} ${data.maxTime.padStart(10)}`);
    }

    // Timeline analysis
    console.log('\n\n📌 Resize Event Timeline (sample)');
    console.log('═'.repeat(70));

    const toDataURLEvents = timeline.filter(e => e.event === 'toDataURL');
    const roCallbacks = timeline.filter(e => e.event === 'ResizeObserver.callback.end');

    if (toDataURLEvents.length > 0) {
      console.log(`\ntoDataURL calls: ${toDataURLEvents.length}`);
      console.log('Canvas sizes used:');
      const sizes = new Map();
      for (const e of toDataURLEvents) {
        const key = `${e.w}x${e.h}`;
        sizes.set(key, (sizes.get(key) || 0) + 1);
      }
      for (const [size, count] of sizes) {
        console.log(`  ${size}: ${count} times`);
      }

      const totalToDataURL = toDataURLEvents.reduce((s, e) => s + e.duration, 0);
      const avgToDataURL = totalToDataURL / toDataURLEvents.length;
      console.log(`Total toDataURL time: ${totalToDataURL.toFixed(1)}ms`);
      console.log(`Average per call: ${avgToDataURL.toFixed(2)}ms`);
    }

    if (roCallbacks.length > 0) {
      console.log(`\nResizeObserver callbacks: ${roCallbacks.length}`);
      const totalRO = roCallbacks.reduce((s, e) => s + e.duration, 0);
      const avgRO = totalRO / roCallbacks.length;
      console.log(`Total callback time: ${totalRO.toFixed(1)}ms`);
      console.log(`Average per callback: ${avgRO.toFixed(2)}ms`);
    }

    // Calculate bottleneck percentages
    console.log('\n\n📌 Time Budget Analysis');
    console.log('═'.repeat(70));

    const budgetMs = steps * 16.67;
    console.log(`Frame budget (${steps} frames @ 60fps): ${budgetMs.toFixed(0)}ms`);
    console.log(`Actual duration: ${totalDuration}ms`);
    console.log(`Budget ratio: ${(totalDuration / budgetMs * 100).toFixed(0)}%\n`);

    let totalMeasured = 0;
    for (const [name, data] of sortedTimings) {
      const time = parseFloat(data.totalTime);
      totalMeasured += time;
      const pct = (time / budgetMs * 100).toFixed(1);
      if (time > 5) { // Only show significant contributors
        console.log(`${name.padEnd(35)} ${pct.padStart(6)}% of budget (${time.toFixed(1)}ms)`);
      }
    }

    console.log('\n─'.repeat(70));
    console.log(`Total measured time: ${totalMeasured.toFixed(1)}ms`);

    // Specific bottleneck analysis
    console.log('\n\n🔍 CRITICAL PATH ANALYSIS');
    console.log('═'.repeat(70));

    const toDataURLTime = parseFloat(timings.toDataURL?.totalTime || '0');
    const gcsTime = parseFloat(timings.getComputedStyle?.totalTime || '0');
    const setAttrTime = parseFloat(timings.setAttribute?.totalTime || '0');
    const gbcrTime = parseFloat(timings.getBoundingClientRect?.totalTime || '0');

    console.log(`
Per-resize-step analysis (${steps} steps):
─────────────────────────────────────────────────────────────────────

toDataURL (PNG encoding):
  Total: ${toDataURLTime.toFixed(1)}ms across ${timings.toDataURL?.count || 0} calls
  Per step: ${(toDataURLTime / steps).toFixed(2)}ms
  Per call: ${timings.toDataURL?.avgTime || '0'}ms
  IMPACT: ${toDataURLTime > 100 ? '🔴 HIGH - PNG encoding is blocking' : toDataURLTime > 50 ? '🟡 MEDIUM' : '🟢 OK'}

getComputedStyle:
  Total: ${gcsTime.toFixed(1)}ms across ${timings.getComputedStyle?.count || 0} calls
  Per step: ${(gcsTime / steps).toFixed(2)}ms
  IMPACT: ${gcsTime > 50 ? '🔴 HIGH - Forces style recalc' : gcsTime > 20 ? '🟡 MEDIUM' : '🟢 OK'}

setAttribute (DOM updates):
  Total: ${setAttrTime.toFixed(1)}ms across ${timings.setAttribute?.count || 0} calls
  Per step: ${(setAttrTime / steps).toFixed(2)}ms
  IMPACT: ${setAttrTime > 30 ? '🔴 HIGH - Too many DOM writes' : '🟢 OK'}

getBoundingClientRect:
  Total: ${gbcrTime.toFixed(1)}ms across ${timings.getBoundingClientRect?.count || 0} calls
  Per step: ${(gbcrTime / steps).toFixed(2)}ms
  IMPACT: ${gbcrTime > 30 ? '🟡 MEDIUM - Layout reads' : '🟢 OK'}
`);

    // Recommendations
    console.log('\n💡 OPTIMIZATION RECOMMENDATIONS');
    console.log('═'.repeat(70));

    if (toDataURLTime > 50) {
      console.log(`
[toDataURL Optimization]
─────────────────────────────────────────────────────────────────────
CURRENT: ${(toDataURLTime / steps).toFixed(2)}ms per resize step
TARGET:  < 1ms per step

Options:
1. Use createObjectURL(blob) instead of toDataURL() during resize
   - Create Blob async via canvas.toBlob()
   - Use URL.createObjectURL() for temporary references
   - Only convert to dataURL when idle

2. Skip displacement map regeneration during active resize
   - Use CSS transform: scale() to stretch existing map
   - Regenerate only when resize ends (300ms idle)

3. Use lower resolution during resize (already implemented but can be more aggressive)
   - Current min resolution: 20%
   - Consider 10% during active drag

4. Cache displacement maps by size hash
   - Reuse maps for similar sizes (within 5% tolerance)
`);
    }

    if (gcsTime > 20) {
      console.log(`
[getComputedStyle Optimization]
─────────────────────────────────────────────────────────────────────
CURRENT: ${(gcsTime / steps).toFixed(2)}ms per resize step
TARGET:  0ms during resize (use cached values)

Options:
1. Cache borderRadius at attach() time
   - Already implemented via state.borderRadius
   - But MutationObserver may be triggering unnecessary rechecks

2. Avoid getComputedStyle in _checkElement during resize
   - CSS Property Engine calls getComputedStyle on every check
   - Consider batch reading at frame boundaries only
`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

runDetailedTrace().catch(console.error);
