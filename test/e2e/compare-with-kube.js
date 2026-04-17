/**
 * Compare our implementation with kube.io demos side by side
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPARE_DIR = join(__dirname, 'comparison');

if (!existsSync(COMPARE_DIR)) mkdirSync(COMPARE_DIR, { recursive: true });

async function compare() {
  console.log('Starting comparison...\n');

  // Start our dev server
  const server = await createServer({
    root: join(__dirname, '..'),
    server: { port: 3336 }
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Capture our demo
  console.log('Capturing our implementation...');
  const ourPage = await browser.newPage();
  await ourPage.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
  await ourPage.goto('http://localhost:3336', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Screenshot of circle panel
  const circleEl = await ourPage.$('#panel-circle');
  if (circleEl) {
    const circleShot = await circleEl.screenshot({ type: 'png' });
    writeFileSync(join(COMPARE_DIR, 'our-circle.png'), circleShot);
    console.log('  Saved our-circle.png');
  }

  // Full demo
  const ourFull = await ourPage.screenshot({ type: 'png' });
  writeFileSync(join(COMPARE_DIR, 'our-demo.png'), ourFull);
  console.log('  Saved our-demo.png');

  // Capture kube.io
  console.log('\nCapturing kube.io demo...');
  const kubePage = await browser.newPage();
  await kubePage.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });

  try {
    await kubePage.goto('https://kube.io/blog/liquid-glass-css-svg', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    // Scroll to find demo sections
    await kubePage.evaluate(() => window.scrollTo(0, 14000));
    await new Promise(r => setTimeout(r, 1000));

    const kubeShot = await kubePage.screenshot({ type: 'png' });
    writeFileSync(join(COMPARE_DIR, 'kube-searchbox.png'), kubeShot);
    console.log('  Saved kube-searchbox.png');

    // Get the magnifying glass hero
    await kubePage.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));
    const heroShot = await kubePage.screenshot({ type: 'png' });
    writeFileSync(join(COMPARE_DIR, 'kube-hero.png'), heroShot);
    console.log('  Saved kube-hero.png');

  } catch (e) {
    console.log('  Error capturing kube.io:', e.message);
  }

  await browser.close();
  await server.close();

  console.log('\nComparison screenshots saved to e2e/comparison/');
  console.log('Review the images to assess visual parity.');
}

compare().catch(console.error);
