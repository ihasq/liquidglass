#!/usr/bin/env node
/**
 * TimerFire Profiler
 *
 * Analyzes setTimeout/setInterval callbacks that contribute to frame drops
 * in instant preview mode.
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5176'], {
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

function analyzeTimerEvents(traceEvents) {
  const timerFires = [];
  const timerInstalls = new Map(); // timerId -> install info

  // First pass: collect TimerInstall events
  for (const event of traceEvents) {
    if (event.name === 'TimerInstall' && event.args?.data) {
      const { timerId, timeout, singleShot } = event.args.data;
      timerInstalls.set(timerId, {
        timeout,
        singleShot,
        ts: event.ts,
        stack: event.args.data.stackTrace || [],
      });
    }
  }

  // Second pass: collect TimerFire events with duration
  for (const event of traceEvents) {
    if (event.name === 'TimerFire' && event.ph === 'X') {
      const timerId = event.args?.data?.timerId;
      const installInfo = timerInstalls.get(timerId);

      timerFires.push({
        timerId,
        duration: (event.dur || 0) / 1000, // Convert to ms
        ts: event.ts,
        timeout: installInfo?.timeout,
        singleShot: installInfo?.singleShot,
        installStack: installInfo?.stack || [],
      });
    }
  }

  // Sort by duration (descending)
  timerFires.sort((a, b) => b.duration - a.duration);

  // Group by timeout value
  const byTimeout = new Map();
  for (const fire of timerFires) {
    const key = fire.timeout ?? 'unknown';
    if (!byTimeout.has(key)) {
      byTimeout.set(key, { count: 0, totalDuration: 0, samples: [] });
    }
    const entry = byTimeout.get(key);
    entry.count++;
    entry.totalDuration += fire.duration;
    if (entry.samples.length < 3) {
      entry.samples.push(fire);
    }
  }

  // Analyze FunctionCall events within TimerFire
  const functionCalls = new Map();
  let currentTimerFire = null;

  for (const event of traceEvents) {
    if (event.name === 'TimerFire' && event.ph === 'B') {
      currentTimerFire = event;
    } else if (event.name === 'TimerFire' && event.ph === 'E') {
      currentTimerFire = null;
    } else if (currentTimerFire && event.name === 'FunctionCall' && event.ph === 'X') {
      const funcName = event.args?.data?.functionName || 'anonymous';
      const url = event.args?.data?.url || '';
      const key = `${funcName} (${url.split('/').pop()})`;

      if (!functionCalls.has(key)) {
        functionCalls.set(key, { count: 0, totalDuration: 0 });
      }
      const entry = functionCalls.get(key);
      entry.count++;
      entry.totalDuration += (event.dur || 0) / 1000;
    }
  }

  return {
    totalFires: timerFires.length,
    totalDuration: timerFires.reduce((sum, f) => sum + f.duration, 0),
    topByDuration: timerFires.slice(0, 10),
    byTimeout: Array.from(byTimeout.entries())
      .map(([timeout, data]) => ({ timeout, ...data }))
      .sort((a, b) => b.totalDuration - a.totalDuration),
    functionCalls: Array.from(functionCalls.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.totalDuration - a.totalDuration)
      .slice(0, 15),
  };
}

async function runProfilingSession(page, client, instantPreview) {
  const mode = instantPreview ? 'INSTANT_PREVIEW' : 'THROTTLED';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Profiling: ${mode}`);
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

  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

  // Start detailed tracing
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
      'v8.execute',
    ].join(','),
    options: 'sampling-frequency=10000',
  });

  // Perform resize operations
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

  return analyzeTimerEvents(traceEvents);
}

function printResults(mode, analysis) {
  console.log(`\n--- ${mode} Results ---\n`);

  console.log(`Total TimerFire events: ${analysis.totalFires}`);
  console.log(`Total TimerFire duration: ${analysis.totalDuration.toFixed(2)}ms`);

  console.log('\n[By Timeout Value]');
  console.log(`${'Timeout'.padEnd(12)} | ${'Count'.padEnd(8)} | ${'Total (ms)'.padEnd(12)} | Avg (ms)`);
  console.log('-'.repeat(55));
  for (const entry of analysis.byTimeout.slice(0, 10)) {
    const avg = entry.count > 0 ? (entry.totalDuration / entry.count).toFixed(2) : '0';
    console.log(
      `${String(entry.timeout).padEnd(12)} | ` +
      `${String(entry.count).padEnd(8)} | ` +
      `${entry.totalDuration.toFixed(2).padEnd(12)} | ` +
      `${avg}`
    );
  }

  console.log('\n[Top Functions in TimerFire]');
  console.log(`${'Function'.padEnd(50)} | ${'Count'.padEnd(8)} | Total (ms)`);
  console.log('-'.repeat(75));
  for (const fn of analysis.functionCalls.slice(0, 10)) {
    console.log(
      `${fn.name.slice(0, 48).padEnd(50)} | ` +
      `${String(fn.count).padEnd(8)} | ` +
      `${fn.totalDuration.toFixed(2)}`
    );
  }

  console.log('\n[Longest Individual TimerFire Events]');
  for (const fire of analysis.topByDuration.slice(0, 5)) {
    console.log(`  ${fire.duration.toFixed(2)}ms (timeout=${fire.timeout}ms, singleShot=${fire.singleShot})`);
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

    await page.goto(`${server.url}/demo/parameter-lab.html`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Run throttled first
    const throttledAnalysis = await runProfilingSession(page, client, false);

    // Reload
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Run instant preview
    const instantAnalysis = await runProfilingSession(page, client, true);

    // Print results
    printResults('THROTTLED', throttledAnalysis);
    printResults('INSTANT_PREVIEW', instantAnalysis);

    // Comparison
    console.log('\n' + '='.repeat(70));
    console.log(' COMPARISON');
    console.log('='.repeat(70));

    console.log(`\n${'Metric'.padEnd(30)} | ${'Throttled'.padEnd(15)} | ${'Instant'.padEnd(15)} | Delta`);
    console.log('-'.repeat(75));
    console.log(
      `${'TimerFire count'.padEnd(30)} | ` +
      `${String(throttledAnalysis.totalFires).padEnd(15)} | ` +
      `${String(instantAnalysis.totalFires).padEnd(15)} | ` +
      `+${instantAnalysis.totalFires - throttledAnalysis.totalFires}`
    );
    console.log(
      `${'TimerFire total (ms)'.padEnd(30)} | ` +
      `${throttledAnalysis.totalDuration.toFixed(2).padEnd(15)} | ` +
      `${instantAnalysis.totalDuration.toFixed(2).padEnd(15)} | ` +
      `+${(instantAnalysis.totalDuration - throttledAnalysis.totalDuration).toFixed(2)}`
    );

    // Identify timeout values unique to or significantly higher in instant mode
    console.log('\n[Timeout Values with Significant Increase]');
    const throttledTimeouts = new Map(throttledAnalysis.byTimeout.map(t => [t.timeout, t]));

    for (const inst of instantAnalysis.byTimeout) {
      const thr = throttledTimeouts.get(inst.timeout);
      if (!thr || inst.totalDuration > thr.totalDuration * 1.5) {
        const thrDur = thr ? thr.totalDuration.toFixed(2) : '0';
        const increase = thr ? ((inst.totalDuration / thr.totalDuration - 1) * 100).toFixed(0) : 'N/A';
        console.log(
          `  timeout=${inst.timeout}ms: ` +
          `${thrDur}ms → ${inst.totalDuration.toFixed(2)}ms ` +
          `(+${increase}%, ${inst.count} fires)`
        );
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
