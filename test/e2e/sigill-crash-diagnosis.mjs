#!/usr/bin/env node
/**
 * SIGILL Crash Diagnosis Script
 *
 * Reproduces the bug: WASM-SIMD → long resize → switch to WebGL2 → SIGILL crash
 *
 * Uses CDP for:
 * - Heap snapshots before/after switch
 * - Memory allocation tracking
 * - WASM memory state analysis
 * - Crash stack trace capture
 */

import puppeteer from 'puppeteer';

const WASM_RESIZE_DURATION_MS = 15000; // 15 seconds of WASM resize
const RESIZE_INTERVAL_MS = 15; // More aggressive
const POST_SWITCH_MONITOR_MS = 8000;

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function run() {
  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  SIGILL Crash Diagnosis - WASM→WebGL2 Switch                ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  let browser = null;
  let crashDetected = false;
  let crashInfo = null;
  const memorySnapshots = [];
  const wasmMemoryHistory = [];
  const errors = [];

  try {
    console.log(`${colors.dim}Launching browser with WASM debugging...${colors.reset}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-precise-memory-info',
        '--js-flags=--expose-gc',
        '--enable-features=WebAssemblySimd',
      ],
      dumpio: false,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Create CDP session
    const cdp = await page.target().createCDPSession();

    // Enable necessary CDP domains
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Debugger.enable');
    await cdp.send('Console.enable');

    // Capture console messages
    const consoleMessages = [];
    cdp.on('Console.messageAdded', (event) => {
      const msg = event.message;
      consoleMessages.push({
        level: msg.level,
        text: msg.text,
        timestamp: Date.now(),
      });
      if (msg.level === 'error') {
        console.log(`${colors.red}[Console Error] ${msg.text}${colors.reset}`);
        errors.push(msg.text);
      }
    });

    // Capture exceptions
    cdp.on('Runtime.exceptionThrown', (event) => {
      const ex = event.exceptionDetails;
      console.log(`${colors.red}[Exception] ${ex.text}${colors.reset}`);
      if (ex.stackTrace) {
        console.log(`${colors.dim}Stack:${colors.reset}`);
        ex.stackTrace.callFrames.forEach((frame, i) => {
          console.log(`  ${i}: ${frame.functionName || '(anonymous)'} @ ${frame.url}:${frame.lineNumber}:${frame.columnNumber}`);
        });
      }
      errors.push({
        text: ex.text,
        stack: ex.stackTrace,
        exception: ex.exception,
      });
    });

    // Monitor page crashes
    page.on('error', (err) => {
      crashDetected = true;
      crashInfo = {
        type: 'page_error',
        message: err.message,
        stack: err.stack,
      };
      console.log(`${colors.red}[PAGE CRASH] ${err.message}${colors.reset}`);
      console.log(err.stack);
    });

    page.on('pageerror', (err) => {
      console.log(`${colors.red}[Page Error] ${err.message}${colors.reset}`);
      errors.push(err.message);
    });

    // Navigate
    const url = 'http://localhost:8787/demo/parameter-lab/';
    console.log(`${colors.dim}Loading ${url}...${colors.reset}`);

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('.glass-panel', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));

    // Inject WASM memory and state monitor
    await page.evaluate(() => {
      window.__wasmMonitor = {
        memoryHistory: [],
        wasmBufferSizes: [],

        measure() {
          const info = {
            timestamp: Date.now(),
            jsHeap: performance.memory?.usedJSHeapSize || 0,
            totalHeap: performance.memory?.totalJSHeapSize || 0,
            heapLimit: performance.memory?.jsHeapSizeLimit || 0,
          };

          // Track number of live canvas elements
          info.canvasCount = document.querySelectorAll('canvas').length;

          // Track SVG filter state
          const filters = document.querySelectorAll('filter');
          info.filterCount = filters.length;

          // Track feImage data URLs (potential memory leak indicator)
          const feImages = document.querySelectorAll('feImage[href^="data:"]');
          let totalDataUrlSize = 0;
          feImages.forEach(img => {
            const href = img.getAttribute('href');
            if (href) totalDataUrlSize += href.length;
          });
          info.feImageCount = feImages.length;
          info.dataUrlTotalSize = totalDataUrlSize;

          this.memoryHistory.push(info);
          return info;
        },

        getHistory() {
          return this.memoryHistory;
        },

        // Get current renderer state
        getCurrentRenderer() {
          const style = getComputedStyle(document.querySelector('.glass-panel'));
          return style.getPropertyValue('--liquidglass-displacement-renderer').trim();
        }
      };
    });

    // =========================================================================
    // Phase 1: Switch to WASM-SIMD
    // =========================================================================
    console.log('');
    console.log(`${colors.cyan}Phase 1: Switching to WASM-SIMD renderer...${colors.reset}`);

    // Find and click the WASM-SIMD button
    // The button text is the uppercase version of the enum value
    const switchedToWasm = await page.evaluate(() => {
      // Find all toggle button groups
      const toggleGroups = document.querySelectorAll('.view-mode-toggle');
      for (const group of toggleGroups) {
        const btns = group.querySelectorAll('.view-mode-btn');
        for (const btn of btns) {
          // Check if this is a WASM-SIMD button (case-insensitive)
          if (btn.textContent.toLowerCase() === 'wasm') {
            btn.click();
            return { found: true, text: btn.textContent };
          }
        }
      }
      return { found: false, buttons: [...document.querySelectorAll('.view-mode-btn')].map(b => b.textContent) };
    });

    if (!switchedToWasm.found) {
      console.log(`${colors.yellow}Available buttons: ${switchedToWasm.buttons?.join(', ')}${colors.reset}`);
      // Try alternative selector based on the schema - look for the Displacement Renderer section
      const altSwitch = await page.evaluate(() => {
        // Find the control with "Displacement Renderer" label
        const controls = document.querySelectorAll('.control');
        for (const control of controls) {
          const header = control.querySelector('.control-header');
          if (header && header.textContent.includes('Displacement Renderer')) {
            const btns = control.querySelectorAll('.view-mode-btn');
            for (const btn of btns) {
              if (btn.textContent.toLowerCase().includes('wasm')) {
                btn.click();
                return true;
              }
            }
          }
        }
        return false;
      });

      if (!altSwitch) {
        console.log(`${colors.red}Could not find WASM-SIMD toggle${colors.reset}`);
        await browser.close();
        return;
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // Verify the switch
    const currentRenderer = await page.evaluate(() => window.__wasmMonitor.getCurrentRenderer());
    console.log(`${colors.green}✓ Switched to WASM-SIMD (current: ${currentRenderer || 'wasm'})${colors.reset}`);

    // Take initial heap snapshot
    console.log(`${colors.dim}Taking initial heap snapshot...${colors.reset}`);
    await cdp.send('HeapProfiler.collectGarbage');
    const initialHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
    memorySnapshots.push({ phase: 'wasm_initial', heap: initialHeap });

    // =========================================================================
    // Phase 2: Extended WASM resize stress (aggressive pattern)
    // =========================================================================
    console.log('');
    console.log(`${colors.cyan}Phase 2: Extended WASM resize (${WASM_RESIZE_DURATION_MS/1000}s, aggressive)...${colors.reset}`);

    const resizeStartTime = Date.now();
    let resizeCount = 0;
    let lastReport = Date.now();
    let maxHeapObserved = initialHeap;

    // Use aggressive resize patterns that stress WASM memory allocation
    const resizePatterns = [
      // Rapid oscillation
      (t) => ({ w: 200 + Math.sin(t * 10) * 150, h: 150 + Math.cos(t * 8) * 100 }),
      // Large to small jumps
      (t) => ({ w: Math.sin(t * 5) > 0 ? 500 : 100, h: Math.cos(t * 5) > 0 ? 400 : 80 }),
      // Gradual growth then sudden drop
      (t) => {
        const phase = (t % 2);
        return phase < 1.5
          ? { w: 100 + phase * 200, h: 100 + phase * 150 }
          : { w: 100, h: 100 };
      },
      // Random-like jumps
      (t) => ({
        w: 100 + Math.abs(Math.sin(t * 17.3) * Math.cos(t * 7.1)) * 400,
        h: 100 + Math.abs(Math.cos(t * 13.7) * Math.sin(t * 11.3)) * 300
      }),
    ];

    while (Date.now() - resizeStartTime < WASM_RESIZE_DURATION_MS && !crashDetected) {
      const elapsed = (Date.now() - resizeStartTime) / 1000;
      const patternIndex = Math.floor(elapsed / 3) % resizePatterns.length;
      const { w, h } = resizePatterns[patternIndex](elapsed);

      try {
        await page.evaluate(({ w, h }) => {
          const el = document.querySelector('.glass-panel');
          if (el) {
            el.style.width = `${Math.round(w)}px`;
            el.style.height = `${Math.round(h)}px`;
          }
          window.__wasmMonitor?.measure();
        }, { w, h });

        resizeCount++;
      } catch (e) {
        console.log(`${colors.red}Resize failed: ${e.message}${colors.reset}`);
        crashDetected = true;
        crashInfo = { type: 'resize_failed', message: e.message, phase: 'wasm' };
        break;
      }

      // Report every 3 seconds
      if (Date.now() - lastReport > 3000) {
        try {
          const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
          maxHeapObserved = Math.max(maxHeapObserved, heap);
          wasmMemoryHistory.push({
            time: Date.now() - resizeStartTime,
            heap,
            resizes: resizeCount
          });
          console.log(`  ${colors.dim}${Math.floor((Date.now() - resizeStartTime)/1000)}s: ${resizeCount} resizes, heap=${formatBytes(heap)}, max=${formatBytes(maxHeapObserved)}${colors.reset}`);
        } catch (e) {
          console.log(`  ${colors.red}Monitor failed: ${e.message}${colors.reset}`);
        }
        lastReport = Date.now();
      }

      await new Promise(r => setTimeout(r, RESIZE_INTERVAL_MS));
    }

    if (crashDetected) {
      console.log(`${colors.red}Crash detected during WASM phase!${colors.reset}`);
    }

    // Take post-WASM snapshot
    console.log(`${colors.dim}Taking post-WASM heap snapshot...${colors.reset}`);
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      await new Promise(r => setTimeout(r, 500));
      const postWasmHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
      memorySnapshots.push({ phase: 'wasm_post', heap: postWasmHeap, resizes: resizeCount });
      console.log(`${colors.green}✓ WASM phase complete: ${resizeCount} resizes${colors.reset}`);
      console.log(`  Heap: ${formatBytes(initialHeap)} → ${formatBytes(postWasmHeap)} (growth: ${formatBytes(postWasmHeap - initialHeap)})`);
      console.log(`  Max observed: ${formatBytes(maxHeapObserved)}`);
    } catch (e) {
      console.log(`${colors.red}Could not get post-WASM snapshot: ${e.message}${colors.reset}`);
    }

    // =========================================================================
    // Phase 3: Switch to WebGL2 (critical moment)
    // =========================================================================
    console.log('');
    console.log(`${colors.yellow}Phase 3: Switching to WebGL2 (monitoring for crash)...${colors.reset}`);

    // Get memory state just before switch
    const preSwitchState = await page.evaluate(() => {
      const history = window.__wasmMonitor?.getHistory() || [];
      return {
        heapBeforeSwitch: performance.memory?.usedJSHeapSize || 0,
        totalMeasurements: history.length,
        lastMeasurement: history[history.length - 1],
      };
    });
    console.log(`  ${colors.dim}Pre-switch heap: ${formatBytes(preSwitchState.heapBeforeSwitch)}${colors.reset}`);

    // Switch to WebGL2
    const switchedToGL2 = await page.evaluate(() => {
      const controls = document.querySelectorAll('.control');
      for (const control of controls) {
        const header = control.querySelector('.control-header');
        if (header && header.textContent.includes('Displacement Renderer')) {
          const btns = control.querySelectorAll('.view-mode-btn');
          for (const btn of btns) {
            if (btn.textContent.toLowerCase() === 'gl2') {
              btn.click();
              return true;
            }
          }
        }
      }
      return false;
    });

    if (!switchedToGL2) {
      console.log(`${colors.red}Could not find GL2 toggle${colors.reset}`);
    } else {
      console.log(`${colors.green}✓ Switched to WebGL2${colors.reset}`);
    }

    // Immediately start monitoring
    const monitorInterval = setInterval(async () => {
      if (crashDetected) return;
      try {
        const state = await page.evaluate(() => ({
          heap: performance.memory?.usedJSHeapSize || 0,
          canvases: document.querySelectorAll('canvas').length,
          renderer: getComputedStyle(document.querySelector('.glass-panel'))
            .getPropertyValue('--liquidglass-displacement-renderer').trim(),
        }));
        console.log(`  ${colors.dim}Monitor: heap=${formatBytes(state.heap)}, canvases=${state.canvases}, renderer=${state.renderer}${colors.reset}`);
      } catch (e) {
        console.log(`  ${colors.red}Monitor failed: ${e.message}${colors.reset}`);
        crashDetected = true;
        crashInfo = { type: 'monitor_failed', message: e.message };
      }
    }, 1000);

    // Post-switch: continue resizing to trigger WebGL2 renders
    console.log(`${colors.cyan}Post-switch monitoring (${POST_SWITCH_MONITOR_MS/1000}s)...${colors.reset}`);

    const postSwitchStart = Date.now();
    let postSwitchResizes = 0;

    while (Date.now() - postSwitchStart < POST_SWITCH_MONITOR_MS && !crashDetected) {
      try {
        const elapsed = (Date.now() - postSwitchStart) / 1000;
        const w = 250 + Math.sin(elapsed * 3) * 150;
        const h = 180 + Math.cos(elapsed * 2.5) * 100;

        await page.evaluate(({ w, h }) => {
          const el = document.querySelector('.glass-panel');
          if (el) {
            el.style.width = `${Math.round(w)}px`;
            el.style.height = `${Math.round(h)}px`;
          }
        }, { w, h });

        postSwitchResizes++;
        await new Promise(r => setTimeout(r, RESIZE_INTERVAL_MS));

      } catch (e) {
        console.log(`${colors.red}Error during post-switch resize: ${e.message}${colors.reset}`);
        crashDetected = true;
        crashInfo = {
          type: 'post_switch_resize_error',
          message: e.message,
          resizesBeforeCrash: postSwitchResizes,
        };
      }
    }

    clearInterval(monitorInterval);

    // =========================================================================
    // Phase 4: Analysis
    // =========================================================================
    console.log('');
    console.log(`${colors.cyan}Phase 4: Analysis...${colors.reset}`);

    // Get final heap state and WASM info
    let finalState = null;
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      await new Promise(r => setTimeout(r, 500));
      finalState = await page.evaluate(() => ({
        heap: performance.memory?.usedJSHeapSize || 0,
        history: window.__wasmMonitor?.getHistory() || [],
        canvases: document.querySelectorAll('canvas').length,
        filters: document.querySelectorAll('filter').length,
      }));
      memorySnapshots.push({ phase: 'webgl2_post', heap: finalState.heap });
    } catch (e) {
      console.log(`${colors.red}Could not get final state (page may have crashed): ${e.message}${colors.reset}`);
    }

    // =========================================================================
    // Report
    // =========================================================================
    console.log('');
    console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║  Diagnosis Report                                            ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Crash status
    if (crashDetected) {
      console.log(`${colors.red}║  CRASH DETECTED                                              ║${colors.reset}`);
      if (crashInfo) {
        console.log(`${colors.red}║  Type: ${String(crashInfo.type).padEnd(51)}║${colors.reset}`);
        console.log(`${colors.red}║  Message: ${String(crashInfo.message || '').substring(0, 48).padEnd(48)}║${colors.reset}`);
        if (crashInfo.resizesBeforeCrash !== undefined) {
          console.log(`${colors.red}║  Resizes before crash: ${String(crashInfo.resizesBeforeCrash).padEnd(35)}║${colors.reset}`);
        }
      }
    } else {
      console.log(`${colors.green}║  NO CRASH DETECTED (in this run)                            ║${colors.reset}`);
    }

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Memory analysis
    console.log(`${colors.cyan}║  Memory Snapshots:                                           ║${colors.reset}`);
    for (const snap of memorySnapshots) {
      const line = `${snap.phase.padEnd(20)} ${formatBytes(snap.heap).padEnd(15)}`;
      console.log(`${colors.cyan}║${colors.reset}    ${line}${colors.cyan}                   ║${colors.reset}`);
    }

    if (memorySnapshots.length >= 2) {
      const growth = memorySnapshots[memorySnapshots.length - 1].heap - memorySnapshots[0].heap;
      const growthColor = growth > 20 * 1024 * 1024 ? colors.red : growth > 10 * 1024 * 1024 ? colors.yellow : colors.green;
      console.log(`${colors.cyan}║${colors.reset}    ${'Total Growth:'.padEnd(20)} ${growthColor}${formatBytes(growth).padEnd(15)}${colors.reset}${colors.cyan}                   ║${colors.reset}`);
    }

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Statistics
    console.log(`${colors.cyan}║  Statistics:                                                 ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}    WASM resizes:       ${String(resizeCount).padEnd(36)}${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}    Post-switch resizes: ${String(postSwitchResizes).padEnd(35)}${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}    Max heap observed:   ${formatBytes(maxHeapObserved).padEnd(35)}${colors.cyan}║${colors.reset}`);

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Error summary
    if (errors.length > 0) {
      console.log(`${colors.red}║  Errors (${errors.length}):                                                  ║${colors.reset}`);
      for (const err of errors.slice(0, 5)) {
        const text = typeof err === 'string' ? err : err.text;
        console.log(`${colors.red}║    ${text.substring(0, 54).padEnd(54)}║${colors.reset}`);
      }
    } else {
      console.log(`${colors.cyan}║  No JavaScript errors captured                              ║${colors.reset}`);
    }

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Known issue analysis
    console.log(`${colors.cyan}║  Potential Root Causes for SIGILL:                          ║${colors.reset}`);
    console.log(`${colors.cyan}║                                                              ║${colors.reset}`);
    console.log(`${colors.cyan}║  1. WASM memory.buffer detachment after grow()              ║${colors.reset}`);
    console.log(`${colors.cyan}║     - Uint8ClampedArray views become invalid                ║${colors.reset}`);
    console.log(`${colors.cyan}║     - quad-wasm-generator.ts line 359: wasmView             ║${colors.reset}`);
    console.log(`${colors.cyan}║                                                              ║${colors.reset}`);
    console.log(`${colors.cyan}║  2. WebGL2 context initialization while WASM active         ║${colors.reset}`);
    console.log(`${colors.cyan}║     - Shared OffscreenCanvas/HTMLCanvasElement conflict     ║${colors.reset}`);
    console.log(`${colors.cyan}║     - webgl2-generator.ts: _gl2Context singleton            ║${colors.reset}`);
    console.log(`${colors.cyan}║                                                              ║${colors.reset}`);
    console.log(`${colors.cyan}║  3. Race condition: WASM generation in-flight during switch ║${colors.reset}`);
    console.log(`${colors.cyan}║     - Promise not awaited before switching renderer         ║${colors.reset}`);
    console.log(`${colors.cyan}║     - filter-manager.ts: _render() async flow               ║${colors.reset}`);
    console.log(`${colors.cyan}║                                                              ║${colors.reset}`);
    console.log(`${colors.cyan}║  4. SIMD instruction on corrupted/unaligned memory          ║${colors.reset}`);
    console.log(`${colors.cyan}║     - AssemblyScript SIMD ops require aligned pointers      ║${colors.reset}`);
    console.log(`${colors.cyan}║     - Memory growth can invalidate alignment assumptions    ║${colors.reset}`);

    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);

    // Memory timeline (if we have data)
    if (finalState?.history?.length > 0) {
      console.log('');
      console.log(`${colors.cyan}Memory Timeline (${finalState.history.length} samples):${colors.reset}`);
      const samples = finalState.history;
      const step = Math.max(1, Math.floor(samples.length / 10));
      for (let i = 0; i < samples.length; i += step) {
        const s = samples[i];
        console.log(`  ${colors.dim}#${String(i).padEnd(4)} heap=${formatBytes(s.jsHeap).padEnd(12)} canvas=${s.canvasCount} filters=${s.filterCount} dataUrl=${formatBytes(s.dataUrlTotalSize)}${colors.reset}`);
      }
    }

    // Console timeline
    if (consoleMessages.length > 0) {
      console.log('');
      console.log(`${colors.cyan}Console Timeline (last 15):${colors.reset}`);
      for (const msg of consoleMessages.slice(-15)) {
        const levelColor = msg.level === 'error' ? colors.red : msg.level === 'warning' ? colors.yellow : colors.dim;
        console.log(`  ${levelColor}[${msg.level}] ${msg.text.substring(0, 65)}${colors.reset}`);
      }
    }

  } catch (error) {
    console.error(`${colors.red}Fatal Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.log(`${colors.dim}Browser already closed${colors.reset}`);
      }
    }
  }
}

run();
