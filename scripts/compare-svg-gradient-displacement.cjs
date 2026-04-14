// Compare SVG gradient displacement with kube.io's PNG displacement
const puppeteer = require('puppeteer');
const { createServer } = require('vite');
const { join, dirname } = require('path');
const { writeFileSync, readFileSync, existsSync, mkdirSync } = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'e2e/comparison/svg-gradient');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log('Starting SVG gradient displacement comparison...\n');

  // Start dev server
  const server = await createServer({
    root: ROOT,
    server: { port: 3340 }
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 2 });

  // Capture svg-precise-displacement.html
  console.log('Capturing svg-precise-displacement.html...');
  await page.goto('http://localhost:3340/demo/svg-precise-displacement.html', {
    waitUntil: 'networkidle0'
  });
  await new Promise(r => setTimeout(r, 2000));

  // Capture each panel
  const panels = [
    { id: 'kube-panel', name: 'kube-png' },
    { id: 'svg-precise-panel', name: 'svg-precise' },
    { id: 'svg-merge-panel', name: 'svg-merge' }
  ];

  const screenshots = {};

  for (const { id, name } of panels) {
    const el = await page.$(`#${id}`);
    if (el) {
      const shot = await el.screenshot({ type: 'png' });
      const path = join(OUTPUT_DIR, `${name}.png`);
      writeFileSync(path, shot);
      screenshots[name] = path;
      console.log(`  Saved ${name}.png`);
    }
  }

  // Full page screenshot
  const fullShot = await page.screenshot({ type: 'png' });
  writeFileSync(join(OUTPUT_DIR, 'full-page.png'), fullShot);
  console.log('  Saved full-page.png');

  await browser.close();
  await server.close();

  // Compare kube PNG vs SVG versions
  const kubeImg = screenshots['kube-png'] ? PNG.sync.read(readFileSync(screenshots['kube-png'])) : null;

  if (kubeImg) {
    const { width, height } = kubeImg;
    const totalPixels = width * height;

    for (const svgName of ['svg-precise', 'svg-merge']) {
      if (!screenshots[svgName]) continue;

      console.log(`\nComparing kube-png vs ${svgName}...`);

      const svgImg = PNG.sync.read(readFileSync(screenshots[svgName]));
      const diff = new PNG({ width, height });

      const numDiffPixels = pixelmatch(
        kubeImg.data, svgImg.data, diff.data,
        width, height,
        { threshold: 0.1 }
      );

      writeFileSync(join(OUTPUT_DIR, `diff-${svgName}.png`), PNG.sync.write(diff));

      const matchPercent = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(2);

      console.log(`  Image size: ${width} x ${height}`);
      console.log(`  Different pixels: ${numDiffPixels}`);
      console.log(`  Match percentage: ${matchPercent}%`);
    }
  }

  console.log(`\nOutput saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
