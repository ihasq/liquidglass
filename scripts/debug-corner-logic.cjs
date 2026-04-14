// Debug corner logic - understand the exact pattern at corners
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Check the corner zone in detail
console.log('=== Top-Left Corner Zone ===');
console.log('Looking for where R or G first becomes non-128...\n');

// Scan diagonally from corner
console.log('Diagonal from (0,0):');
for (let d = 0; d < 150; d++) {
  const p = getPixel(d, d);
  if (p.r !== 128 || p.g !== 128) {
    console.log(`First non-128 at (${d}, ${d}): R=${p.r}, G=${p.g}`);
    break;
  }
}

// Scan horizontally at different y levels
console.log('\nHorizontal scans (finding first non-128 R):');
for (let y = 0; y < 150; y += 10) {
  let firstX = -1;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      firstX = x;
      break;
    }
  }
  console.log(`y=${y}: first non-128 R at x=${firstX}`);
}

// The key insight: at the LEFT edge, R becomes active based on y distance from corners
// Let me check what y value makes R active at x=0
console.log('\nVertical scan at x=0 (left edge):');
for (let y = 0; y < 160; y++) {
  const p = getPixel(0, y);
  if (p.r !== 128) {
    console.log(`y=${y}: first non-128 R at left edge: R=${p.r}`);
    break;
  }
}

// And at x=1, x=2, etc.
console.log('\nVertical scans at different x values:');
for (let x = 0; x < 10; x++) {
  let firstY = -1;
  for (let y = 0; y < height / 2; y++) {
    if (getPixel(x, y).r !== 128) {
      firstY = y;
      break;
    }
  }
  console.log(`x=${x}: first non-128 R at y=${firstY}`);
}

// The corner seems to be: R is 128 when distLeft < some_threshold_based_on_y
// And that threshold depends on both x and y following a curve

console.log('\n=== Verifying the corner boundary curve ===');
console.log('For each (x,y) in corner zone, check if R,G matches expected pattern');

// The corner should have a specific shape. Let me check if it's related to
// the minimum of distLeft and distTop
console.log('\nx\ty\tR\tG\tminDist\tdistL+distT');
for (let y = 0; y <= 20; y += 2) {
  for (let x = 0; x <= 20; x += 2) {
    const p = getPixel(x, y);
    const minDist = Math.min(x, y);
    console.log(`${x}\t${y}\t${p.r}\t${p.g}\t${minDist}\t${x + y}`);
  }
}
