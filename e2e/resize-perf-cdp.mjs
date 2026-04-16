/**
 * CDP-based Performance Test for Liquid Glass Resize
 *
 * Measures performance difference between:
 * 1. Normal mode (adaptive throttling enabled)
 * 2. Instant Preview mode (throttling bypassed)
 *
 * Uses Chrome DevTools Protocol for:
 * - CPU throttling (0.1x = 10x slowdown)
 * - Performance tracing
 * - Frame timing analysis
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  cpuThrottling: 10, // 0.1x speed = 10x slowdown (slowdownRate param)
  resizeFrames: 20,  // Number of resize steps
  frameDelay: 16,    // Delay between frames (~60fps simulation)
  startSize: { width: 200, height: 150 },
  endSize: { width: 450, height: 350 },
  traceCategories: [
    'devtools.timeline',
    'v8.execute',
    'blink.user_timing',
    'loading',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'disabled-by-default-devtools.timeline.stack',
    'disabled-by-default-v8.cpu_profiler',
  ],
};

let viteProcess = null;

async function startDevServer() {
  console.log('Starting Vite dev server...');

  return new Promise((resolve, reject) => {
    viteProcess = spawn('npm', ['run', 'dev', '--', '--port', '5199'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    viteProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('Local:') || output.includes('localhost:5199')) {
        console.log('Vite dev server started on port 5199');
        resolve();
      }
    });

    viteProcess.stderr.on('data', (data) => {
      const str = data.toString();
      if (!str.includes('ExperimentalWarning')) {
        console.error('Vite stderr:', str);
      }
    });

    viteProcess.on('error', reject);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!output.includes('localhost')) {
        reject(new Error('Vite server startup timeout'));
      }
    }, 30000);
  });
}

function stopDevServer() {
  if (viteProcess) {
    console.log('Stopping Vite dev server...');
    viteProcess.kill('SIGTERM');
    viteProcess = null;
  }
}

async function runPerformanceTest(page, cdp, mode) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running test: ${mode.toUpperCase()} MODE`);
  console.log('='.repeat(60));

  // Navigate and wait for element
  await page.goto('http://localhost:5199/e2e/resize-perf-test.html', {
    waitUntil: 'networkidle0',
  });
  await page.waitForSelector('#test-element');

  // Initialize test API
  await page.evaluate(() => window.testAPI.init());

  // Set up debug mode
  if (mode === 'instantPreview') {
    const result = await page.evaluate(() => window.testAPI.enableInstantPreview());
    console.log(`Instant Preview mode enabled: ${result}`);
  } else {
    // Enable logs even in normal mode to see throttle decisions
    await page.evaluate(() => {
      window.testAPI.disableInstantPreview();
      if (typeof lgc_dev !== 'undefined') {
        lgc_dev.debug.log.throttle.enable();
        lgc_dev.debug.log.progressive.enable();
      }
    });
    console.log('Running with normal throttling (debug logs enabled)');
  }

  // Start log capture
  await page.evaluate(() => window.testAPI.startLogCapture());

  // Get debug status
  const debugStatus = await page.evaluate(() => window.testAPI.getDebugStatus());
  console.log('Debug status:', JSON.stringify(debugStatus, null, 2));

  // Generate resize steps
  const steps = await page.evaluate((config) => {
    return window.testAPI.generateResizeSteps(
      config.startSize.width,
      config.startSize.height,
      config.endSize.width,
      config.endSize.height,
      config.resizeFrames
    );
  }, CONFIG);

  // Enable CPU throttling via CDP
  console.log(`\nEnabling CPU throttling: ${CONFIG.cpuThrottling}x slowdown (0.1x speed)`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CONFIG.cpuThrottling });

  // Enable CPU profiler for detailed stack traces
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100μs sampling
  await cdp.send('Profiler.start');

  // Start performance tracing
  console.log('Starting performance trace...');
  await cdp.send('Tracing.start', {
    categories: CONFIG.traceCategories.join(','),
    options: 'sampling-frequency=10000',
  });

  // Update status
  await page.evaluate((mode) => {
    window.testAPI.updateStatus(`Running ${mode} mode test...`);
  }, mode);

  // Run resize sequence
  const startTime = Date.now();
  const result = await page.evaluate(async (steps, delay) => {
    return await window.testAPI.runResizeSequence(steps, delay);
  }, steps, CONFIG.frameDelay);
  const wallClockTime = Date.now() - startTime;

  // Stop profiler and get CPU profile
  const { profile: cpuProfile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');

  // Stop tracing and collect data
  const traceData = await new Promise((resolve) => {
    const chunks = [];
    cdp.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
    cdp.on('Tracing.tracingComplete', () => {
      resolve(chunks);
    });
    cdp.send('Tracing.end');
  });

  // Disable CPU throttling
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('CPU throttling disabled');

  // Collect debug logs
  const logs = await page.evaluate(() => window.testAPI.getLogs());

  // Analyze trace data
  const analysis = analyzeTraceData(traceData, result);

  // Analyze CPU profile for hot spots
  const cpuAnalysis = analyzeCpuProfile(cpuProfile);

  // Print results
  console.log('\n--- RESULTS ---');
  console.log(`Mode: ${mode}`);
  console.log(`Resize frames: ${result.frameCount}`);
  console.log(`JS-reported total time: ${result.totalTime.toFixed(2)}ms`);
  console.log(`Wall clock time: ${wallClockTime}ms`);
  console.log(`Average frame interval: ${(result.totalTime / result.frameCount).toFixed(2)}ms`);

  console.log('\n--- TRACE ANALYSIS ---');
  console.log(`Total trace events: ${traceData.length}`);
  console.log(`Task events: ${analysis.taskCount}`);
  console.log(`Long tasks (>50ms): ${analysis.longTasks.length}`);
  console.log(`Frame events: ${analysis.frameCount}`);
  console.log(`Dropped frames: ${analysis.droppedFrames}`);

  if (analysis.longTasks.length > 0) {
    console.log('\n--- LONG TASKS (>50ms) ---');
    analysis.longTasks.slice(0, 10).forEach((task, i) => {
      console.log(`  ${i + 1}. Duration: ${task.duration.toFixed(2)}ms`);
      if (task.stack) {
        console.log(`     Stack: ${task.stack.slice(0, 200)}...`);
      }
    });
  }

  if (analysis.topFunctions.length > 0) {
    console.log('\n--- TOP CPU CONSUMERS (trace) ---');
    analysis.topFunctions.slice(0, 10).forEach((fn, i) => {
      console.log(`  ${i + 1}. ${fn.name}: ${fn.totalTime.toFixed(2)}ms (${fn.count} calls)`);
    });
  }

  if (cpuAnalysis.hotSpots.length > 0) {
    console.log('\n--- CPU PROFILE HOT SPOTS ---');
    console.log(`Total profiled time: ${cpuAnalysis.totalTime.toFixed(2)}ms`);
    cpuAnalysis.hotSpots.slice(0, 15).forEach((spot, i) => {
      // Highlight liquid-glass related functions
      const isLiquidGlass = spot.name.includes('liquidglass') || spot.name.includes('filter') ||
                            spot.name.includes('displacement') || spot.name.includes('wasm') ||
                            spot.name.includes('canvas') || spot.name.includes('specular');
      const prefix = isLiquidGlass ? '>>> ' : '    ';
      console.log(`${prefix}${i + 1}. ${spot.timeMs.toFixed(2)}ms - ${spot.name.slice(0, 80)}`);
    });
  }

  console.log('\n--- DEBUG LOGS ---');
  const throttleLogs = logs.filter(l => l.msg.includes('[Throttle]'));
  const progressiveLogs = logs.filter(l => l.msg.includes('[Progressive]'));
  console.log(`Throttle events: ${throttleLogs.length}`);
  console.log(`Progressive events: ${progressiveLogs.length}`);

  // Sample of throttle decisions
  if (throttleLogs.length > 0) {
    console.log('\nThrottle decision samples:');
    throttleLogs.slice(0, 5).forEach((log, i) => {
      // Extract mode from log
      const modeMatch = log.msg.match(/mode['":\s]+['"]?(\w+)/);
      const mode = modeMatch ? modeMatch[1] : 'unknown';
      console.log(`  ${i + 1}. ${mode} @ ${log.time.toFixed(0)}ms`);
    });
    if (throttleLogs.length > 5) {
      console.log(`  ... and ${throttleLogs.length - 5} more`);
    }
  }

  return {
    mode,
    result,
    wallClockTime,
    analysis,
    cpuAnalysis,
    logs: { throttle: throttleLogs, progressive: progressiveLogs },
  };
}

function analyzeTraceData(traceData, resizeResult) {
  const analysis = {
    taskCount: 0,
    longTasks: [],
    frameCount: 0,
    droppedFrames: 0,
    topFunctions: [],
  };

  const functionTimes = new Map();

  for (const event of traceData) {
    // Count tasks
    if (event.name === 'RunTask' || event.name === 'FunctionCall') {
      analysis.taskCount++;

      const duration = (event.dur || 0) / 1000; // Convert to ms
      if (duration > 50) {
        const stack = event.args?.data?.stackTrace
          ? event.args.data.stackTrace.map(f => f.functionName).join(' → ')
          : null;
        analysis.longTasks.push({ duration, stack, event });
      }
    }

    // Count frames
    if (event.name === 'BeginFrame' || event.name === 'DrawFrame') {
      analysis.frameCount++;
    }

    // Track dropped frames
    if (event.name === 'DroppedFrame') {
      analysis.droppedFrames++;
    }

    // Aggregate function times
    if (event.name === 'FunctionCall' && event.dur) {
      const fnName = event.args?.data?.functionName || 'anonymous';
      const existing = functionTimes.get(fnName) || { totalTime: 0, count: 0 };
      existing.totalTime += event.dur / 1000;
      existing.count++;
      functionTimes.set(fnName, existing);
    }

    // Track V8 compilation/execution
    if (event.cat?.includes('v8') && event.dur) {
      const fnName = `[V8] ${event.name}`;
      const existing = functionTimes.get(fnName) || { totalTime: 0, count: 0 };
      existing.totalTime += event.dur / 1000;
      existing.count++;
      functionTimes.set(fnName, existing);
    }
  }

  // Sort functions by total time
  analysis.topFunctions = Array.from(functionTimes.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.totalTime - a.totalTime);

  return analysis;
}

/**
 * Analyze CPU profile to find hot spots
 */
function analyzeCpuProfile(profile) {
  if (!profile || !profile.nodes) {
    return { hotSpots: [], totalTime: 0 };
  }

  const nodeMap = new Map();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Calculate self time for each node
  const nodeTimes = new Map();
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];

  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    nodeTimes.set(nodeId, (nodeTimes.get(nodeId) || 0) + delta);
  }

  // Aggregate by function name
  const functionTimes = new Map();
  for (const [nodeId, time] of nodeTimes) {
    const node = nodeMap.get(nodeId);
    if (!node || !node.callFrame) continue;

    const cf = node.callFrame;
    const key = `${cf.functionName || '(anonymous)'} @ ${cf.url || 'native'}:${cf.lineNumber}`;
    const existing = functionTimes.get(key) || { time: 0, url: cf.url, line: cf.lineNumber };
    existing.time += time;
    functionTimes.set(key, existing);
  }

  // Sort by time
  const hotSpots = Array.from(functionTimes.entries())
    .map(([name, data]) => ({ name, timeUs: data.time, timeMs: data.time / 1000, ...data }))
    .filter(h => h.timeMs > 0.5) // Filter noise
    .sort((a, b) => b.timeUs - a.timeUs);

  const totalTime = hotSpots.reduce((sum, h) => sum + h.timeMs, 0);

  return { hotSpots, totalTime };
}

async function main() {
  let browser = null;

  try {
    // Start dev server
    await startDevServer();

    // Wait for server to be fully ready
    await new Promise(r => setTimeout(r, 2000));

    // Launch browser
    console.log('\nLaunching Chrome...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--enable-features=NetworkService',
      ],
    });

    const page = await browser.newPage();

    // Create CDP session
    const cdp = await page.createCDPSession();

    // Run tests
    const results = {};

    // Test 1: Normal mode (throttling enabled)
    results.normal = await runPerformanceTest(page, cdp, 'normal');

    // Brief pause between tests
    await new Promise(r => setTimeout(r, 1000));

    // Test 2: Instant Preview mode (throttling bypassed)
    results.instantPreview = await runPerformanceTest(page, cdp, 'instantPreview');

    // Comparison summary
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON SUMMARY');
    console.log('='.repeat(60));

    console.log('\n| Metric                    | Normal Mode | Instant Preview |');
    console.log('|---------------------------|-------------|-----------------|');
    console.log(`| JS Total Time             | ${results.normal.result.totalTime.toFixed(1).padStart(9)}ms | ${results.instantPreview.result.totalTime.toFixed(1).padStart(13)}ms |`);
    console.log(`| Wall Clock Time           | ${results.normal.wallClockTime.toString().padStart(9)}ms | ${results.instantPreview.wallClockTime.toString().padStart(13)}ms |`);
    console.log(`| Long Tasks (>50ms)        | ${results.normal.analysis.longTasks.length.toString().padStart(11)} | ${results.instantPreview.analysis.longTasks.length.toString().padStart(15)} |`);
    console.log(`| Dropped Frames            | ${results.normal.analysis.droppedFrames.toString().padStart(11)} | ${results.instantPreview.analysis.droppedFrames.toString().padStart(15)} |`);
    console.log(`| Throttle Events           | ${results.normal.logs.throttle.length.toString().padStart(11)} | ${results.instantPreview.logs.throttle.length.toString().padStart(15)} |`);
    console.log(`| Progressive Events        | ${results.normal.logs.progressive.length.toString().padStart(11)} | ${results.instantPreview.logs.progressive.length.toString().padStart(15)} |`);

    // Identify bottlenecks
    console.log('\n--- BOTTLENECK ANALYSIS ---');

    const instantLongTasks = results.instantPreview.analysis.longTasks;
    if (instantLongTasks.length > 0) {
      console.log('\nInstant Preview mode long tasks indicate these bottlenecks:');
      const bottleneckCategories = {};

      instantLongTasks.forEach(task => {
        const stack = task.stack || '';
        let category = 'Unknown';

        if (stack.includes('generateWasm') || stack.includes('WASM') || stack.includes('wasm')) {
          category = 'WASM Displacement Generation';
        } else if (stack.includes('toDataURL') || stack.includes('canvas')) {
          category = 'Canvas toDataURL (PNG encoding)';
        } else if (stack.includes('putImageData') || stack.includes('ImageData')) {
          category = 'Canvas ImageData operations';
        } else if (stack.includes('Filter') || stack.includes('filter')) {
          category = 'SVG Filter creation/update';
        } else if (stack.includes('style') || stack.includes('CSS')) {
          category = 'Style recalculation';
        } else if (stack.includes('specular') || stack.includes('Specular')) {
          category = 'Specular map generation';
        }

        bottleneckCategories[category] = (bottleneckCategories[category] || 0) + task.duration;
      });

      Object.entries(bottleneckCategories)
        .sort(([,a], [,b]) => b - a)
        .forEach(([cat, time]) => {
          console.log(`  - ${cat}: ${time.toFixed(1)}ms total`);
        });
    } else {
      console.log('No significant long tasks detected in instant preview mode.');
    }

    // Check if renders actually happened per frame
    const normalRenders = results.normal.logs.throttle.filter(l =>
      l.msg.includes('PASSED') || l.msg.includes('DEFERRED') || l.msg.includes('COALESCED')
    ).length;
    const instantRenders = results.instantPreview.logs.throttle.filter(l =>
      l.msg.includes('INSTANT PREVIEW') || l.msg.includes('immediate')
    ).length;

    console.log(`\nActual render triggers:`);
    console.log(`  Normal mode: ${normalRenders} (throttled)`);
    console.log(`  Instant Preview: ${instantRenders} (every frame)`);

    if (results.instantPreview.analysis.longTasks.length > results.normal.analysis.longTasks.length) {
      console.log('\n[!] Instant Preview mode generates MORE long tasks.');
      console.log('    This is expected as it renders on every resize event.');
      console.log('    Bottleneck is in the displacement map generation pipeline.');
    }

  } catch (error) {
    console.error('Test failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    stopDevServer();
  }
}

main();
