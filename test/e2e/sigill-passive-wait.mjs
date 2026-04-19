#!/usr/bin/env node
/**
 * Passive SIGILL reproduction test
 *
 * Exactly as reported: open parameter-lab and wait.
 * No user interaction, no resize, no clicks.
 */

import puppeteer from 'puppeteer';

const WAIT_MS = 60000; // 60 seconds
const SAMPLE_INTERVAL_MS = 2000;

const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].slice(0, 12)}] ${msg}`);

async function run() {
  log('Passive SIGILL reproduction test');
  log('Method: open parameter-lab, wait, observe');
  log('');

  let browser = null;
  let crashed = false;
  let crashReason = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-features=WebAssemblySimd',
      ],
      dumpio: false,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Track crashes
    page.on('error', (err) => {
      crashed = true;
      crashReason = `PAGE ERROR: ${err.message}`;
      log(`CRASH: ${crashReason}`);
    });

    page.on('pageerror', (err) => {
      log(`PAGE JS ERROR: ${err.message}`);
    });

    // Console
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        log(`[${type.toUpperCase()}] ${msg.text()}`);
      }
    });

    // Navigate
    const url = 'http://localhost:8787/demo/parameter-lab/';
    log(`Loading ${url}...`);

    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (e) {
      log(`Navigation failed: ${e.message}`);
      crashed = true;
      crashReason = `Navigation: ${e.message}`;
    }

    if (!crashed) {
      log('Page loaded. Starting passive wait...');
      log('');

      const startTime = Date.now();
      let sampleCount = 0;

      while (Date.now() - startTime < WAIT_MS && !crashed) {
        await new Promise(r => setTimeout(r, SAMPLE_INTERVAL_MS));
        sampleCount++;

        // Just check if page is still responsive
        try {
          const state = await page.evaluate(() => {
            const panel = document.querySelector('.glass-panel');
            const rect = panel?.getBoundingClientRect();
            return {
              heap: (performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(1),
              panelExists: !!panel,
              panelSize: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : 'N/A',
            };
          });

          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log(`${elapsed}s: heap=${state.heap}MB, panel=${state.panelSize}`);

        } catch (e) {
          crashed = true;
          crashReason = `evaluate failed: ${e.message}`;
          log(`CRASH: ${crashReason}`);
        }
      }
    }

    log('');
    if (crashed) {
      log(`RESULT: CRASH DETECTED`);
      log(`Reason: ${crashReason}`);
      process.exitCode = 1;
    } else {
      log(`RESULT: No crash after ${WAIT_MS / 1000}s`);
      process.exitCode = 0;
    }

  } catch (e) {
    log(`Fatal: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

run();
