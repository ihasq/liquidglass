#!/usr/bin/env node
/**
 * CDP Performance Profiler for CSS Property Engine
 *
 * Measures:
 * - getComputedStyle call frequency and stack traces
 * - Style recalculation events
 * - Layout/Reflow triggers
 * - Paint operations
 *
 * Usage:
 *   node scripts/cdp-performance-profile.mjs
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ============================================================================
// Simple HTTP Server
// ============================================================================

function startServer(port = 3456) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.ts': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
  };

  const server = createServer((req, res) => {
    let filePath = join(ROOT, req.url === '/' ? '/demo/css-property-engine-demo.html' : req.url);

    // Handle TypeScript files via esbuild-style transform marker
    if (filePath.endsWith('.ts')) {
      // For simplicity, redirect to pre-built if available
      const jsPath = filePath.replace(/\.ts$/, '.js');
      if (existsSync(jsPath)) {
        filePath = jsPath;
      }
    }

    const ext = filePath.match(/\.[^.]+$/)?.[0] || '.html';
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end(`Not found: ${req.url}`);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

// ============================================================================
// CDP Performance Profiler
// ============================================================================

async function runProfiler() {
  console.log('\n🔬 CSS Property Engine Performance Profiler\n');
  console.log('=' .repeat(60));

  // Start local server
  const server = await startServer(3456);
  const url = 'http://localhost:3456/demo/css-property-engine-demo.html';

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,  // Show browser for interaction
    devtools: true,
    args: ['--disable-web-security', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  const client = await page.target().createCDPSession();

  // ──────────────────────────────────────────────────────────────────────────
  // Performance metrics collection
  // ──────────────────────────────────────────────────────────────────────────

  const metrics = {
    getComputedStyleCalls: [],
    styleRecalculations: [],
    layoutEvents: [],
    paintEvents: [],
    functionCalls: [],
  };

  // Enable required CDP domains
  await client.send('Performance.enable');
  await client.send('Profiler.enable');
  await client.send('Runtime.enable');
  await client.send('Debugger.enable');

  // Set up breakpoint on getComputedStyle
  await client.send('Debugger.setBreakpointByUrl', {
    lineNumber: 0,
    urlRegex: '.*',
    columnNumber: 0,
  });

  // Collect performance timeline
  await client.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'blink.user_timing',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
    ].join(','),
    options: 'sampling-frequency=10000',
  });

  // Inject getComputedStyle interceptor
  await page.evaluateOnNewDocument(() => {
    const originalGetComputedStyle = window.getComputedStyle;
    window.__getComputedStyleCalls = [];

    window.getComputedStyle = function(element, pseudoElt) {
      const stack = new Error().stack;
      const call = {
        timestamp: performance.now(),
        element: element.tagName + (element.id ? '#' + element.id : '') + (element.className ? '.' + element.className.split(' ')[0] : ''),
        stack: stack.split('\n').slice(2, 6).map(s => s.trim()),
      };
      window.__getComputedStyleCalls.push(call);

      // Limit stored calls to prevent memory bloat
      if (window.__getComputedStyleCalls.length > 1000) {
        window.__getComputedStyleCalls.shift();
      }

      return originalGetComputedStyle.call(window, element, pseudoElt);
    };

    // Track MutationObserver callbacks
    const originalObserve = MutationObserver.prototype.observe;
    window.__mutationObserverCalls = [];

    MutationObserver.prototype.observe = function(target, options) {
      window.__mutationObserverCalls.push({
        timestamp: performance.now(),
        target: target.tagName + (target.id ? '#' + target.id : ''),
        options: JSON.stringify(options),
      });
      return originalObserve.call(this, target, options);
    };
  });

  // Navigate to demo page
  console.log(`\n📄 Loading: ${url}\n`);
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Wait for engine initialization
  await page.waitForTimeout(1000);

  console.log('🎮 Interactive Mode');
  console.log('─'.repeat(60));
  console.log('Interact with the demo page (sliders, color pickers, etc.)');
  console.log('The profiler is collecting data...\n');
  console.log('Press Ctrl+C in terminal to stop and see results.\n');

  // Periodic metrics collection
  const collectMetrics = async () => {
    try {
      const calls = await page.evaluate(() => {
        const calls = window.__getComputedStyleCalls || [];
        window.__getComputedStyleCalls = [];  // Reset
        return calls;
      });
      metrics.getComputedStyleCalls.push(...calls);

      const mutations = await page.evaluate(() => {
        const calls = window.__mutationObserverCalls || [];
        window.__mutationObserverCalls = [];
        return calls;
      });
      // Store mutations if needed
    } catch (e) {
      // Page might be navigating
    }
  };

  const collectionInterval = setInterval(collectMetrics, 500);

  // Handle cleanup
  const cleanup = async () => {
    clearInterval(collectionInterval);

    console.log('\n\n📊 Performance Analysis Results');
    console.log('=' .repeat(60));

    // Final collection
    await collectMetrics();

    // Stop tracing
    const tracingData = await new Promise((resolve) => {
      const chunks = [];
      client.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
      client.on('Tracing.tracingComplete', () => resolve(chunks));
      client.send('Tracing.end');
    });

    // Analyze tracing data
    const styleRecalcs = tracingData.filter(e => e.name === 'UpdateLayoutTree' || e.name === 'RecalculateStyles');
    const layouts = tracingData.filter(e => e.name === 'Layout');
    const paints = tracingData.filter(e => e.name === 'Paint');

    // ──────────────────────────────────────────────────────────────────────────
    // Report: getComputedStyle
    // ──────────────────────────────────────────────────────────────────────────

    console.log('\n📌 getComputedStyle Calls');
    console.log('─'.repeat(60));
    console.log(`Total calls: ${metrics.getComputedStyleCalls.length}`);

    // Group by stack trace
    const stackGroups = new Map();
    for (const call of metrics.getComputedStyleCalls) {
      const key = call.stack.join(' → ');
      if (!stackGroups.has(key)) {
        stackGroups.set(key, { count: 0, elements: new Set(), stack: call.stack });
      }
      const group = stackGroups.get(key);
      group.count++;
      group.elements.add(call.element);
    }

    // Sort by frequency
    const sortedStacks = [...stackGroups.entries()].sort((a, b) => b[1].count - a[1].count);

    console.log('\nTop call sites by frequency:');
    for (const [key, data] of sortedStacks.slice(0, 10)) {
      console.log(`\n  [${data.count} calls] on ${data.elements.size} unique elements`);
      for (const line of data.stack) {
        console.log(`    ${line}`);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Report: Style Recalculations
    // ──────────────────────────────────────────────────────────────────────────

    console.log('\n\n📌 Style Recalculations');
    console.log('─'.repeat(60));
    console.log(`Total events: ${styleRecalcs.length}`);

    const recalcDurations = styleRecalcs.map(e => e.dur / 1000 || 0);
    if (recalcDurations.length > 0) {
      const avgDuration = recalcDurations.reduce((a, b) => a + b, 0) / recalcDurations.length;
      const maxDuration = Math.max(...recalcDurations);
      console.log(`Average duration: ${avgDuration.toFixed(2)}ms`);
      console.log(`Max duration: ${maxDuration.toFixed(2)}ms`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Report: Layout/Reflow
    // ──────────────────────────────────────────────────────────────────────────

    console.log('\n\n📌 Layout Events');
    console.log('─'.repeat(60));
    console.log(`Total events: ${layouts.length}`);

    const layoutDurations = layouts.map(e => e.dur / 1000 || 0);
    if (layoutDurations.length > 0) {
      const avgDuration = layoutDurations.reduce((a, b) => a + b, 0) / layoutDurations.length;
      const maxDuration = Math.max(...layoutDurations);
      console.log(`Average duration: ${avgDuration.toFixed(2)}ms`);
      console.log(`Max duration: ${maxDuration.toFixed(2)}ms`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Report: Paint
    // ──────────────────────────────────────────────────────────────────────────

    console.log('\n\n📌 Paint Events');
    console.log('─'.repeat(60));
    console.log(`Total events: ${paints.length}`);

    // ──────────────────────────────────────────────────────────────────────────
    // Optimization Recommendations
    // ──────────────────────────────────────────────────────────────────────────

    console.log('\n\n💡 Optimization Recommendations');
    console.log('─'.repeat(60));

    const issues = [];

    // Check for excessive getComputedStyle
    if (metrics.getComputedStyleCalls.length > 100) {
      const topCaller = sortedStacks[0];
      if (topCaller && topCaller[1].count > 50) {
        issues.push({
          severity: 'HIGH',
          issue: `Excessive getComputedStyle calls (${topCaller[1].count}x from same location)`,
          location: topCaller[1].stack[0],
          suggestion: 'Cache computed style values or batch reads before writes',
        });
      }
    }

    // Check for style recalc storms
    const recalcsPerSecond = styleRecalcs.length / (tracingData.length > 0 ?
      (tracingData[tracingData.length - 1].ts - tracingData[0].ts) / 1000000 : 1);
    if (recalcsPerSecond > 30) {
      issues.push({
        severity: 'MEDIUM',
        issue: `High style recalculation rate (${recalcsPerSecond.toFixed(1)}/sec)`,
        suggestion: 'Debounce or throttle style changes, use CSS containment',
      });
    }

    // Check for layout thrashing
    if (layouts.length > styleRecalcs.length * 0.5) {
      issues.push({
        severity: 'MEDIUM',
        issue: 'Potential layout thrashing detected',
        suggestion: 'Avoid interleaving DOM reads and writes',
      });
    }

    if (issues.length === 0) {
      console.log('✅ No significant performance issues detected!');
    } else {
      for (const issue of issues) {
        console.log(`\n[${issue.severity}] ${issue.issue}`);
        if (issue.location) console.log(`  Location: ${issue.location}`);
        console.log(`  Suggestion: ${issue.suggestion}`);
      }
    }

    console.log('\n' + '=' .repeat(60));
    console.log('Profiling complete.\n');

    await browser.close();
    server.close();
    process.exit(0);
  };

  // Handle Ctrl+C
  process.on('SIGINT', cleanup);

  // Auto-cleanup after 5 minutes
  setTimeout(() => {
    console.log('\n⏱️  Auto-stopping after 5 minutes...');
    cleanup();
  }, 5 * 60 * 1000);
}

// Run
runProfiler().catch(console.error);
