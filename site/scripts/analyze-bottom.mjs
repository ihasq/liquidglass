import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP 4 CODE BLOCK BOTTOM ANALYSIS ===\n');

// Check bottom of code block at x=300
console.log('Scanning y from 850 to 930 at x=300:');
for (let y = 850; y < 930; y++) {
  const p = getPixel(300, y);
  const isGray = p.r > 225 && p.r < 250;
  const isWhite = p.r > 250;
  const isBlack = p.r < 30;
  const status = isGray ? 'GRAY' : isWhite ? 'WHITE' : isBlack ? 'BLACK' : `rgb(${p.r},${p.g},${p.b})`;
  console.log(`  y=${y}: ${status}`);
}

// Check the text content end
console.log('\n=== LAST LINE OF CODE ===');
// Looking for "}" which should be the last line
for (let y = 870; y < 920; y++) {
  let hasBlack = false;
  for (let x = 180; x < 250; x++) {
    const p = getPixel(x, y);
    if (p && p.r < 30) {
      hasBlack = true;
      break;
    }
  }
  if (hasBlack) {
    console.log(`  y=${y}: has black text`);
  }
}

// Bottom padding analysis
console.log('\n=== BOTTOM EDGE ===');
let lastGrayY = -1;
for (let y = 920; y > 850; y--) {
  const p = getPixel(300, y);
  if (p.r > 225 && p.r < 250) {
    lastGrayY = y;
    console.log(`Last gray pixel at y=${y}`);
    break;
  }
}

// Last text line
let lastTextY = -1;
for (let y = 920; y > 850; y--) {
  for (let x = 180; x < 250; x++) {
    const p = getPixel(x, y);
    if (p && p.r < 30) {
      lastTextY = y;
      break;
    }
  }
  if (lastTextY > 0) {
    console.log(`Last text line at y=${lastTextY}`);
    break;
  }
}

if (lastGrayY > 0 && lastTextY > 0) {
  console.log(`Bottom padding: ${lastGrayY - lastTextY}px`);
}
