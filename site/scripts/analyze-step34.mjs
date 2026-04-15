import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP ③ POSITION ===');
for (let y = 305; y < 330; y++) {
  for (let x = 95; x < 140; x++) {
    const p = getPixel(x, y);
    if (p.r > 150 && p.r < 180 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}

console.log('\n=== STEP 4 CODE BLOCK ANALYSIS ===\n');

// Find the gray (#eee) background for step 4
console.log('Scanning for #eee background (y=660-930):');

let firstY = -1, lastY = -1;
for (let y = 660; y < 930; y++) {
  let firstGray = -1;
  let lastGray = -1;

  for (let x = 150; x < 700; x++) {
    const p = getPixel(x, y);
    if (p.r > 230 && p.r < 250 && Math.abs(p.r - p.g) < 5 && Math.abs(p.r - p.b) < 5) {
      if (firstGray === -1) firstGray = x;
      lastGray = x;
    }
  }

  if (firstGray > 0) {
    if (firstY === -1) {
      firstY = y;
      console.log(`First row y=${y}: x=${firstGray} to x=${lastGray}`);
    }
    lastY = y;
  }
}
console.log(`Last row y=${lastY}`);
console.log(`Height: ${lastY - firstY + 1}`);

// Check middle for consistent x bounds
const midY = Math.floor((firstY + lastY) / 2);
let midFirstGray = -1, midLastGray = -1;
for (let x = 150; x < 700; x++) {
  const p = getPixel(x, midY);
  if (p.r > 230 && p.r < 250 && Math.abs(p.r - p.g) < 5) {
    if (midFirstGray === -1) midFirstGray = x;
    midLastGray = x;
  }
}
console.log(`Middle row (y=${midY}): x=${midFirstGray} to x=${midLastGray} (width=${midLastGray - midFirstGray + 1})`);

// Find step number ④
console.log('\n=== STEP ④ POSITION ===');
for (let y = 675; y < 710; y++) {
  for (let x = 95; x < 150; x++) {
    const p = getPixel(x, y);
    if (p.r > 120 && p.r < 150 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}
