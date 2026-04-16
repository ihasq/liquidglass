#!/usr/bin/env node
/**
 * Refresh Rate Benchmark
 *
 * Measures the impact of --liquidglass-refresh-rate on frame drops
 * and rendering performance during resize operations.
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

async function runBenchmark(page, client, refreshRate) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Benchmark: refreshRate = ${refreshRate}`);
  console.log('─'.repeat(60));

  // Set refreshRate via CSS property
  await page.evaluate((rate) => {
    document.querySelectorAll('.glass-panel').forEach(el => {
      el.style.setProperty('--liquidglass-refresh-rate', rate);
    });
  }, refreshRate);

  // Enable instant preview mode
  await page.evaluate(() => {
    if (window.lgc_dev) {
      window.lgc_dev.debug.mode.instantPreview.enable();
    }
  });

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Start tracing
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'blink.user_timing',
    ].join(','),
  });

  // Run resize test and measure frame times
  const results = await page.evaluate(async () => {
    const element = document.getElementById('element-1');
    if (!element) return { error: 'Element not found' };

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;

    const frameTimes = [];
    let lastFrameTime = performance.now();
    let resizeCount = 0;

    const startTime = performance.now();
    while (performance.now() - startTime < 3000) {
      const frameStart = performance.now();

      width += 2 * direction;
      if (width >= 450) direction = -1;
      if (width <= 200) direction = 1;

      glass.style.width = `${width}px`;
      element.dataset.w = width;
      resizeCount++;

      // Wait for frame
      await new Promise(r => requestAnimationFrame(r));

      const frameEnd = performance.now();
      frameTimes.push(frameEnd - frameStart);
      lastFrameTime = frameEnd;

      await new Promise(r => setTimeout(r, 16));
    }

    // Calculate statistics
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const droppedFrames = frameTimes.filter(t => t > 20).length;
    const severeDrops = frameTimes.filter(t => t > 33).length;

    return {
      resizeCount,
      totalFrames: frameTimes.length,
      droppedFrames,
      severeDrops,
      avgFrameTime: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      maxFrameTime: Math.max(...frameTimes),
      p95FrameTime: sorted[Math.floor(sorted.length * 0.95)],
      p99FrameTime: sorted[Math.floor(sorted.length * 0.99)],
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

  // Analyze trace for TimerFire
  const timerFires = traceEvents.filter(e => e.name === 'TimerFire' && e.ph === 'X');
  const totalTimerTime = timerFires.reduce((sum, e) => sum + (e.dur || 0) / 1000, 0);

  return {
    refreshRate,
    ...results,
    timerFireCount: timerFires.length,
    timerFireTotal: totalTimerTime,
  };
}

function printResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log(' BENCHMARK RESULTS');
  console.log('='.repeat(80));

  console.log(`\n${'refreshRate'.padEnd(12)} | ${'Frames'.padEnd(8)} | ${'Dropped'.padEnd(8)} | ${'Drop%'.padEnd(8)} | ${'Avg(ms)'.padEnd(10)} | ${'P95(ms)'.padEnd(10)} | ${'Timer(ms)'.padEnd(10)}`);
  console.log('-'.repeat(85));

  for (const r of results) {
    const dropRate = ((r.droppedFrames / r.totalFrames) * 100).toFixed(1);
    console.log(
      `${String(r.refreshRate).padEnd(12)} | ` +
      `${String(r.totalFrames).padEnd(8)} | ` +
      `${String(r.droppedFrames).padEnd(8)} | ` +
      `${(dropRate + '%').padEnd(8)} | ` +
      `${r.avgFrameTime.toFixed(2).padEnd(10)} | ` +
      `${r.p95FrameTime.toFixed(2).padEnd(10)} | ` +
      `${r.timerFireTotal.toFixed(2).padEnd(10)}`
    );
  }

  // Calculate improvements
  const baseline = results.find(r => r.refreshRate === 1);
  if (baseline) {
    console.log('\n' + '='.repeat(80));
    console.log(' IMPROVEMENTS vs refreshRate=1');
    console.log('='.repeat(80));

    console.log(`\n${'refreshRate'.padEnd(12)} | ${'Drop% Δ'.padEnd(12)} | ${'Avg Δ'.padEnd(12)} | ${'Timer Δ'.padEnd(12)}`);
    console.log('-'.repeat(55));

    for (const r of results) {
      if (r.refreshRate === 1) continue;

      const baseDropRate = (baseline.droppedFrames / baseline.totalFrames) * 100;
      const dropRate = (r.droppedFrames / r.totalFrames) * 100;
      const dropImprove = baseDropRate - dropRate;

      const avgImprove = baseline.avgFrameTime - r.avgFrameTime;
      const timerImprove = baseline.timerFireTotal - r.timerFireTotal;

      console.log(
        `${String(r.refreshRate).padEnd(12)} | ` +
        `${(dropImprove > 0 ? '-' : '+') + Math.abs(dropImprove).toFixed(1) + '%'.padEnd(10)} | ` +
        `${(avgImprove > 0 ? '-' : '+') + Math.abs(avgImprove).toFixed(2) + 'ms'.padEnd(9)} | ` +
        `${(timerImprove > 0 ? '-' : '+') + Math.abs(timerImprove).toFixed(2) + 'ms'.padEnd(9)}`
      );
    }
  }
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

    const results = [];

    // Test different refreshRate values
    for (const refreshRate of [1, 2, 3, 4, 5]) {
      await page.goto(`${server.url}/demo/parameter-lab.html`, {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });

      await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
      await page.evaluate(() => window.setFloatingControlsVisible?.(false));

      const result = await runBenchmark(page, client, refreshRate);
      results.push(result);

      console.log(`  Frames: ${result.totalFrames}`);
      console.log(`  Dropped: ${result.droppedFrames} (${((result.droppedFrames / result.totalFrames) * 100).toFixed(1)}%)`);
      console.log(`  Avg frame: ${result.avgFrameTime.toFixed(2)}ms`);
      console.log(`  P95 frame: ${result.p95FrameTime.toFixed(2)}ms`);
      console.log(`  TimerFire: ${result.timerFireTotal.toFixed(2)}ms`);
    }

    printResults(results);

  } catch (error) {
    console.error('Failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server?.process) server.process.kill();
  }
}

main();
