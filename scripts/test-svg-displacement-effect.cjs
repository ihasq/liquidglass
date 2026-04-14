// Test: Full SVG displacement effect with WebP
// Verify feDisplacementMap produces correct visual output

const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'e2e/debug/svg-displacement-test');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log('=== SVG Displacement Effect Test ===\n');

  // Load WebP as data URL
  const webpPath = path.join(ROOT, 'e2e/debug/svg-webp-test/dispmap.webp');
  if (!fs.existsSync(webpPath)) {
    // Create it
    await sharp(path.join(ROOT, 'e2e/debug/kube-assets/displacement-map-w2qrsb.png'))
      .webp({ lossless: true })
      .toFile(webpPath);
  }
  const webpData = fs.readFileSync(webpPath);
  const webpBase64 = webpData.toString('base64');
  const webpDataUrl = `data:image/webp;base64,${webpBase64}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Test element dimensions
  const W = 420, H = 300;

  // Create HTML with SVG filter
  const testHtml = `<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; padding: 0; }
.test-box {
  width: ${W}px;
  height: ${H}px;
  background: linear-gradient(135deg, #ff0000 0%, #00ff00 50%, #0000ff 100%);
}
</style>
</head>
<body>
<svg width="0" height="0" style="position: absolute;">
  <defs>
    <filter id="liquidglass" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <!-- Load displacement map from WebP -->
      <feImage href="${webpDataUrl}" result="dispMap"
               width="${W}" height="${H}"
               preserveAspectRatio="none"/>

      <!-- Apply displacement -->
      <feDisplacementMap in="SourceGraphic" in2="dispMap"
                         xChannelSelector="R" yChannelSelector="G"
                         scale="50" result="displaced"/>
    </filter>

    <!-- Same filter with different scale for comparison -->
    <filter id="liquidglass-2x" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${webpDataUrl}" result="dispMap"
               width="${W}" height="${H}"
               preserveAspectRatio="none"/>
      <feDisplacementMap in="SourceGraphic" in2="dispMap"
                         xChannelSelector="R" yChannelSelector="G"
                         scale="100" result="displaced"/>
    </filter>

    <!-- Filter with gamma adjustment -->
    <filter id="liquidglass-gamma" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${webpDataUrl}" result="dispMap"
               width="${W}" height="${H}"
               preserveAspectRatio="none"/>
      <!-- Adjust gamma before displacement -->
      <feComponentTransfer in="dispMap" result="adjustedMap">
        <feFuncR type="gamma" amplitude="1" exponent="0.5" offset="0"/>
        <feFuncG type="gamma" amplitude="1" exponent="0.5" offset="0"/>
      </feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="adjustedMap"
                         xChannelSelector="R" yChannelSelector="G"
                         scale="50" result="displaced"/>
    </filter>
  </defs>
</svg>

<div id="container">
  <canvas id="original" width="${W}" height="${H}"></canvas>
  <canvas id="filtered" width="${W}" height="${H}"></canvas>
  <canvas id="filtered-2x" width="${W}" height="${H}"></canvas>
  <canvas id="filtered-gamma" width="${W}" height="${H}"></canvas>
</div>

<script>
async function test() {
  const results = {};

  // Create gradient image
  const gradCanvas = document.createElement('canvas');
  gradCanvas.width = ${W};
  gradCanvas.height = ${H};
  const gradCtx = gradCanvas.getContext('2d');
  const gradient = gradCtx.createLinearGradient(0, 0, ${W}, ${H});
  gradient.addColorStop(0, '#ff0000');
  gradient.addColorStop(0.5, '#00ff00');
  gradient.addColorStop(1, '#0000ff');
  gradCtx.fillStyle = gradient;
  gradCtx.fillRect(0, 0, ${W}, ${H});

  // Draw original
  const origCtx = document.getElementById('original').getContext('2d');
  origCtx.drawImage(gradCanvas, 0, 0);
  results.original = Array.from(origCtx.getImageData(0, 0, ${W}, ${H}).data);

  // Apply filter using SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', ${W});
  svg.setAttribute('height', ${H});

  const foreignObj = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  foreignObj.setAttribute('width', '100%');
  foreignObj.setAttribute('height', '100%');
  foreignObj.setAttribute('filter', 'url(#liquidglass)');

  const div = document.createElement('div');
  div.style.width = '${W}px';
  div.style.height = '${H}px';
  div.style.background = 'linear-gradient(135deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)';
  foreignObj.appendChild(div);
  svg.appendChild(foreignObj);
  document.body.appendChild(svg);

  // Wait for render
  await new Promise(r => setTimeout(r, 100));

  // Capture filtered output using html2canvas approach
  const filteredCtx = document.getElementById('filtered').getContext('2d');
  filteredCtx.filter = 'url(#liquidglass)';
  filteredCtx.drawImage(gradCanvas, 0, 0);
  results.filtered = Array.from(filteredCtx.getImageData(0, 0, ${W}, ${H}).data);

  // 2x scale
  const filtered2xCtx = document.getElementById('filtered-2x').getContext('2d');
  filtered2xCtx.filter = 'url(#liquidglass-2x)';
  filtered2xCtx.drawImage(gradCanvas, 0, 0);
  results.filtered2x = Array.from(filtered2xCtx.getImageData(0, 0, ${W}, ${H}).data);

  // Gamma adjusted
  const filteredGammaCtx = document.getElementById('filtered-gamma').getContext('2d');
  filteredGammaCtx.filter = 'url(#liquidglass-gamma)';
  filteredGammaCtx.drawImage(gradCanvas, 0, 0);
  results.filteredGamma = Array.from(filteredGammaCtx.getImageData(0, 0, ${W}, ${H}).data);

  return results;
}
test().then(r => window.testResult = r).catch(e => window.testError = e.message);
</script>
</body>
</html>`;

  await page.setContent(testHtml, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.testResult !== undefined || window.testError !== undefined', { timeout: 30000 });

  const error = await page.evaluate(() => window.testError);
  if (error) {
    console.error('Browser error:', error);
    await browser.close();
    return;
  }

  const results = await page.evaluate(() => window.testResult);
  await browser.close();

  // Analyze results
  console.log('Captured renders:');
  console.log(`  original:    ${results.original.length / 4} pixels`);
  console.log(`  filtered:    ${results.filtered.length / 4} pixels`);
  console.log(`  filtered2x:  ${results.filtered2x.length / 4} pixels`);
  console.log(`  filteredGamma: ${results.filteredGamma.length / 4} pixels`);

  // Check if filter was applied (pixels should differ from original)
  let origVsFiltered = 0;
  let origVsFiltered2x = 0;
  let filteredVsGamma = 0;
  const total = W * H;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    if (results.original[idx] !== results.filtered[idx] ||
        results.original[idx + 1] !== results.filtered[idx + 1]) {
      origVsFiltered++;
    }
    if (results.original[idx] !== results.filtered2x[idx] ||
        results.original[idx + 1] !== results.filtered2x[idx + 1]) {
      origVsFiltered2x++;
    }
    if (results.filtered[idx] !== results.filteredGamma[idx] ||
        results.filtered[idx + 1] !== results.filteredGamma[idx + 1]) {
      filteredVsGamma++;
    }
  }

  console.log('\n=== Filter Effect Analysis ===');
  console.log(`Pixels modified (scale=50): ${origVsFiltered} (${(origVsFiltered / total * 100).toFixed(1)}%)`);
  console.log(`Pixels modified (scale=100): ${origVsFiltered2x} (${(origVsFiltered2x / total * 100).toFixed(1)}%)`);
  console.log(`Difference with gamma: ${filteredVsGamma} (${(filteredVsGamma / total * 100).toFixed(1)}%)`);

  // Save images
  function saveResult(name, data) {
    const png = new PNG({ width: W, height: H });
    for (let i = 0; i < W * H * 4; i++) {
      png.data[i] = data[i];
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.png`), PNG.sync.write(png));
  }

  saveResult('original', results.original);
  saveResult('filtered-scale50', results.filtered);
  saveResult('filtered-scale100', results.filtered2x);
  saveResult('filtered-gamma', results.filteredGamma);

  console.log(`\nImages saved to: ${OUTPUT_DIR}`);

  // Summary
  console.log('\n=== SVG Adjustable Parameters (no WebP re-encoding) ===');
  console.log('1. SIZE: feImage width/height attributes');
  console.log('2. INTENSITY: feDisplacementMap scale attribute');
  console.log('3. GAMMA/CONTRAST: feComponentTransfer feFuncR/G');
  console.log('4. ASPECT RATIO: preserveAspectRatio attribute');

  if (origVsFiltered > 0) {
    console.log('\n[SUCCESS] Displacement filter is working');
    console.log('The WebP displacement map can be used in SVG feDisplacementMap');
    console.log('with adjustable parameters without re-encoding the WebP.');
  } else {
    console.log('\n[WARNING] No visible displacement - filter may not be supported');
  }
}

main().catch(console.error);
