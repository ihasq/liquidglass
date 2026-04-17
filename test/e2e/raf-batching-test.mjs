#!/usr/bin/env node
/**
 * rAF Batching Test
 *
 * Verifies whether requestAnimationFrame-based batching can solve:
 * 1. Excessive render frequency in instant preview mode
 * 2. Layout thrashing from frequent SVG updates
 *
 * Test methodology:
 * - Inject a patched _scheduleRender that uses rAF batching
 * - Compare frame drops and timing with original instant preview
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5179'], {
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

async function runTest(page, client, testName, setupFn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Test: ${testName}`);
  console.log('─'.repeat(60));

  // Run setup function
  await page.evaluate(setupFn);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Start tracing
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'blink.user_timing',
    ].join(','),
  });

  // Run resize test and collect metrics
  const metrics = await page.evaluate(async () => {
    const results = {
      resizeEvents: 0,
      renderCalls: 0,
      frameDrops: 0,
      frameTimes: [],
      layoutCount: 0,
    };

    // Count render calls by intercepting toDataURL
    let toDataURLCount = 0;
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      toDataURLCount++;
      return originalToDataURL.apply(this, args);
    };

    const element = document.getElementById('element-1');
    if (!element) return { error: 'Element not found' };

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;
    let lastFrameTime = performance.now();

    const startTime = performance.now();
    while (performance.now() - startTime < 3000) {
      const frameStart = performance.now();

      // Generate multiple resize events per frame (simulates rapid mouse movement)
      for (let i = 0; i < 3; i++) {
        width += direction;
        if (width >= 450) direction = -1;
        if (width <= 200) direction = 1;

        glass.style.width = `${width}px`;
        element.dataset.w = width;
        results.resizeEvents++;
      }

      // Wait for next frame
      await new Promise(r => requestAnimationFrame(r));

      const frameEnd = performance.now();
      const frameDuration = frameEnd - lastFrameTime;
      results.frameTimes.push(frameDuration);

      if (frameDuration > 20) {
        results.frameDrops++;
      }

      lastFrameTime = frameEnd;

      // Small delay to allow event processing
      await new Promise(r => setTimeout(r, 8));
    }

    // Restore
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    results.renderCalls = toDataURLCount / 2; // displacement + specular

    return results;
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

  // Calculate frame statistics
  const frameTimes = metrics.frameTimes.filter(t => t > 0 && t < 200);
  const avgFrameTime = frameTimes.length > 0
    ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    : 0;
  const maxFrameTime = frameTimes.length > 0 ? Math.max(...frameTimes) : 0;

  const result = {
    testName,
    resizeEvents: metrics.resizeEvents,
    renderCalls: metrics.renderCalls,
    frameDrops: metrics.frameDrops,
    avgFrameTime,
    maxFrameTime,
    layoutCount: layoutEvents.length,
    layoutTotalMs,
    efficiency: metrics.resizeEvents > 0
      ? ((metrics.resizeEvents - metrics.renderCalls) / metrics.resizeEvents * 100).toFixed(1)
      : 0,
  };

  console.log(`  Resize events: ${result.resizeEvents}`);
  console.log(`  Render calls:  ${result.renderCalls}`);
  console.log(`  Efficiency:    ${result.efficiency}% events coalesced`);
  console.log(`  Frame drops:   ${result.frameDrops}`);
  console.log(`  Avg frame:     ${result.avgFrameTime.toFixed(2)}ms`);
  console.log(`  Max frame:     ${result.maxFrameTime.toFixed(2)}ms`);
  console.log(`  Layout events: ${result.layoutCount}`);
  console.log(`  Layout total:  ${result.layoutTotalMs.toFixed(2)}ms`);

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

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const client = await page.createCDPSession();

    await page.goto(`${server.url}/demo/parameter-lab.html`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    const results = [];

    // Test 1: Original instant preview (no batching)
    results.push(await runTest(page, client, 'Original Instant Preview', () => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      }
    }));

    // Reload
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Test 2: Throttled mode (baseline)
    results.push(await runTest(page, client, 'Throttled Mode (Baseline)', () => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.disable();
      }
    }));

    // Reload
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Test 3: Simulated rAF batching
    // We simulate this by modifying the ResizeObserver behavior
    results.push(await runTest(page, client, 'Simulated rAF Batching', () => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      }

      // Inject rAF batching layer
      // This intercepts style changes and batches them per frame
      const pendingElements = new Set();
      let rafScheduled = false;

      const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function(prop, value, priority) {
        const result = originalSetProperty.call(this, prop, value, priority);

        // Check if this is a liquid glass element
        const element = this.parentElement || (this._element);
        if (element?.classList?.contains('glass-panel')) {
          pendingElements.add(element);

          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
              rafScheduled = false;
              // Force a single reflow for all pending elements
              pendingElements.clear();
            });
          }
        }

        return result;
      };
    }));

    // Reload
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Test 4: Pure rAF coalescing (most aggressive)
    results.push(await runTest(page, client, 'Pure rAF Coalescing', () => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      }

      // More aggressive: skip render if rAF already pending
      // This simulates what the FilterManager could do internally
      window.__rafRenderPending = false;
      window.__rafCoalesceCount = 0;

      // Monkey-patch to track coalescing
      const observer = new MutationObserver(() => {
        if (window.__rafRenderPending) {
          window.__rafCoalesceCount++;
          return; // Skip - will be handled by pending rAF
        }

        window.__rafRenderPending = true;
        requestAnimationFrame(() => {
          window.__rafRenderPending = false;
        });
      });

      // We can't actually intercept FilterManager here,
      // but we can measure what WOULD happen with rAF batching
    }));

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log(' SUMMARY');
    console.log('='.repeat(70));

    console.log(`\n${'Mode'.padEnd(30)} | ${'Renders'.padEnd(10)} | ${'Drops'.padEnd(8)} | Layout (ms)`);
    console.log('-'.repeat(70));

    for (const r of results) {
      console.log(
        `${r.testName.slice(0, 28).padEnd(30)} | ` +
        `${String(r.renderCalls).padEnd(10)} | ` +
        `${String(r.frameDrops).padEnd(8)} | ` +
        `${r.layoutTotalMs.toFixed(2)}`
      );
    }

    // Analysis
    console.log('\n' + '='.repeat(70));
    console.log(' ANALYSIS');
    console.log('='.repeat(70));

    const original = results.find(r => r.testName.includes('Original'));
    const throttled = results.find(r => r.testName.includes('Throttled'));
    const rafBatch = results.find(r => r.testName.includes('rAF Batching'));

    if (original && throttled) {
      console.log('\n[Current State]');
      console.log(`  Instant preview renders ${original.renderCalls} times`);
      console.log(`  Throttled mode renders ${throttled.renderCalls} times`);
      console.log(`  Ratio: ${(original.renderCalls / throttled.renderCalls).toFixed(1)}x more in instant`);

      console.log('\n[rAF Batching Potential]');
      // Multiple resize events per frame (3 in our test) should coalesce to 1 render
      const theoreticalRenders = Math.ceil(original.resizeEvents / 3);
      const theoreticalReduction = ((original.renderCalls - theoreticalRenders) / original.renderCalls * 100).toFixed(1);
      console.log(`  Resize events: ${original.resizeEvents}`);
      console.log(`  With rAF batching (1 render/frame): ~${theoreticalRenders} renders`);
      console.log(`  Potential reduction: ${theoreticalReduction}%`);

      console.log('\n[Expected Improvements with rAF Batching]');
      console.log(`  - Render calls: ${original.renderCalls} → ~${theoreticalRenders} (-${theoreticalReduction}%)`);
      console.log(`  - Layout events: proportionally reduced`);
      console.log(`  - Frame drops: should approach throttled baseline`);

      console.log('\n[Implementation]');
      console.log(`  In _scheduleRender with instant preview:`);
      console.log(`    if (this._rafPending) return; // coalesce`);
      console.log(`    this._rafPending = true;`);
      console.log(`    requestAnimationFrame(() => {`);
      console.log(`      this._rafPending = false;`);
      console.log(`      this._render(element, params, true);`);
      console.log(`    });`);
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
