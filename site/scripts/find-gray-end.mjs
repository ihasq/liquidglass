import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * mockup.width + x) * 4;
  return { r: mockup.data[idx], g: mockup.data[idx + 1], b: mockup.data[idx + 2] };
}

function isGray(p) {
  return p.r > 230 && p.r < 250 && Math.abs(p.r - p.g) < 5;
}

console.log('=== FINDING EXACT GRAY END ===\n');

// Step 1 at y=190
let step1End = -1;
for (let x = 580; x < 800; x++) {
  const p = getPixel(x, 190);
  if (isGray(p)) {
    step1End = x;
  }
}
console.log(`Step 1 (y=190): gray ends at x=${step1End}`);

// Step 2 at y=255
let step2End = -1;
for (let x = 600; x < 850; x++) {
  const p = getPixel(x, 255);
  if (isGray(p)) {
    step2End = x;
  }
}
console.log(`Step 2 (y=255): gray ends at x=${step2End}`);

// Step 4 at y=750
let step4End = -1;
for (let x = 650; x < 850; x++) {
  const p = getPixel(x, 750);
  if (isGray(p)) {
    step4End = x;
  }
}
console.log(`Step 4 (y=750): gray ends at x=${step4End}`);

// Actually check where white starts (end of gray block)
console.log('\n=== TRANSITION TO WHITE ===');

for (let x = 750; x < 860; x++) {
  const p1 = getPixel(x, 190);
  const p2 = getPixel(x, 255);
  const p4 = getPixel(x, 750);

  if (p1.r === 255 && !isGray(getPixel(x-1, 190))) {
    console.log(`Step 1 -> white at x=${x}`);
  }
  if (p2.r === 255 && !isGray(getPixel(x-1, 255))) {
    console.log(`Step 2 -> white at x=${x}`);
  }
  if (p4.r === 255 && !isGray(getPixel(x-1, 750))) {
    console.log(`Step 4 -> white at x=${x}`);
  }
}
