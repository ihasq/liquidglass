#!/usr/bin/env node
/**
 * Morph Path Verifier
 *
 * Verifies whether morph transitions are actually being used
 * and measures the ParseHTML cost in different scenarios.
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5175'], {
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

    const handleOutput = (data) => {
      const output = data.toString();
      const match = output.match(/Local:\s+(http:\/\/localhost:\d+)/);
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

async function runTest(page, client, testName, smoothingValue, instantPreview) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Test: ${testName}`);
  console.log(`  displacementSmoothing: ${smoothingValue}`);
  console.log(`  instantPreview: ${instantPreview}`);
  console.log('─'.repeat(60));

  // Set smoothing value via CSS property
  await page.evaluate((smoothing) => {
    document.querySelectorAll('.glass-panel').forEach(el => {
      el.style.setProperty('--liquidglass-displacement-smoothing', smoothing);
    });
  }, smoothingValue);

  // Set instant preview mode
  await page.evaluate((enabled) => {
    if (window.lgc_dev) {
      if (enabled) {
        window.lgc_dev.debug.mode.instantPreview.enable();
        window.lgc_dev.debug.log.morph.enable();
      } else {
        window.lgc_dev.debug.mode.instantPreview.disable();
        window.lgc_dev.debug.log.morph.disable();
      }
    }
  }, instantPreview);

  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

  // Capture console logs for morph analysis
  const morphLogs = [];
  const consoleHandler = (msg) => {
    const text = msg.text();
    if (text.includes('[Morph]')) {
      morphLogs.push(text);
    }
  };
  page.on('console', consoleHandler);

  // Start tracing
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink.user_timing',
    ].join(','),
  });

  // Perform resize operations
  const resizeCount = await page.evaluate(async () => {
    const element = document.getElementById('element-1');
    if (!element) return 0;

    const glass = element.querySelector('.glass-panel');
    let count = 0;
    let width = 320;
    let direction = 1;

    const startTime = performance.now();
    while (performance.now() - startTime < 2000) {
      width += 3 * direction;
      if (width >= 450) direction = -1;
      if (width <= 200) direction = 1;

      glass.style.width = `${width}px`;
      element.dataset.w = width;
      count++;

      await new Promise(r => setTimeout(r, 16));
    }
    return count;
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

  page.off('console', consoleHandler);

  // Analyze ParseHTML events
  const parseHTMLEvents = traceEvents.filter(e => e.name === 'ParseHTML' && e.ph === 'X');
  const totalParseTime = parseHTMLEvents.reduce((sum, e) => sum + (e.dur || 0) / 1000, 0);
  const parseCount = parseHTMLEvents.length;

  // Analyze morph logs
  const morphStartCount = morphLogs.filter(l => l.includes('Starting MORPH')).length;
  const morphCompleteCount = morphLogs.filter(l => l.includes('COMPLETED')).length;
  const fullRecreateCount = morphLogs.filter(l => l.includes('FULL filter recreation')).length;

  console.log(`\nResults:`);
  console.log(`  Resize events: ${resizeCount}`);
  console.log(`  ParseHTML calls: ${parseCount}`);
  console.log(`  ParseHTML total time: ${totalParseTime.toFixed(2)}ms`);
  console.log(`  Morph transitions started: ${morphStartCount}`);
  console.log(`  Morph transitions completed: ${morphCompleteCount}`);
  console.log(`  Full filter recreations: ${fullRecreateCount}`);

  if (fullRecreateCount > 0 && morphStartCount === 0) {
    console.log(`\n  ⚠️  WARNING: Morph path NOT being used!`);
    console.log(`     All renders taking slow innerHTML path.`);
  } else if (morphStartCount > 0) {
    console.log(`\n  ✓  Morph path is being used.`);
  }

  return {
    testName,
    smoothingValue,
    instantPreview,
    resizeCount,
    parseCount,
    totalParseTime,
    morphStartCount,
    fullRecreateCount,
  };
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
    await client.send('Performance.enable');

    await page.goto(`${server.url}/demo/parameter-lab.html`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    console.log('Page loaded.');

    // Hide controls
    await page.evaluate(() => {
      if (window.setFloatingControlsVisible) {
        window.setFloatingControlsVisible(false);
      }
    });

    const results = [];

    // Test 1: Default smoothing (30) with instant preview
    results.push(await runTest(page, client, 'Default (smoothing=30, instant)', 30, true));

    // Reload for clean state
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Test 2: No smoothing (0) with instant preview
    results.push(await runTest(page, client, 'No smoothing (smoothing=0, instant)', 0, true));

    // Reload for clean state
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    // Test 3: Default smoothing (30) with throttling
    results.push(await runTest(page, client, 'Default (smoothing=30, throttled)', 30, false));

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log(' SUMMARY');
    console.log('='.repeat(70));
    console.log(`\n${'Test'.padEnd(45)} | ${'ParseHTML'.padEnd(12)} | Morph?`);
    console.log('-'.repeat(70));

    for (const r of results) {
      const morphStatus = r.morphStartCount > 0 ? 'YES' : (r.fullRecreateCount > 0 ? 'NO (full)' : 'N/A');
      console.log(`${r.testName.padEnd(45)} | ${(r.totalParseTime.toFixed(2) + 'ms').padEnd(12)} | ${morphStatus}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log(' DIAGNOSIS');
    console.log('='.repeat(70));

    const smoothing30 = results.find(r => r.smoothingValue === 30 && r.instantPreview);
    const smoothing0 = results.find(r => r.smoothingValue === 0 && r.instantPreview);

    if (smoothing30 && smoothing0) {
      const ratio = smoothing30.totalParseTime / Math.max(smoothing0.totalParseTime, 0.01);

      if (smoothing30.morphStartCount === 0 && smoothing0.morphStartCount > 0) {
        console.log('\n✗ CONFIRMED: displacementSmoothing > 0 breaks morph transitions.');
        console.log('  When smoothing is enabled, dOld/dNew are feGaussianBlur elements,');
        console.log('  but filter-manager queries for feImage[result="dOld"], returning null.');
        console.log(`\n  ParseHTML cost with smoothing=30: ${smoothing30.totalParseTime.toFixed(2)}ms`);
        console.log(`  ParseHTML cost with smoothing=0:  ${smoothing0.totalParseTime.toFixed(2)}ms`);
        console.log(`  Ratio: ${ratio.toFixed(1)}x slower`);
      } else if (smoothing30.morphStartCount > 0) {
        console.log('\n✓ Morph transitions working with smoothing enabled.');
      }
    }

  } catch (error) {
    console.error('Test failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server?.process) server.process.kill();
  }
}

main();
