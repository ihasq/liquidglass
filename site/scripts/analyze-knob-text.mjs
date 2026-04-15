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

console.log('=== KNOB TEXT ANALYSIS (Slider 1, y=325) ===\n');

// Find white text bounds in mockup knob (x=445-474, y=311-340)
function findWhiteTextBounds(png, knobX, knobY, knobW, knobH) {
  let left = 999, right = 0, top = 999, bottom = 0;

  for (let y = knobY; y < knobY + knobH; y++) {
    for (let x = knobX; x < knobX + knobW; x++) {
      const p = getPixel(png, x, y);
      if (p.r > 150) { // White or light gray (text)
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { left, right, top, bottom };
}

const mBounds = findWhiteTextBounds(mockup, 445, 311, 30, 30);
const sBounds = findWhiteTextBounds(screenshot, 445, 311, 30, 30);

console.log('Mockup text bounds:', mBounds);
console.log('Screenshot text bounds:', sBounds);

console.log('\nText center comparison:');
const mCenterX = Math.floor((mBounds.left + mBounds.right) / 2);
const mCenterY = Math.floor((mBounds.top + mBounds.bottom) / 2);
const sCenterX = Math.floor((sBounds.left + sBounds.right) / 2);
const sCenterY = Math.floor((sBounds.top + sBounds.bottom) / 2);

console.log(`Mockup text center: (${mCenterX}, ${mCenterY})`);
console.log(`Screenshot text center: (${sCenterX}, ${sCenterY})`);
console.log(`Knob center: (460, 326)`);

console.log('\n=== COMPARING PIXELS IN KNOB CENTER AREA ===');
for (let y = 320; y < 332; y++) {
  let row = `y=${y}: `;
  for (let x = 452; x < 470; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    // M=mockup white, S=screenshot white, .=both dark, X=mismatch
    const mWhite = mp.r > 150;
    const sWhite = sp.r > 150;

    if (mWhite && sWhite) row += 'O'; // both white
    else if (!mWhite && !sWhite) row += '.'; // both dark
    else if (mWhite && !sWhite) row += 'M'; // only mockup
    else row += 'S'; // only screenshot
  }
  console.log(row);
}
