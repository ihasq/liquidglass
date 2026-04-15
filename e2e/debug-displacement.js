/**
 * Debug script to visualize displacement maps
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = join(__dirname, 'debug');

if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });

async function debugDisplacementMaps() {
  console.log('Debugging displacement maps...\n');

  const server = await createServer({
    root: join(__dirname, '..'),
    server: { port: 3334 }
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

  await page.goto('http://localhost:3334', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Extract displacement map data URLs and info
  const debugInfo = await page.evaluate(() => {
    const glass = window.__liquidGlass;
    if (!glass) return { error: 'LiquidGlass not found' };

    const results = {};

    // Generate a test displacement map directly
    const { generateDisplacementMap } = glass.LiquidGlass.prototype.constructor;

    // Get the filter elements
    const filters = document.querySelectorAll('filter[id^="liquid-glass"]');
    results.filterCount = filters.length;

    // Check SVG container
    const svgContainer = document.querySelector('svg[aria-hidden="true"]');
    results.svgContainerExists = !!svgContainer;

    if (svgContainer) {
      results.svgHTML = svgContainer.outerHTML.substring(0, 2000);
    }

    // Check backdrop-filter on panels
    const panel = document.getElementById('panel-squircle');
    if (panel) {
      const styles = window.getComputedStyle(panel);
      results.backdropFilter = styles.backdropFilter;
      results.webkitBackdropFilter = styles.webkitBackdropFilter;
    }

    return results;
  });

  console.log('Debug info:', JSON.stringify(debugInfo, null, 2));

  // Save the SVG filter HTML for inspection
  if (debugInfo.svgHTML) {
    writeFileSync(join(DEBUG_DIR, 'svg-filter.html'), debugInfo.svgHTML);
    console.log('Saved SVG filter HTML');
  }

  // Take screenshot of the full page
  const screenshot = await page.screenshot({ type: 'png' });
  writeFileSync(join(DEBUG_DIR, 'current-render.png'), screenshot);

  await browser.close();
  await server.close();

  console.log('\nDebug complete! Check e2e/debug/ directory');
}

debugDisplacementMaps().catch(console.error);
