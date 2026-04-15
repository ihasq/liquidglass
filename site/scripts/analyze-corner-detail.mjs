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

console.log('=== TOP-LEFT CORNER COMPARISON ===\n');

// Black box: left=858, top=60
// Looking at the corner region

console.log('Mockup vs Screenshot at top-left corner (x=858-880, y=60-80):');
console.log('Format: (mockup) vs (screenshot)\n');

for (let y = 60; y <= 80; y += 5) {
  let row = `y=${y}: `;
  for (let x = 858; x <= 880; x += 5) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    const mLabel = mp.r < 30 ? 'BLK' : mp.r > 250 ? 'WHT' : `${mp.r}`;
    const sLabel = sp.r < 30 ? 'BLK' : sp.r > 250 ? 'WHT' : `${sp.r}`;

    row += `[${mLabel}/${sLabel}] `;
  }
  console.log(row);
}

console.log('\n=== DETAILED DIAGONAL SCAN ===');
for (let offset = 0; offset < 80; offset += 2) {
  const x = 858 + offset;
  const y = 60 + offset;

  const mp = getPixel(mockup, x, y);
  const sp = getPixel(screenshot, x, y);

  const diff = Math.abs(mp.r - sp.r);
  const marker = diff > 50 ? '***' : diff > 10 ? '*' : '';

  console.log(`offset=${offset}: mockup(${mp.r},${mp.g},${mp.b}) vs screenshot(${sp.r},${sp.g},${sp.b}) diff=${diff} ${marker}`);
}

console.log('\n=== BOTTOM-RIGHT CORNER ===');
// box ends at x=1793, y=932
for (let offset = 0; offset < 80; offset += 2) {
  const x = 1793 - offset;
  const y = 932 - offset;

  const mp = getPixel(mockup, x, y);
  const sp = getPixel(screenshot, x, y);

  const diff = Math.abs(mp.r - sp.r);
  const marker = diff > 50 ? '***' : diff > 10 ? '*' : '';

  console.log(`offset=${offset}: mockup(${mp.r},${mp.g},${mp.b}) vs screenshot(${sp.r},${sp.g},${sp.b}) diff=${diff} ${marker}`);
}
