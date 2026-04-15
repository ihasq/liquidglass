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

console.log('=== TITLE TEXT DETAILED ANALYSIS ===\n');

// Title region: approximately x=127-500, y=68-110

// Find exact title bounds in mockup
console.log('Finding title text bounds in mockup:');
let titleLeft = 999, titleRight = 0, titleTop = 999, titleBottom = 0;

for (let y = 60; y < 120; y++) {
  for (let x = 120; x < 550; x++) {
    const p = getPixel(mockup, x, y);
    if (p.r < 30) { // Black text
      if (x < titleLeft) titleLeft = x;
      if (x > titleRight) titleRight = x;
      if (y < titleTop) titleTop = y;
      if (y > titleBottom) titleBottom = y;
    }
  }
}
console.log(`Mockup title bounds: x=${titleLeft}-${titleRight}, y=${titleTop}-${titleBottom}`);
console.log(`Mockup title size: ${titleRight - titleLeft}px x ${titleBottom - titleTop}px`);

// Same for screenshot
console.log('\nFinding title text bounds in screenshot:');
let sLeft = 999, sRight = 0, sTop = 999, sBottom = 0;

for (let y = 60; y < 120; y++) {
  for (let x = 120; x < 550; x++) {
    const p = getPixel(screenshot, x, y);
    if (p.r < 30) { // Black text
      if (x < sLeft) sLeft = x;
      if (x > sRight) sRight = x;
      if (y < sTop) sTop = y;
      if (y > sBottom) sBottom = y;
    }
  }
}
console.log(`Screenshot title bounds: x=${sLeft}-${sRight}, y=${sTop}-${sBottom}`);
console.log(`Screenshot title size: ${sRight - sLeft}px x ${sBottom - sTop}px`);

console.log('\n=== POSITION DIFFERENCE ===');
console.log(`X offset: ${sLeft - titleLeft}px (screenshot - mockup)`);
console.log(`Y offset: ${sTop - titleTop}px`);
console.log(`Width diff: ${(sRight - sLeft) - (titleRight - titleLeft)}px`);
console.log(`Height diff: ${(sBottom - sTop) - (titleBottom - titleTop)}px`);

// Compare specific scan lines
console.log('\n=== HORIZONTAL SCAN AT TITLE CENTER ===');
const centerY = Math.floor((titleTop + titleBottom) / 2);
console.log(`Scanning at y=${centerY}:`);

for (let x = titleLeft - 5; x < titleLeft + 30; x++) {
  const mp = getPixel(mockup, x, centerY);
  const sp = getPixel(screenshot, x, centerY);
  const mBlack = mp.r < 30 ? 'X' : '.';
  const sBlack = sp.r < 30 ? 'X' : '.';
  if (mBlack !== sBlack) {
    console.log(`x=${x}: mockup=${mBlack} screenshot=${sBlack} MISMATCH`);
  }
}
