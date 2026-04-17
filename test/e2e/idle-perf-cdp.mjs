/**
 * CDP-based Idle Performance Test for Liquid Glass
 *
 * Measures performance difference between normal and instant preview modes
 * during COMPLETE IDLE - no resize, no mouse movement, no interaction.
 *
 * This helps identify if there are:
 * - Polling loops or timers running in the background
 * - Memory leaks causing GC pressure
 * - Unnecessary re-renders or observers firing
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  cpuThrottling: 4, // 4x slowdown to amplify issues
  idleDuration: 5000, // 5 seconds of idle measurement
  warmupDuration: 1000, // 1 second warmup before measurement
  traceCategories: [
    'devtools.timeline',
    'v8.execute',
    'blink.user_timing',
    'loading',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'disabled-by-default-devtools.timeline.stack',
    'disabled-by-default-v8.cpu_profiler',
    'disabled-by-default-devtools.timeline.invalidationTracking',
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
        // console.error('Vite stderr:', str);
      }
    });

    viteProcess.on('error', reject);

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

async function runIdlePerformanceTest(page, cdp, mode) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running IDLE test: ${mode.toUpperCase()} MODE`);
  console.log('='.repeat(60));

  // Navigate and wait for element
  await page.goto('http://localhost:5199/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
  });

  // Wait for liquid glass to be fully initialized
  await page.waitForFunction(() => {
    return typeof lgc_dev !== 'undefined';
  }, { timeout: 10000 });

  // Set up debug mode
  if (mode === 'instantPreview') {
    await page.evaluate(() => {
      lgc_dev.debug.mode.instantPreview.enable();
      lgc_dev.debug.log.enableAll();
    });
    console.log('Instant Preview mode ENABLED');
  } else {
    await page.evaluate(() => {
      lgc_dev.debug.mode.instantPreview.disable();
      lgc_dev.debug.log.enableAll();
    });
    console.log('Normal mode (Instant Preview DISABLED)');
  }

  // Get debug status
  const debugStatus = await page.evaluate(() => ({
    instantPreview: lgc_dev.debug.mode.instantPreview.isEnabled(),
    logStatus: lgc_dev.debug.log.status(),
  }));
  console.log('Debug status:', JSON.stringify(debugStatus, null, 2));

  // Start console log capture
  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[LiquidGlass]')) {
      consoleLogs.push({
        time: Date.now(),
        text,
        type: msg.type(),
      });
    }
  });

  // Warmup period - let everything settle
  console.log(`\nWarmup period: ${CONFIG.warmupDuration}ms...`);
  await new Promise(r => setTimeout(r, CONFIG.warmupDuration));

  // Clear console logs after warmup
  consoleLogs.length = 0;

  // Enable CPU throttling
  console.log(`\nEnabling CPU throttling: ${CONFIG.cpuThrottling}x slowdown`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CONFIG.cpuThrottling });

  // Enable CPU profiler
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100μs
  await cdp.send('Profiler.start');

  // Start heap profiling to detect memory churn
  await cdp.send('HeapProfiler.enable');
  const heapBefore = await cdp.send('HeapProfiler.collectGarbage').catch(() => null);

  // Start performance tracing
  console.log('Starting performance trace...');
  await cdp.send('Tracing.start', {
    categories: CONFIG.traceCategories.join(','),
    options: 'sampling-frequency=10000',
  });

  // Start measurement timestamp
  const measurementStart = Date.now();

  // === IDLE PERIOD - NO INTERACTION ===
  console.log(`\n>>> IDLE MEASUREMENT: ${CONFIG.idleDuration}ms (NO INTERACTION) <<<`);

  // Just wait - no interaction at all
  await new Promise(r => setTimeout(r, CONFIG.idleDuration));

  const measurementEnd = Date.now();
  const actualIdleTime = measurementEnd - measurementStart;

  // Stop profiler and get CPU profile
  const { profile: cpuProfile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');

  // Stop tracing and collect data
  const traceData = await new Promise((resolve) => {
    const chunks = [];
    const dataHandler = ({ value }) => chunks.push(...value);
    const completeHandler = () => {
      cdp.off('Tracing.dataCollected', dataHandler);
      cdp.off('Tracing.tracingComplete', completeHandler);
      resolve(chunks);
    };
    cdp.on('Tracing.dataCollected', dataHandler);
    cdp.on('Tracing.tracingComplete', completeHandler);
    cdp.send('Tracing.end');
  });

  // Collect heap info
  const heapAfter = await cdp.send('HeapProfiler.collectGarbage').catch(() => null);
  await cdp.send('HeapProfiler.disable');

  // Disable CPU throttling
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('CPU throttling disabled');

  // Analyze trace data
  const analysis = analyzeTraceData(traceData);

  // Analyze CPU profile
  const cpuAnalysis = analyzeCpuProfile(cpuProfile);

  // Analyze timers and intervals
  const timerAnalysis = analyzeTimers(traceData);

  // Print results
  console.log('\n--- IDLE PERFORMANCE RESULTS ---');
  console.log(`Mode: ${mode}`);
  console.log(`Actual idle duration: ${actualIdleTime}ms`);

  console.log('\n--- TRACE ANALYSIS ---');
  console.log(`Total trace events: ${traceData.length}`);
  console.log(`Task events: ${analysis.taskCount}`);
  console.log(`Long tasks (>50ms): ${analysis.longTasks.length}`);
  console.log(`Frame events: ${analysis.frameCount}`);
  console.log(`Dropped frames: ${analysis.droppedFrames}`);
  console.log(`GC events: ${analysis.gcEvents}`);
  console.log(`Style recalc events: ${analysis.styleRecalcEvents}`);
  console.log(`Layout events: ${analysis.layoutEvents}`);
  console.log(`Paint events: ${analysis.paintEvents}`);

  console.log('\n--- TIMER/INTERVAL ANALYSIS ---');
  console.log(`setTimeout calls: ${timerAnalysis.setTimeoutCalls}`);
  console.log(`setInterval calls: ${timerAnalysis.setIntervalCalls}`);
  console.log(`requestAnimationFrame calls: ${timerAnalysis.rafCalls}`);
  console.log(`Timer fired events: ${timerAnalysis.timerFired}`);

  if (timerAnalysis.timerDetails.length > 0) {
    console.log('\nTimer details:');
    timerAnalysis.timerDetails.slice(0, 10).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.name} @ ${t.time.toFixed(0)}ms (dur: ${t.duration.toFixed(2)}ms)`);
    });
  }

  if (analysis.longTasks.length > 0) {
    console.log('\n--- LONG TASKS DURING IDLE ---');
    analysis.longTasks.slice(0, 10).forEach((task, i) => {
      console.log(`  ${i + 1}. Duration: ${task.duration.toFixed(2)}ms`);
      if (task.stack) {
        console.log(`     Stack: ${task.stack.slice(0, 200)}`);
      }
    });
  }

  if (cpuAnalysis.hotSpots.length > 0) {
    console.log('\n--- CPU PROFILE HOT SPOTS ---');
    console.log(`Total profiled time: ${cpuAnalysis.totalTime.toFixed(2)}ms`);
    cpuAnalysis.hotSpots.slice(0, 20).forEach((spot, i) => {
      const isLiquidGlass = spot.name.includes('liquidglass') || spot.name.includes('filter') ||
                            spot.name.includes('displacement') || spot.name.includes('wasm') ||
                            spot.name.includes('specular') || spot.name.includes('morph') ||
                            spot.name.includes('Throttle') || spot.name.includes('render') ||
                            spot.name.includes('Render');
      const prefix = isLiquidGlass ? '>>> ' : '    ';
      console.log(`${prefix}${i + 1}. ${spot.timeMs.toFixed(2)}ms - ${spot.name.slice(0, 100)}`);
    });
  }

  console.log('\n--- CONSOLE LOG ANALYSIS ---');
  console.log(`Total LiquidGlass logs during idle: ${consoleLogs.length}`);

  // Categorize console logs
  const logCategories = {
    throttle: consoleLogs.filter(l => l.text.includes('[Throttle]')),
    progressive: consoleLogs.filter(l => l.text.includes('[Progressive]')),
    morph: consoleLogs.filter(l => l.text.includes('[Morph]')),
    prediction: consoleLogs.filter(l => l.text.includes('[Prediction]')),
    interval: consoleLogs.filter(l => l.text.includes('[Interval]')),
  };

  Object.entries(logCategories).forEach(([cat, logs]) => {
    if (logs.length > 0) {
      console.log(`  ${cat}: ${logs.length} events`);
    }
  });

  // Show any unexpected logs during idle
  if (consoleLogs.length > 0) {
    console.log('\nUnexpected activity during idle:');
    consoleLogs.slice(0, 5).forEach((log, i) => {
      console.log(`  ${i + 1}. ${log.text.slice(0, 150)}`);
    });
    if (consoleLogs.length > 5) {
      console.log(`  ... and ${consoleLogs.length - 5} more`);
    }
  }

  return {
    mode,
    actualIdleTime,
    analysis,
    cpuAnalysis,
    timerAnalysis,
    consoleLogs,
    logCategories,
  };
}

function analyzeTraceData(traceData) {
  const analysis = {
    taskCount: 0,
    longTasks: [],
    frameCount: 0,
    droppedFrames: 0,
    gcEvents: 0,
    styleRecalcEvents: 0,
    layoutEvents: 0,
    paintEvents: 0,
  };

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

    // Count GC events
    if (event.name === 'MinorGC' || event.name === 'MajorGC' || event.name === 'V8.GCScavenger') {
      analysis.gcEvents++;
    }

    // Style recalculation
    if (event.name === 'RecalculateStyles' || event.name === 'UpdateLayoutTree') {
      analysis.styleRecalcEvents++;
    }

    // Layout
    if (event.name === 'Layout') {
      analysis.layoutEvents++;
    }

    // Paint
    if (event.name === 'Paint' || event.name === 'CompositeLayers') {
      analysis.paintEvents++;
    }
  }

  return analysis;
}

function analyzeTimers(traceData) {
  const analysis = {
    setTimeoutCalls: 0,
    setIntervalCalls: 0,
    rafCalls: 0,
    timerFired: 0,
    timerDetails: [],
  };

  for (const event of traceData) {
    if (event.name === 'TimerInstall') {
      if (event.args?.data?.singleShot === false) {
        analysis.setIntervalCalls++;
      } else {
        analysis.setTimeoutCalls++;
      }
    }

    if (event.name === 'TimerFire') {
      analysis.timerFired++;
      const duration = (event.dur || 0) / 1000;
      analysis.timerDetails.push({
        name: 'TimerFire',
        time: (event.ts || 0) / 1000,
        duration,
        timerId: event.args?.data?.timerId,
      });
    }

    if (event.name === 'RequestAnimationFrame') {
      analysis.rafCalls++;
    }

    if (event.name === 'FireAnimationFrame') {
      analysis.timerDetails.push({
        name: 'FireAnimationFrame',
        time: (event.ts || 0) / 1000,
        duration: (event.dur || 0) / 1000,
        frameId: event.args?.data?.id,
      });
    }
  }

  return analysis;
}

function analyzeCpuProfile(profile) {
  if (!profile || !profile.nodes) {
    return { hotSpots: [], totalTime: 0 };
  }

  const nodeMap = new Map();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  const nodeTimes = new Map();
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];

  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    nodeTimes.set(nodeId, (nodeTimes.get(nodeId) || 0) + delta);
  }

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

  const hotSpots = Array.from(functionTimes.entries())
    .map(([name, data]) => ({ name, timeUs: data.time, timeMs: data.time / 1000, ...data }))
    .filter(h => h.timeMs > 0.1) // Lower threshold for idle analysis
    .sort((a, b) => b.timeUs - a.timeUs);

  const totalTime = hotSpots.reduce((sum, h) => sum + h.timeMs, 0);

  return { hotSpots, totalTime };
}

async function main() {
  let browser = null;

  try {
    // Start dev server
    await startDevServer();
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
    const cdp = await page.createCDPSession();

    const results = {};

    // Test 1: Normal mode (throttling enabled)
    results.normal = await runIdlePerformanceTest(page, cdp, 'normal');

    // Brief pause between tests
    await new Promise(r => setTimeout(r, 2000));

    // Test 2: Instant Preview mode
    results.instantPreview = await runIdlePerformanceTest(page, cdp, 'instantPreview');

    // Comparison summary
    console.log('\n' + '='.repeat(70));
    console.log('IDLE PERFORMANCE COMPARISON');
    console.log('='.repeat(70));

    console.log('\n| Metric                    | Normal Mode | Instant Preview |  Delta  |');
    console.log('|---------------------------|-------------|-----------------|---------|');

    const metrics = [
      ['Task events', results.normal.analysis.taskCount, results.instantPreview.analysis.taskCount],
      ['Long tasks (>50ms)', results.normal.analysis.longTasks.length, results.instantPreview.analysis.longTasks.length],
      ['Frame events', results.normal.analysis.frameCount, results.instantPreview.analysis.frameCount],
      ['Dropped frames', results.normal.analysis.droppedFrames, results.instantPreview.analysis.droppedFrames],
      ['GC events', results.normal.analysis.gcEvents, results.instantPreview.analysis.gcEvents],
      ['Style recalc', results.normal.analysis.styleRecalcEvents, results.instantPreview.analysis.styleRecalcEvents],
      ['Layout events', results.normal.analysis.layoutEvents, results.instantPreview.analysis.layoutEvents],
      ['Paint events', results.normal.analysis.paintEvents, results.instantPreview.analysis.paintEvents],
      ['Timer fired', results.normal.timerAnalysis.timerFired, results.instantPreview.timerAnalysis.timerFired],
      ['RAF calls', results.normal.timerAnalysis.rafCalls, results.instantPreview.timerAnalysis.rafCalls],
      ['Console logs', results.normal.consoleLogs.length, results.instantPreview.consoleLogs.length],
    ];

    metrics.forEach(([name, normal, instant]) => {
      const delta = instant - normal;
      const deltaStr = delta === 0 ? '-' : (delta > 0 ? `+${delta}` : `${delta}`);
      console.log(`| ${name.padEnd(25)} | ${String(normal).padStart(11)} | ${String(instant).padStart(15)} | ${deltaStr.padStart(7)} |`);
    });

    // Key findings
    console.log('\n--- KEY FINDINGS ---');

    if (results.instantPreview.analysis.droppedFrames > results.normal.analysis.droppedFrames) {
      console.log('\n[!] MORE DROPPED FRAMES in Instant Preview mode during IDLE');
      console.log('    This indicates background activity even when not resizing.');
    }

    if (results.instantPreview.timerAnalysis.rafCalls > results.normal.timerAnalysis.rafCalls) {
      console.log('\n[!] MORE RAF CALLS in Instant Preview mode');
      console.log('    There may be an animation loop that wasn\'t cleaned up.');
    }

    if (results.instantPreview.consoleLogs.length > 0) {
      console.log('\n[!] UNEXPECTED CONSOLE ACTIVITY during idle in Instant Preview:');
      results.instantPreview.consoleLogs.slice(0, 3).forEach((log, i) => {
        console.log(`    ${i + 1}. ${log.text.slice(0, 100)}`);
      });
    }

    // Check for morph animations still running
    const morphLogs = results.instantPreview.logCategories.morph;
    if (morphLogs.length > 0) {
      console.log('\n[!] MORPH TRANSITIONS occurred during idle!');
      console.log(`    Count: ${morphLogs.length}`);
      console.log('    This suggests morphAnimationId was not properly cleaned up.');
    }

    // Check for any resize/render activity
    const renderLogs = results.instantPreview.consoleLogs.filter(l =>
      l.text.includes('Render') || l.text.includes('render') ||
      l.text.includes('_render') || l.text.includes('schedule')
    );
    if (renderLogs.length > 0) {
      console.log('\n[!] RENDER ACTIVITY during idle!');
      renderLogs.slice(0, 3).forEach((log, i) => {
        console.log(`    ${i + 1}. ${log.text.slice(0, 100)}`);
      });
    }

    // Save results to file
    const reportPath = path.join(__dirname, '..', 'IDLE_PERFORMANCE_REPORT.md');
    const report = generateReport(results);
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved to: ${reportPath}`);

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

function generateReport(results) {
  const timestamp = new Date().toISOString();

  return `# Liquid Glass Idle Performance Report

**Date:** ${timestamp}
**Test Duration:** ${CONFIG.idleDuration}ms idle period
**CPU Throttling:** ${CONFIG.cpuThrottling}x slowdown

## Summary

| Metric | Normal Mode | Instant Preview | Delta |
|--------|-------------|-----------------|-------|
| Dropped Frames | ${results.normal.analysis.droppedFrames} | ${results.instantPreview.analysis.droppedFrames} | ${results.instantPreview.analysis.droppedFrames - results.normal.analysis.droppedFrames} |
| Task Events | ${results.normal.analysis.taskCount} | ${results.instantPreview.analysis.taskCount} | ${results.instantPreview.analysis.taskCount - results.normal.analysis.taskCount} |
| RAF Calls | ${results.normal.timerAnalysis.rafCalls} | ${results.instantPreview.timerAnalysis.rafCalls} | ${results.instantPreview.timerAnalysis.rafCalls - results.normal.timerAnalysis.rafCalls} |
| Console Logs | ${results.normal.consoleLogs.length} | ${results.instantPreview.consoleLogs.length} | ${results.instantPreview.consoleLogs.length - results.normal.consoleLogs.length} |

## Instant Preview Mode Hot Spots

${results.instantPreview.cpuAnalysis.hotSpots.slice(0, 15).map((h, i) =>
  `${i + 1}. ${h.timeMs.toFixed(2)}ms - ${h.name}`
).join('\n')}

## Console Activity During Idle

### Normal Mode
${results.normal.consoleLogs.length === 0 ? 'No activity' : results.normal.consoleLogs.slice(0, 5).map(l => `- ${l.text.slice(0, 100)}`).join('\n')}

### Instant Preview Mode
${results.instantPreview.consoleLogs.length === 0 ? 'No activity' : results.instantPreview.consoleLogs.slice(0, 5).map(l => `- ${l.text.slice(0, 100)}`).join('\n')}

---
*Generated by idle-perf-cdp.mjs*
`;
}

main();
