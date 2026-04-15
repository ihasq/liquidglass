import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';
const DIFF_PATH = './screenshots/diff.png';

async function takeScreenshot() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const mockupBuffer = fs.readFileSync(MOCKUP_PATH);
  const mockupPng = PNG.sync.read(mockupBuffer);

  await page.setViewport({
    width: mockupPng.width,
    height: mockupPng.height,
    deviceScaleFactor: 1
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1000));

  fs.mkdirSync('./screenshots', { recursive: true });
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  await browser.close();

  return SCREENSHOT_PATH;
}

function compareImages() {
  const mockupBuffer = fs.readFileSync(MOCKUP_PATH);
  const screenshotBuffer = fs.readFileSync(SCREENSHOT_PATH);

  const mockupPng = PNG.sync.read(mockupBuffer);
  const screenshotPng = PNG.sync.read(screenshotBuffer);

  const { width, height } = mockupPng;

  if (screenshotPng.width !== width || screenshotPng.height !== height) {
    console.log(`Size mismatch: mockup ${width}x${height}, screenshot ${screenshotPng.width}x${screenshotPng.height}`);
    return { match: 0, total: width * height };
  }

  const diffPng = new PNG({ width, height });
  let totalDiff = 0;
  let matchingPixels = 0;
  const totalPixels = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const mr = mockupPng.data[idx];
      const mg = mockupPng.data[idx + 1];
      const mb = mockupPng.data[idx + 2];

      const sr = screenshotPng.data[idx];
      const sg = screenshotPng.data[idx + 1];
      const sb = screenshotPng.data[idx + 2];

      // Convert to YUV (ITU-R BT.601)
      // Y = 0.299R + 0.587G + 0.114B
      const mY = 0.299 * mr + 0.587 * mg + 0.114 * mb;
      const sY = 0.299 * sr + 0.587 * sg + 0.114 * sb;

      // Signed luminance difference: positive = mockup brighter, negative = screenshot brighter
      const dY = mY - sY;

      // Euclidean distance for match counting
      const dr = mr - sr;
      const dg = mg - sg;
      const db = mb - sb;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);

      if (distance < 15) {
        matchingPixels++;
      }
      totalDiff += distance;

      // Directional visualization:
      // Green = match
      // Red = mockup brighter (implementation is too dark / missing element)
      // Blue = screenshot brighter (implementation is too bright / extra element)
      const absDY = Math.abs(dY);

      if (absDY < 5) {
        // Match - dark green
        diffPng.data[idx] = 0;
        diffPng.data[idx + 1] = 50;
        diffPng.data[idx + 2] = 0;
      } else if (dY > 0) {
        // Mockup brighter (implementation too dark) - RED
        const intensity = Math.min(255, absDY * 2);
        diffPng.data[idx] = intensity;
        diffPng.data[idx + 1] = 0;
        diffPng.data[idx + 2] = 0;
      } else {
        // Screenshot brighter (implementation too bright) - BLUE
        const intensity = Math.min(255, absDY * 2);
        diffPng.data[idx] = 0;
        diffPng.data[idx + 1] = 0;
        diffPng.data[idx + 2] = intensity;
      }
      diffPng.data[idx + 3] = 255;
    }
  }

  fs.writeFileSync(DIFF_PATH, PNG.sync.write(diffPng));

  const matchRate = (matchingPixels / totalPixels * 100).toFixed(2);
  const avgDiff = (totalDiff / totalPixels).toFixed(2);

  console.log(`\n=== Screenshot Comparison Results ===`);
  console.log(`Mockup size: ${width}x${height}`);
  console.log(`Total pixels: ${totalPixels}`);
  console.log(`Matching pixels (dist < 15): ${matchingPixels}`);
  console.log(`Match rate: ${matchRate}%`);
  console.log(`Average color distance: ${avgDiff}`);
  console.log(`Diff image saved to: ${DIFF_PATH}`);
  console.log(`\nDirectional diff legend:`);
  console.log(`  Dark green = match (luminance diff < 5)`);
  console.log(`  Red = mockup brighter → implementation too dark / missing`);
  console.log(`  Blue = screenshot brighter → implementation too bright / extra`);

  return { match: matchingPixels, total: totalPixels, rate: parseFloat(matchRate), avgDiff: parseFloat(avgDiff) };
}

async function main() {
  console.log('Taking screenshot...');
  await takeScreenshot();
  console.log('Comparing with mockup...');
  const result = compareImages();

  if (result.rate >= 99.9) {
    console.log('\n✓ PASS: Match rate >= 99.9%');
    process.exit(0);
  } else {
    console.log('\n✗ FAIL: Match rate < 99.9%');
    process.exit(1);
  }
}

main().catch(console.error);
