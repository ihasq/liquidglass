const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const PORT = process.argv[2] || '8788';

async function captureAndCompare() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  console.log(`Navigating to http://localhost:${PORT}/demo/kube-comparison.html`);

  try {
    await page.goto(`http://localhost:${PORT}/demo/kube-comparison.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
  } catch (e) {
    console.error('Failed to connect. Make sure the dev server is running on port', PORT);
    await browser.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 2000));

  // Capture full comparison
  await page.screenshot({ path: 'e2e/debug/comparison-full.png' });

  // Capture individual panels
  const kubePanel = await page.$('#kube-demo');
  const ourPanel = await page.$('#our-demo');

  if (kubePanel && ourPanel) {
    await kubePanel.screenshot({ path: 'e2e/debug/comparison-kube.png' });
    await ourPanel.screenshot({ path: 'e2e/debug/comparison-ours.png' });

    console.log('Captured both panels');

    // Compare the two images
    const img1 = PNG.sync.read(fs.readFileSync('e2e/debug/comparison-kube.png'));
    const img2 = PNG.sync.read(fs.readFileSync('e2e/debug/comparison-ours.png'));

    const width = Math.min(img1.width, img2.width);
    const height = Math.min(img1.height, img2.height);

    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(
      img1.data, img2.data, diff.data,
      width, height,
      { threshold: 0.1 }
    );

    fs.writeFileSync('e2e/debug/comparison-diff.png', PNG.sync.write(diff));

    const totalPixels = width * height;
    const matchPercentage = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(2);

    console.log('\n=== Comparison Results ===');
    console.log('Total pixels:', totalPixels);
    console.log('Different pixels:', numDiffPixels);
    console.log('Match percentage:', matchPercentage + '%');
    console.log('Diff image saved to: e2e/debug/comparison-diff.png');

    // Save results to JSON
    fs.writeFileSync('e2e/debug/comparison-results.json', JSON.stringify({
      timestamp: new Date().toISOString(),
      totalPixels,
      diffPixels: numDiffPixels,
      matchPercentage: parseFloat(matchPercentage)
    }, null, 2));

  } else {
    console.error('Could not find panels');
  }

  await browser.close();
}

captureAndCompare().catch(console.error);
