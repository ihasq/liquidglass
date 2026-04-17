#!/usr/bin/env node
/**
 * Inline Timing Profiler
 *
 * Injects performance.mark/measure into the render pipeline
 * to capture precise timing of each operation.
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5178'], {
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

async function runTimingTest(page, instantPreview) {
  const mode = instantPreview ? 'INSTANT_PREVIEW' : 'THROTTLED';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Timing Test: ${mode}`);
  console.log('='.repeat(60));

  // Set mode
  await page.evaluate((enabled) => {
    if (window.lgc_dev) {
      if (enabled) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      } else {
        window.lgc_dev.debug.mode.instantPreview.disable();
      }
    }
  }, instantPreview);

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Run test with timing collection
  const timings = await page.evaluate(async () => {
    const results = {
      renderCount: 0,
      resizeCount: 0,
      timings: {
        wasmGenerate: [],
        toDataURL_disp: [],
        specularGenerate: [],
        toDataURL_spec: [],
        filterUpdate: [],
        totalRender: [],
      },
      frameDrops: 0,
    };

    // Intercept toDataURL to measure its cost
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    let currentContext = null;

    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const start = performance.now();
      const result = originalToDataURL.apply(this, args);
      const duration = performance.now() - start;

      if (currentContext === 'displacement') {
        results.timings.toDataURL_disp.push(duration);
      } else if (currentContext === 'specular') {
        results.timings.toDataURL_spec.push(duration);
      }

      return result;
    };

    // Intercept WASM generation
    const originalFetch = window.fetch;
    let wasmModule = null;

    // We'll use ResizeObserver timing instead since we can't easily intercept WASM

    // Run resize test
    const element = document.getElementById('element-1');
    if (!element) return { error: 'Element not found' };

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;
    let lastFrameTime = performance.now();

    const startTime = performance.now();
    while (performance.now() - startTime < 3000) {
      const frameStart = performance.now();

      width += 2 * direction;
      if (width >= 450) direction = -1;
      if (width <= 200) direction = 1;

      // Mark displacement context
      currentContext = 'displacement';
      glass.style.width = `${width}px`;
      element.dataset.w = width;
      results.resizeCount++;

      // Wait for render to complete
      await new Promise(r => requestAnimationFrame(() => {
        currentContext = 'specular';
        r();
      }));

      currentContext = null;

      const frameEnd = performance.now();
      const frameDuration = frameEnd - frameStart;

      if (frameDuration > 20) {
        results.frameDrops++;
        results.timings.totalRender.push(frameDuration);
      }

      // Maintain ~60fps
      const elapsed = frameEnd - lastFrameTime;
      if (elapsed < 16) {
        await new Promise(r => setTimeout(r, 16 - elapsed));
      }
      lastFrameTime = performance.now();
    }

    // Restore original
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;

    // Calculate statistics
    const calcStats = (arr) => {
      if (arr.length === 0) return { count: 0, total: 0, avg: 0, max: 0, p95: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      return {
        count: arr.length,
        total: arr.reduce((a, b) => a + b, 0),
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        max: Math.max(...arr),
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      };
    };

    return {
      mode: '${mode}',
      resizeCount: results.resizeCount,
      frameDrops: results.frameDrops,
      stats: {
        toDataURL_disp: calcStats(results.timings.toDataURL_disp),
        toDataURL_spec: calcStats(results.timings.toDataURL_spec),
        slowFrames: calcStats(results.timings.totalRender),
      },
    };
  });

  return timings;
}

async function runDetailedTimingTest(page, client, instantPreview) {
  const mode = instantPreview ? 'INSTANT_PREVIEW' : 'THROTTLED';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Detailed Timing: ${mode}`);
  console.log('='.repeat(60));

  // Set mode
  await page.evaluate((enabled) => {
    if (window.lgc_dev) {
      if (enabled) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      } else {
        window.lgc_dev.debug.mode.instantPreview.disable();
      }
    }
  }, instantPreview);

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Start tracing with user timing
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'blink.user_timing',
    ].join(','),
  });

  // Run test
  await page.evaluate(async () => {
    const element = document.getElementById('element-1');
    if (!element) return;

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;

    const startTime = performance.now();
    while (performance.now() - startTime < 3000) {
      width += 2 * direction;
      if (width >= 450) direction = -1;
      if (width <= 200) direction = 1;

      glass.style.width = `${width}px`;
      element.dataset.w = width;

      await new Promise(r => setTimeout(r, 16));
    }
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

  // Analyze EncodeImage events (canvas.toDataURL calls)
  const encodeEvents = traceEvents.filter(e =>
    e.name === 'EncodeImage' ||
    e.name === 'Encode Image' ||
    (e.name === 'FunctionCall' && e.args?.data?.functionName?.includes('toDataURL'))
  );

  // Analyze all X (complete) events
  const completeEvents = traceEvents
    .filter(e => e.ph === 'X' && e.dur > 0)
    .map(e => ({
      name: e.name,
      duration: e.dur / 1000,
      cat: e.cat,
    }));

  // Group by event name
  const eventGroups = new Map();
  for (const e of completeEvents) {
    if (!eventGroups.has(e.name)) {
      eventGroups.set(e.name, { count: 0, total: 0, max: 0 });
    }
    const g = eventGroups.get(e.name);
    g.count++;
    g.total += e.duration;
    g.max = Math.max(g.max, e.duration);
  }

  // Sort by total time
  const sorted = Array.from(eventGroups.entries())
    .map(([name, data]) => ({ name, ...data }))
    .filter(e => e.total > 10) // Filter noise
    .sort((a, b) => b.total - a.totalTime);

  return { mode, events: sorted.slice(0, 20), encodeCount: encodeEvents.length };
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

    // Run timing tests
    const throttledTiming = await runTimingTest(page, false);

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    const instantTiming = await runTimingTest(page, true);

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log(' TIMING RESULTS');
    console.log('='.repeat(70));

    const printStats = (name, stats) => {
      if (stats.count === 0) {
        console.log(`  ${name}: (no samples)`);
        return;
      }
      console.log(`  ${name}:`);
      console.log(`    Count: ${stats.count}`);
      console.log(`    Total: ${stats.total.toFixed(2)}ms`);
      console.log(`    Avg:   ${stats.avg.toFixed(2)}ms`);
      console.log(`    Max:   ${stats.max.toFixed(2)}ms`);
      console.log(`    P95:   ${stats.p95.toFixed(2)}ms`);
    };

    console.log('\nTHROTTLED:');
    console.log(`  Resize events: ${throttledTiming.resizeCount}`);
    console.log(`  Frame drops: ${throttledTiming.frameDrops}`);
    printStats('toDataURL (displacement)', throttledTiming.stats.toDataURL_disp);
    printStats('toDataURL (specular)', throttledTiming.stats.toDataURL_spec);
    printStats('Slow frames (>20ms)', throttledTiming.stats.slowFrames);

    console.log('\nINSTANT_PREVIEW:');
    console.log(`  Resize events: ${instantTiming.resizeCount}`);
    console.log(`  Frame drops: ${instantTiming.frameDrops}`);
    printStats('toDataURL (displacement)', instantTiming.stats.toDataURL_disp);
    printStats('toDataURL (specular)', instantTiming.stats.toDataURL_spec);
    printStats('Slow frames (>20ms)', instantTiming.stats.slowFrames);

    // Run detailed tracing
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    const throttledTrace = await runDetailedTimingTest(page, client, false);

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    const instantTrace = await runDetailedTimingTest(page, client, true);

    // Comparison
    console.log('\n' + '='.repeat(70));
    console.log(' TRACE EVENT COMPARISON');
    console.log('='.repeat(70));

    console.log('\nTHROTTLED - Top Events:');
    console.log(`${'Event'.padEnd(40)} | ${'Count'.padEnd(8)} | ${'Total (ms)'.padEnd(12)} | Max (ms)`);
    console.log('-'.repeat(75));
    for (const e of throttledTrace.events.slice(0, 10)) {
      console.log(
        `${e.name.slice(0, 38).padEnd(40)} | ` +
        `${String(e.count).padEnd(8)} | ` +
        `${e.total.toFixed(2).padEnd(12)} | ` +
        `${e.max.toFixed(2)}`
      );
    }

    console.log('\nINSTANT_PREVIEW - Top Events:');
    console.log(`${'Event'.padEnd(40)} | ${'Count'.padEnd(8)} | ${'Total (ms)'.padEnd(12)} | Max (ms)`);
    console.log('-'.repeat(75));
    for (const e of instantTrace.events.slice(0, 10)) {
      console.log(
        `${e.name.slice(0, 38).padEnd(40)} | ` +
        `${String(e.count).padEnd(8)} | ` +
        `${e.total.toFixed(2).padEnd(12)} | ` +
        `${e.max.toFixed(2)}`
      );
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
