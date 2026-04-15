import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

function isBlack(p) {
  return p && p.r < 30 && p.g < 30 && p.b < 30;
}

console.log('=== BLACK BOX ANALYSIS ===\n');

// Find left edge
let leftEdge = -1;
for (let x = 800; x < 900; x++) {
  const p = getPixel(x, 500); // middle height
  if (isBlack(p)) {
    leftEdge = x;
    break;
  }
}
console.log(`Left edge: x=${leftEdge}`);

// Find top edge
let topEdge = -1;
for (let y = 0; y < 150; y++) {
  const p = getPixel(1300, y); // middle width of box
  if (isBlack(p)) {
    topEdge = y;
    break;
  }
}
console.log(`Top edge: y=${topEdge}`);

// Find right edge
let rightEdge = -1;
for (let x = 1900; x > 1700; x--) {
  const p = getPixel(x, 500);
  if (isBlack(p)) {
    rightEdge = x;
    break;
  }
}
console.log(`Right edge: x=${rightEdge}`);

// Find bottom edge
let bottomEdge = -1;
for (let y = 990; y > 800; y--) {
  const p = getPixel(1300, y);
  if (isBlack(p)) {
    bottomEdge = y;
    break;
  }
}
console.log(`Bottom edge: y=${bottomEdge}`);

console.log(`\nBox dimensions: ${rightEdge - leftEdge + 1} x ${bottomEdge - topEdge + 1}`);
console.log(`Position: left=${leftEdge}, top=${topEdge}`);

// Analyze corner radius
console.log('\n=== CORNER RADIUS ANALYSIS ===');

// Top-left corner: find where black starts
console.log('\nTop-left corner scan (x from leftEdge, y from topEdge):');
for (let offset = 0; offset < 100; offset += 5) {
  const x = leftEdge + offset;
  const y = topEdge + offset;
  const diagonal = getPixel(x, y);
  const horizontal = getPixel(leftEdge + offset, topEdge);
  const vertical = getPixel(leftEdge, topEdge + offset);

  console.log(`  offset=${offset}: diag=${diagonal ? (isBlack(diagonal) ? 'BLACK' : `rgb(${diagonal.r},${diagonal.g},${diagonal.b})`) : 'null'}`);
}

// Find exact corner radius by scanning along the edge
console.log('\nFinding corner cutoff:');
for (let y = topEdge; y < topEdge + 80; y++) {
  let firstBlackX = -1;
  for (let x = leftEdge - 20; x < leftEdge + 100; x++) {
    if (isBlack(getPixel(x, y))) {
      firstBlackX = x;
      break;
    }
  }
  if (firstBlackX >= 0) {
    const indent = firstBlackX - leftEdge;
    if (indent > 0) {
      console.log(`  y=${y}: first black at x=${firstBlackX} (indent=${indent})`);
    }
  }
}
