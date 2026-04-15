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

  // Look at specific regions to understand content
  console.log('=== STEP 3 CONTENT ANALYSIS ===\n');

  // Step 3 is around y=315-633
  // Text starts at x=444 according to analysis

  // Scan for left edge of text at each line
  for (let y = 310; y < 650; y += 25) {
    let textLeft = -1;
    for (let x = 100; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100) {
        textLeft = x;
        break;
      }
    }
    if (textLeft > 0) {
      console.log(`y=${y}: text starts at x=${textLeft}`);
    }
  }

  console.log('\n=== STEP 4 CONTENT ANALYSIS ===\n');

  // Step 4 is around y=689-899
  for (let y = 685; y < 920; y += 20) {
    let textLeft = -1;
    for (let x = 100; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100) {
        textLeft = x;
        break;
      }
    }
    if (textLeft > 0) {
      console.log(`y=${y}: text starts at x=${textLeft}`);
    }
  }

  // Check for code block boundaries (white rectangles)
  console.log('\n=== CODE BLOCK BOUNDARIES ===\n');

  // Scan for transitions between white/off-white
  // Code blocks should have pure white (#ffffff) background

  // Sample at y=195 (middle of step 1)
  console.log('Step 1 horizontal scan (y=195):');
  for (let x = 100; x < 600; x += 20) {
    const p = getPixel(png, x, 195);
    if (p) console.log(`  x=${x}: rgb(${p.r},${p.g},${p.b})`);
  }

  console.log('\nStep 3 horizontal scan (y=350):');
  for (let x = 100; x < 600; x += 20) {
    const p = getPixel(png, x, 350);
    if (p) console.log(`  x=${x}: rgb(${p.r},${p.g},${p.b})`);
  }

  console.log('\nStep 4 horizontal scan (y=730):');
  for (let x = 100; x < 600; x += 20) {
    const p = getPixel(png, x, 730);
    if (p) console.log(`  x=${x}: rgb(${p.r},${p.g},${p.b})`);
  }
}

main();
