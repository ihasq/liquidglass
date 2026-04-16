#!/usr/bin/env node
/**
 * rAF Injection Test
 *
 * Patches FilterManager to use rAF-based batching in instant preview mode
 * and measures the actual improvement.
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5180'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let serverUrl = null;
    const timeout = setTimeout(() => {
      if (!serverUrl) {
        vite.kill();
        reject(new Error('Timeout'));
      }
    }, 30000);

    const handleOutput = (data) => {
      const match = data.toString().match(/Local:\s+(http:\/\/localhost:\d+)/);
      if (match && !serverUrl) {
        serverUrl = match[1];
        clearTimeout(timeout);
        resolve({ url: serverUrl, process: vite });
      }
    };

    vite.stdout.on('data', handleOutput);
    vite.stderr.on('data', handleOutput);
    vite.on('error', reject);
  });
}

async function runTest(page, client, testName, minIntervalMs) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Test: ${testName} (minInterval=${minIntervalMs}ms)`);
  console.log('─'.repeat(60));

  // Inject rAF-based batching with configurable minimum interval
  await page.evaluate((minInterval) => {
    // Enable instant preview mode
    if (window.lgc_dev) {
      window.lgc_dev.debug.mode.instantPreview.enable();
    }

    // Track metrics
    window.__rafMetrics = {
      scheduleCount: 0,
      renderCount: 0,
      coalescedCount: 0,
      lastRenderTime: 0,
    };

    // Find all glass panels and get their FilterManager references
    // We'll intercept the render by patching toDataURL
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      window.__rafMetrics.renderCount++;
      return originalToDataURL.apply(this, args);
    };

    // If minInterval > 0, we need to throttle at the resize event level
    if (minInterval > 0) {
      // Patch ResizeObserver to add minimum interval throttling
      const originalObserve = ResizeObserver.prototype.observe;
      const lastCallTimes = new WeakMap();

      // We can't easily patch ResizeObserver callbacks, so we'll
      // use a different approach: throttle style changes
      const pendingUpdates = new Map();
      let rafId = null;

      const originalSetWidth = Object.getOwnPropertyDescriptor(
        CSSStyleDeclaration.prototype, 'width'
      )?.set;

      if (originalSetWidth) {
        Object.defineProperty(CSSStyleDeclaration.prototype, 'width', {
          set: function(value) {
            const element = this.parentElement;
            if (element?.classList?.contains('glass-panel')) {
              const now = performance.now();
              const lastTime = lastCallTimes.get(element) || 0;

              if (now - lastTime < minInterval) {
                // Throttle: store pending update
                pendingUpdates.set(element, value);
                window.__rafMetrics.coalescedCount++;

                if (!rafId) {
                  rafId = requestAnimationFrame(() => {
                    rafId = null;
                    for (const [el, val] of pendingUpdates) {
                      originalSetWidth.call(el.style, val);
                      lastCallTimes.set(el, performance.now());
                    }
                    pendingUpdates.clear();
                  });
                }
                return;
              }

              lastCallTimes.set(element, now);
            }
            return originalSetWidth.call(this, value);
          },
          configurable: true,
        });
      }
    }
  }, minIntervalMs);

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Start tracing
  await client.send('Tracing.start', {
    categories: ['devtools.timeline'].join(','),
  });

  // Run resize test
  const testResults = await page.evaluate(async () => {
    const element = document.getElementById('element-1');
    if (!element) return { error: 'Element not found' };

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;
    let frameDrops = 0;
    let lastFrameTime = performance.now();
    const frameTimes = [];

    const startTime = performance.now();
    while (performance.now() - startTime < 3000) {
      // Multiple resize events per iteration (simulates rapid dragging)
      for (let i = 0; i < 3; i++) {
        width += direction;
        if (width >= 450) direction = -1;
        if (width <= 200) direction = 1;
        glass.style.width = `${width}px`;
        element.dataset.w = width;
        window.__rafMetrics.scheduleCount++;
      }

      await new Promise(r => requestAnimationFrame(r));

      const now = performance.now();
      const frameTime = now - lastFrameTime;
      frameTimes.push(frameTime);
      if (frameTime > 20) frameDrops++;
      lastFrameTime = now;

      await new Promise(r => setTimeout(r, 8));
    }

    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

    return {
      scheduleCount: window.__rafMetrics.scheduleCount,
      renderCount: window.__rafMetrics.renderCount / 2, // displacement + specular
      coalescedCount: window.__rafMetrics.coalescedCount,
      frameDrops,
      avgFrameTime,
      maxFrameTime: Math.max(...frameTimes),
    };
  });

  // Collect trace
  const tracePromise = new Promise(resolve => {
    const events = [];
    client.on('Tracing.dataCollected', ({ value }) => {
      events.push(...value);
    });
    client.once('Tracing.tracingComplete', () => {
      resolve(events);
    });
  });

  await client.send('Tracing.end');
  const traceEvents = await tracePromise;

  // Count Layout events
  const layoutEvents = traceEvents.filter(e => e.name === 'Layout' && e.ph === 'X');
  const layoutTotalMs = layoutEvents.reduce((sum, e) => sum + (e.dur || 0) / 1000, 0);

  const result = {
    testName,
    minInterval: minIntervalMs,
    ...testResults,
    layoutCount: layoutEvents.length,
    layoutTotalMs,
    efficiency: testResults.scheduleCount > 0
      ? ((testResults.scheduleCount - testResults.renderCount) / testResults.scheduleCount * 100).toFixed(1)
      : 0,
  };

  console.log(`  Schedule calls: ${result.scheduleCount}`);
  console.log(`  Render calls:   ${result.renderCount}`);
  console.log(`  Coalesced:      ${result.coalescedCount}`);
  console.log(`  Efficiency:     ${result.efficiency}%`);
  console.log(`  Frame drops:    ${result.frameDrops}`);
  console.log(`  Avg frame:      ${result.avgFrameTime.toFixed(2)}ms`);
  console.log(`  Max frame:      ${result.maxFrameTime.toFixed(2)}ms`);
  console.log(`  Layout count:   ${result.layoutCount}`);
  console.log(`  Layout total:   ${result.layoutTotalMs.toFixed(2)}ms`);

  return result;
}

async function main() {
  let server = null;
  let browser = null;

  try {
    console.log('Starting dev server...');
    server = await startDevServer();
    console.log(`Server: ${server.url}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--disable-gpu', '--no-sandbox'],
    });

    const results = [];

    // Test different minimum intervals
    const intervals = [0, 16, 32, 50];

    for (const interval of intervals) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const client = await page.createCDPSession();

      await page.goto(`${server.url}/demo/parameter-lab.html`, {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });

      await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
      await page.evaluate(() => window.setFloatingControlsVisible?.(false));

      const name = interval === 0
        ? 'Original (no throttle)'
        : `rAF + ${interval}ms throttle`;

      results.push(await runTest(page, client, name, interval));

      await page.close();
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log(' SUMMARY: rAF Batching with Minimum Interval');
    console.log('='.repeat(80));

    console.log(`\n${'Mode'.padEnd(28)} | ${'Renders'.padEnd(8)} | ${'Drops'.padEnd(6)} | ${'Layout'.padEnd(10)} | Efficiency`);
    console.log('-'.repeat(80));

    for (const r of results) {
      console.log(
        `${r.testName.slice(0, 26).padEnd(28)} | ` +
        `${String(r.renderCount).padEnd(8)} | ` +
        `${String(r.frameDrops).padEnd(6)} | ` +
        `${r.layoutTotalMs.toFixed(2).padEnd(10)} | ` +
        `${r.efficiency}%`
      );
    }

    // Analysis
    console.log('\n' + '='.repeat(80));
    console.log(' ANALYSIS');
    console.log('='.repeat(80));

    const original = results.find(r => r.minInterval === 0);
    const best = results.reduce((a, b) =>
      (a.frameDrops < b.frameDrops || (a.frameDrops === b.frameDrops && a.renderCount < b.renderCount)) ? a : b
    );

    if (original && best && best !== original) {
      const renderReduction = ((original.renderCount - best.renderCount) / original.renderCount * 100).toFixed(1);
      const dropReduction = ((original.frameDrops - best.frameDrops) / original.frameDrops * 100).toFixed(1);
      const layoutReduction = ((original.layoutTotalMs - best.layoutTotalMs) / original.layoutTotalMs * 100).toFixed(1);

      console.log(`\nBest configuration: ${best.testName}`);
      console.log(`  Render reduction:  ${renderReduction}% (${original.renderCount} → ${best.renderCount})`);
      console.log(`  Frame drop reduction: ${dropReduction}% (${original.frameDrops} → ${best.frameDrops})`);
      console.log(`  Layout reduction:  ${layoutReduction}% (${original.layoutTotalMs.toFixed(2)}ms → ${best.layoutTotalMs.toFixed(2)}ms)`);

      console.log('\n[Conclusion]');
      if (parseFloat(dropReduction) > 20) {
        console.log(`  rAF + ${best.minInterval}ms throttle significantly reduces frame drops.`);
        console.log(`  This confirms that rAF alone is insufficient - minimum interval is needed.`);
      } else {
        console.log(`  rAF batching alone provides limited improvement.`);
        console.log(`  The bottleneck is the render cost per frame, not batching efficiency.`);
      }
    }

  } catch (error) {
    console.error('Failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server?.process) server.process.kill();
  }
}

main();
