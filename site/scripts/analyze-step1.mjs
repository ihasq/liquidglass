import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP 1 CODE BLOCK ANALYSIS ===\n');

// Find the gray (#eee) background for step 1
console.log('Scanning for #eee background (y=170-220):');

for (let y = 170; y < 220; y++) {
  let firstGray = -1;
  let lastGray = -1;

  for (let x = 150; x < 600; x++) {
    const p = getPixel(x, y);
    // #eee is approximately rgb(238, 238, 238)
    if (p.r > 230 && p.r < 250 && Math.abs(p.r - p.g) < 5 && Math.abs(p.r - p.b) < 5) {
      if (firstGray === -1) firstGray = x;
      lastGray = x;
    }
  }

  if (firstGray > 0) {
    console.log(`y=${y}: gray from x=${firstGray} to x=${lastGray} (width=${lastGray - firstGray + 1})`);
  }
}

// Find step number ①
console.log('\n=== STEP ① POSITION ===');
for (let y = 175; y < 200; y++) {
  for (let x = 95; x < 130; x++) {
    const p = getPixel(x, y);
    // Looking for gray #b0b0b0 (176,176,176)
    if (p.r > 160 && p.r < 190 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}

// Find first text in step 1 code block
console.log('\n=== TEXT "npm" POSITION ===');
for (let y = 175; y < 200; y++) {
  let firstBlack = -1;
  for (let x = 180; x < 250; x++) {
    const p = getPixel(x, y);
    if (p.r < 30 && p.g < 30 && p.b < 30) {
      if (firstBlack === -1) {
        firstBlack = x;
        console.log(`y=${y}: first black text at x=${firstBlack}`);
        break;
      }
    }
  }
}

// Find copy icon position
console.log('\n=== COPY ICON POSITION ===');
for (let y = 180; y < 200; y++) {
  for (let x = 500; x < 550; x++) {
    const p = getPixel(x, y);
    // Looking for #b0b0b0 gray of the icon
    if (p.r > 160 && p.r < 190 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Icon gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}
