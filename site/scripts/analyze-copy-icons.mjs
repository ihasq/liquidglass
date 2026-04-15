import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== COPY ICON ANALYSIS ===\n');

// Step 1 copy icon - should be gray (#b0b0b0 = 176) on gray bg (#eee = 238)
console.log('Step 1 copy icon (around y=190):');
for (let y = 185; y < 200; y++) {
  for (let x = 720; x < 760; x++) {
    const p = getPixel(x, y);
    // Looking for gray icon color (around 176) distinct from bg (238)
    if (p.r > 160 && p.r < 190 && Math.abs(p.r - p.g) < 10) {
      console.log(`  Icon gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}

// Step 2 copy icon
console.log('\nStep 2 copy icon (around y=255):');
for (let y = 250; y < 265; y++) {
  for (let x = 720; x < 760; x++) {
    const p = getPixel(x, y);
    if (p.r > 140 && p.r < 160 && Math.abs(p.r - p.g) < 10) {
      console.log(`  Icon gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}

// Step 4 copy icon
console.log('\nStep 4 copy icon (around y=690):');
for (let y = 680; y < 705; y++) {
  for (let x = 720; x < 760; x++) {
    const p = getPixel(x, y);
    if (p.r > 120 && p.r < 150 && Math.abs(p.r - p.g) < 10) {
      console.log(`  Icon gray at (${x}, ${y}): rgb(${p.r},${p.g},${p.b})`);
    }
  }
}
