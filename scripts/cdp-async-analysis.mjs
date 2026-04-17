#!/usr/bin/env node
/**
 * CDP Async Flow Analysis
 *
 * Traces the full async render pipeline to find hidden bottlenecks
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const DEMO_URL = 'http://localhost:5173/demo/parameter-lab.html';

async function startDevServer() {
  const server = spawn('npx', ['vite', '--port', '5173'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server timeout')), 30000);
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Local:') || data.toString().includes('ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('error', reject);
  });

  return server;
}

async function runAsyncAnalysis() {
  let server;
  let browser;

  try {
    server = await startDevServer();
    await sleep(2000);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    const client = await page.target().createCDPSession();

    // Enable tracing with async stacks
    await client.send('Debugger.enable');
    await client.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });

    // Inject async flow tracker
    await page.evaluateOnNewDocument(() => {
      window.__asyncFlows = [];
      window.__renderPipeline = [];
      window.__lastResizeTime = 0;

      // Track the render pipeline
      const trackRender = (phase, data = {}) => {
        window.__renderPipeline.push({
          ts: performance.now(),
          phase,
          sinceLast: performance.now() - window.__lastResizeTime,
          ...data
        });
      };

      // Intercept console to track FilterManager logs
      const origLog = console.log;
      console.log = function(...args) {
        const msg = args.join(' ');
        if (msg.includes('[LiquidGlass]')) {
          window.__asyncFlows.push({
            ts: performance.now(),
            msg: msg.slice(0, 100)
          });
        }
        return origLog.apply(this, args);
      };

      // Track setTimeout/requestAnimationFrame
      const origSetTimeout = window.setTimeout;
      window.__pendingTimeouts = new Map();
      let timeoutId = 0;

      window.setTimeout = function(fn, delay, ...args) {
        const id = ++timeoutId;
        const stack = new Error().stack.split('\n').slice(2, 5).join(' → ');

        const wrapper = () => {
          const start = performance.now();
          window.__pendingTimeouts.delete(id);
          trackRender('setTimeout.exec', { delay, stack: stack.slice(0, 80) });
          fn(...args);
        };

        window.__pendingTimeouts.set(id, { delay, stack });
        return origSetTimeout.call(window, wrapper, delay);
      };

      // Track Promise microtask timing
      const origPromiseThen = Promise.prototype.then;
      Promise.prototype.then = function(onFulfilled, onRejected) {
        return origPromiseThen.call(this,
          onFulfilled && function(value) {
            const start = performance.now();
            const result = onFulfilled(value);
            return result;
          },
          onRejected
        );
      };

      // Track WASM calls
      if (typeof WebAssembly !== 'undefined') {
        const origInstantiate = WebAssembly.instantiate;
        WebAssembly.instantiate = async function(...args) {
          const start = performance.now();
          const result = await origInstantiate.apply(this, args);
          trackRender('WASM.instantiate', { duration: performance.now() - start });
          return result;
        };
      }

      // Track canvas operations with context
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const ctx = origGetContext.call(this, type, ...args);
        if (ctx && type === '2d') {
          const origPutImageData = ctx.putImageData;
          ctx.putImageData = function(imageData, ...rest) {
            const start = performance.now();
            const result = origPutImageData.call(this, imageData, ...rest);
            trackRender('putImageData', {
              w: imageData.width,
              h: imageData.height,
              duration: performance.now() - start
            });
            return result;
          };
        }
        return ctx;
      };

      // Track toDataURL with timing
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const start = performance.now();
        const result = origToDataURL.apply(this, args);
        trackRender('toDataURL', {
          w: this.width,
          h: this.height,
          duration: performance.now() - start,
          resultLength: result.length
        });
        return result;
      };

      // Track toBlob
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        const start = performance.now();
        const w = this.width, h = this.height;
        return origToBlob.call(this, (blob) => {
          trackRender('toBlob', {
            w, h,
            duration: performance.now() - start,
            blobSize: blob?.size || 0
          });
          callback(blob);
        }, ...args);
      };
    });

    await page.goto(DEMO_URL, { waitUntil: 'networkidle0' });
    await sleep(2000);

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('ASYNC FLOW & RENDER PIPELINE ANALYSIS');
    console.log('════════════════════════════════════════════════════════════════\n');

    // Get resize handle
    const handlePos = await page.evaluate(() => {
      const el = document.querySelector('#element-1');
      const handle = el?.querySelector('.resize-handle.se');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (!handlePos) throw new Error('Could not find resize handle');

    // Clear tracking
    await page.evaluate(() => {
      window.__renderPipeline = [];
      window.__asyncFlows = [];
    });

    // Enable dev mode logging
    await page.evaluate(() => {
      if (window.lgc_dev && window.lgc_dev.debug) {
        window.lgc_dev.debug.log.enableAll();
      }
    });

    // Start CPU profiler
    await client.send('Profiler.start');

    console.log('Executing controlled resize (10 steps, 100ms intervals)...\n');

    await page.mouse.move(handlePos.x, handlePos.y);
    await page.mouse.down();

    const resizeStart = Date.now();
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        window.__lastResizeTime = performance.now();
      });

      await page.mouse.move(handlePos.x + i * 20, handlePos.y + i * 15);
      await sleep(100);
    }

    await page.mouse.up();
    await sleep(1000); // Wait for high-res render

    const resizeDuration = Date.now() - resizeStart;

    // Stop profiler
    const profile = await client.send('Profiler.stop');

    // Collect data
    const pipeline = await page.evaluate(() => window.__renderPipeline);
    const asyncFlows = await page.evaluate(() => window.__asyncFlows);

    console.log(`Total duration: ${resizeDuration}ms\n`);

    // ════════════════════════════════════════════════════════════════════════
    // Pipeline Event Analysis
    // ════════════════════════════════════════════════════════════════════════

    console.log('📊 RENDER PIPELINE EVENTS');
    console.log('─'.repeat(70));

    // Group by phase
    const phases = {};
    for (const event of pipeline) {
      if (!phases[event.phase]) {
        phases[event.phase] = { count: 0, totalDuration: 0, events: [] };
      }
      phases[event.phase].count++;
      phases[event.phase].totalDuration += event.duration || 0;
      phases[event.phase].events.push(event);
    }

    console.log(`${'Phase'.padEnd(25)} ${'Count'.padStart(8)} ${'Total ms'.padStart(12)} ${'Avg ms'.padStart(10)}`);
    console.log('─'.repeat(70));

    const sortedPhases = Object.entries(phases)
      .sort((a, b) => b[1].totalDuration - a[1].totalDuration);

    for (const [phase, data] of sortedPhases) {
      const avg = data.count > 0 ? (data.totalDuration / data.count).toFixed(2) : '0.00';
      console.log(`${phase.padEnd(25)} ${data.count.toString().padStart(8)} ${data.totalDuration.toFixed(2).padStart(12)} ${avg.padStart(10)}`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // toDataURL Deep Dive
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📊 toDataURL DETAILED ANALYSIS');
    console.log('─'.repeat(70));

    const toDataURLEvents = pipeline.filter(e => e.phase === 'toDataURL');

    if (toDataURLEvents.length > 0) {
      // Group by canvas size
      const bySizeAndDuration = new Map();
      for (const e of toDataURLEvents) {
        const key = `${e.w}x${e.h}`;
        if (!bySizeAndDuration.has(key)) {
          bySizeAndDuration.set(key, { count: 0, totalDuration: 0, totalBytes: 0 });
        }
        const entry = bySizeAndDuration.get(key);
        entry.count++;
        entry.totalDuration += e.duration;
        entry.totalBytes += e.resultLength;
      }

      console.log(`${'Size'.padEnd(15)} ${'Count'.padStart(8)} ${'Duration'.padStart(12)} ${'Avg Data KB'.padStart(12)}`);
      console.log('─'.repeat(50));

      for (const [size, data] of bySizeAndDuration) {
        const avgKB = ((data.totalBytes / data.count) / 1024).toFixed(1);
        console.log(`${size.padEnd(15)} ${data.count.toString().padStart(8)} ${data.totalDuration.toFixed(2).padStart(12)} ${avgKB.padStart(12)}`);
      }

      // Total stats
      const totalDuration = toDataURLEvents.reduce((s, e) => s + e.duration, 0);
      const totalBytes = toDataURLEvents.reduce((s, e) => s + e.resultLength, 0);
      console.log('─'.repeat(50));
      console.log(`Total: ${toDataURLEvents.length} calls, ${totalDuration.toFixed(2)}ms, ${(totalBytes / 1024).toFixed(1)} KB`);

      // Estimate savings with Blob approach
      const avgDuration = totalDuration / toDataURLEvents.length;
      console.log(`\nEstimated with createObjectURL: ~${(avgDuration * 0.3).toFixed(2)}ms per call`);
      console.log(`Potential savings: ~${(totalDuration * 0.7).toFixed(0)}ms`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // setTimeout Analysis (deferred renders)
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📊 DEFERRED RENDER ANALYSIS (setTimeout)');
    console.log('─'.repeat(70));

    const timeoutEvents = pipeline.filter(e => e.phase === 'setTimeout.exec');

    if (timeoutEvents.length > 0) {
      console.log('Timeout patterns detected:');

      const byDelay = new Map();
      for (const e of timeoutEvents) {
        const key = e.delay;
        if (!byDelay.has(key)) {
          byDelay.set(key, { count: 0, stacks: new Set() });
        }
        byDelay.get(key).count++;
        byDelay.get(key).stacks.add(e.stack || 'unknown');
      }

      for (const [delay, data] of byDelay) {
        console.log(`\n  [${delay}ms delay] - ${data.count} calls`);
        for (const stack of Array.from(data.stacks).slice(0, 3)) {
          console.log(`    └─ ${stack}`);
        }
      }
    } else {
      console.log('No setTimeout events captured');
    }

    // ════════════════════════════════════════════════════════════════════════
    // CPU Profile Hot Spots
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n📊 CPU PROFILE HOT SPOTS');
    console.log('─'.repeat(70));

    const hotFuncs = profile.profile.nodes
      .filter(n => n.hitCount > 0 && n.callFrame.functionName)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 20);

    for (const node of hotFuncs) {
      const cf = node.callFrame;
      const url = cf.url ? cf.url.split('/').pop() : '';
      console.log(`${node.hitCount.toString().padStart(5)} ${cf.functionName.slice(0, 40).padEnd(42)} ${url}:${cf.lineNumber}`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Async Flow Timeline
    // ════════════════════════════════════════════════════════════════════════

    if (asyncFlows.length > 0) {
      console.log('\n\n📊 LIQUIDGLASS DEBUG LOG TIMELINE');
      console.log('─'.repeat(70));

      for (const flow of asyncFlows.slice(0, 30)) {
        const relTime = (flow.ts % 10000).toFixed(0).padStart(5);
        console.log(`[${relTime}ms] ${flow.msg}`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Final Analysis
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n\n🔍 BOTTLENECK SUMMARY');
    console.log('═'.repeat(70));

    // Calculate where time is being spent
    const totalTrackedTime = Object.values(phases)
      .reduce((s, p) => s + p.totalDuration, 0);

    const untrackedTime = resizeDuration - totalTrackedTime;

    console.log(`
Time breakdown:
─────────────────────────────────────────────────────────────────────
Tracked operations:     ${totalTrackedTime.toFixed(0)}ms
Untracked (async/idle): ${untrackedTime.toFixed(0)}ms
Total:                  ${resizeDuration}ms

Major time consumers:
`);

    for (const [phase, data] of sortedPhases.slice(0, 5)) {
      const pct = ((data.totalDuration / resizeDuration) * 100).toFixed(1);
      console.log(`  ${phase.padEnd(25)} ${pct}%  (${data.totalDuration.toFixed(1)}ms)`);
    }

    console.log(`
Key findings:
─────────────────────────────────────────────────────────────────────`);

    if (phases['toDataURL']) {
      const toDataURLPct = (phases['toDataURL'].totalDuration / resizeDuration) * 100;
      if (toDataURLPct > 5) {
        console.log(`⚠️  toDataURL accounts for ${toDataURLPct.toFixed(1)}% of time`);
        console.log(`   → Consider using Blob + createObjectURL during resize`);
      }
    }

    if (phases['setTimeout.exec']) {
      console.log(`⚠️  ${phases['setTimeout.exec'].count} deferred operations detected`);
      console.log(`   → Review timeout patterns for optimization opportunities`);
    }

    const idlePct = (untrackedTime / resizeDuration) * 100;
    if (idlePct > 50) {
      console.log(`⚠️  ${idlePct.toFixed(0)}% of time is untracked/idle`);
      console.log(`   → May indicate browser rendering or async wait overhead`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

runAsyncAnalysis().catch(console.error);
