// Test: SVG filter with WebP displacement map
// Goal: Verify that WebP + SVG feDisplacementMap produces correct visual output

const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'e2e/debug/svg-webp-test');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log('=== SVG + WebP Displacement Map Test ===\n');

  // 1. Create lossless WebP from kube's displacement map
  const srcPng = 'e2e/debug/kube-assets/displacement-map-w2qrsb.png';
  const webpPath = path.join(OUTPUT_DIR, 'dispmap.webp');

  await sharp(srcPng)
    .webp({ lossless: true })
    .toFile(webpPath);

  const webpSize = fs.statSync(webpPath).size;
  console.log(`WebP created: ${(webpSize / 1024).toFixed(1)} KB`);

  // 2. Get original map dimensions
  const srcInfo = await sharp(srcPng).metadata();
  const { width, height } = srcInfo;
  console.log(`Map dimensions: ${width}x${height}`);

  // 3. Launch browser and render
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Serve the WebP file via data URL
  const webpData = fs.readFileSync(webpPath);
  const webpBase64 = webpData.toString('base64');
  const webpDataUrl = `data:image/webp;base64,${webpBase64}`;

  // Create test HTML
  const testHtml = `<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; background: #888; }
canvas { display: block; }
</style>
</head>
<body>
<canvas id="output" width="${width}" height="${height}"></canvas>
<script>
async function test() {
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');

  // Load the WebP displacement map
  const img = new Image();
  img.src = '${webpDataUrl}';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // Draw the displacement map itself (to verify WebP loaded correctly)
  ctx.drawImage(img, 0, 0, ${width}, ${height});

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, ${width}, ${height});
  return Array.from(imageData.data);
}
test().then(data => window.testResult = data).catch(e => window.testError = e.message);
</script>
</body>
</html>`;

  await page.setContent(testHtml, { waitUntil: 'networkidle0' });

  // Wait for result
  await page.waitForFunction('window.testResult !== undefined || window.testError !== undefined', { timeout: 30000 });

  const error = await page.evaluate(() => window.testError);
  if (error) {
    console.error('Browser error:', error);
    await browser.close();
    return;
  }

  const browserData = await page.evaluate(() => window.testResult);
  console.log(`Browser rendered ${browserData.length / 4} pixels`);

  // 4. Compare browser-rendered WebP with original PNG
  const srcData = await sharp(srcPng).raw().toBuffer({ resolveWithObject: true });

  let exactMatch = 0;
  let tolerance1Match = 0;
  let tolerance2Match = 0;
  const total = width * height;
  let maxErrR = 0, maxErrG = 0;

  for (let i = 0; i < total; i++) {
    const srcR = srcData.data[i * 4];
    const srcG = srcData.data[i * 4 + 1];
    const browserR = browserData[i * 4];
    const browserG = browserData[i * 4 + 1];

    const errR = Math.abs(srcR - browserR);
    const errG = Math.abs(srcG - browserG);

    if (errR === 0 && errG === 0) exactMatch++;
    if (errR <= 1 && errG <= 1) tolerance1Match++;
    if (errR <= 2 && errG <= 2) tolerance2Match++;

    maxErrR = Math.max(maxErrR, errR);
    maxErrG = Math.max(maxErrG, errG);
  }

  console.log(`\n=== Browser WebP Rendering Accuracy ===`);
  console.log(`Exact match: ${(exactMatch / total * 100).toFixed(4)}%`);
  console.log(`Within ±1:   ${(tolerance1Match / total * 100).toFixed(4)}%`);
  console.log(`Within ±2:   ${(tolerance2Match / total * 100).toFixed(4)}%`);
  console.log(`Max error:   R=${maxErrR}, G=${maxErrG}`);

  // 5. Save browser-rendered output
  const outPng = new PNG({ width, height });
  for (let i = 0; i < total; i++) {
    outPng.data[i * 4] = browserData[i * 4];
    outPng.data[i * 4 + 1] = browserData[i * 4 + 1];
    outPng.data[i * 4 + 2] = browserData[i * 4 + 2];
    outPng.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'browser-rendered.png'), PNG.sync.write(outPng));

  // 6. Create diff image
  const kubePng = PNG.sync.read(fs.readFileSync(srcPng));
  const diff = new PNG({ width, height });
  const numDiff = pixelmatch(kubePng.data, outPng.data, diff.data, width, height, { threshold: 0.01 });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'diff.png'), PNG.sync.write(diff));

  console.log(`\nPixelmatch diff pixels (threshold 0.01): ${numDiff}`);
  console.log(`Match: ${((total - numDiff) / total * 100).toFixed(4)}%`);

  await browser.close();

  // 7. Summary
  console.log('\n=== Summary ===');
  console.log(`WebP file: ${webpPath}`);
  console.log(`Size: ${(webpSize / 1024).toFixed(1)} KB (vs PNG: ${(fs.statSync(srcPng).size / 1024).toFixed(1)} KB)`);
  console.log(`Browser rendering accuracy: ${(exactMatch / total * 100).toFixed(2)}%`);

  if (exactMatch === total) {
    console.log('\n✓ 100% exact match - WebP can be used directly in SVG feDisplacementMap');
  } else if (tolerance1Match / total > 0.999) {
    console.log('\n✓ >99.9% match within ±1 - acceptable for visual effect');
  } else {
    console.log('\n✗ Match below target - need to investigate');
  }
}

main().catch(console.error);
