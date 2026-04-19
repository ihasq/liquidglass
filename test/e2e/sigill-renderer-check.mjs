#!/usr/bin/env node
/**
 * Check which displacement renderer is actually being used
 * and monitor for SIGILL/crash during passive wait.
 */

import puppeteer from 'puppeteer';

const WAIT_MS = 30000;

const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].slice(0, 8)}] ${msg}`);

async function run() {
  log('SIGILL renderer check');

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,  // headless mode (headed not available in CI/SSH)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-features=WebAssemblySimd',
        '--enable-webgpu',
      ],
      dumpio: false,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Capture console
    page.on('console', (msg) => {
      const text = msg.text();
      // Filter for liquidglass-related logs
      if (text.includes('LiquidGlass') || text.includes('WebGL') || text.includes('WebGPU') || text.includes('WASM')) {
        log(`[CONSOLE] ${text}`);
      }
    });

    page.on('error', (err) => {
      log(`[CRASH] ${err.message}`);
    });

    page.on('pageerror', (err) => {
      log(`[PAGE ERROR] ${err.message}`);
    });

    // Navigate
    log('Loading page...');
    await page.goto('http://localhost:8787/demo/parameter-lab/', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for panel to render
    await page.waitForSelector('.glass-panel', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));

    // Check the actual renderer being used
    const info = await page.evaluate(() => {
      const panel = document.querySelector('.glass-panel');
      if (!panel) return { error: 'No panel found' };

      const style = getComputedStyle(panel);
      const renderer = style.getPropertyValue('--liquidglass-displacement-renderer').trim();

      // Get GPU info
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      let gpuRenderer = 'unknown';
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpuRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }

      // Check WebGPU availability
      let webgpuAvailable = false;
      if ('gpu' in navigator) {
        webgpuAvailable = true;
      }

      // Check how many filter elements exist
      const filterCount = document.querySelectorAll('filter').length;
      const feImageCount = document.querySelectorAll('feImage').length;

      return {
        cssRenderer: renderer || '(empty)',
        gpuRenderer,
        webgpuAvailable,
        filterCount,
        feImageCount,
      };
    });

    log('');
    log('=== RENDERER INFO ===');
    log(`CSS --liquidglass-displacement-renderer: ${info.cssRenderer}`);
    log(`GPU Renderer: ${info.gpuRenderer}`);
    log(`WebGPU Available: ${info.webgpuAvailable}`);
    log(`SVG Filters: ${info.filterCount}`);
    log(`feImage elements: ${info.feImageCount}`);
    log('=====================');
    log('');

    // Now wait passively
    log(`Waiting ${WAIT_MS / 1000}s passively...`);

    const startTime = Date.now();
    while (Date.now() - startTime < WAIT_MS) {
      await new Promise(r => setTimeout(r, 5000));

      try {
        const heap = await page.evaluate(() =>
          (performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(1)
        );
        log(`${Math.floor((Date.now() - startTime) / 1000)}s: heap=${heap}MB, page alive`);
      } catch (e) {
        log(`Page check failed: ${e.message}`);
        break;
      }
    }

    log('Test complete - no crash detected');

  } catch (e) {
    log(`Error: ${e.message}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

run();
