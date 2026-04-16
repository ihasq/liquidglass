#!/usr/bin/env node
/**
 * Frame Drop Profiler for Liquid Glass
 *
 * Uses CDP (Chrome DevTools Protocol) to measure frame drops during resize operations
 * with instant preview mode enabled vs disabled.
 *
 * Usage: node e2e/frame-drop-profiler.mjs
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration
const CONFIG = {
  WARMUP_FRAMES: 30,
  TEST_DURATION_MS: 5000,
  RESIZE_INTERVAL_MS: 16, // ~60fps resize events
  RESIZE_DELTA_PX: 2,
  ELEMENT_INITIAL_SIZE: { width: 320, height: 200 },
  VIEWPORT: { width: 1280, height: 800 },
};

/**
 * Start Vite dev server
 */
async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5173'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let serverUrl = null;
    const timeout = setTimeout(() => {
      if (!serverUrl) {
        vite.kill();
        reject(new Error('Vite dev server startup timeout'));
      }
    }, 30000);

    vite.stdout.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/Local:\s+(http:\/\/localhost:\d+)/);
      if (match && !serverUrl) {
        serverUrl = match[1];
        clearTimeout(timeout);
        resolve({ url: serverUrl, process: vite });
      }
    });

    vite.stderr.on('data', (data) => {
      // Vite outputs to stderr sometimes
      const output = data.toString();
      const match = output.match(/Local:\s+(http:\/\/localhost:\d+)/);
      if (match && !serverUrl) {
        serverUrl = match[1];
        clearTimeout(timeout);
        resolve({ url: serverUrl, process: vite });
      }
    });

    vite.on('error', reject);
  });
}

/**
 * Analyze performance trace for frame drops
 */
function analyzeTrace(traceEvents) {
  const frames = [];
  const longTasks = [];
  const functionCalls = new Map(); // function name -> { count, totalDuration }

  // Find all frame events and long tasks
  for (const event of traceEvents) {
    if (event.name === 'FrameCommittedInBrowser' || event.name === 'DrawFrame') {
      frames.push(event.ts);
    }

    // Long tasks (>50ms)
    if (event.ph === 'X' && event.dur && event.dur > 50000) { // dur is in microseconds
      longTasks.push({
        name: event.name,
        duration: event.dur / 1000, // Convert to ms
        ts: event.ts,
        category: event.cat,
        stack: event.args?.data?.stackTrace || null,
      });
    }

    // Function call sampling
    if (event.ph === 'X' && event.dur && event.name && event.cat?.includes('devtools.timeline')) {
      const key = event.name;
      if (!functionCalls.has(key)) {
        functionCalls.set(key, { count: 0, totalDuration: 0, samples: [] });
      }
      const entry = functionCalls.get(key);
      entry.count++;
      entry.totalDuration += event.dur / 1000;
      if (entry.samples.length < 5) {
        entry.samples.push({
          duration: event.dur / 1000,
          stack: event.args?.data?.stackTrace || null,
        });
      }
    }
  }

  // Calculate frame times
  frames.sort((a, b) => a - b);
  const frameTimes = [];
  for (let i = 1; i < frames.length; i++) {
    frameTimes.push((frames[i] - frames[i - 1]) / 1000); // Convert to ms
  }

  // Calculate frame drop statistics
  const TARGET_FRAME_TIME = 16.67; // 60fps
  const droppedFrames = frameTimes.filter(t => t > TARGET_FRAME_TIME * 1.5).length;
  const severeDrops = frameTimes.filter(t => t > TARGET_FRAME_TIME * 3).length;

  const avgFrameTime = frameTimes.length > 0
    ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    : 0;
  const maxFrameTime = frameTimes.length > 0 ? Math.max(...frameTimes) : 0;
  const p99FrameTime = frameTimes.length > 0
    ? frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.99)]
    : 0;

  // Sort function calls by total duration
  const sortedFunctions = Array.from(functionCalls.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.totalDuration - a.totalDuration)
    .slice(0, 20);

  // Sort long tasks by duration
  longTasks.sort((a, b) => b.duration - a.duration);

  return {
    totalFrames: frames.length,
    droppedFrames,
    severeDrops,
    dropRate: frames.length > 0 ? (droppedFrames / frames.length * 100).toFixed(2) : 0,
    avgFrameTime: avgFrameTime.toFixed(2),
    maxFrameTime: maxFrameTime.toFixed(2),
    p99FrameTime: p99FrameTime.toFixed(2),
    estimatedFPS: avgFrameTime > 0 ? (1000 / avgFrameTime).toFixed(1) : 0,
    longTasks: longTasks.slice(0, 10),
    topFunctions: sortedFunctions,
    frameTimes,
  };
}

/**
 * Run a single profiling session
 */
async function runProfilingSession(page, client, instantPreviewEnabled) {
  const mode = instantPreviewEnabled ? 'INSTANT_PREVIEW' : 'THROTTLED';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running profiling session: ${mode}`);
  console.log('='.repeat(60));

  // Set instant preview mode
  if (instantPreviewEnabled) {
    await page.evaluate(() => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.enable();
      }
    });
  } else {
    await page.evaluate(() => {
      if (window.lgc_dev) {
        window.lgc_dev.debug.mode.instantPreview.disable();
      }
    });
  }

  // Wait for mode to take effect
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

  // Start tracing with detailed settings
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-devtools.timeline.stack',
      'v8.execute',
      'blink.user_timing',
      'cc',
      'gpu',
    ].join(','),
    options: 'sampling-frequency=10000', // 10kHz sampling
  });

  // Warmup: let a few frames render
  await page.evaluate((warmupFrames) => {
    return new Promise(resolve => {
      let count = 0;
      function frame() {
        if (++count >= warmupFrames) {
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      }
      requestAnimationFrame(frame);
    });
  }, CONFIG.WARMUP_FRAMES);

  // Perform automated resize operations
  const resizeResults = await page.evaluate(async (config) => {
    const element = document.getElementById('element-1');
    if (!element) {
      return { error: 'Element not found' };
    }

    const glass = element.querySelector('.glass-panel');
    const seHandle = element.querySelector('.resize-handle.se');

    // Get initial position
    const rect = element.getBoundingClientRect();
    const previewArea = document.getElementById('preview-area').getBoundingClientRect();

    let currentWidth = config.ELEMENT_INITIAL_SIZE.width;
    let currentHeight = config.ELEMENT_INITIAL_SIZE.height;

    const startTime = performance.now();
    let resizeCount = 0;
    let direction = 1; // 1 = growing, -1 = shrinking

    // Track frame times during resize
    const frameTimestamps = [];
    let lastFrameTime = performance.now();
    let animationFrameId = null;

    function trackFrames() {
      const now = performance.now();
      frameTimestamps.push(now - lastFrameTime);
      lastFrameTime = now;
      animationFrameId = requestAnimationFrame(trackFrames);
    }
    animationFrameId = requestAnimationFrame(trackFrames);

    // Resize loop
    while (performance.now() - startTime < config.TEST_DURATION_MS) {
      // Change direction at bounds
      if (currentWidth >= 500 || currentHeight >= 350) {
        direction = -1;
      } else if (currentWidth <= 150 || currentHeight <= 100) {
        direction = 1;
      }

      currentWidth += config.RESIZE_DELTA_PX * direction;
      currentHeight += config.RESIZE_DELTA_PX * direction;

      // Apply resize
      glass.style.width = `${currentWidth}px`;
      glass.style.height = `${currentHeight}px`;
      element.dataset.w = currentWidth;
      element.dataset.h = currentHeight;

      resizeCount++;

      // Wait for next interval
      await new Promise(r => setTimeout(r, config.RESIZE_INTERVAL_MS));
    }

    // Stop frame tracking
    cancelAnimationFrame(animationFrameId);

    const endTime = performance.now();
    const actualDuration = endTime - startTime;

    // Calculate frame statistics from JS side
    const validFrameTimes = frameTimestamps.filter(t => t > 0 && t < 1000);
    const avgFrameTime = validFrameTimes.length > 0
      ? validFrameTimes.reduce((a, b) => a + b, 0) / validFrameTimes.length
      : 0;
    const droppedJS = validFrameTimes.filter(t => t > 25).length; // >25ms = dropped

    return {
      resizeCount,
      actualDuration,
      avgFrameTimeJS: avgFrameTime.toFixed(2),
      droppedFramesJS: droppedJS,
      totalFramesJS: validFrameTimes.length,
    };
  }, CONFIG);

  // Stop tracing and collect events
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

  // Analyze trace
  const analysis = analyzeTrace(traceEvents);

  return {
    mode,
    instantPreviewEnabled,
    resizeResults,
    analysis,
  };
}

/**
 * Print comparison results
 */
function printComparison(throttledResult, instantResult) {
  console.log('\n');
  console.log('='.repeat(80));
  console.log(' COMPARISON: Throttled vs Instant Preview');
  console.log('='.repeat(80));

  const t = throttledResult.analysis;
  const i = instantResult.analysis;

  console.log('\n--- Frame Statistics ---\n');
  console.log(`${'Metric'.padEnd(25)} | ${'Throttled'.padEnd(15)} | ${'Instant'.padEnd(15)} | Delta`);
  console.log('-'.repeat(70));
  console.log(`${'Total Frames'.padEnd(25)} | ${String(t.totalFrames).padEnd(15)} | ${String(i.totalFrames).padEnd(15)} | ${i.totalFrames - t.totalFrames}`);
  console.log(`${'Dropped Frames'.padEnd(25)} | ${String(t.droppedFrames).padEnd(15)} | ${String(i.droppedFrames).padEnd(15)} | ${i.droppedFrames - t.droppedFrames}`);
  console.log(`${'Drop Rate (%)'.padEnd(25)} | ${String(t.dropRate).padEnd(15)} | ${String(i.dropRate).padEnd(15)} | ${(parseFloat(i.dropRate) - parseFloat(t.dropRate)).toFixed(2)}%`);
  console.log(`${'Avg Frame Time (ms)'.padEnd(25)} | ${String(t.avgFrameTime).padEnd(15)} | ${String(i.avgFrameTime).padEnd(15)} | ${(parseFloat(i.avgFrameTime) - parseFloat(t.avgFrameTime)).toFixed(2)}`);
  console.log(`${'Max Frame Time (ms)'.padEnd(25)} | ${String(t.maxFrameTime).padEnd(15)} | ${String(i.maxFrameTime).padEnd(15)} | ${(parseFloat(i.maxFrameTime) - parseFloat(t.maxFrameTime)).toFixed(2)}`);
  console.log(`${'P99 Frame Time (ms)'.padEnd(25)} | ${String(t.p99FrameTime).padEnd(15)} | ${String(i.p99FrameTime).padEnd(15)} | ${(parseFloat(i.p99FrameTime) - parseFloat(t.p99FrameTime)).toFixed(2)}`);
  console.log(`${'Estimated FPS'.padEnd(25)} | ${String(t.estimatedFPS).padEnd(15)} | ${String(i.estimatedFPS).padEnd(15)} | ${(parseFloat(i.estimatedFPS) - parseFloat(t.estimatedFPS)).toFixed(1)}`);

  console.log('\n--- Long Tasks (>50ms) ---\n');
  console.log('THROTTLED MODE:');
  if (t.longTasks.length === 0) {
    console.log('  (none)');
  } else {
    for (const task of t.longTasks.slice(0, 5)) {
      console.log(`  ${task.name}: ${task.duration.toFixed(2)}ms [${task.category || 'unknown'}]`);
    }
  }

  console.log('\nINSTANT PREVIEW MODE:');
  if (i.longTasks.length === 0) {
    console.log('  (none)');
  } else {
    for (const task of i.longTasks.slice(0, 5)) {
      console.log(`  ${task.name}: ${task.duration.toFixed(2)}ms [${task.category || 'unknown'}]`);
    }
  }

  console.log('\n--- Top Functions by Total Duration ---\n');
  console.log('THROTTLED MODE:');
  for (const fn of t.topFunctions.slice(0, 10)) {
    console.log(`  ${fn.name.padEnd(40)} | ${fn.count.toString().padStart(5)} calls | ${fn.totalDuration.toFixed(2).padStart(10)}ms total`);
  }

  console.log('\nINSTANT PREVIEW MODE:');
  for (const fn of i.topFunctions.slice(0, 10)) {
    console.log(`  ${fn.name.padEnd(40)} | ${fn.count.toString().padStart(5)} calls | ${fn.totalDuration.toFixed(2).padStart(10)}ms total`);
  }

  // Identify bottlenecks unique to instant preview
  console.log('\n--- Bottleneck Analysis ---\n');

  const throttledFnMap = new Map(t.topFunctions.map(f => [f.name, f]));
  const instantOnlyBottlenecks = i.topFunctions.filter(fn => {
    const throttledFn = throttledFnMap.get(fn.name);
    if (!throttledFn) return fn.totalDuration > 50;
    return fn.totalDuration > throttledFn.totalDuration * 1.5 && fn.totalDuration > 50;
  });

  if (instantOnlyBottlenecks.length > 0) {
    console.log('Functions with significantly higher cost in Instant Preview mode:');
    for (const fn of instantOnlyBottlenecks.slice(0, 10)) {
      const throttledFn = throttledFnMap.get(fn.name);
      const throttledDur = throttledFn ? throttledFn.totalDuration : 0;
      const increase = throttledDur > 0 ? ((fn.totalDuration / throttledDur - 1) * 100).toFixed(0) : 'N/A';
      console.log(`  ${fn.name}`);
      console.log(`    Instant: ${fn.totalDuration.toFixed(2)}ms (${fn.count} calls)`);
      console.log(`    Throttled: ${throttledDur.toFixed(2)}ms`);
      console.log(`    Increase: ${increase}%`);
    }
  } else {
    console.log('No significant bottleneck differences identified.');
  }

  // Summary
  console.log('\n--- Summary ---\n');
  const dropRateDiff = parseFloat(i.dropRate) - parseFloat(t.dropRate);
  if (dropRateDiff > 5) {
    console.log(`Frame drop rate increased by ${dropRateDiff.toFixed(2)}% in Instant Preview mode.`);
    console.log('Primary bottleneck candidates:');

    // Find the most likely culprits
    const culprits = instantOnlyBottlenecks
      .filter(fn => fn.name.includes('generate') || fn.name.includes('encode') || fn.name.includes('render'))
      .slice(0, 3);

    if (culprits.length > 0) {
      for (const c of culprits) {
        console.log(`  - ${c.name}: ${c.totalDuration.toFixed(2)}ms total (${c.count} calls)`);
      }
    } else {
      console.log('  - Check top functions listed above for potential optimization targets.');
    }
  } else {
    console.log('Frame drop rate is comparable between modes.');
  }
}

/**
 * Main entry point
 */
async function main() {
  let server = null;
  let browser = null;

  try {
    console.log('Starting Vite dev server...');
    server = await startDevServer();
    console.log(`Server running at ${server.url}`);

    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--enable-features=SharedArrayBuffer',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport(CONFIG.VIEWPORT);

    // Create CDP session
    const client = await page.createCDPSession();

    // Enable performance domain
    await client.send('Performance.enable');

    // Navigate to parameter lab
    console.log('Loading parameter-lab.html...');
    await page.goto(`${server.url}/demo/parameter-lab.html`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    // Wait for liquid glass to initialize
    await page.waitForFunction(() => {
      return typeof window.lgc_dev !== 'undefined';
    }, { timeout: 10000 });

    console.log('Page loaded, lgc_dev available.');

    // Hide floating controls to reduce visual noise
    await page.evaluate(() => {
      if (window.setFloatingControlsVisible) {
        window.setFloatingControlsVisible(false);
      }
    });

    // Run throttled (normal) session first
    const throttledResult = await runProfilingSession(page, client, false);

    // Reset page state
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => {
      if (window.setFloatingControlsVisible) {
        window.setFloatingControlsVisible(false);
      }
    });

    // Run instant preview session
    const instantResult = await runProfilingSession(page, client, true);

    // Print comparison
    printComparison(throttledResult, instantResult);

  } catch (error) {
    console.error('Profiling failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (server?.process) {
      server.process.kill();
    }
  }
}

main();
