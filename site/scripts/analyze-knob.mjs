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

console.log('=== SLIDER KNOB 1 (y=325) DETAILED ===\n');

// Knob is at x=445-474, y=311-340 (from earlier analysis)
console.log('Knob area comparison:');

let mismatchCount = 0;
for (let y = 310; y < 342; y++) {
  let row = `y=${y}: `;
  for (let x = 444; x < 476; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    const diff = Math.abs(mp.r - sp.r);
    if (diff > 30) {
      row += 'X';
      mismatchCount++;
    } else if (diff > 10) {
      row += '.';
    } else {
      row += ' ';
    }
  }
  console.log(row);
}
console.log(`Total significant mismatches: ${mismatchCount}`);

// Find white text center in mockup
console.log('\n=== WHITE TEXT POSITION IN MOCKUP ===');
let textLeft = 999, textRight = 0, textTop = 999, textBottom = 0;
for (let y = 315; y < 336; y++) {
  for (let x = 450; x < 470; x++) {
    const mp = getPixel(mockup, x, y);
    if (mp.r > 200) {
      if (x < textLeft) textLeft = x;
      if (x > textRight) textRight = x;
      if (y < textTop) textTop = y;
      if (y > textBottom) textBottom = y;
    }
  }
}
console.log(`Text bounds: x=${textLeft}-${textRight}, y=${textTop}-${textBottom}`);
console.log(`Text center: (${Math.floor((textLeft+textRight)/2)}, ${Math.floor((textTop+textBottom)/2)})`);
console.log(`Knob center: (${Math.floor((445+474)/2)}, ${Math.floor((311+340)/2)}) = (459, 325)`);

// Same for screenshot
console.log('\n=== WHITE TEXT POSITION IN SCREENSHOT ===');
textLeft = 999; textRight = 0; textTop = 999; textBottom = 0;
for (let y = 315; y < 336; y++) {
  for (let x = 450; x < 470; x++) {
    const sp = getPixel(screenshot, x, y);
    if (sp.r > 200) {
      if (x < textLeft) textLeft = x;
      if (x > textRight) textRight = x;
      if (y < textTop) textTop = y;
      if (y > textBottom) textBottom = y;
    }
  }
}
console.log(`Text bounds: x=${textLeft}-${textRight}, y=${textTop}-${textBottom}`);
console.log(`Text center: (${Math.floor((textLeft+textRight)/2)}, ${Math.floor((textTop+textBottom)/2)})`);
