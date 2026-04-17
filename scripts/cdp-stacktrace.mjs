#!/usr/bin/env node
/**
 * CDP Stack Trace Analysis
 *
 * Injects instrumentation to capture call stacks
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const DEMO_URL = 'http://localhost:5173/demo/css-property-engine-demo.html';

async function startDevServer() {
  console.log('Starting Vite dev server...');
  const server = spawn('npx', ['vite', '--port', '5174'], {
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
    server.stderr.on('data', () => {});
    server.on('error', reject);
  });

  return server;
}

async function runAnalysis() {
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

    // Capture console logs
    const consoleLogs = [];
    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    // Navigate
    const url = DEMO_URL.replace('5173', '5174');
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await sleep(500);

    // Inject instrumentation
    console.log('Injecting instrumentation...');
    await page.evaluate(() => {
      window.__scanCalls = [];
      window.__checkCalls = [];
      window.__scheduleCalls = [];

      // Find the engine instance
      const engine = window.__cssPropertyEngine;
      if (!engine) {
        console.warn('Engine not found on window');
        return;
      }

      // Wrap _scanDocument
      const origScan = engine._scanDocument.bind(engine);
      engine._scanDocument = function() {
        const stack = new Error().stack;
        window.__scanCalls.push({
          time: performance.now(),
          stack: stack.split('\n').slice(1, 6).join('\n')
        });
        return origScan();
      };

      // Wrap _checkElement
      const origCheck = engine._checkElement.bind(engine);
      engine._checkElement = function(el) {
        window.__checkCalls.push({
          time: performance.now(),
          element: el.id || el.className,
        });
        return origCheck(el);
      };

      // Wrap _scheduleScan
      const origSchedule = engine._scheduleScan.bind(engine);
      engine._scheduleScan = function() {
        const stack = new Error().stack;
        window.__scheduleCalls.push({
          time: performance.now(),
          stack: stack.split('\n').slice(1, 6).join('\n')
        });
        return origSchedule();
      };

      console.log('Instrumentation injected');
    });

    // Check if instrumentation worked
    const instrumentationOk = await page.evaluate(() => {
      return typeof window.__scanCalls !== 'undefined';
    });

    if (!instrumentationOk) {
      // Try alternative approach - expose engine on window
      console.log('Retrying with alternative approach...');
      await page.evaluate(() => {
        // The engine might not be directly accessible
        // Let's trace via console
        window.__scanCalls = [];
        window.__checkCalls = [];

        const origConsoleLog = console.log;
        console.log = function(...args) {
          if (args[0]?.includes?.('scan') || args[0]?.includes?.('check')) {
            window.__scanCalls.push({
              time: performance.now(),
              message: args.join(' ')
            });
          }
          return origConsoleLog.apply(console, args);
        };
      });
    }

    await sleep(500);

    // Simulate interactions
    console.log('\nSimulating interactions...');

    // Initial state
    await page.evaluate(() => {
      window.__testPhase = 'initial';
    });
    await sleep(200);

    // Phase 1: Single color change
    console.log('  Phase 1: Color change');
    await page.evaluate(() => {
      window.__testPhase = 'color_change';
      const colorInput = document.getElementById('color1');
      if (colorInput) {
        colorInput.value = '#00ff00';
        colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(300);

    // Phase 2: Single size change
    console.log('  Phase 2: Size change');
    await page.evaluate(() => {
      window.__testPhase = 'size_change';
      const sizeInput = document.getElementById('size1');
      if (sizeInput) {
        sizeInput.value = '110';
        sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(300);

    // Phase 3: Rapid changes
    console.log('  Phase 3: Rapid changes (10 iterations)');
    await page.evaluate(() => {
      window.__testPhase = 'rapid_changes';
    });
    for (let i = 0; i < 10; i++) {
      await page.evaluate((val) => {
        const sizeInput = document.getElementById('size1');
        if (sizeInput) {
          sizeInput.value = String(val);
          sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 80 + i * 5);
      await sleep(30);
    }
    await sleep(500);

    // Phase 4: Toggle highlight (triggers class change)
    console.log('  Phase 4: Toggle highlight');
    await page.evaluate(() => {
      const toggleBtn = document.getElementById('toggleHighlight');
      if (toggleBtn) toggleBtn.click();
    });
    await sleep(300);

    // Phase 5: Force rescan to test scan code path
    console.log('  Phase 5: Force rescan');
    await page.evaluate(() => {
      if (window.__cssPropertyEngine) {
        window.__cssPropertyEngine.rescan();
      }
    });
    await sleep(300);

    // Collect results
    console.log('\n========================================');
    console.log('STACK TRACE ANALYSIS');
    console.log('========================================\n');

    const results = await page.evaluate(() => {
      return {
        scanCalls: window.__scanCalls || [],
        checkCalls: window.__checkCalls || [],
        scheduleCalls: window.__scheduleCalls || [],
        logCount: document.getElementById('log')?.children.length || 0,
      };
    });

    console.log(`Total _scanDocument calls: ${results.scanCalls.length}`);
    console.log(`Total _checkElement calls: ${results.checkCalls.length}`);
    console.log(`Total _scheduleScan calls: ${results.scheduleCalls.length}`);
    console.log(`Callback executions: ${results.logCount}`);

    if (results.scheduleCalls.length > 0) {
      console.log('\n--- _scheduleScan call stacks ---');
      const uniqueStacks = new Map();
      for (const call of results.scheduleCalls) {
        const key = call.stack;
        if (!uniqueStacks.has(key)) {
          uniqueStacks.set(key, { count: 0, stack: call.stack });
        }
        uniqueStacks.get(key).count++;
      }

      for (const [, data] of uniqueStacks) {
        console.log(`\n[${data.count}x]:`);
        console.log(data.stack);
      }
    }

    if (results.scanCalls.length > 0) {
      console.log('\n--- _scanDocument call stacks ---');
      const uniqueStacks = new Map();
      for (const call of results.scanCalls) {
        const key = call.stack;
        if (!uniqueStacks.has(key)) {
          uniqueStacks.set(key, { count: 0, stack: call.stack });
        }
        uniqueStacks.get(key).count++;
      }

      for (const [, data] of uniqueStacks) {
        console.log(`\n[${data.count}x]:`);
        console.log(data.stack);
      }
    }

    // Analysis
    console.log('\n========================================');
    console.log('ANALYSIS');
    console.log('========================================\n');

    const expectedCallbacks = 10 + 2; // 10 rapid + 1 color + 1 size (each property)
    const actualCallbacks = results.logCount;

    if (actualCallbacks > expectedCallbacks * 2) {
      console.log(`⚠️  Excessive callbacks: ${actualCallbacks} (expected ~${expectedCallbacks * 2})`);
    } else {
      console.log(`✓  Callback count OK: ${actualCallbacks}`);
    }

    // Check if scans are proportional to changes
    const expectedScans = 12; // rough estimate with debouncing
    if (results.scanCalls.length > expectedScans * 3) {
      console.log(`⚠️  Excessive scans: ${results.scanCalls.length} (expected ~${expectedScans})`);
    } else {
      console.log(`✓  Scan count OK: ${results.scanCalls.length}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

runAnalysis().catch(console.error);
