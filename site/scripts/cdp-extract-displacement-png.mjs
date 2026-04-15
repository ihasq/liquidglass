/**
 * Extract displacement maps as PNG and compare
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const OUTPUT_DIR = '/tmp/displacement-maps';

async function extractMaps(url, prefix) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const maps = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('svg filter').forEach((filter, filterIdx) => {
      filter.querySelectorAll('feImage').forEach(img => {
        const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href && href.startsWith('data:image/png;base64,')) {
          result.push({
            filterId: filter.id,
            result: img.getAttribute('result'),
            base64: href.replace('data:image/png;base64,', ''),
          });
        }
      });
    });
    return result;
  });

  await browser.close();

  // Save PNGs
  const savedFiles = [];
  for (const map of maps) {
    const filename = `${prefix}_${map.result}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    const buffer = Buffer.from(map.base64, 'base64');
    fs.writeFileSync(filepath, buffer);
    savedFiles.push({ name: map.result, path: filepath, size: buffer.length });
  }

  return savedFiles;
}

async function comparePNGs(file1, file2, outputPath) {
  const img1 = PNG.sync.read(fs.readFileSync(file1));
  const img2 = PNG.sync.read(fs.readFileSync(file2));

  // Check dimensions
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return {
      match: false,
      reason: `Size mismatch: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}`,
      img1Size: { w: img1.width, h: img1.height },
      img2Size: { w: img2.width, h: img2.height },
    };
  }

  const diff = new PNG({ width: img1.width, height: img1.height });
  const numDiffPixels = pixelmatch(
    img1.data, img2.data, diff.data,
    img1.width, img1.height,
    { threshold: 0.1 }
  );

  fs.writeFileSync(outputPath, PNG.sync.write(diff));

  const totalPixels = img1.width * img1.height;
  const diffPercent = ((numDiffPixels / totalPixels) * 100).toFixed(2);

  return {
    match: numDiffPixels === 0,
    diffPixels: numDiffPixels,
    totalPixels,
    diffPercent,
    diffPath: outputPath,
    size: { w: img1.width, h: img1.height },
  };
}

async function main() {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Extracting displacement maps...\n');

  // Extract from both sources
  const demoMaps = await extractMaps('http://localhost:8787/demo/parameter-lab.html', 'demo');
  const siteMaps = await extractMaps('http://localhost:5176', 'site');

  console.log('=== Demo Maps ===');
  demoMaps.forEach(m => console.log(`  ${m.name}: ${m.path} (${m.size} bytes)`));

  console.log('\n=== Site Maps ===');
  siteMaps.forEach(m => console.log(`  ${m.name}: ${m.path} (${m.size} bytes)`));

  // Compare matching maps
  console.log('\n=== Comparison ===\n');

  const mapTypes = ['dOld', 'dNew', 'sp'];
  for (const mapType of mapTypes) {
    const demoMap = demoMaps.find(m => m.name === mapType);
    const siteMap = siteMaps.find(m => m.name === mapType);

    if (!demoMap || !siteMap) {
      console.log(`${mapType}: Missing (demo: ${!!demoMap}, site: ${!!siteMap})`);
      continue;
    }

    const diffPath = path.join(OUTPUT_DIR, `diff_${mapType}.png`);
    const result = await comparePNGs(demoMap.path, siteMap.path, diffPath);

    console.log(`${mapType}:`);
    if (result.reason) {
      console.log(`  ${result.reason}`);
      console.log(`  Demo: ${result.img1Size.w}x${result.img1Size.h}`);
      console.log(`  Site: ${result.img2Size.w}x${result.img2Size.h}`);
    } else {
      console.log(`  Size: ${result.size.w}x${result.size.h}`);
      console.log(`  Diff pixels: ${result.diffPixels} / ${result.totalPixels} (${result.diffPercent}%)`);
      console.log(`  Diff image: ${result.diffPath}`);
    }
    console.log();
  }

  console.log(`\nAll files saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
