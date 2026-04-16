#!/usr/bin/env node
/**
 * Render Pipeline Profiler
 *
 * Analyzes the cost breakdown of each render operation:
 * - WASM displacement map generation
 * - Specular map generation
 * - SVG filter update
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const vite = spawn('npx', ['vite', '--port', '5177'], {
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

async function runProfilingSession(page, instantPreview) {
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

  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // Inject performance instrumentation
  const metrics = await page.evaluate(async () => {
    // Track render pipeline costs
    const measurements = {
      resizeCount: 0,
      renderCalls: 0,
      wasmCalls: 0,
      specularCalls: 0,
      filterUpdates: 0,
      totalRenderTime: 0,
      totalWasmTime: 0,
      totalSpecularTime: 0,
      totalFilterTime: 0,
      renderTimes: [],
      wasmTimes: [],
      specularTimes: [],
      filterTimes: [],
    };

    // Wrap performance.now for consistent timing
    const now = performance.now.bind(performance);

    // Instrument via user timing API marks
    const originalMark = performance.mark.bind(performance);
    const marks = new Map();

    performance.mark = function(name, options) {
      marks.set(name, now());
      return originalMark(name, options);
    };

    // Run resize test with performance marks
    const element = document.getElementById('element-1');
    if (!element) return { error: 'Element not found' };

    const glass = element.querySelector('.glass-panel');
    let width = 320;
    let direction = 1;

    const startTime = now();
    while (now() - startTime < 3000) {
      const resizeStart = now();

      width += 2 * direction;
      if (width >= 450) direction = -1;
      if (width <= 200) direction = 1;

      glass.style.width = `${width}px`;
      element.dataset.w = width;

      measurements.resizeCount++;

      // Wait for next frame to allow render to complete
      await new Promise(r => requestAnimationFrame(r));

      const resizeEnd = now();
      const resizeTime = resizeEnd - resizeStart;

      // Record if this was a "slow" frame (>20ms)
      if (resizeTime > 20) {
        measurements.renderTimes.push(resizeTime);
      }

      await new Promise(r => setTimeout(r, 16));
    }

    return measurements;
  });

  return { mode, metrics };
}

async function runDetailedProfiling(page, client, instantPreview) {
  const mode = instantPreview ? 'INSTANT_PREVIEW' : 'THROTTLED';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Detailed Profiling: ${mode}`);
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

  // Start CPU profiling
  await client.send('Profiler.enable');
  await client.send('Profiler.start');

  // Run resize test
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

  // Stop profiling and get results
  const { profile } = await client.send('Profiler.stop');
  await client.send('Profiler.disable');

  // Analyze profile
  const functionStats = new Map();

  function processNode(node, totalTime = 0) {
    const name = node.callFrame?.functionName || '(anonymous)';
    const url = node.callFrame?.url || '';
    const selfTime = node.hitCount * (profile.samplingInterval || 1) / 1000; // Convert to ms

    // Filter for relevant functions
    const isRelevant =
      url.includes('liquidglass') ||
      url.includes('filter-manager') ||
      url.includes('displacement') ||
      url.includes('specular') ||
      url.includes('svg-builder') ||
      url.includes('wasm') ||
      name.includes('generate') ||
      name.includes('render') ||
      name.includes('filter') ||
      name.includes('displacement') ||
      name.includes('specular');

    if (isRelevant && name !== '(idle)' && name !== '(program)' && name !== '(garbage collector)') {
      const key = `${name} (${url.split('/').pop() || 'native'})`;
      if (!functionStats.has(key)) {
        functionStats.set(key, { selfTime: 0, hitCount: 0 });
      }
      const entry = functionStats.get(key);
      entry.selfTime += selfTime;
      entry.hitCount += node.hitCount || 0;
    }

    // Process children
    if (node.children) {
      for (const childId of node.children) {
        const childNode = profile.nodes.find(n => n.id === childId);
        if (childNode) {
          processNode(childNode);
        }
      }
    }
  }

  // Build node lookup
  const nodeById = new Map(profile.nodes.map(n => [n.id, n]));

  // Process from root
  for (const node of profile.nodes) {
    if (node.callFrame) {
      const name = node.callFrame.functionName || '(anonymous)';
      const url = node.callFrame.url || '';
      const selfTime = (node.hitCount || 0) * (profile.samplingInterval || 1) / 1000;

      const isRelevant =
        url.includes('filter-manager') ||
        url.includes('displacement') ||
        url.includes('specular') ||
        url.includes('svg-builder') ||
        url.includes('wasm-generator') ||
        url.includes('highlight') ||
        name.includes('generate') ||
        name.includes('render') ||
        name.includes('_render') ||
        name.includes('_createFilter') ||
        name.includes('buildFilterChain');

      if (isRelevant && selfTime > 0) {
        const key = `${name} (${url.split('/').pop() || 'native'})`;
        if (!functionStats.has(key)) {
          functionStats.set(key, { selfTime: 0, hitCount: 0 });
        }
        const entry = functionStats.get(key);
        entry.selfTime += selfTime;
        entry.hitCount += node.hitCount || 0;
      }
    }
  }

  // Sort by self time
  const sorted = Array.from(functionStats.entries())
    .map(([name, data]) => ({ name, ...data }))
    .filter(f => f.selfTime > 0.5) // Filter out noise
    .sort((a, b) => b.selfTime - a.selfTime);

  return { mode, functions: sorted, totalSamples: profile.samples?.length || 0 };
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

    // Run detailed CPU profiling for both modes
    const throttledProfile = await runDetailedProfiling(page, client, false);

    // Reload
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof window.lgc_dev !== 'undefined');
    await page.evaluate(() => window.setFloatingControlsVisible?.(false));

    const instantProfile = await runDetailedProfiling(page, client, true);

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log(' CPU PROFILE: THROTTLED');
    console.log('='.repeat(70));
    console.log(`Total samples: ${throttledProfile.totalSamples}`);
    console.log(`\n${'Function'.padEnd(55)} | Self Time (ms)`);
    console.log('-'.repeat(75));
    for (const fn of throttledProfile.functions.slice(0, 15)) {
      console.log(`${fn.name.slice(0, 53).padEnd(55)} | ${fn.selfTime.toFixed(2)}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log(' CPU PROFILE: INSTANT_PREVIEW');
    console.log('='.repeat(70));
    console.log(`Total samples: ${instantProfile.totalSamples}`);
    console.log(`\n${'Function'.padEnd(55)} | Self Time (ms)`);
    console.log('-'.repeat(75));
    for (const fn of instantProfile.functions.slice(0, 15)) {
      console.log(`${fn.name.slice(0, 53).padEnd(55)} | ${fn.selfTime.toFixed(2)}`);
    }

    // Comparison
    console.log('\n' + '='.repeat(70));
    console.log(' COMPARISON: Functions with >50% increase');
    console.log('='.repeat(70));

    const throttledMap = new Map(throttledProfile.functions.map(f => [f.name, f.selfTime]));

    for (const fn of instantProfile.functions) {
      const throttledTime = throttledMap.get(fn.name) || 0;
      if (fn.selfTime > throttledTime * 1.5 && fn.selfTime > 1) {
        const increase = throttledTime > 0 ? ((fn.selfTime / throttledTime - 1) * 100).toFixed(0) : 'N/A';
        console.log(`\n${fn.name}`);
        console.log(`  Throttled: ${throttledTime.toFixed(2)}ms`);
        console.log(`  Instant:   ${fn.selfTime.toFixed(2)}ms`);
        console.log(`  Increase:  +${increase}%`);
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
