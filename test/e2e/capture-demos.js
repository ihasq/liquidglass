/**
 * Capture interactive demo components from kube.io
 */

import puppeteer from 'puppeteer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(__dirname, 'reference');

if (!existsSync(REFERENCE_DIR)) mkdirSync(REFERENCE_DIR, { recursive: true });

async function captureDemo() {
  console.log('Capturing demo screenshots from kube.io...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });

  try {
    await page.goto('https://kube.io/blog/liquid-glass-css-svg', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait for page load
    await new Promise(r => setTimeout(r, 3000));

    // Scroll down to find demos
    for (let scroll = 0; scroll <= 8000; scroll += 800) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      await new Promise(r => setTimeout(r, 500));

      const screenshot = await page.screenshot({ type: 'png' });
      writeFileSync(join(REFERENCE_DIR, `scroll-${scroll}.png`), screenshot);
      console.log(`Captured at scroll position: ${scroll}`);
    }

    // Get full page
    const fullPage = await page.screenshot({ type: 'png', fullPage: true });
    writeFileSync(join(REFERENCE_DIR, 'full-blog-page.png'), fullPage);
    console.log('Saved full page screenshot');

    console.log('\nDemo capture complete!');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

captureDemo();
