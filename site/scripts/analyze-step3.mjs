import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

function main() {
  const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

  console.log('=== STEP 3 DETAILED ANALYSIS ===\n');

  // Step 3 area: y=315-633
  // Look at the full horizontal extent

  console.log('Horizontal scan at y=370 (a line in step 3):');
  for (let x = 100; x < 700; x += 10) {
    const p = getPixel(png, x, 370);
    if (p) {
      const isWhite = p.r > 250;
      const isGray = p.r > 100 && p.r < 200;
      const isDark = p.r < 100;
      const isOffWhite = p.r > 220 && p.r < 250;

      let type = 'other';
      if (isWhite) type = 'white';
      else if (isOffWhite) type = 'offwhite';
      else if (isGray) type = 'gray';
      else if (isDark) type = 'dark';

      console.log(`x=${x}: rgb(${p.r},${p.g},${p.b}) - ${type}`);
    }
  }

  console.log('\n\nLooking for circular elements in step 3...');
  // Circles would have a consistent color in a round shape
  // Scan around y=360 (first value line)

  console.log('\nHorizontal scan at y=375:');
  for (let x = 100; x < 500; x += 5) {
    const p = getPixel(png, x, 375);
    if (p && (p.r < 240 || Math.abs(p.r - p.g) > 5)) {
      console.log(`x=${x}: rgb(${p.r},${p.g},${p.b})`);
    }
  }

  // Look for the line pattern in step 3
  console.log('\n\nLooking for line elements (horizontal lines):');
  for (let y = 350; y < 450; y += 5) {
    let linePixels = 0;
    let lineColor = null;
    for (let x = 130; x < 450; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 250 && p.r > 200) {
        linePixels++;
        if (!lineColor) lineColor = p;
      }
    }
    if (linePixels > 200) {
      console.log(`y=${y}: ${linePixels} gray pixels, color=rgb(${lineColor?.r},${lineColor?.g},${lineColor?.b})`);
    }
  }

  // Find the exact structure of step 3
  console.log('\n\n=== STEP 3 STRUCTURE ===');
  console.log('Vertical scan at x=350 (middle of potential line area):');
  for (let y = 300; y < 700; y += 10) {
    const p = getPixel(png, 350, y);
    if (p && p.r < 250) {
      console.log(`y=${y}: rgb(${p.r},${p.g},${p.b})`);
    }
  }

  // Check what's at the right edge of step 3 (the values)
  console.log('\n\nVertical scan at x=450 (value area):');
  for (let y = 310; y < 650; y += 10) {
    const p = getPixel(png, 450, y);
    if (p) {
      const isDark = p.r < 100;
      console.log(`y=${y}: rgb(${p.r},${p.g},${p.b})${isDark ? ' [TEXT]' : ''}`);
    }
  }
}

main();
