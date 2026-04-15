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

function toY(p) {
  return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

console.log('=== TITLE TEXT ANALYSIS ===\n');

// Title at approximately x=129, y=68, font-size 43
// Scan the title region

let titleMismatch = 0;
let titleTotal = 0;

for (let y = 60; y < 120; y++) {
  for (let x = 120; x < 500; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    titleTotal++;
    const mY = toY(mp);
    const sY = toY(sp);

    if (Math.abs(mY - sY) > 15) {
      titleMismatch++;
    }
  }
}

console.log(`Title region (120-500, 60-120): ${titleMismatch} mismatched out of ${titleTotal} (${(titleMismatch/titleTotal*100).toFixed(2)}%)`);

console.log('\n=== TITLE HORIZONTAL SCAN AT Y=90 ===');
for (let x = 125; x < 145; x++) {
  const mp = getPixel(mockup, x, 90);
  const sp = getPixel(screenshot, x, 90);
  console.log(`x=${x}: mockup Y=${toY(mp).toFixed(0)}, screenshot Y=${toY(sp).toFixed(0)}`);
}

console.log('\n=== STEP 1 CODE BLOCK ANALYSIS ===');

let step1Mismatch = 0;
let step1Total = 0;

// Step 1 code block: x=167, y=177, height=35
for (let y = 170; y < 220; y++) {
  for (let x = 160; x < 550; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    step1Total++;
    const mY = toY(mp);
    const sY = toY(sp);

    if (Math.abs(mY - sY) > 15) {
      step1Mismatch++;
    }
  }
}

console.log(`Step 1 region: ${step1Mismatch} mismatched out of ${step1Total} (${(step1Mismatch/step1Total*100).toFixed(2)}%)`);

console.log('\n=== SLIDER REGION ANALYSIS ===');

let sliderMismatch = 0;
let sliderTotal = 0;

// Sliders: y=310 to y=640, x=160 to x=560
for (let y = 310; y < 640; y++) {
  for (let x = 160; x < 560; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    sliderTotal++;
    const mY = toY(mp);
    const sY = toY(sp);

    if (Math.abs(mY - sY) > 15) {
      sliderMismatch++;
    }
  }
}

console.log(`Slider region: ${sliderMismatch} mismatched out of ${sliderTotal} (${(sliderMismatch/sliderTotal*100).toFixed(2)}%)`);

console.log('\n=== STEP 4 CODE BLOCK ANALYSIS ===');

let step4Mismatch = 0;
let step4Total = 0;

// Step 4: y=666 to y=920, x=160 to x=600
for (let y = 666; y < 920; y++) {
  for (let x = 160; x < 600; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    step4Total++;
    const mY = toY(mp);
    const sY = toY(sp);

    if (Math.abs(mY - sY) > 15) {
      step4Mismatch++;
    }
  }
}

console.log(`Step 4 region: ${step4Mismatch} mismatched out of ${step4Total} (${(step4Mismatch/step4Total*100).toFixed(2)}%)`);

console.log('\n=== BLACK BOX REGION ANALYSIS ===');

let boxMismatch = 0;
let boxTotal = 0;

// Black box: x=858 to x=1793, y=60 to y=932
for (let y = 60; y < 932; y++) {
  for (let x = 858; x < 1793; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    boxTotal++;
    const mY = toY(mp);
    const sY = toY(sp);

    if (Math.abs(mY - sY) > 15) {
      boxMismatch++;
    }
  }
}

console.log(`Black box region: ${boxMismatch} mismatched out of ${boxTotal} (${(boxMismatch/boxTotal*100).toFixed(2)}%)`);
