/**
 * Capture reference screenshots from kube.io demo
 */

import puppeteer from 'puppeteer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(__dirname, 'reference');

if (!existsSync(REFERENCE_DIR)) mkdirSync(REFERENCE_DIR, { recursive: true });

async function captureReference() {
  console.log('Capturing reference from kube.io demo...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

  try {
    // Navigate to kube.io demo
    console.log('Loading kube.io demo page...');
    await page.goto('https://kube.io/blog/liquid-glass-css-svg', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for page to fully load
    await new Promise(r => setTimeout(r, 2000));

    // Take full page screenshot
    const fullPage = await page.screenshot({ type: 'png', fullPage: false });
    writeFileSync(join(REFERENCE_DIR, 'kube-io-demo.png'), fullPage);
    console.log('Saved: kube-io-demo.png');

    // Try to find and capture specific glass elements
    // The blog page likely has demo components
    const demoSelectors = [
      '.liquid-glass',
      '[class*="glass"]',
      '.demo',
      'article',
      'main'
    ];

    for (const selector of demoSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const box = await element.boundingBox();
          if (box && box.width > 100 && box.height > 100) {
            const screenshot = await element.screenshot({ type: 'png' });
            const safeName = selector.replace(/[^a-z0-9]/gi, '-');
            writeFileSync(join(REFERENCE_DIR, `kube-element-${safeName}.png`), screenshot);
            console.log(`Saved: kube-element-${safeName}.png`);
          }
        }
      } catch (e) {
        // Selector not found, continue
      }
    }

    console.log('\nReference capture complete!');

  } catch (error) {
    console.error('Error capturing reference:', error.message);
  } finally {
    await browser.close();
  }
}

captureReference();
