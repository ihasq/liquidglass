import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP 2 CODE BLOCK ANALYSIS ===\n');

// Find the gray (#eee) background for step 2
console.log('Scanning for #eee background (y=230-280):');

for (let y = 230; y < 280; y++) {
  let firstGray = -1;
  let lastGray = -1;

  for (let x = 150; x < 650; x++) {
    const p = getPixel(x, y);
    if (p.r > 230 && p.r < 250 && Math.abs(p.r - p.g) < 5 && Math.abs(p.r - p.b) < 5) {
      if (firstGray === -1) firstGray = x;
      lastGray = x;
    }
  }

  if (firstGray > 0) {
    console.log(`y=${y}: gray from x=${firstGray} to x=${lastGray} (width=${lastGray - firstGray + 1})`);
  }
}

// Find step number ②
console.log('\n=== STEP ② POSITION ===');
for (let y = 245; y < 270; y++) {
  for (let x = 95; x < 140; x++) {
    const p = getPixel(x, y);
    if (p.r > 130 && p.r < 160 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}
