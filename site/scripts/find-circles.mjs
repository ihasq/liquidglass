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

  console.log('=== FINDING STEP 3 SLIDER DETAILS ===\n');

  // For each slider row, find:
  // 1. Line start/end
  // 2. Circle position
  // 3. Text position

  const rowYs = [375, 424, 473, 522, 571, 619]; // Approximate y centers

  rowYs.forEach((y, i) => {
    console.log(`Row ${i + 1} (y~${y}):`);

    // Find gray line bounds
    let lineStart = -1, lineEnd = -1;
    for (let x = 130; x < 500; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r > 200 && p.r < 240 && lineStart === -1) {
        lineStart = x;
      }
      if (p && p.r > 200 && p.r < 240) {
        lineEnd = x;
      }
    }
    console.log(`  Line: x=${lineStart} to ${lineEnd} (width=${lineEnd - lineStart})`);

    // Find circle (darker gray, around 150-190)
    let circleX = -1;
    for (let x = lineEnd - 30; x < lineEnd + 50; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r > 130 && p.r < 200 && p.g > 130 && p.g < 200) {
        if (circleX === -1) circleX = x;
      }
    }
    console.log(`  Circle starts at: x=${circleX}`);

    // Find text start (black)
    let textStart = -1;
    for (let x = 420; x < 500; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 50 && textStart === -1) {
        textStart = x;
        break;
      }
    }
    console.log(`  Text starts at: x=${textStart}`);
    console.log('');
  });

  // Check what's at y=315-340 region
  console.log('\n=== Y=315-340 REGION ===');
  for (let y = 315; y < 345; y += 5) {
    let hasText = false;
    for (let x = 150; x < 250; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100) {
        hasText = true;
        break;
      }
    }
    console.log(`y=${y}: has dark text = ${hasText}`);
  }

  // Scan y=320-330 for the first text (should be .div { if present)
  console.log('\nScanning for text in y=320-335:');
  for (let y = 320; y < 340; y++) {
    let firstX = -1;
    for (let x = 150; x < 500; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 50 && firstX === -1) {
        firstX = x;
        break;
      }
    }
    if (firstX > 0) {
      console.log(`  y=${y}: text at x=${firstX}`);
    }
  }
}

main();
