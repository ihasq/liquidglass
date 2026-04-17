#!/usr/bin/env node
/**
 * CDP Resize Performance Analysis for Parameter Lab
 *
 * Analyzes:
 * - CPU profiler during continuous resize
 * - Stack traces of expensive operations
 * - getComputedStyle call patterns
 * - WASM/Canvas operations
 * - ResizeObserver callback frequency
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import fs from 'fs';
import path from 'path';

const DEMO_URL = 'http://localhost:5173/demo/parameter-lab.html';

async function startDevServer() {
  console.log('Starting Vite dev server...');
  const server = spawn('npx', ['vite', '--port', '5173'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server timeout')), 30000);

    server.stdout.on('data', (data) => {
      const str = data.toString();
      if (str.includes('Local:') || str.includes('ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      // Ignore warnings
    });

    server.on('error', reject);
  });

  console.log('Vite dev server started');
  return server;
}

async function runResizeAnalysis() {
  let server;
  let browser;

  try {
    server = await startDevServer();
    await sleep(2000);

    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    const client = await page.target().createCDPSession();

    // Enable CDP domains
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 }); // 100µs for fine-grained
    await client.send('Runtime.enable');
    await client.send('Performance.enable');

    // Inject performance interceptors BEFORE page load
    await page.evaluateOnNewDocument(() => {
      // Track getComputedStyle calls
      const originalGetComputedStyle = window.getComputedStyle;
      window.__perfStats = {
        getComputedStyleCalls: [],
        resizeObserverCallbacks: 0,
        wasmCalls: 0,
        canvasOperations: 0,
        toDataURLCalls: 0,
        renderCalls: 0,
      };

      window.getComputedStyle = function(element, pseudoElt) {
        const stack = new Error().stack.split('\n').slice(2, 7).map(s => s.trim());
        window.__perfStats.getComputedStyleCalls.push({
          ts: performance.now(),
          element: element.tagName + (element.id ? '#' + element.id : ''),
          stack
        });
        if (window.__perfStats.getComputedStyleCalls.length > 500) {
          window.__perfStats.getComputedStyleCalls.shift();
        }
        return originalGetComputedStyle.call(window, element, pseudoElt);
      };

      // Track canvas.toDataURL (expensive!)
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        window.__perfStats.toDataURLCalls++;
        return originalToDataURL.apply(this, args);
      };

      // Track ResizeObserver callbacks
      const originalROCallback = ResizeObserver;
      window.ResizeObserver = class extends originalROCallback {
        constructor(callback) {
          super((entries, observer) => {
            window.__perfStats.resizeObserverCallbacks++;
            callback(entries, observer);
          });
        }
      };
    });

    // Navigate
    console.log(`\nNavigating to ${DEMO_URL}...`);
    await page.goto(DEMO_URL, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Wait for liquidglass to initialize
    await page.waitForFunction(() => {
      const glass = document.querySelector('.glass-panel');
      return glass && window.getComputedStyle(glass).getPropertyValue('backdrop-filter') !== 'none';
    }, { timeout: 10000 });

    console.log('LiquidGlass initialized');

    // Start tracing for timeline
    const traceEvents = [];
    client.on('Tracing.dataCollected', (data) => {
      traceEvents.push(...data.value);
    });

    await client.send('Tracing.start', {
      categories: [
        'devtools.timeline',
        'v8.execute',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-v8.cpu_profiler.hires',
      ].join(','),
      options: 'sampling-frequency=10000',
    });

    // Start CPU profiler
    await client.send('Profiler.start');

    console.log('\n========================================');
    console.log('PHASE 1: Continuous Resize Simulation');
    console.log('========================================\n');

    // Get the first glass element's resize handle
    const element1Selector = '#element-1';

    // Find the SE resize handle position
    const handlePos = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const handle = el.querySelector('.resize-handle.se');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }, element1Selector);

    if (!handlePos) {
      throw new Error('Could not find resize handle');
    }

    console.log('Starting continuous resize (diagonal drag)...');

    // Simulate continuous resize - 60 steps over 2 seconds
    await page.mouse.move(handlePos.x, handlePos.y);
    await page.mouse.down();

    const startTime = performance.now();
    const steps = 60;
    const duration = 2000;

    for (let i = 0; i < steps; i++) {
      const progress = i / steps;
      const deltaX = Math.sin(progress * Math.PI * 2) * 100; // Oscillating resize
      const deltaY = Math.sin(progress * Math.PI * 2) * 80;
      await page.mouse.move(handlePos.x + deltaX, handlePos.y + deltaY);
      await sleep(duration / steps);
    }

    await page.mouse.up();

    const resizeDuration = performance.now() - startTime;
    console.log(`Resize simulation completed in ${resizeDuration.toFixed(0)}ms`);

    // Wait for high-res render to complete
    await sleep(500);

    console.log('\n========================================');
    console.log('PHASE 2: Rapid Parameter Changes');
    console.log('========================================\n');

    // Simulate rapid slider changes
    for (let i = 0; i < 20; i++) {
      await page.evaluate((val) => {
        const slider = document.getElementById('refraction');
        if (slider) {
          slider.value = val;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 30 + (i % 2) * 40);
      await sleep(50);
    }

    console.log('Parameter change simulation completed');

    // Stop profiling
    const profile = await client.send('Profiler.stop');
    await client.send('Tracing.end');
    await sleep(500);

    // Collect page stats
    const perfStats = await page.evaluate(() => window.__perfStats);

    console.log('\n========================================');
    console.log('ANALYSIS RESULTS');
    console.log('========================================\n');

    // ════════════════════════════════════════════════════════════════════════
    // 1. getComputedStyle Analysis
    // ════════════════════════════════════════════════════════════════════════

    console.log('📌 getComputedStyle Calls');
    console.log('─'.repeat(60));
    console.log(`Total calls: ${perfStats.getComputedStyleCalls.length}`);

    // Group by stack trace
    const stackGroups = new Map();
    for (const call of perfStats.getComputedStyleCalls) {
      const key = call.stack.slice(0, 3).join(' → ');
      if (!stackGroups.has(key)) {
        stackGroups.set(key, { count: 0, stack: call.stack });
      }
      stackGroups.get(key).count++;
    }

    const sortedStacks = [...stackGroups.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    console.log('\nTop call sites:');
    for (const [key, data] of sortedStacks) {
      console.log(`\n  [${data.count} calls]`);
      for (const line of data.stack.slice(0, 4)) {
        // Extract function name and location
        const match = line.match(/at\s+(\S+).*?(\S+:\d+:\d+)/);
        if (match) {
          console.log(`    ${match[1].padEnd(30)} ${match[2]}`);
        } else {
          console.log(`    ${line.slice(0, 70)}`);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. Canvas/WASM Operations
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📌 Canvas/Encoding Operations');
    console.log('─'.repeat(60));
    console.log(`toDataURL calls: ${perfStats.toDataURLCalls}`);
    console.log(`ResizeObserver callbacks: ${perfStats.resizeObserverCallbacks}`);

    // ════════════════════════════════════════════════════════════════════════
    // 3. CPU Profile Analysis
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📌 CPU Profile Hot Functions');
    console.log('─'.repeat(60));

    const hotFunctions = analyzeProfile(profile.profile);

    // Group by category
    const categories = {
      'Style/Layout': ['getComputedStyle', 'getBoundingClientRect', 'offsetWidth', 'offsetHeight', 'style'],
      'DOM Manipulation': ['setAttribute', 'appendChild', 'createElement', 'querySelector'],
      'Canvas/Image': ['toDataURL', 'putImageData', 'getImageData', 'createImageData', 'drawImage'],
      'WASM': ['wasm', 'WASM', 'generateQuadrant', 'generateWasm'],
      'Math/Computation': ['Math.', 'sqrt', 'sin', 'cos', 'exp', 'floor', 'ceil'],
      'Filter/Render': ['_render', '_scheduleRender', 'updateDisplacement', 'morph', 'Filter'],
      'Observer': ['ResizeObserver', 'MutationObserver', '_scheduleCheck'],
    };

    for (const [category, patterns] of Object.entries(categories)) {
      const matches = hotFunctions.filter(f =>
        patterns.some(p => f.name.includes(p))
      );
      if (matches.length > 0) {
        const totalHits = matches.reduce((sum, f) => sum + f.hitCount, 0);
        console.log(`\n${category} (${totalHits} total hits):`);
        for (const func of matches.slice(0, 5)) {
          console.log(`  ${func.hitCount.toString().padStart(5)} ${func.name.slice(0, 50)}`);
          if (func.url) {
            const shortUrl = func.url.split('/').slice(-2).join('/');
            console.log(`        └─ ${shortUrl}:${func.line}`);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 4. Timeline Event Analysis
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📌 Timeline Event Analysis');
    console.log('─'.repeat(60));

    const eventTypes = {
      'FunctionCall': 0,
      'UpdateLayoutTree': 0,
      'RecalculateStyles': 0,
      'Layout': 0,
      'Paint': 0,
      'CompositeLayers': 0,
    };

    const longTasks = [];

    for (const event of traceEvents) {
      if (eventTypes.hasOwnProperty(event.name)) {
        eventTypes[event.name]++;
      }
      // Track long tasks (>16ms = dropped frame potential)
      if (event.dur && event.dur > 16000) { // >16ms in µs
        longTasks.push({
          name: event.name,
          duration: event.dur / 1000,
          stack: event.args?.data?.stackTrace || []
        });
      }
    }

    console.log('Event counts:');
    for (const [name, count] of Object.entries(eventTypes)) {
      if (count > 0) {
        console.log(`  ${name.padEnd(25)} ${count}`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 5. Long Tasks (Frame Budget Violations)
    // ════════════════════════════════════════════════════════════════════════

    if (longTasks.length > 0) {
      console.log(`\n\n⚠️  Long Tasks (>${16}ms - potential frame drops)`);
      console.log('─'.repeat(60));

      const grouped = new Map();
      for (const task of longTasks) {
        const key = task.name;
        if (!grouped.has(key)) {
          grouped.set(key, { count: 0, totalDuration: 0, maxDuration: 0 });
        }
        const g = grouped.get(key);
        g.count++;
        g.totalDuration += task.duration;
        g.maxDuration = Math.max(g.maxDuration, task.duration);
      }

      const sorted = [...grouped.entries()].sort((a, b) => b[1].totalDuration - a[1].totalDuration);
      for (const [name, data] of sorted.slice(0, 10)) {
        console.log(`  ${name}`);
        console.log(`    Count: ${data.count}, Total: ${data.totalDuration.toFixed(1)}ms, Max: ${data.maxDuration.toFixed(1)}ms`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 6. Bottleneck Summary
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n🔍 BOTTLENECK SUMMARY');
    console.log('═'.repeat(60));

    const issues = [];

    // Check for excessive getComputedStyle
    const gcsPerResize = perfStats.getComputedStyleCalls.length / steps;
    if (gcsPerResize > 3) {
      issues.push({
        severity: 'HIGH',
        area: 'getComputedStyle',
        detail: `${gcsPerResize.toFixed(1)} calls per resize step`,
        impact: 'Forces style recalculation, blocks main thread',
        suggestion: 'Cache borderRadius/styles, avoid reading during resize'
      });
    }

    // Check for excessive toDataURL
    const toDataURLPerResize = perfStats.toDataURLCalls / steps;
    if (toDataURLPerResize > 1) {
      issues.push({
        severity: 'HIGH',
        area: 'toDataURL',
        detail: `${toDataURLPerResize.toFixed(1)} calls per resize step`,
        impact: 'PNG encoding is CPU-intensive (~5-15ms per call)',
        suggestion: 'Use Blob.createObjectURL or skip encoding during resize'
      });
    }

    // Check ResizeObserver frequency
    if (perfStats.resizeObserverCallbacks > steps * 1.5) {
      issues.push({
        severity: 'MEDIUM',
        area: 'ResizeObserver',
        detail: `${perfStats.resizeObserverCallbacks} callbacks for ${steps} resize events`,
        impact: 'Multiple observers or redundant triggers',
        suggestion: 'Consolidate observers, debounce callbacks'
      });
    }

    // Check for long tasks
    if (longTasks.length > steps / 4) {
      issues.push({
        severity: 'HIGH',
        area: 'Frame Budget',
        detail: `${longTasks.length} tasks exceeded 16ms frame budget`,
        impact: 'Causes visible jank/stuttering',
        suggestion: 'Break up heavy work, use requestIdleCallback'
      });
    }

    if (issues.length === 0) {
      console.log('✅ No significant bottlenecks detected!');
    } else {
      for (const issue of issues) {
        console.log(`\n[${issue.severity}] ${issue.area}`);
        console.log(`  Detail: ${issue.detail}`);
        console.log(`  Impact: ${issue.impact}`);
        console.log(`  Fix: ${issue.suggestion}`);
      }
    }

    // Save detailed profile for external analysis
    const profilePath = path.join(process.cwd(), 'resize-profile.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      profile: profile.profile,
      stats: perfStats,
      longTasks: longTasks.slice(0, 50),
      stackGroups: Object.fromEntries(sortedStacks)
    }, null, 2));
    console.log(`\n📄 Detailed profile saved to: ${profilePath}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

function analyzeProfile(profile) {
  if (!profile || !profile.nodes) {
    return [];
  }

  const functions = [];

  for (const node of profile.nodes) {
    const callFrame = node.callFrame;
    if (!callFrame || !callFrame.functionName) continue;

    const hitCount = node.hitCount || 0;
    if (hitCount === 0) continue;

    functions.push({
      name: callFrame.functionName,
      url: callFrame.url,
      line: callFrame.lineNumber,
      hitCount,
    });
  }

  // Sort by hit count
  functions.sort((a, b) => b.hitCount - a.hitCount);

  return functions;
}

runResizeAnalysis().catch(console.error);
