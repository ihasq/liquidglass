/**
 * Progressive Rendering Capture Script
 *
 * Captures screenshots showing displacement map lag during resize
 * with CPU throttling enabled to simulate slow devices.
 *
 * Usage: node e2e/progressive-render-capture.mjs
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'screenshots');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting Vite dev server...');

  // Start Vite dev server
  const vite = spawn('npx', ['vite', '--port', '5173'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Wait for Vite to be ready and capture the port
  let vitePort = null;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 30000);

    vite.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[vite]', output.trim());

      // Extract port from output like "Local:   http://localhost:5173/"
      const portMatch = output.match(/localhost:(\d+)/);
      if (portMatch) {
        vitePort = portMatch[1];
      }

      if (output.includes('Local:') || output.includes('ready in')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    vite.stderr.on('data', (data) => {
      console.error('[vite error]', data.toString().trim());
    });
  });

  console.log('Vite dev server ready on port:', vitePort);

  // Give Vite a moment to fully initialize
  await sleep(1000);

  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode
    args: [
      '--window-size=1400,900',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Get CDP session for CPU throttling
  const client = await page.createCDPSession();

  try {
    const url = `http://localhost:${vitePort}/demo/parameter-lab.html`;
    console.log('Navigating to:', url);
    await page.goto(url, {
      waitUntil: 'networkidle0'
    });

    console.log('Waiting 5 seconds for WASM to load...');
    await sleep(5000);

    // Wait for the window function to be defined
    console.log('Waiting for setFloatingControlsVisible to be defined...');
    await page.waitForFunction(() => typeof window.setFloatingControlsVisible === 'function', {
      timeout: 10000
    });

    // Take initial screenshot (before throttling)
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '01-initial-loaded.png'),
      fullPage: false
    });
    console.log('Screenshot: 01-initial-loaded.png');

    // Hide floating controls
    console.log('Hiding floating controls...');
    await page.evaluate(() => {
      window.setFloatingControlsVisible(false);
    });
    await sleep(500);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, '02-controls-hidden.png'),
      fullPage: false
    });
    console.log('Screenshot: 02-controls-hidden.png');

    // Enable CPU throttling (0.1x = 10x slowdown)
    // rate: 10 means 10x slowdown
    console.log('Enabling CPU throttling (10x slowdown)...');
    await client.send('Emulation.setCPUThrottlingRate', { rate: 10 });

    await page.screenshot({
      path: path.join(OUTPUT_DIR, '03-throttling-enabled.png'),
      fullPage: false
    });
    console.log('Screenshot: 03-throttling-enabled.png');

    // Get the main glass element's position
    const elementBounds = await page.evaluate(() => {
      const el = document.getElementById('element-1');
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    });

    console.log('Element bounds:', elementBounds);

    // Click to select the element first
    await page.mouse.click(elementBounds.centerX, elementBounds.centerY);
    await sleep(200);

    // Find the SE resize handle position
    const seHandlePos = await page.evaluate(() => {
      const el = document.getElementById('element-1');
      const glass = el.querySelector('.glass-panel');
      const glassRect = glass.getBoundingClientRect();
      // SE handle is at bottom-right corner
      return {
        x: glassRect.right - 6,
        y: glassRect.bottom - 6
      };
    });

    console.log('SE handle position:', seHandlePos);

    // Start resize by pressing mouse on SE handle
    console.log('Starting resize operation...');
    await page.mouse.move(seHandlePos.x, seHandlePos.y);
    await page.mouse.down();
    await sleep(100);

    // Take screenshots during drag at different positions
    const dragPositions = [
      { dx: 50, dy: 30, name: '04-resize-small' },
      { dx: 100, dy: 60, name: '05-resize-medium' },
      { dx: 150, dy: 90, name: '06-resize-large' },
      { dx: 200, dy: 120, name: '07-resize-max' },
    ];

    for (const pos of dragPositions) {
      const targetX = seHandlePos.x + pos.dx;
      const targetY = seHandlePos.y + pos.dy;

      console.log(`Dragging to ${pos.dx}, ${pos.dy}...`);

      // Move in small steps to simulate real drag
      const steps = 5;
      const currentX = await page.evaluate(() => {
        const el = document.getElementById('element-1');
        const glass = el.querySelector('.glass-panel');
        return glass.getBoundingClientRect().right;
      });
      const currentY = await page.evaluate(() => {
        const el = document.getElementById('element-1');
        const glass = el.querySelector('.glass-panel');
        return glass.getBoundingClientRect().bottom;
      });

      for (let i = 1; i <= steps; i++) {
        const x = currentX + (pos.dx * i / steps);
        const y = currentY + (pos.dy * i / steps);
        await page.mouse.move(x, y);
        await sleep(50);
      }

      // Take screenshot immediately after drag (should show lag)
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${pos.name}-during.png`),
        fullPage: false
      });
      console.log(`Screenshot: ${pos.name}-during.png`);

      // Wait a bit and take another screenshot (still catching up)
      await sleep(200);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${pos.name}-after.png`),
        fullPage: false
      });
      console.log(`Screenshot: ${pos.name}-after.png`);
    }

    // Release mouse
    await page.mouse.up();
    console.log('Mouse released');

    // Wait for high-res to complete and take final screenshot
    await sleep(1000);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '08-resize-complete.png'),
      fullPage: false
    });
    console.log('Screenshot: 08-resize-complete.png');

    // Disable throttling and take final comparison
    console.log('Disabling CPU throttling...');
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await sleep(500);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, '09-final-no-throttle.png'),
      fullPage: false
    });
    console.log('Screenshot: 09-final-no-throttle.png');

    console.log('\n=== All screenshots saved to:', OUTPUT_DIR, '===');

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // Cleanup
    await browser.close();
    vite.kill();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
