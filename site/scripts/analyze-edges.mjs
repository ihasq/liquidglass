import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';

const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));
const screenshot = PNG.sync.read(fs.readFileSync(SCREENSHOT_PATH));

function getPixel(png, x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP 1 RIGHT EDGE (y=190) ===');
for (let x = 590; x < 620; x++) {
  const mp = getPixel(mockup, x, 190);
  const sp = getPixel(screenshot, x, 190);
  console.log(`x=${x}: mockup(${mp.r},${mp.g},${mp.b}) vs screenshot(${sp.r},${sp.g},${sp.b})`);
}

console.log('\n=== STEP 2 RIGHT EDGE (y=255) ===');
for (let x = 640; x < 670; x++) {
  const mp = getPixel(mockup, x, 255);
  const sp = getPixel(screenshot, x, 255);
  console.log(`x=${x}: mockup(${mp.r},${mp.g},${mp.b}) vs screenshot(${sp.r},${sp.g},${sp.b})`);
}

console.log('\n=== STEP 4 RIGHT EDGE (y=750) ===');
for (let x = 690; x < 720; x++) {
  const mp = getPixel(mockup, x, 750);
  const sp = getPixel(screenshot, x, 750);
  console.log(`x=${x}: mockup(${mp.r},${mp.g},${mp.b}) vs screenshot(${sp.r},${sp.g},${sp.b})`);
}

// Check what's to the right of step 1 in mockup
console.log('\n=== WHAT IS RIGHT OF STEP 1 (x=600-650, y=190) ===');
for (let x = 595; x < 650; x += 5) {
  const p = getPixel(mockup, x, 190);
  console.log(`x=${x}: mockup(${p.r},${p.g},${p.b})`);
}
