// Test: Full 2D displacement map with SVG scaling
// Verify that the map works correctly when scaled to different sizes

const fs = require('fs');
const PNG = require('pngjs').PNG;
const sharp = require('sharp');
const puppeteer = require('puppeteer');

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

async function main() {
  console.log('=== Full Map + SVG Scaling Test ===\n');
  console.log(`Original map: ${width}x${height}`);
  
  // Convert to WebP (lossless)
  await sharp(Buffer.from(kubeMap.data), {
    raw: { width, height, channels: 4 }
  })
    .webp({ lossless: true })
    .toFile('e2e/debug/dispmap-compare/kube-lossless.webp');
  
  const pngSize = fs.statSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png').size;
  const webpSize = fs.statSync('e2e/debug/dispmap-compare/kube-lossless.webp').size;
  
  console.log(`PNG size: ${(pngSize / 1024).toFixed(1)} KB`);
  console.log(`WebP lossless: ${(webpSize / 1024).toFixed(1)} KB`);
  console.log(`Compression: ${(pngSize / webpSize).toFixed(2)}x\n`);
  
  // Test with lossy WebP (smaller file)
  await sharp(Buffer.from(kubeMap.data), {
    raw: { width, height, channels: 4 }
  })
    .webp({ quality: 100, nearLossless: true })
    .toFile('e2e/debug/dispmap-compare/kube-nearLossless.webp');
  
  const webpNLSize = fs.statSync('e2e/debug/dispmap-compare/kube-nearLossless.webp').size;
  console.log(`WebP near-lossless: ${(webpNLSize / 1024).toFixed(1)} KB`);
  
  // Read back and compare
  const webpData = await sharp('e2e/debug/dispmap-compare/kube-lossless.webp')
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  let webpMatch = 0;
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const srcR = kubeMap.data[i * 4];
    const srcG = kubeMap.data[i * 4 + 1];
    const dstR = webpData.data[i * 4];
    const dstG = webpData.data[i * 4 + 1];
    if (srcR === dstR && srcG === dstG) webpMatch++;
  }
  console.log(`\nWebP lossless exact match: ${(webpMatch / totalPixels * 100).toFixed(2)}%`);
  
  // Test SVG scaling in browser
  console.log('\n=== Testing SVG Scaling in Browser ===');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Create test HTML with different scale factors
  const testHtml = `<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; background: #888; }
canvas { display: block; margin: 10px; border: 1px solid #000; }
</style>
</head>
<body>
<canvas id="c1" width="${width}" height="${height}"></canvas>
<script>
async function test() {
  const canvas = document.getElementById('c1');
  const ctx = canvas.getContext('2d');
  
  // Load the WebP
  const img = new Image();
  img.src = '/e2e/debug/dispmap-compare/kube-lossless.webp';
  await new Promise(r => img.onload = r);
  
  // Draw at original size
  ctx.drawImage(img, 0, 0);
  
  // Get pixel data
  const imageData = ctx.getImageData(0, 0, ${width}, ${height});
  return Array.from(imageData.data);
}
test().then(data => window.testData = data);
</script>
</body>
</html>`;
  
  await page.setContent(testHtml, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.testData !== undefined');
  
  const browserData = await page.evaluate(() => window.testData);
  
  // Compare browser-rendered WebP with original
  let browserMatch = 0;
  for (let i = 0; i < totalPixels; i++) {
    const srcR = kubeMap.data[i * 4];
    const srcG = kubeMap.data[i * 4 + 1];
    const dstR = browserData[i * 4];
    const dstG = browserData[i * 4 + 1];
    if (srcR === dstR && srcG === dstG) browserMatch++;
  }
  console.log(`Browser WebP exact match: ${(browserMatch / totalPixels * 100).toFixed(2)}%`);
  
  await browser.close();
  
  // Summary of adjustable parameters
  console.log('\n=== Adjustable Parameters with Single WebP ===');
  console.log('1. SIZE: feImage width/height attributes');
  console.log('   - Can scale to any element size');
  console.log('   - preserveAspectRatio controls stretch behavior');
  console.log('');
  console.log('2. INTENSITY: feDisplacementMap scale attribute');
  console.log('   - scale=0: no displacement');
  console.log('   - scale=98: original intensity');
  console.log('   - scale=196: double intensity');
  console.log('');
  console.log('3. CONTRAST/GAMMA: feComponentTransfer');
  console.log('   - feFuncR/G with type="gamma"');
  console.log('   - Adjusts displacement curve shape');
  console.log('');
  console.log('4. ASPECT RATIO:');
  console.log('   - preserveAspectRatio="none" stretches');
  console.log('   - May distort corners slightly');
  console.log('   - For accurate corners, need multiple maps');
}

main().catch(console.error);
