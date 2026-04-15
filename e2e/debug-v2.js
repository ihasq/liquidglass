/**
 * Debug script v2 - capture console logs and errors
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = join(__dirname, 'debug');

if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });

async function debug() {
  console.log('Starting debug...\n');

  const server = await createServer({
    root: join(__dirname, '..'),
    server: { port: 3335 }
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    dumpio: false
  });

  const page = await browser.newPage();

  // Capture console messages
  const logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', error => {
    logs.push(`[ERROR] ${error.message}`);
  });

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

  console.log('Loading page...');
  await page.goto('http://localhost:3335', { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait longer for scripts to load
  await new Promise(r => setTimeout(r, 3000));

  console.log('\nConsole logs:');
  logs.forEach(log => console.log('  ' + log));

  // Check if there are any SVG elements
  const svgInfo = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    const filters = document.querySelectorAll('filter');
    const feDisp = document.querySelectorAll('feDisplacementMap');

    const panel = document.getElementById('panel-squircle');
    let panelStyle = null;
    if (panel) {
      const cs = getComputedStyle(panel);
      panelStyle = {
        backdropFilter: cs.backdropFilter,
        background: cs.backgroundColor
      };
    }

    return {
      svgCount: svgs.length,
      filterCount: filters.length,
      feDisplacementMapCount: feDisp.length,
      panelStyle,
      bodyHTML: document.body.innerHTML.substring(0, 500)
    };
  });

  console.log('\nPage analysis:');
  console.log('  SVG elements:', svgInfo.svgCount);
  console.log('  Filter elements:', svgInfo.filterCount);
  console.log('  feDisplacementMap elements:', svgInfo.feDisplacementMapCount);
  console.log('  Panel style:', JSON.stringify(svgInfo.panelStyle, null, 4));

  // Get full HTML
  const html = await page.content();
  writeFileSync(join(DEBUG_DIR, 'page.html'), html);
  console.log('\nSaved page HTML to debug/page.html');

  // Screenshot
  const screenshot = await page.screenshot({ type: 'png' });
  writeFileSync(join(DEBUG_DIR, 'screenshot.png'), screenshot);

  await browser.close();
  await server.close();

  console.log('\nDone!');
}

debug().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
