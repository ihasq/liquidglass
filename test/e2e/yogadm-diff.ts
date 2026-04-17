/**
 * YogaDM 9-Slice vs Simple Filter Pixel Comparison Test
 * Captures screenshots of both panels and compares them pixel-by-pixel
 */

import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.join(__dirname, 'debug');

async function main() {
  // Ensure debug directory exists
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 400 });

  // Load the test page
  await page.goto('http://localhost:8789/demo/yogadm-test.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  // Wait for the page to render
  await page.waitForSelector('#simple-panel');
  await page.waitForSelector('#yogadm-panel');

  // Additional wait for filter rendering and image loading
  await new Promise(r => setTimeout(r, 2000));

  // Capture screenshots of both panels
  const simplePanel = await page.$('#simple-panel');
  const yogadmPanel = await page.$('#yogadm-panel');

  if (!simplePanel || !yogadmPanel) {
    console.error('Could not find panels');
    await browser.close();
    process.exit(1);
  }

  const simpleScreenshot = await simplePanel.screenshot({ encoding: 'binary' }) as Buffer;
  const yogadmScreenshot = await yogadmPanel.screenshot({ encoding: 'binary' }) as Buffer;

  // Save screenshots for inspection
  fs.writeFileSync(path.join(DEBUG_DIR, 'yogadm-simple.png'), simpleScreenshot);
  fs.writeFileSync(path.join(DEBUG_DIR, 'yogadm-9slice.png'), yogadmScreenshot);

  // Parse PNGs
  const simplePng = PNG.sync.read(simpleScreenshot);
  const yogadmPng = PNG.sync.read(yogadmScreenshot);

  // Compare pixels
  const width = simplePng.width;
  const height = simplePng.height;
  let matchingPixels = 0;
  let totalPixels = width * height;
  let maxDiff = 0;
  let diffSum = 0;

  // Create diff image
  const diffPng = new PNG({ width, height });

  // Allow tolerance of ±1 per channel (±3 total) for GPU floating-point rounding
  const TOLERANCE = 3;
  let exactMatches = 0;
  let withinTolerance = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const r1 = simplePng.data[idx];
      const g1 = simplePng.data[idx + 1];
      const b1 = simplePng.data[idx + 2];

      const r2 = yogadmPng.data[idx];
      const g2 = yogadmPng.data[idx + 1];
      const b2 = yogadmPng.data[idx + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

      if (diff === 0) {
        exactMatches++;
        matchingPixels++;
        diffPng.data[idx] = 0;
        diffPng.data[idx + 1] = 255;
        diffPng.data[idx + 2] = 0;
        diffPng.data[idx + 3] = 255;
      } else if (diff <= TOLERANCE) {
        withinTolerance++;
        matchingPixels++;
        // Yellow for within tolerance
        diffPng.data[idx] = 255;
        diffPng.data[idx + 1] = 255;
        diffPng.data[idx + 2] = 0;
        diffPng.data[idx + 3] = 128;
      } else {
        const intensity = Math.min(255, diff * 10);
        diffPng.data[idx] = 255;
        diffPng.data[idx + 1] = 0;
        diffPng.data[idx + 2] = 0;
        diffPng.data[idx + 3] = intensity;

        maxDiff = Math.max(maxDiff, diff);
        diffSum += diff;
      }
    }
  }

  // Save diff image
  fs.writeFileSync(path.join(DEBUG_DIR, 'yogadm-diff.png'), PNG.sync.write(diffPng));

  const matchPercentage = (matchingPixels / totalPixels) * 100;
  const avgDiff = diffSum / (totalPixels - matchingPixels || 1);

  console.log('\n=== YogaDM 9-Slice vs Simple Filter Comparison ===');
  console.log(`Image size: ${width}x${height} (${totalPixels} pixels)`);
  console.log(`Exact matches: ${exactMatches} / ${totalPixels} (${(exactMatches / totalPixels * 100).toFixed(4)}%)`);
  console.log(`Within tolerance (±${TOLERANCE}): ${withinTolerance}`);
  console.log(`Total matching: ${matchingPixels} / ${totalPixels} (${matchPercentage.toFixed(4)}%)`);
  console.log(`Max difference per pixel: ${maxDiff}`);
  if (totalPixels - matchingPixels > 0) {
    console.log(`Avg difference (failures): ${avgDiff.toFixed(2)}`);
  }
  console.log(`\nScreenshots saved to: ${DEBUG_DIR}`);

  // Success thresholds:
  // - 100% (with GPU tolerance): Same dimensions path uses single feImage
  // - 99.5%: 9-slice path has ~0.5% edge antialiasing artifacts (acceptable)
  if (matchPercentage >= 99.9) {
    console.log('\n✅ SUCCESS: 99.9%+ match (single feImage path or equivalent)');
  } else if (matchPercentage >= 99.5) {
    console.log('\n✅ ACCEPTABLE: 99.5%+ match (9-slice path, edge artifacts within tolerance)');
  } else {
    console.log(`\n❌ NEED MORE WORK: ${matchPercentage.toFixed(2)}% below 99.5% threshold`);
  }

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
