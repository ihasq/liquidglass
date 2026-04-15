import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== STEP 4 CODE BLOCK ANALYSIS ===\n');

// Sample some pixels around y=700 area
console.log('Sampling pixels at y=750:');
for (let x = 160; x < 400; x += 20) {
  const p = getPixel(x, 750);
  console.log(`  x=${x}: rgb(${p.r}, ${p.g}, ${p.b})`);
}

// Find vertical extent of gray background
console.log('\nFinding gray background extent at x=300:');
let topY = -1, bottomY = -1;
for (let y = 650; y < 920; y++) {
  const p = getPixel(300, y);
  // #eee is approximately rgb(238, 238, 238)
  const isEee = p && p.r > 225 && p.r < 250 && p.g > 225 && p.g < 250 && p.b > 225 && p.b < 250;
  if (isEee) {
    if (topY === -1) {
      topY = y;
      console.log(`Gray starts at y=${y}: rgb(${p.r}, ${p.g}, ${p.b})`);
    }
    bottomY = y;
  }
}
console.log(`Gray ends at y=${bottomY}`);
console.log(`Height: ${bottomY - topY + 1}`);

// Find left edge
console.log('\nFinding left edge at y=750:');
for (let x = 155; x < 180; x++) {
  const p = getPixel(x, 750);
  console.log(`  x=${x}: rgb(${p.r}, ${p.g}, ${p.b})`);
}

// Find step ④ position more precisely
console.log('\n=== STEP ④ POSITION ===');
// The circled number is a gray color, not white
for (let y = 665; y < 700; y++) {
  for (let x = 100; x < 140; x++) {
    const p = getPixel(x, y);
    // Looking for gray circle (around 130-140 gray value)
    if (p && p.r > 120 && p.r < 150 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10) {
      console.log(`Gray (#858585) at y=${y}, x=${x}: rgb(${p.r}, ${p.g}, ${p.b})`);
    }
  }
}

// First text in code block
console.log('\n=== FIRST TEXT IN CODE BLOCK ===');
for (let y = topY; y < topY + 40; y++) {
  for (let x = 175; x < 250; x++) {
    const p = getPixel(x, y);
    if (p && p.r < 30 && p.g < 30 && p.b < 30) {
      console.log(`Black text at y=${y}, x=${x}`);
      break;
    }
  }
}
