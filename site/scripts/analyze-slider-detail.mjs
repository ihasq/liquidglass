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

console.log('=== SLIDER 1 DETAILED COMPARISON ===\n');

// Slider 1 is at y=325, knob x=445-474

// Compare the black knob area
console.log('Comparing black knob area (x=445-475, y=310-340):');

let blackMismatch = 0;
let totalBlack = 0;

for (let y = 310; y < 342; y++) {
  for (let x = 444; x < 476; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    // Count black pixels
    const mBlack = mp.r < 30;
    const sBlack = sp.r < 30;

    if (mBlack || sBlack) {
      totalBlack++;
      if (mBlack !== sBlack) blackMismatch++;
    }
  }
}

console.log(`Black area mismatch: ${blackMismatch}/${totalBlack} (${(blackMismatch/totalBlack*100).toFixed(1)}%)`);

// Analyze knob shape differences
console.log('\n=== KNOB SHAPE ANALYSIS ===');

// Find knob bounds in both images
function findKnobBounds(png, centerY) {
  let left = 999, right = 0, top = 999, bottom = 0;

  for (let y = centerY - 20; y < centerY + 20; y++) {
    for (let x = 430; x < 490; x++) {
      const p = getPixel(png, x, y);
      if (p.r < 30) { // Black
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

const mBounds = findKnobBounds(mockup, 325);
const sBounds = findKnobBounds(screenshot, 325);

console.log(`Mockup knob: x=${mBounds.left}-${mBounds.right}, y=${mBounds.top}-${mBounds.bottom}, size=${mBounds.width}x${mBounds.height}`);
console.log(`Screenshot knob: x=${sBounds.left}-${sBounds.right}, y=${sBounds.top}-${sBounds.bottom}, size=${sBounds.width}x${sBounds.height}`);

// Check if the issue is the gray line position
console.log('\n=== GRAY LINE ANALYSIS ===');

// Left gray line ends where?
let mLineEnd = 0, sLineEnd = 0;
for (let x = 400; x < 450; x++) {
  const mp = getPixel(mockup, x, 325);
  const sp = getPixel(screenshot, x, 325);

  // Gray is around 217
  if (mp.r > 200 && mp.r < 230) mLineEnd = x;
  if (sp.r > 200 && sp.r < 230) sLineEnd = x;
}
console.log(`Left gray line ends: mockup x=${mLineEnd}, screenshot x=${sLineEnd}`);

// Right gray line starts where?
let mLineStart = 999, sLineStart = 999;
for (let x = 475; x < 560; x++) {
  const mp = getPixel(mockup, x, 325);
  const sp = getPixel(screenshot, x, 325);

  if (mp.r > 200 && mp.r < 230 && mLineStart === 999) mLineStart = x;
  if (sp.r > 200 && sp.r < 230 && sLineStart === 999) sLineStart = x;
}
console.log(`Right gray line starts: mockup x=${mLineStart}, screenshot x=${sLineStart}`);
